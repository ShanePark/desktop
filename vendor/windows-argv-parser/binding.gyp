{
  "targets": [
    {
      "target_name": "windows-argv-parser",
      "sources": [ "main.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
      ],
      "dependencies": [ "<!(node -p \"require('node-addon-api').targets\"):node_addon_api" ],
      'cflags!': [ '-fno-exceptions' ],
      'cflags_cc!': [ '-fno-exceptions' ],
      'conditions': [
        [ 'OS=="linux"', {
          # GCC 9 uses the gnu++2a spelling for the C++20 dialect.
          'cflags_cc!': [ '-std=gnu++20' ],
          'cflags_cc': [ '-std=gnu++2a' ],
        } ],
      ],
      'xcode_settings': { 'GCC_ENABLE_CPP_EXCEPTIONS': 'YES',
        'CLANG_CXX_LIBRARY': 'libc++',
        'MACOSX_DEPLOYMENT_TARGET': '10.7',
      },
      'msvs_settings': {
        'VCCLCompilerTool': { 'ExceptionHandling': 1 },
      },
    }
  ]
}
