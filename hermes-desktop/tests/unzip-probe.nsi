Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "BotGo extraction probe"
OutFile "${WORKSPACE}\artifacts\verification\hermes-capabilities-20261023\zip-inspect\unzip-probe.exe"
!addplugindir /x86-unicode "${PLUGIN_SOURCE}"
Section
  CreateDirectory "${WORKSPACE}\artifacts\verification\nsis-unzip-probe"
  SetOutPath "${WORKSPACE}\artifacts\verification\nsis-unzip-probe"
  nsisunz::Unzip "${WORKSPACE}\artifacts\verification\hermes-capabilities-20261023\zip-inspect\embedded.zip" "$OUTDIR"
  Pop $0
  FileOpen $1 "${WORKSPACE}\artifacts\verification\hermes-capabilities-20261023\zip-inspect\unzip-result.txt" w
  FileWriteUTF16LE $1 "$0"
  FileClose $1
  StrCmp $0 "success" passed
  SetErrorLevel 1
  Quit
  passed:
  SetErrorLevel 0
SectionEnd
