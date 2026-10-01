#include <node_api.h>

#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <winternl.h>
#else
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <sys/param.h>
#endif
#endif

static const size_t kMaxSourceBytes = 2000000;
static const size_t kMaxReadChunkBytes = 65536;

struct SecureScope {
#ifdef _WIN32
  HANDLE root_handle;
  std::wstring root_path;
  std::wstring display_root_path;
#else
  int root_fd;
  std::string root_path;
  std::string display_root_path;
#endif
  bool closed;
  // Pending counters change on the JS thread; work references protect worker borrows.
  size_t pending_open_count;
  size_t pending_read_count;
};

struct SecureFile {
#ifdef _WIN32
  HANDLE handle;
#else
  int fd;
#endif
  std::string identity;
  uint64_t position;
  bool closed;
  bool busy;
};

struct FileInspection {
  std::string identity;
  bool contained;
  bool is_directory;
  bool is_regular;
  uint64_t size;
};

enum NativeError {
  kNoError,
  kOpenError,
  kInspectError,
  kPathSecurityError,
  kNotRegularError,
  kTooLargeError,
  kReadError,
  kBusyError,
};

static napi_value ErrorValue(napi_env env, const char* code, const char* message) {
  napi_value code_value;
  napi_value message_value;
  napi_value error_value;
  if (napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &code_value) != napi_ok ||
      napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &message_value) != napi_ok ||
      napi_create_error(env, nullptr, message_value, &error_value) != napi_ok ||
      napi_set_named_property(env, error_value, "code", code_value) != napi_ok) return nullptr;
  return error_value;
}

static napi_value ThrowNow(napi_env env, const char* code, const char* message) {
  napi_value error = ErrorValue(env, code, message);
  if (error) napi_throw(env, error);
  return nullptr;
}

static void Reject(napi_env env, napi_deferred deferred, const char* code, const char* message) {
  napi_value error = ErrorValue(env, code, message);
  if (error) napi_reject_deferred(env, deferred, error);
}

static void ReleaseReference(napi_env env, napi_ref* reference) {
  if (!reference || !*reference) return;
  napi_delete_reference(env, *reference);
  *reference = nullptr;
}

static bool GetInt32(napi_env env, napi_value value, int32_t* result) {
  return napi_get_value_int32(env, value, result) == napi_ok;
}

static bool SetString(napi_env env, napi_value object, const char* name, const std::string& value) {
  napi_value string_value;
  return napi_create_string_utf8(env, value.c_str(), value.size(), &string_value) == napi_ok &&
      napi_set_named_property(env, object, name, string_value) == napi_ok;
}

#ifdef _WIN32
static bool GetUtf16(napi_env env, napi_value value, std::wstring* result) {
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok) return false;
  std::vector<char16_t> buffer(length + 1);
  if (napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &length) != napi_ok) return false;
  result->assign(reinterpret_cast<const wchar_t*>(buffer.data()), length);
  return true;
}

static bool HandlePath(HANDLE handle, std::wstring* result, DWORD volume_name = VOLUME_NAME_NT) {
  std::vector<wchar_t> buffer(512);
  for (int attempt = 0; attempt < 8; ++attempt) {
    DWORD written = GetFinalPathNameByHandleW(handle, buffer.data(), static_cast<DWORD>(buffer.size()), FILE_NAME_NORMALIZED | volume_name);
    if (!written) return false;
    if (written < buffer.size()) {
      result->assign(buffer.data(), written);
      return true;
    }
    if (written > 1024 * 1024) return false;
    buffer.resize(static_cast<size_t>(written) + 1);
  }
  return false;
}

