Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!define APPKEY "Software\797b3738-c027-55e0-801e-efcde42fbb67"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\797b3738-c027-55e0-801e-efcde42fbb67"
Name "PERRY 1.1.45"
OutFile "PERRY-Update-1.1.45.exe"
VIProductVersion "1.1.45.0"
VIAddVersionKey "ProductName" "PERRY"
VIAddVersionKey "FileDescription" "PERRY · Aggiornamento di Riprendi"
VIAddVersionKey "FileVersion" "1.1.45.0"
VIAddVersionKey "LegalCopyright" "PERRY"
ShowInstDetails show
Var RunAfter
Var MachineMode
Var Mutex

Function .onInit
  System::Call 'kernel32::CreateMutexW(p 0,i 0,w "Local\PerryDesktopUpdate145") p.r9 ?e'
  Pop $8
  StrCpy $Mutex $9
  ${If} $8 == 183
    SetErrorLevel 1618
    Quit
  ${EndIf}
  SetRegView 64
  StrCpy $MachineMode 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--force-run" $1
  IfErrors +2
    StrCpy $RunAfter 1
  ${If} $INSTDIR == ""
    ReadRegStr $INSTDIR HKCU "${APPKEY}" "InstallLocation"
    ${If} $INSTDIR == ""
      ReadRegStr $INSTDIR HKLM "${APPKEY}" "InstallLocation"
    ${EndIf}
    ${If} $INSTDIR == ""
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\perry"
    ${EndIf}
  ${EndIf}
  ReadRegStr $2 HKLM "${APPKEY}" "InstallLocation"
  ${If} $2 == $INSTDIR
    StrCpy $MachineMode 1
  ${EndIf}
FunctionEnd

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=apply.exe "apply.exe"
  ClearErrors
  ExecWait '"$PLUGINSDIR\apply.exe" "$INSTDIR"' $0
  IfErrors failed
  ${If} $0 != 0
    Goto failed
  ${EndIf}
  ${If} $MachineMode == 1
    WriteRegStr HKLM "${UNKEY}" "DisplayVersion" "1.1.45"
  ${Else}
    ReadRegStr $1 HKCU "${APPKEY}" "InstallLocation"
    ${If} $1 == $INSTDIR
      WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "1.1.45"
    ${EndIf}
  ${EndIf}
  ${If} $RunAfter == 1
    SetOutPath "$INSTDIR"
    Exec '"$INSTDIR\PERRY.exe"'
  ${EndIf}
  SetErrorLevel 0
  Goto finished
  failed:
    ${If} $0 == 3
      MessageBox MB_OK|MB_ICONEXCLAMATION "Per questo aggiornamento serve PERRY 1.1.44 ufficiale per Windows x64." /SD IDOK
    ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Chiudi PERRY e riprova dalla stessa cartella di installazione." /SD IDOK
    ${EndIf}
    SetErrorLevel 1
    Abort
  finished:
SectionEnd
