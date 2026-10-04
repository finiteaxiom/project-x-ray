{
  "targets": [{
    "target_name": "windows_upgrade_write_probe",
    "sources": ["windows_upgrade_write_probe.cc"],
    "libraries": ["bcrypt.lib"],
    "defines": ["NAPI_VERSION=8", "_WIN32_WINNT=0x0602"],
    "msvs_settings": { "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17"] } }
  }]
}