static bool GetIdentity(HANDLE handle, std::string* result, bool* is_directory, bool* is_regular, uint64_t* size) {
  FILE_ID_INFO id_info;
  FILE_STANDARD_INFO standard_info;
  if (!GetFileInformationByHandleEx(handle, FileIdInfo, &id_info, sizeof(id_info)) ||
      !GetFileInformationByHandleEx(handle, FileStandardInfo, &standard_info, sizeof(standard_info))) return false;
  char identity[50];
  int offset = snprintf(identity, sizeof(identity), "%016llx:", static_cast<unsigned long long>(id_info.VolumeSerialNumber));
  if (offset < 0) return false;
  for (size_t i = 0; i < sizeof(id_info.FileId.Identifier); ++i) {
    snprintf(identity + offset + i * 2, sizeof(identity) - static_cast<size_t>(offset) - i * 2, "%02x", id_info.FileId.Identifier[i]);
  }
  *result = identity;
  *is_directory = standard_info.Directory != FALSE;
  *is_regular = GetFileType(handle) == FILE_TYPE_DISK && !*is_directory;
  *size = standard_info.EndOfFile.QuadPart < 0 ? 0 : static_cast<uint64_t>(standard_info.EndOfFile.QuadPart);
  return true;
}

static bool Contained(const std::wstring& root, const std::wstring& file) {
  size_t root_length = root.size();
  while (root_length > 1 && (root[root_length - 1] == L'\\' || root[root_length - 1] == L'/')) --root_length;
  return file.size() > root_length && file.compare(0, root_length, root, 0, root_length) == 0 &&
      (file[root_length] == L'\\' || file[root_length] == L'/');
}

static void CloseNativeFile(SecureFile* file) {
  if (!file || file->closed) return;
  if (file->handle != INVALID_HANDLE_VALUE) CloseHandle(file->handle);
  file->handle = INVALID_HANDLE_VALUE;
  file->closed = true;
}

static void CloseNativeScope(SecureScope* scope) {
  if (!scope || scope->closed) return;
  if (scope->root_handle != INVALID_HANDLE_VALUE) CloseHandle(scope->root_handle);
  scope->root_handle = INVALID_HANDLE_VALUE;
  scope->closed = true;
}

#else
static bool HandlePath(int fd, std::string* result) {
#if defined(__APPLE__)
  std::vector<char> buffer(MAXPATHLEN + 1);
  if (fcntl(fd, F_GETPATH, buffer.data()) == -1) return false;
  *result = buffer.data();
  return !result->empty();
#elif defined(__linux__)
  std::vector<char> buffer(4096);
  const std::string link = "/proc/self/fd/" + std::to_string(fd);
  while (buffer.size() <= 1024 * 1024) {
    ssize_t length = readlink(link.c_str(), buffer.data(), buffer.size());
    if (length < 0) return false;
    if (static_cast<size_t>(length) < buffer.size()) {
      result->assign(buffer.data(), static_cast<size_t>(length));
      static const char deleted_suffix[] = " (deleted)";
      if (result->size() >= sizeof(deleted_suffix) - 1 &&
          result->compare(result->size() - (sizeof(deleted_suffix) - 1), sizeof(deleted_suffix) - 1, deleted_suffix) == 0) return false;
      return !result->empty();
    }
    buffer.resize(buffer.size() * 2);
  }
  return false;
#else
  (void)fd;
  (void)result;
  return false;
#endif
}

static bool GetIdentity(int fd, std::string* result, bool* is_directory, bool* is_regular, uint64_t* size) {
  struct stat info;
  if (fstat(fd, &info) != 0) return false;
  *result = std::to_string(static_cast<uint64_t>(info.st_dev)) + ":" + std::to_string(static_cast<uint64_t>(info.st_ino));
  *is_directory = S_ISDIR(info.st_mode);
  *is_regular = S_ISREG(info.st_mode);
  *size = info.st_size < 0 ? 0 : static_cast<uint64_t>(info.st_size);
  return true;
}

static bool Contained(const std::string& root, const std::string& file) {
  size_t root_length = root.size();
  while (root_length > 1 && root[root_length - 1] == '/') --root_length;
  if (root_length == 1 && root[0] == '/') return file.size() > 1 && file[0] == '/';
  return file.size() > root_length && file.compare(0, root_length, root, 0, root_length) == 0 && file[root_length] == '/';
}

static void CloseNativeFile(SecureFile* file) {
  if (!file || file->closed) return;
  if (file->fd >= 0) close(file->fd);
  file->fd = -1;
  file->closed = true;
}

