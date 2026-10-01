{
  "target_defaults": {
    "sources": [ "windows_credentials.cc" ],
    "defines": [ "NAPI_VERSION=8" ],
    "conditions": [[ "OS=='win'", {
      "libraries": [ "Advapi32.lib" ],
      "defines": [ "_WIN32_WINNT=0x0602", "WIN32_LEAN_AND_MEAN", "NOMINMAX" ],
      "msvs_settings": { "VCCLCompilerTool": { "ExceptionHandling": 1 } }
    } ]]
  },
  "targets": [
    { "target_name": "windows_credentials" },
    { "target_name": "windows_credentials_test", "defines": [ "XRAY_CREDENTIAL_TEST_TARGET=1" ] }
  ]
}
