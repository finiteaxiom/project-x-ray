{
  "targets": [
    {
      "target_name": "secure_reader",
      "sources": [ "secure_reader.cc" ],
      "defines": [ "NAPI_VERSION=8" ],
      "conditions": [
        [ "OS=='win'", {
          "defines": [ "_WIN32_WINNT=0x0602" ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "RuntimeTypeInfo": "true"
            }
          }
        } ]
      ]
    }
  ]
}