static void CloseNativeScope(SecureScope* scope) {
  if (!scope || scope->closed) return;
  if (scope->root_fd >= 0) close(scope->root_fd);
  scope->root_fd = -1;
  scope->closed = true;
}
#endif

static bool InspectHandle(SecureScope* scope, SecureFile* file, FileInspection* inspection) {
  if (!scope || scope->closed || !file || file->closed) return false;
#ifdef _WIN32
  std::wstring file_path;
  if (!HandlePath(file->handle, &file_path) || !GetIdentity(file->handle, &inspection->identity, &inspection->is_directory, &inspection->is_regular, &inspection->size)) return false;
  inspection->contained = Contained(scope->root_path, file_path);
#else
  std::string file_path;
  if (!HandlePath(file->fd, &file_path) || !GetIdentity(file->fd, &inspection->identity, &inspection->is_directory, &inspection->is_regular, &inspection->size)) return false;
  inspection->contained = Contained(scope->root_path, file_path);
#endif
  return true;
}

static void FinalizeScope(napi_env, void* data, void*) {
  SecureScope* scope = static_cast<SecureScope*>(data);
  if (!scope) return;
  CloseNativeScope(scope);
  delete scope;
}

static void FinalizeFile(napi_env, void* data, void*) {
  SecureFile* file = static_cast<SecureFile*>(data);
  if (!file) return;
  CloseNativeFile(file);
  delete file;
}

static napi_value CreateScope(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) return ThrowNow(env, "ERR_SECURE_READ", "Invalid secure root scope request");
  SecureScope* scope = new SecureScope();
  scope->closed = false;
  scope->pending_open_count = 0;
  scope->pending_read_count = 0;
#ifdef _WIN32
  scope->root_handle = INVALID_HANDLE_VALUE;
  std::wstring root_path;
  if (!GetUtf16(env, argv[0], &root_path)) { delete scope; return ThrowNow(env, "ERR_SECURE_READ", "Unable to read project root path"); }
  scope->root_handle = CreateFileW(root_path.c_str(), FILE_READ_ATTRIBUTES,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS, nullptr);
  if (scope->root_handle == INVALID_HANDLE_VALUE) { delete scope; return ThrowNow(env, "ERR_SECURE_READ", "Unable to open project root handle"); }
  std::string identity;
  bool is_directory = false;
  bool is_regular = false;
  uint64_t size = 0;
  std::wstring final_path;
  if (!HandlePath(scope->root_handle, &final_path) || !GetIdentity(scope->root_handle, &identity, &is_directory, &is_regular, &size) || !is_directory) {
    CloseHandle(scope->root_handle); delete scope; return ThrowNow(env, "ERR_SECURE_READ", "Unable to validate project root handle");
  }
  scope->root_path = final_path;
  if (!HandlePath(scope->root_handle, &scope->display_root_path, VOLUME_NAME_DOS)) { CloseHandle(scope->root_handle); delete scope; return ThrowNow(env, "ERR_SECURE_READ", "Unable to resolve project root handle path"); }
  if (scope->display_root_path.compare(0, 8, L"\\\\?\\UNC\\") == 0) scope->display_root_path = L"\\\\" + scope->display_root_path.substr(8);
  else if (scope->display_root_path.compare(0, 4, L"\\\\?\\") == 0 && scope->display_root_path.size() > 5 && scope->display_root_path[5] == L':') scope->display_root_path = scope->display_root_path.substr(4);
