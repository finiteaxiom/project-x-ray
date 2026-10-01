#include <node_api.h>
#include <array>
#include <cstring>
#include <cwchar>
#ifdef _WIN32
#include <windows.h>
#include <wincred.h>
#endif

namespace {
constexpr size_t kLimit = 2048;
#ifdef XRAY_CREDENTIAL_TEST_TARGET
constexpr const char* kVariant = "test";
#ifdef _WIN32
constexpr wchar_t kTarget[] = L"com.projectxray.desktop/openai/api-key/v1/test";
#endif
#else
constexpr const char* kVariant = "production";
#ifdef _WIN32
constexpr wchar_t kTarget[] = L"com.projectxray.desktop/openai/api-key/v1";
#endif
#endif
#ifdef _WIN32
static_assert(kLimit <= CRED_MAX_CREDENTIAL_BLOB_SIZE, "Application budget exceeds Win32 blob limit");
struct SecretBytes {
  std::array<unsigned char, kLimit> data{};
  ~SecretBytes() { SecureZeroMemory(data.data(), data.size()); }
};
struct CredentialAllocation {
  PCREDENTIALW value = nullptr;
  ~CredentialAllocation() {
    if (value) {
      if (value->CredentialBlob) SecureZeroMemory(value->CredentialBlob, value->CredentialBlobSize);
      CredFree(value);
    }
  }
};
bool ValidBytes(const unsigned char* data, size_t size) {
  if (!data || size == 0 || size > kLimit) return false;
  // A bounded temporary UTF16 view is used only to reject malformed UTF8/control scalars.
  std::array<wchar_t, kLimit> wide{};
  const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, reinterpret_cast<const char*>(data), static_cast<int>(size), wide.data(), static_cast<int>(wide.size()));
  bool valid = count > 0;
  for (int i = 0; i < count; ++i) if (wide[i] <= 0x20 || (wide[i] >= 0x7f && wide[i] <= 0x9f)) valid = false;
  SecureZeroMemory(wide.data(), sizeof(wide)); return valid;
}
bool ReadCredential(CredentialAllocation& owned, const char*& code) {
  if (!CredReadW(kTarget, CRED_TYPE_GENERIC, 0, &owned.value)) { code = GetLastError() == ERROR_NOT_FOUND ? "missing" : "unavailable"; return false; }
  if (!owned.value || owned.value->Type != CRED_TYPE_GENERIC || owned.value->Persist != CRED_PERSIST_LOCAL_MACHINE || !owned.value->TargetName || std::wcscmp(owned.value->TargetName, kTarget) != 0 || !ValidBytes(owned.value->CredentialBlob, owned.value->CredentialBlobSize)) { code = "unavailable"; return false; }
  code = "ok"; return true;
}
#endif
napi_value Result(napi_env env, const char* code, const unsigned char* bytes = nullptr, size_t size = 0) {
  napi_value result, text;
  if (napi_create_object(env, &result) != napi_ok || napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &text) != napi_ok || napi_set_named_property(env, result, "code", text) != napi_ok) return nullptr;
  if (bytes) {
    napi_value buffer; void* copy = nullptr;
    if (napi_create_buffer_copy(env, size, bytes, &copy, &buffer) != napi_ok) return nullptr;
    if (napi_set_named_property(env, result, "value", buffer) != napi_ok) {
#ifdef _WIN32
      if (copy) SecureZeroMemory(copy, size);
#endif
      return nullptr;
    }
  }
  return result;
}
bool NoArguments(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value extra; return napi_get_cb_info(env, info, &argc, &extra, nullptr, nullptr) == napi_ok && argc == 0;
}
napi_value Status(napi_env env, napi_callback_info info) {
  if (!NoArguments(env, info)) return Result(env, "invalid");
#ifdef _WIN32
  CredentialAllocation owned; const char* code = "unavailable"; ReadCredential(owned, code); return Result(env, code);
#else
  return Result(env, "unavailable");
#endif
}
napi_value Read(napi_env env, napi_callback_info info) {
  if (!NoArguments(env, info)) return Result(env, "invalid");
#ifdef _WIN32
  CredentialAllocation owned; const char* code = "unavailable";
  if (!ReadCredential(owned, code)) return Result(env, code);
  SecretBytes copy; const size_t size = owned.value->CredentialBlobSize;
  std::memcpy(copy.data.data(), owned.value->CredentialBlob, size);
  return Result(env, "ok", copy.data.data(), size);
#else
  return Result(env, "unavailable");
#endif
}
napi_value Write(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2]; bool is_buffer = false; void* input = nullptr; size_t size = 0;
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1 || napi_is_buffer(env, args[0], &is_buffer) != napi_ok || !is_buffer || napi_get_buffer_info(env, args[0], &input, &size) != napi_ok) return Result(env, "invalid");
#ifdef _WIN32
  if (!input || size == 0 || size > kLimit) return Result(env, "invalid");
  SecretBytes copy; std::memcpy(copy.data.data(), input, size);
  if (!ValidBytes(copy.data.data(), size)) return Result(env, "invalid");
  CREDENTIALW credential{}; credential.Type = CRED_TYPE_GENERIC; credential.TargetName = const_cast<wchar_t*>(kTarget); credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
  credential.CredentialBlobSize = static_cast<DWORD>(size); credential.CredentialBlob = copy.data.data();
  return Result(env, CredWriteW(&credential, 0) ? "ok" : "unavailable");
#else
  return Result(env, "unavailable");
#endif
}
napi_value Remove(napi_env env, napi_callback_info info) {
  if (!NoArguments(env, info)) return Result(env, "invalid");
#ifdef _WIN32
  if (CredDeleteW(kTarget, CRED_TYPE_GENERIC, 0)) return Result(env, "ok");
  return Result(env, GetLastError() == ERROR_NOT_FOUND ? "missing" : "unavailable");
#else
  return Result(env, "unavailable");
#endif
}
napi_value Init(napi_env env, napi_value exports) {
  napi_value variant;
  if (napi_create_string_utf8(env, kVariant, NAPI_AUTO_LENGTH, &variant) != napi_ok) return nullptr;
  napi_property_descriptor methods[] = {
    {"status", nullptr, Status, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"read", nullptr, Read, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"write", nullptr, Write, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"remove", nullptr, Remove, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"variant", nullptr, nullptr, nullptr, nullptr, variant, napi_default, nullptr}
  };
  if (napi_define_properties(env, exports, 5, methods) != napi_ok) return nullptr;
  return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
