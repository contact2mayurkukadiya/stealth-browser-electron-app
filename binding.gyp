{
  "targets": [
    {
      "target_name": "invisurf_non_activating",
      "sources": [
        "native/nonActivatingWindow/addon.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "sources": [
              "native/nonActivatingWindow/mac/nonActivatingPanel.mm",
              "native/nonActivatingWindow/mac/globalKeyboardMonitor.mm"
            ],
            "xcode_settings": {
              "OTHER_CFLAGS": [
                "-ObjC++",
                "-fobjc-arc"
              ]
            },
            "link_settings": {
              "libraries": [
                "-framework Cocoa",
                "-framework ApplicationServices"
              ]
            }
          }
        ],
        [
          "OS=='win'",
          {
            "sources": [
              "native/nonActivatingWindow/win/nonActivatingWindow.cc",
              "native/nonActivatingWindow/win/globalKeyboardMonitor.cc"
            ]
          }
        ]
      ]
    }
  ]
}