#else
  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length) != napi_ok) { delete scope; return ThrowNow(env, "ERR_SECURE_READ", "Unable to read project root path"); }
  std::vector<char> root_path(length + 1);
  if (napi_get_value_string_utf8(env, argv[0], root_path.data(), root_path.size(), &length) != napi_ok) { delete scope; return ThrowNow(env, "ERR_SECURE_READ", "Unable to read project root path"); }
  scope->root_fd = open(root_path.data(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (scope->root_fd < 0) { delete scope; return ThrowNow(env, "ERR_SECURE_READ", "Unable to open project root handle"); }
  std::string identity;
  bool is_directory = false;
  bool is_regular = false;
  uint64_t size = 0;
  if (!HandlePath(scope->root_fd, &scope->root_path) || !GetIdentity(scope->root_fd, &identity, &is_directory, &is_regular, &size) || !is_directory) {
    close(scope->root_fd); delete scope; return ThrowNow(env, "ERR_SECURE_READ", "Unable to validate project root handle");
  }
  scope->display_root_path = scope->root_path;
#endif
  napi_value result;
  napi_value external;
  napi_value display_path;
  if (napi_create_object(env, &result) != napi_ok) { FinalizeScope(env, scope, nullptr); return ThrowNow(env, "ERR_SECURE_READ", "Unable to create secure root scope"); }
#ifdef _WIN32
  std::vector<char16_t> display_utf16(scope->display_root_path.size());
  for (size_t index = 0; index < scope->display_root_path.size(); ++index) display_utf16[index] = static_cast<char16_t>(scope->display_root_path[index]);
  if (napi_create_string_utf16(env, display_utf16.data(), display_utf16.size(), &display_path) != napi_ok) { FinalizeScope(env, scope, nullptr); return ThrowNow(env, "ERR_SECURE_READ", "Unable to return project root path"); }
#else
  if (napi_create_string_utf8(env, scope->display_root_path.c_str(), scope->display_root_path.size(), &display_path) != napi_ok) { FinalizeScope(env, scope, nullptr); return ThrowNow(env, "ERR_SECURE_READ", "Unable to return project root path"); }
#endif
  if (napi_create_external(env, scope, FinalizeScope, nullptr, &external) != napi_ok) { FinalizeScope(env, scope, nullptr); return ThrowNow(env, "ERR_SECURE_READ", "Unable to retain project root handle"); }
  if (napi_set_named_property(env, result, "nativeScope", external) != napi_ok || napi_set_named_property(env, result, "rootPath", display_path) != napi_ok) return ThrowNow(env, "ERR_SECURE_READ", "Unable to expose secure root scope");
  return result;
}

struct OpenWork {
  napi_async_work work;
  napi_deferred deferred;
  // Keep the external scope alive until the worker completes.
  napi_ref scope_ref;
  SecureScope* scope;
  SecureFile* file;
  NativeError error;
#ifdef _WIN32
  std::wstring path;
#else
  std::string path;
#endif
};

#ifdef _WIN32
static bool IsSafeRelativePath(const std::wstring& path) {
  if (path.empty() || path[0] == L'\\' || path[0] == L'/' || path.find(L'\0') != std::wstring::npos) return false;
  size_t start = 0;
  while (start < path.size()) {
    size_t end = path.find_first_of(L"\\/", start);
    if (end == std::wstring::npos) end = path.size();
    const std::wstring part = path.substr(start, end - start);
    if (part.empty() || part == L"." || part == L".." || part.find(L':') != std::wstring::npos) return false;
    start = end + 1;
  }
  return path.back() != L'\\' && path.back() != L'/';
}

static bool OpenRelativeFile(HANDLE root, const std::wstring& path, HANDLE* result) {
  if (path.size() > 32767 || path.size() * sizeof(wchar_t) > 0xFFFE) return false;
  using NtCreateFileRoutine = NTSTATUS(NTAPI*)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
  HMODULE native_module = GetModuleHandleW(L"ntdll.dll");
  auto create_file = native_module ? reinterpret_cast<NtCreateFileRoutine>(GetProcAddress(native_module, "NtCreateFile")) : nullptr;
  if (!create_file) return false;
  UNICODE_STRING name = {};
  name.Length = static_cast<USHORT>(path.size() * sizeof(wchar_t));
  name.MaximumLength = name.Length;
  name.Buffer = const_cast<PWSTR>(path.c_str());
  OBJECT_ATTRIBUTES attributes = {};
  attributes.Length = sizeof(attributes);
  attributes.RootDirectory = root;
  attributes.ObjectName = &name;
  attributes.Attributes = OBJ_CASE_INSENSITIVE;
  IO_STATUS_BLOCK status_block = {};
  HANDLE file = INVALID_HANDLE_VALUE;
  NTSTATUS status = create_file(&file, GENERIC_READ | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
    &attributes, &status_block, nullptr, FILE_ATTRIBUTE_NORMAL,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN,
    FILE_NON_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT, nullptr, 0);
  if (status < 0 || file == INVALID_HANDLE_VALUE) return false;
  *result = file;
  return true;
}
#else
static bool IsSafeRelativePath(const std::string& path) {
  if (path.empty() || path[0] == '/' || path[0] == '\\' || path.find('\0') != std::string::npos) return false;
  size_t start = 0;
  while (start < path.size()) {
    size_t end = path.find_first_of("\\/", start);
    if (end == std::string::npos) end = path.size();
    const std::string part = path.substr(start, end - start);
    if (part.empty() || part == "." || part == "..") return false;
    start = end + 1;
  }
  return path.back() != '/' && path.back() != '\\';
}
#endif

static void ExecuteOpen(napi_env, void* data) {
  OpenWork* work = static_cast<OpenWork*>(data);
  SecureFile* file = new SecureFile();
  file->position = 0;
  file->closed = false;
  file->busy = false;
#ifdef _WIN32
  if (!OpenRelativeFile(work->scope->root_handle, work->path, &file->handle)) { delete file; work->error = kOpenError; return; }
  bool is_directory = false;
  bool is_regular = false;
  uint64_t size = 0;
  if (!GetIdentity(file->handle, &file->identity, &is_directory, &is_regular, &size)) { CloseNativeFile(file); delete file; work->error = kInspectError; return; }
#else
  file->fd = openat(work->scope->root_fd, work->path.c_str(), O_RDONLY | O_CLOEXEC | O_NONBLOCK);
  if (file->fd < 0) { delete file; work->error = kOpenError; return; }
  bool is_directory = false;
  bool is_regular = false;
  uint64_t size = 0;
  if (!GetIdentity(file->fd, &file->identity, &is_directory, &is_regular, &size)) { CloseNativeFile(file); delete file; work->error = kInspectError; return; }
#endif
  if (!is_regular) { CloseNativeFile(file); delete file; work->error = kNotRegularError; return; }
  if (size > kMaxSourceBytes) { CloseNativeFile(file); delete file; work->error = kTooLargeError; return; }
  work->file = file;
}

static const char* ErrorCode(NativeError error) {
  switch (error) {
    case kPathSecurityError: return "ERR_PROJECT_PATH_SECURITY";
    case kNoError: return "";
    default: return "ERR_SECURE_READ";
  }
}

static const char* ErrorMessage(NativeError error) {
  switch (error) {
    case kOpenError: return "Unable to open source file handle";
    case kInspectError: return "Unable to inspect source file handle";
    case kPathSecurityError: return "Opened source handle is outside the project root";
    case kNotRegularError: return "Source path is not a regular file";
    case kTooLargeError: return "Source file exceeds the 2 MB limit";
    case kReadError: return "Unable to read source file handle";
    case kBusyError: return "Source file handle already has a read in progress";
    case kNoError: return "";
  }
  return "Unable to read source file handle";
}

static void CompleteOpen(napi_env env, napi_status status, void* data) {
  OpenWork* work = static_cast<OpenWork*>(data);
  if (work->scope->pending_open_count > 0) --work->scope->pending_open_count;
  if (status != napi_ok && work->error == kNoError) work->error = kOpenError;
  if (work->error != kNoError) {
    Reject(env, work->deferred, ErrorCode(work->error), ErrorMessage(work->error));
    if (work->file) { CloseNativeFile(work->file); delete work->file; }
  } else {
    napi_value external;
    if (napi_create_external(env, work->file, FinalizeFile, nullptr, &external) == napi_ok) napi_resolve_deferred(env, work->deferred, external);
    else { CloseNativeFile(work->file); delete work->file; Reject(env, work->deferred, "ERR_SECURE_READ", "Unable to retain source file handle"); }
  }
  napi_delete_async_work(env, work->work);
  ReleaseReference(env, &work->scope_ref);
  delete work;
}

static napi_value OpenFile(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2) return ThrowNow(env, "ERR_SECURE_READ", "Invalid source file open request");
  SecureScope* scope = nullptr;
  if (napi_get_value_external(env, argv[0], reinterpret_cast<void**>(&scope)) != napi_ok || !scope || scope->closed) return ThrowNow(env, "ERR_SECURE_READ", "Invalid secure root scope");
  OpenWork* work = new OpenWork{};
  work->file = nullptr;
  work->scope = scope;
  work->error = kNoError;
#ifdef _WIN32
  if (!GetUtf16(env, argv[1], &work->path)) { delete work; return ThrowNow(env, "ERR_SECURE_READ", "Unable to read source path"); }
  if (!IsSafeRelativePath(work->path)) { delete work; return ThrowNow(env, "ERR_PROJECT_PATH_SECURITY", "Invalid project-relative source path"); }
#else
  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[1], nullptr, 0, &length) != napi_ok) { delete work; return ThrowNow(env, "ERR_SECURE_READ", "Unable to read source path"); }
  std::vector<char> path(length + 1);
  if (napi_get_value_string_utf8(env, argv[1], path.data(), path.size(), &length) != napi_ok) { delete work; return ThrowNow(env, "ERR_SECURE_READ", "Unable to read source path"); }
  work->path.assign(path.data(), length);
  if (!IsSafeRelativePath(work->path)) { delete work; return ThrowNow(env, "ERR_PROJECT_PATH_SECURITY", "Invalid project-relative source path"); }
