#define NAPI_VERSION 8
#define WIN32_LEAN_AND_MEAN
#include <node_api.h>
#include <windows.h>
#include <winternl.h>
#include <bcrypt.h>
#include <algorithm>
#include <cwctype>
#include <sstream>
#include <string>
#include <vector>

// Isolated synchronous experiment. No source capability, SQLite, or product exports.
namespace {
constexpr DWORD ReadDir = FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE;
constexpr DWORD WriteDir = ReadDir | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY;
constexpr DWORD SpecificFile = FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE | DELETE;
// NtCreateFile's synchronous option requires the explicit SYNCHRONIZE bit.
constexpr DWORD GenericFile = GENERIC_READ | GENERIC_WRITE | DELETE | SYNCHRONIZE;
constexpr DWORD Chunk = 128 * 1024, Large = 3 * 1024 * 1024 + 17;
constexpr ULONG Collision = 0xC0000035UL, Sharing = 0xC0000043UL, Denied = 0xC0000022UL;
struct Failure { const char* code; };
void need(bool ok, const char* code) { if (!ok) throw Failure{code}; }
std::string boolean(bool b) { return b ? "true" : "false"; }
std::string quoted(const std::string& s) { return "\"" + s + "\""; } // Only fixed codes and hex IDs/digests.
std::string hex(const unsigned char* p, size_t n) {
  const char* alphabet = "0123456789abcdef"; std::string s;
  for (size_t i = 0; i < n; ++i) { s += alphabet[p[i] >> 4]; s += alphabet[p[i] & 15]; } return s;
}
std::string identity(HANDLE h) {
  FILE_ID_INFO id{}; need(GetFileInformationByHandleEx(h, FileIdInfo, &id, sizeof(id)), "IDENTITY_FAILED");
  std::ostringstream out; out << std::hex; out.width(16); out.fill('0'); out << id.VolumeSerialNumber;
  return out.str() + ":" + hex(id.FileId.Identifier, 16);
}
DWORD inspect(HANDLE h, bool directory) {
  FILE_ATTRIBUTE_TAG_INFO a{}; FILE_STANDARD_INFO s{};
  need(GetFileType(h) == FILE_TYPE_DISK && GetFileInformationByHandleEx(h, FileAttributeTagInfo, &a, sizeof(a)) &&
    GetFileInformationByHandleEx(h, FileStandardInfo, &s, sizeof(s)), "INSPECT_FAILED");
  need(!(a.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)), "REPARSE_REJECTED");
  need(bool(s.Directory) == directory && !s.DeletePending && s.EndOfFile.QuadPart >= 0, "LAYOUT_REJECTED"); return a.FileAttributes;
}
bool safeName(const std::wstring& name) {
  if (name.empty() || name.size() > 255 || name == L"." || name == L".." || name.back() == L'.' || name.back() == L' ') return false;
  for (wchar_t c : name) if (c < 32 || c == 127 || std::wstring(L"\\/:*?\"<>|").find(c) != std::wstring::npos) return false;
  auto base = name.substr(0, name.find(L'.')); std::transform(base.begin(), base.end(), base.begin(), towupper);
  if (base == L"CON" || base == L"PRN" || base == L"AUX" || base == L"NUL" || base == L"CONIN$" || base == L"CONOUT$") return false;
  if (base.size() == 4 && (base.substr(0, 3) == L"COM" || base.substr(0, 3) == L"LPT") &&
    ((base[3] >= L'0' && base[3] <= L'9') || base[3] == L'\u00b9' || base[3] == L'\u00b2' || base[3] == L'\u00b3')) return false;
  return true;
}
struct Open { HANDLE h = INVALID_HANDLE_VALUE; ULONG status = 0; ULONG_PTR information = 0; };
using NtCreate = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
Open relative(HANDLE parent, const std::wstring& name, bool dir, DWORD access, DWORD share, ULONG disposition) {
  need(safeName(name), "INVALID_COMPONENT");
  auto fn = reinterpret_cast<NtCreate>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtCreateFile")); need(fn != nullptr, "API_UNAVAILABLE");
  UNICODE_STRING text{}; text.Length = static_cast<USHORT>(name.size() * sizeof(wchar_t)); text.MaximumLength = text.Length; text.Buffer = const_cast<PWSTR>(name.c_str());
  OBJECT_ATTRIBUTES attrs{}; attrs.Length = sizeof(attrs); attrs.RootDirectory = parent; attrs.ObjectName = &text; attrs.Attributes = OBJ_CASE_INSENSITIVE;
  IO_STATUS_BLOCK io{}; Open result;
  result.status = static_cast<ULONG>(fn(&result.h, access, &attrs, &io, nullptr, 0, share, disposition,
    FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT | (dir ? FILE_DIRECTORY_FILE : FILE_NON_DIRECTORY_FILE), nullptr, 0));
  result.information = io.Information; return result;
}
bool succeeded(const Open& r) { return (r.status & 0x80000000UL) == 0; }
std::string category(ULONG status) {
  if (!(status & 0x80000000UL)) return "SUCCESS";
  if (status == Collision) return "COLLISION"; if (status == Sharing) return "SHARING_DENIED"; if (status == Denied) return "ACCESS_DENIED";
  return "NT_FAILURE";
}
std::string opening(const Open& o) {
  return "{\"ntStatus\":" + std::to_string(o.status) + ",\"information\":" + std::to_string(o.information) + ",\"category\":" + quoted(category(o.status)) + "}";
}
struct Held { HANDLE h; std::string id; DWORD attributes = 0; bool directory; bool active = true; bool closeAttempted = false; };
struct Context {
  std::vector<Held> held; std::vector<std::string> rows, closes; bool closeOK = true; uint32_t cryptoCloses = 0, cryptoCloseFailures = 0; ULONGLONG start = GetTickCount64();
  void cryptoClose(NTSTATUS status) noexcept { ++cryptoCloses; if (status < 0) { ++cryptoCloseFailures; closeOK = false; } }
  void checkpoint() { need(GetTickCount64() - start < 45000, "NATIVE_DEADLINE"); }
  size_t adopt(HANDLE h, bool directory) {
    need(h != INVALID_HANDLE_VALUE && h != nullptr, "OPEN_FAILED"); const size_t at = held.size();
    held.push_back({h, "", 0, directory, true}); // Own first, so even inspection failure is checked-close.
    held[at].attributes = inspect(h, directory); held[at].id = identity(h); return at;
  }
  size_t requireOpen(const Open& o, bool directory) { need(succeeded(o), "OPEN_FAILED"); return adopt(o.h, directory); }
  HANDLE h(size_t at) { return held.at(at).h; }
  void close(size_t at) {
    auto& entry = held.at(at); if (!entry.active || entry.closeAttempted) return;
    entry.closeAttempted = true; // Unknown failure is not retried against a possibly recycled handle.
    SetLastError(0); const BOOL ok = CloseHandle(entry.h); const DWORD error = ok ? 0 : GetLastError();
    closes.push_back("{\"slot\":" + std::to_string(at) + ",\"ok\":" + boolean(ok != 0) + ",\"win32\":" + std::to_string(error) + "}");
    if (ok) entry.active = false; else closeOK = false;
  }
  void closeAll() { for (size_t i = held.size(); i-- > 0;) if (held[i].active) close(i); }
  void verifyDirectories() {
    for (const auto& entry : held) if (entry.active && entry.directory) {
      inspect(entry.h, true); need(identity(entry.h) == entry.id, "IDENTITY_CHANGED");
    }
  }
  void row(const std::string& s) { rows.push_back(s); }
  std::string join(const std::vector<std::string>& v) { std::string s; for (const auto& r : v) { if (!s.empty()) s += ','; s += r; } return "[" + s + "]"; }
  std::string report(const char* outcome) {
    return "{\"outcome\":" + quoted(outcome) + ",\"closed\":" + boolean(closeOK && std::none_of(held.begin(), held.end(), [](const Held& e) { return e.active; })) +
      ",\"cryptoCloseCalls\":" + std::to_string(cryptoCloses) + ",\"cryptoCloseFailures\":" + std::to_string(cryptoCloseFailures) + ",\"rows\":" + join(rows) + ",\"closeResults\":" + join(closes) + "}";
  }
};
size_t bind(Context& c, const std::wstring& root) {
  need(root.size() > 3 && root.size() < 32700 && iswalpha(root[0]) && root[1] == L':' && root[2] == L'\\' && root.back() != L'\\', "INVALID_ROOT");
  const auto leaf = root.substr(root.find_last_of(L'\\') + 1);
  need(leaf.find(L"project-xray-write-probe-") == 0 && safeName(leaf), "NOT_PROBE_ROOT");
  need(GetDriveTypeW(root.substr(0, 3).c_str()) == DRIVE_FIXED, "UNSUPPORTED_VOLUME");
  const auto volume = L"\\\\?\\" + root.substr(0, 3);
  const size_t base = c.adopt(CreateFileW(volume.c_str(), ReadDir, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr), true);
  wchar_t actual[32768]{}, filesystem[32]{};
  const DWORD n = GetFinalPathNameByHandleW(c.h(base), actual, 32768, FILE_NAME_NORMALIZED | VOLUME_NAME_NT);
  need(n && n < 32768 && std::wstring(actual, n).find(L"\\Device\\HarddiskVolume") == 0 &&
    GetVolumeInformationByHandleW(c.h(base), nullptr, 0, nullptr, nullptr, nullptr, filesystem, 32) && std::wstring(filesystem) == L"NTFS", "UNSUPPORTED_VOLUME");
  size_t current = base;
  for (size_t from = 3; from < root.size();) {
    c.checkpoint(); const size_t end = root.find(L'\\', from); const auto name = root.substr(from, end == std::wstring::npos ? end : end - from);
    current = c.requireOpen(relative(c.h(current), name, true, ReadDir, FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_OPEN), true);
    need(c.held[current].id.substr(0, 16) == c.held[base].id.substr(0, 16), "VOLUME_CHANGED");
    if (end == std::wstring::npos) break; from = end + 1;
  }
  c.row("{\"test\":\"containerBinding\",\"id\":" + quoted(c.held[current].id) + ",\"attributes\":" + std::to_string(c.held[current].attributes) + "}"); return current;
}
struct Hash {
  Context& context;
  BCRYPT_ALG_HANDLE provider = nullptr; BCRYPT_HASH_HANDLE hash = nullptr; std::vector<unsigned char> state;
  explicit Hash(Context& c) : context(c) {
    need(BCryptOpenAlgorithmProvider(&provider, BCRYPT_SHA256_ALGORITHM, nullptr, 0) >= 0, "HASH_FAILED");
    DWORD size = 0, returned = 0;
    if (BCryptGetProperty(provider, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&size), sizeof(size), &returned, 0) < 0) { context.cryptoClose(BCryptCloseAlgorithmProvider(provider, 0)); provider = nullptr; throw Failure{"HASH_FAILED"}; }
    state.resize(size);
    if (BCryptCreateHash(provider, &hash, state.data(), size, nullptr, 0, 0) < 0) { context.cryptoClose(BCryptCloseAlgorithmProvider(provider, 0)); provider = nullptr; throw Failure{"HASH_FAILED"}; }
  }
  ~Hash() { if (hash) context.cryptoClose(BCryptDestroyHash(hash)); if (provider) context.cryptoClose(BCryptCloseAlgorithmProvider(provider, 0)); }
  void add(unsigned char* bytes, DWORD n) { need(BCryptHashData(hash, bytes, n, 0) >= 0, "HASH_FAILED"); }
  std::string finish() { unsigned char digest[32]{}; need(BCryptFinishHash(hash, digest, 32, 0) >= 0, "HASH_FAILED"); return hex(digest, 32); }
};
void renameAttempt(Context& c, const std::wstring& path, const char* name) {
  SetLastError(0); const BOOL ok = MoveFileExW(path.c_str(), (path + L"-rename-attempt").c_str(), 0); const DWORD error = ok ? 0 : GetLastError();
  c.row("{\"test\":" + quoted(name) + ",\"ok\":" + boolean(ok != 0) + ",\"win32\":" + std::to_string(error) + "}");
  need(!ok && error == ERROR_SHARING_VIOLATION, "RENAME_NOT_SHARING_DENIED"); c.verifyDirectories();
}
void payload(Context& c, size_t operation, const std::wstring& leaf, DWORD mask, DWORD size, const char* mode) {
  c.checkpoint(); const auto created = relative(c.h(operation), leaf, false, mask, 0, FILE_CREATE);
  c.row("{\"test\":\"targetCreate\",\"mode\":" + quoted(mode) + ",\"mask\":" + std::to_string(mask) + ",\"size\":" + std::to_string(size) + ",\"result\":" + opening(created) + "}");
  const size_t at = c.requireOpen(created, false); need(created.information == FILE_CREATED, "NOT_CREATED");
  const auto id = c.held[at].id;
  c.row("{\"test\":\"targetIdentity\",\"mode\":" + quoted(mode) + ",\"size\":" + std::to_string(size) + ",\"id\":" + quoted(id) + ",\"attributes\":" + std::to_string(c.held[at].attributes) + "}");
  const DWORD accesses[] = {FILE_READ_DATA | SYNCHRONIZE, FILE_WRITE_DATA | SYNCHRONIZE, DELETE | SYNCHRONIZE};
  const char* labels[] = {"otherRead", "otherWrite", "otherDelete"};
  for (int i = 0; i < 3; ++i) {
    const auto attempt = relative(c.h(operation), leaf, false, accesses[i], FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN);
    if (succeeded(attempt)) c.adopt(attempt.h, false);
    c.row("{\"test\":" + quoted(labels[i]) + ",\"mode\":" + quoted(mode) + ",\"size\":" + std::to_string(size) + ",\"result\":" + opening(attempt) + "}");
    need(attempt.status == Sharing, "TARGET_NOT_EXCLUSIVE");
  }
  std::vector<unsigned char> bytes(Chunk), back(Chunk); Hash expected(c), observed(c);
  uint64_t written = 0; DWORD calls = 0; bool writesOK = true;
  do {
    c.checkpoint(); const DWORD n = static_cast<DWORD>(std::min<uint64_t>(Chunk, size - written));
    for (DWORD i = 0; i < n; ++i) bytes[i] = static_cast<unsigned char>((written + i) % 251);
    DWORD actual = 0; SetLastError(0); const BOOL ok = WriteFile(c.h(at), bytes.data(), n, &actual, nullptr); const DWORD error = ok ? 0 : GetLastError();
    ++calls; c.row("{\"test\":\"writeChunk\",\"mode\":" + quoted(mode) + ",\"size\":" + std::to_string(size) + ",\"requested\":" + std::to_string(n) + ",\"actual\":" + std::to_string(actual) + ",\"ok\":" + boolean(ok != 0) + ",\"win32\":" + std::to_string(error) + "}");
    writesOK = writesOK && ok && actual == n; need(writesOK, "WRITE_FAILED_OR_SHORT"); expected.add(bytes.data(), n); written += actual;
  } while (written < size);
  SetLastError(0); const BOOL flush = FlushFileBuffers(c.h(at)); const DWORD flushError = flush ? 0 : GetLastError();
  c.row("{\"test\":\"flushResult\",\"mode\":" + quoted(mode) + ",\"size\":" + std::to_string(size) + ",\"ok\":" + boolean(flush != 0) + ",\"win32\":" + std::to_string(flushError) + "}");
  LARGE_INTEGER zero{}, position{}; SetLastError(0); const BOOL seek = SetFilePointerEx(c.h(at), zero, &position, FILE_BEGIN); const DWORD seekError = seek ? 0 : GetLastError();
  c.row("{\"test\":\"seekResult\",\"mode\":" + quoted(mode) + ",\"size\":" + std::to_string(size) + ",\"ok\":" + boolean(seek != 0) + ",\"win32\":" + std::to_string(seekError) + ",\"position\":" + std::to_string(position.QuadPart) + "}");
  need(seek && position.QuadPart == 0, "SEEK_FAILED");
  uint64_t read = 0; bool exact = true;
  while (read < size) {
    c.checkpoint(); const DWORD wanted = static_cast<DWORD>(std::min<uint64_t>(Chunk, size - read)); DWORD actual = 0;
    need(ReadFile(c.h(at), back.data(), wanted, &actual, nullptr) && actual == wanted, "READ_FAILED_OR_SHORT");
    for (DWORD i = 0; i < actual; ++i) exact = exact && back[i] == static_cast<unsigned char>((read + i) % 251);
    observed.add(back.data(), actual); read += actual;
  }
  DWORD extra = 0; need(ReadFile(c.h(at), back.data(), 1, &extra, nullptr) && extra == 0, "EOF_FAILED");
  const auto a = expected.finish(), b = observed.finish(); need(exact && a == b && identity(c.h(at)) == id, "READBACK_CHANGED");
  // Collision is attempted after writing, so the subsequent complete readback also proves no truncation.
  const auto duplicate = relative(c.h(operation), leaf, false, mask, 0, FILE_CREATE);
  if (succeeded(duplicate)) c.adopt(duplicate.h, false);
  c.row("{\"test\":\"duplicateTarget\",\"mode\":" + quoted(mode) + ",\"size\":" + std::to_string(size) + ",\"result\":" + opening(duplicate) + "}");
  need(duplicate.status == Collision, "DUPLICATE_NOT_COLLISION");
  need(SetFilePointerEx(c.h(at), zero, nullptr, FILE_BEGIN), "SEEK_FAILED"); Hash afterCollision(c); uint64_t reread = 0;
  while (reread < size) { DWORD actual = 0; const DWORD n = static_cast<DWORD>(std::min<uint64_t>(Chunk, size - reread)); c.checkpoint();
    need(ReadFile(c.h(at), back.data(), n, &actual, nullptr) && actual == n, "COLLISION_READ_FAILED"); afterCollision.add(back.data(), actual); reread += actual; }
  need(ReadFile(c.h(at), back.data(), 1, &extra, nullptr) && extra == 0 && afterCollision.finish() == a && identity(c.h(at)) == id, "COLLISION_CHANGED_BYTES");
  c.row("{\"test\":\"payloadResult\",\"mode\":" + quoted(mode) + ",\"size\":" + std::to_string(size) + ",\"writeCalls\":" + std::to_string(calls) + ",\"actualWritten\":" + std::to_string(written) +
    ",\"flush\":" + boolean(flush != 0) + ",\"flushWin32\":" + std::to_string(flushError) + ",\"seek\":" + boolean(seek != 0) + ",\"seekWin32\":" + std::to_string(seekError) +
    ",\"readBytes\":" + std::to_string(read) + ",\"exactEOF\":true,\"expectedHash\":" + quoted(a) + ",\"readHash\":" + quoted(b) + ",\"collisionUnchanged\":true}");
  c.close(at); need(!c.held[at].active, "CLOSE_FAILED");
  const auto reopened = relative(c.h(operation), leaf, false, GenericFile, 0, FILE_OPEN);
  c.row("{\"test\":\"immediateReoccupy\",\"mode\":" + quoted(mode) + ",\"size\":" + std::to_string(size) + ",\"result\":" + opening(reopened) + "}");
  const auto again = c.requireOpen(reopened, false); need(identity(c.h(again)) == id, "REOCCUPY_IDENTITY_CHANGED"); c.close(again); need(!c.held[again].active, "CLOSE_FAILED");
}
std::wstring input(napi_env env, napi_value v) {
  napi_valuetype type; size_t n = 0; need(napi_typeof(env, v, &type) == napi_ok && type == napi_string &&
    napi_get_value_string_utf16(env, v, nullptr, 0, &n) == napi_ok && n <= 32700, "INVALID_INPUT");
  std::vector<char16_t> bytes(n + 1); need(napi_get_value_string_utf16(env, v, bytes.data(), bytes.size(), &n) == napi_ok, "INVALID_INPUT");
  std::wstring result(reinterpret_cast<wchar_t*>(bytes.data()), n); need(result.find(L'\0') == std::wstring::npos, "INVALID_INPUT"); return result;
}
napi_value Run(napi_env env, napi_callback_info info) {
  Context c; const char* outcome = "EXPERIMENT_COMPLETED";
  try {
    size_t count = 3; napi_value args[3]; need(napi_get_cb_info(env, info, &count, args, nullptr, nullptr) == napi_ok && count == 2, "INVALID_INPUT");
    const auto root = input(env, args[0]), mode = input(env, args[1]); need(mode == L"normal" || mode == L"junction" || mode == L"identify", "INVALID_INPUT");
    const size_t container = bind(c, root);
    if (mode != L"identify") {
      const auto readOpen = relative(c.h(container), mode == L"junction" ? L"junction-data" : L"data", true, ReadDir, FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_OPEN);
      const size_t readRoot = c.requireOpen(readOpen, true);
      c.row("{\"test\":\"readRoot\",\"mask\":" + std::to_string(ReadDir) + ",\"id\":" + quoted(c.held[readRoot].id) + ",\"attributes\":" + std::to_string(c.held[readRoot].attributes) + "}");
      if (mode == L"junction") {
        const auto open = relative(c.h(readRoot), L"upgrade-preservation", true, WriteDir, FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_OPEN);
        c.row("{\"test\":\"junctionOpen\",\"result\":" + opening(open) + "}"); c.requireOpen(open, true);
        throw Failure{"JUNCTION_WAS_NOT_REJECTED"};
      }
      const auto direct = relative(c.h(readRoot), L"upgrade-preservation", true, WriteDir, FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_CREATE);
      c.row("{\"test\":\"readOnlyCreate\",\"parentMask\":" + std::to_string(ReadDir) + ",\"childMask\":" + std::to_string(WriteDir) + ",\"result\":" + opening(direct) + ",\"denied\":" + boolean(direct.status == Denied) + "}");
      std::string parentId;
      if (succeeded(direct)) { const auto initial = c.adopt(direct.h, true); parentId = c.held[initial].id; need(direct.information == FILE_CREATED, "NOT_CREATED"); c.close(initial); need(!c.held[initial].active, "CLOSE_FAILED"); }
      const auto writeOpen = relative(c.h(container), L"data", true, WriteDir, FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_OPEN);
      const size_t writeRoot = c.requireOpen(writeOpen, true); need(c.held[writeRoot].id == c.held[readRoot].id, "ROOT_IDENTITY_CHANGED");
      c.row("{\"test\":\"writeRootReopen\",\"mask\":" + std::to_string(WriteDir) + ",\"result\":" + opening(writeOpen) + ",\"id\":" + quoted(c.held[writeRoot].id) + ",\"sameIdentity\":true}");
      const auto parentOpen = relative(c.h(writeRoot), L"upgrade-preservation", true, WriteDir, FILE_SHARE_READ | FILE_SHARE_WRITE, parentId.empty() ? FILE_CREATE : FILE_OPEN);
      const size_t parent = c.requireOpen(parentOpen, true); if (!parentId.empty()) need(c.held[parent].id == parentId, "PARENT_IDENTITY_CHANGED");
      else need(parentOpen.information == FILE_CREATED, "NOT_CREATED");
      c.row("{\"test\":\"parent\",\"result\":" + opening(parentOpen) + ",\"id\":" + quoted(c.held[parent].id) + ",\"attributes\":" + std::to_string(c.held[parent].attributes) + "}");
      renameAttempt(c, root + L"\\data", "rootRename"); renameAttempt(c, root + L"\\data\\upgrade-preservation", "parentRename");
      for (int i = 0; i < 2; ++i) {
        const wchar_t* op = i ? L"op-generic" : L"op-specific"; const char* label = i ? "generic" : "specific"; const DWORD mask = i ? GenericFile : SpecificFile;
        const auto opOpen = relative(c.h(parent), op, true, WriteDir, FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_CREATE);
        const size_t operation = c.requireOpen(opOpen, true); need(opOpen.information == FILE_CREATED, "NOT_CREATED");
        c.row("{\"test\":\"operationCreate\",\"mode\":" + quoted(label) + ",\"result\":" + opening(opOpen) + ",\"id\":" + quoted(c.held[operation].id) + ",\"attributes\":" + std::to_string(c.held[operation].attributes) + "}");
        const auto duplicate = relative(c.h(parent), op, true, WriteDir, FILE_SHARE_READ | FILE_SHARE_WRITE, FILE_CREATE);
        if (succeeded(duplicate)) c.adopt(duplicate.h, true);
        c.row("{\"test\":\"duplicateOperation\",\"mode\":" + quoted(label) + ",\"result\":" + opening(duplicate) + "}"); need(duplicate.status == Collision, "DUPLICATE_NOT_COLLISION");
        renameAttempt(c, root + L"\\data\\upgrade-preservation\\" + op, i ? "genericOperationRename" : "specificOperationRename");
        payload(c, operation, L"00000000.bin", mask, 0, label); payload(c, operation, L"00000001.bin", mask, Large, label);
      }
      c.verifyDirectories();
      if (direct.status != Denied) outcome = "READ_ONLY_CREATE_ASSUMPTION_FAILED";
    }
  } catch (const Failure& e) { outcome = e.code; } catch (...) { outcome = "PROBE_INTERNAL_FAILED"; }
  c.closeAll(); const auto json = c.report(outcome); napi_value value;
  napi_create_string_utf8(env, json.c_str(), json.size(), &value); return value;
}
napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor property = {"run", nullptr, Run, nullptr, nullptr, nullptr, napi_default, nullptr};
  napi_define_properties(env, exports, 1, &property); return exports;
}
} // namespace
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