#endif
  napi_value promise;
  napi_value resource_name;
  if (napi_create_reference(env, argv[0], 1, &work->scope_ref) != napi_ok) { delete work; return ThrowNow(env, "ERR_SECURE_READ", "Unable to retain secure root scope for source open"); }
  if (napi_create_promise(env, &work->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "secure-reader.openFile", NAPI_AUTO_LENGTH, &resource_name) != napi_ok) {
    ReleaseReference(env, &work->scope_ref); delete work; return ThrowNow(env, "ERR_SECURE_READ", "Unable to prepare source file open");
  }
  if (napi_create_async_work(env, nullptr, resource_name, ExecuteOpen, CompleteOpen, work, &work->work) != napi_ok) {
    ReleaseReference(env, &work->scope_ref); delete work; return ThrowNow(env, "ERR_SECURE_READ", "Unable to queue source file open");
  }
  ++scope->pending_open_count;
  if (napi_queue_async_work(env, work->work) != napi_ok) {
    --scope->pending_open_count; napi_delete_async_work(env, work->work); ReleaseReference(env, &work->scope_ref); delete work;
    return ThrowNow(env, "ERR_SECURE_READ", "Unable to queue source file open");
  }
  return promise;
}

static napi_value InspectFileHandle(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 2) return ThrowNow(env, "ERR_SECURE_READ", "Invalid file handle inspection request");
  SecureScope* scope = nullptr;
  SecureFile* file = nullptr;
  if (napi_get_value_external(env, argv[0], reinterpret_cast<void**>(&scope)) != napi_ok ||
      napi_get_value_external(env, argv[1], reinterpret_cast<void**>(&file)) != napi_ok ||
      !scope || scope->closed || !file || file->closed) return ThrowNow(env, "ERR_SECURE_READ", "Invalid secure file handle");
  FileInspection inspection;
  if (!InspectHandle(scope, file, &inspection)) return ThrowNow(env, "ERR_PROJECT_PATH_SECURITY", "Unable to inspect opened file path and identity");
  napi_value result;
  napi_value contained_value;
  napi_value directory_value;
  napi_value regular_value;
  napi_value size_value;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_get_boolean(env, inspection.contained, &contained_value) != napi_ok ||
      napi_get_boolean(env, inspection.is_directory, &directory_value) != napi_ok ||
      napi_get_boolean(env, inspection.is_regular, &regular_value) != napi_ok ||
      napi_create_double(env, static_cast<double>(inspection.size), &size_value) != napi_ok ||
      napi_set_named_property(env, result, "contained", contained_value) != napi_ok ||
      napi_set_named_property(env, result, "isDirectory", directory_value) != napi_ok ||
      napi_set_named_property(env, result, "isFile", regular_value) != napi_ok ||
      napi_set_named_property(env, result, "size", size_value) != napi_ok ||
      !SetString(env, result, "identity", inspection.identity)) return ThrowNow(env, "ERR_SECURE_READ", "Unable to return opened file identity");
  return result;
}

struct ReadWork {
  napi_async_work work;
  napi_deferred deferred;
  // Keep both native objects alive until the worker completes.
  napi_ref scope_ref;
  napi_ref file_ref;
  SecureScope* scope;
  SecureFile* file;
  NativeError error;
  size_t capacity;
  size_t bytes_read;
  uint64_t starting_position;
  std::vector<unsigned char> bytes;
};

static void ExecuteRead(napi_env, void* data) {
  ReadWork* work = static_cast<ReadWork*>(data);
  FileInspection before;
  if (!InspectHandle(work->scope, work->file, &before)) { work->error = kPathSecurityError; return; }
  if (!before.contained || before.identity != work->file->identity) { work->error = kPathSecurityError; return; }
  if (!before.is_regular) { work->error = kNotRegularError; return; }
  work->bytes.resize(work->capacity);
#ifdef _WIN32
  LARGE_INTEGER position;
  position.QuadPart = static_cast<LONGLONG>(work->starting_position);
  if (!SetFilePointerEx(work->file->handle, position, nullptr, FILE_BEGIN)) { work->error = kReadError; return; }
  DWORD bytes_read = 0;
  if (!ReadFile(work->file->handle, work->bytes.data(), static_cast<DWORD>(work->capacity), &bytes_read, nullptr)) { work->error = kReadError; return; }
  work->bytes_read = static_cast<size_t>(bytes_read);
#else
  ssize_t bytes_read;
  do { bytes_read = pread(work->file->fd, work->bytes.data(), work->capacity, static_cast<off_t>(work->starting_position)); } while (bytes_read < 0 && errno == EINTR);
  if (bytes_read < 0) { work->error = kReadError; return; }
  work->bytes_read = static_cast<size_t>(bytes_read);
#endif
  FileInspection after;
  if (!InspectHandle(work->scope, work->file, &after) || !after.contained || after.identity != work->file->identity || after.is_directory || !after.is_regular) {
    work->error = kPathSecurityError;
  }
}

static void CompleteRead(napi_env env, napi_status status, void* data) {
  ReadWork* work = static_cast<ReadWork*>(data);
  work->file->busy = false;
  if (work->scope->pending_read_count > 0) --work->scope->pending_read_count;
  if (status != napi_ok && work->error == kNoError) work->error = kReadError;
  if (work->error != kNoError) Reject(env, work->deferred, ErrorCode(work->error), ErrorMessage(work->error));
  else {
    napi_value buffer;
    void* copied = nullptr;
    if (napi_create_buffer_copy(env, work->bytes_read, work->bytes.data(), &copied, &buffer) == napi_ok) {
      work->file->position += work->bytes_read;
      napi_resolve_deferred(env, work->deferred, buffer);
    } else Reject(env, work->deferred, "ERR_SECURE_READ", "Unable to return source bytes");
  }
  napi_delete_async_work(env, work->work);
  ReleaseReference(env, &work->file_ref);
  ReleaseReference(env, &work->scope_ref);
  delete work;
}

static napi_value ReadFileChunk(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 3) return ThrowNow(env, "ERR_SECURE_READ", "Invalid source file read request");
  SecureScope* scope = nullptr;
  SecureFile* file = nullptr;
  int32_t capacity = 0;
  if (napi_get_value_external(env, argv[0], reinterpret_cast<void**>(&scope)) != napi_ok ||
      napi_get_value_external(env, argv[1], reinterpret_cast<void**>(&file)) != napi_ok ||
      !scope || scope->closed || !file || file->closed || !GetInt32(env, argv[2], &capacity) ||
      capacity <= 0 || static_cast<size_t>(capacity) > kMaxReadChunkBytes) return ThrowNow(env, "ERR_SECURE_READ", "Invalid secure file read arguments");
  if (file->busy) return ThrowNow(env, "ERR_SECURE_READ", "Source file handle already has a read in progress");
  ReadWork* work = new ReadWork{};
  work->scope = scope;
  work->file = file;
  work->error = kNoError;
  work->capacity = static_cast<size_t>(capacity);
  work->bytes_read = 0;
  work->starting_position = file->position;
  napi_value promise;
  napi_value resource_name;
  if (napi_create_reference(env, argv[0], 1, &work->scope_ref) != napi_ok) { delete work; return ThrowNow(env, "ERR_SECURE_READ", "Unable to retain secure root scope for source read"); }
  if (napi_create_reference(env, argv[1], 1, &work->file_ref) != napi_ok) {
    ReleaseReference(env, &work->scope_ref); delete work; return ThrowNow(env, "ERR_SECURE_READ", "Unable to retain source handle for read");
  }
  if (napi_create_promise(env, &work->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "secure-reader.readChunk", NAPI_AUTO_LENGTH, &resource_name) != napi_ok) {
    ReleaseReference(env, &work->file_ref); ReleaseReference(env, &work->scope_ref); delete work;
    return ThrowNow(env, "ERR_SECURE_READ", "Unable to prepare source file read");
  }
  if (napi_create_async_work(env, nullptr, resource_name, ExecuteRead, CompleteRead, work, &work->work) != napi_ok) {
    ReleaseReference(env, &work->file_ref); ReleaseReference(env, &work->scope_ref); delete work;
    return ThrowNow(env, "ERR_SECURE_READ", "Unable to queue source file read");
  }
  file->busy = true;
  ++scope->pending_read_count;
  if (napi_queue_async_work(env, work->work) != napi_ok) {
    file->busy = false; --scope->pending_read_count; napi_delete_async_work(env, work->work);
    ReleaseReference(env, &work->file_ref); ReleaseReference(env, &work->scope_ref); delete work;
    return ThrowNow(env, "ERR_SECURE_READ", "Unable to queue source file read");
  }
  return promise;
}

static napi_value CloseFile(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) return ThrowNow(env, "ERR_SECURE_READ", "Invalid secure file close request");
  SecureFile* file = nullptr;
  if (napi_get_value_external(env, argv[0], reinterpret_cast<void**>(&file)) != napi_ok || !file) return ThrowNow(env, "ERR_SECURE_READ", "Invalid secure file handle");
  if (file->busy) return ThrowNow(env, "ERR_SECURE_READ", "Cannot close a source handle during a read");
  CloseNativeFile(file);
  napi_value undefined_value;
  napi_get_undefined(env, &undefined_value);
  return undefined_value;
}

static napi_value CloseScope(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) return ThrowNow(env, "ERR_SECURE_READ", "Invalid secure root scope close request");
  SecureScope* scope = nullptr;
  if (napi_get_value_external(env, argv[0], reinterpret_cast<void**>(&scope)) != napi_ok || !scope) return ThrowNow(env, "ERR_SECURE_READ", "Invalid secure root scope");
  if (scope->pending_open_count || scope->pending_read_count) return ThrowNow(env, "ERR_SECURE_READ", "Cannot close a project root while native work is pending");
  CloseNativeScope(scope);
  napi_value undefined_value;
  napi_get_undefined(env, &undefined_value);
  return undefined_value;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "createScope", nullptr, CreateScope, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "openFile", nullptr, OpenFile, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "inspectFileHandle", nullptr, InspectFileHandle, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "readFileChunk", nullptr, ReadFileChunk, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "closeFile", nullptr, CloseFile, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "closeScope", nullptr, CloseScope, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties) != napi_ok) return ThrowNow(env, "ERR_SECURE_READ", "Unable to initialize file handle inspection");
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
