Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WordFunc.nsh"
!define BASE_FEED "https://github.com/rootcoreofficial/rootcore-group-website/releases/download/v1.1.44"
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
  ClearErrors
  ${GetOptions} $0 "--machine-worker" $1
  ${IfNot} ${Errors}
    ReadRegStr $INSTDIR HKLM "${APPKEY}" "InstallLocation"
    ${If} $INSTDIR == ""
      SetErrorLevel 3
      Quit
    ${EndIf}
    StrCpy $RunAfter 0
    StrCpy $MachineMode 1
  ${EndIf}
  ${If} $MachineMode == 1
    UserInfo::GetAccountType
    Pop $1
    ${If} $1 != "Admin"
      ClearErrors
      ExecShellWait "runas" "$EXEPATH" "/S --machine-worker" SW_SHOWNORMAL $1
      ${If} ${Errors}
        SetErrorLevel 5
        Quit
      ${EndIf}
      ${If} $1 == 0
      ${AndIf} $RunAfter == 1
        SetOutPath "$INSTDIR"
        Exec '"$INSTDIR\PERRY.exe"'
      ${EndIf}
      SetErrorLevel $1
      Quit
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::CreateMutexW(p 0,i 0,w "Local\PerryDesktopUpdate145") p.r9 ?e'
  Pop $8
  StrCpy $Mutex $9
  ${If} $8 == 183
    SetErrorLevel 1618
    Quit
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
      ReadRegStr $1 HKCU "${APPKEY}" "InstallLocation"
      ReadRegStr $2 HKCU "${UNKEY}" "DisplayVersion"
      ${If} $MachineMode == 1
        ReadRegStr $1 HKLM "${APPKEY}" "InstallLocation"
        ReadRegStr $2 HKLM "${UNKEY}" "DisplayVersion"
      ${EndIf}
      ${If} $1 == $INSTDIR
      ${AndIf} $2 != ""
      ${AndIf} ${FileExists} "$INSTDIR\PERRY.exe"
        ${VersionCompare} "$2" "1.1.44" $3
        ${If} $3 == 2
          ; I client precedenti ricevono il passaggio alla base dal loro updater originale.
          System::Call 'kernel32::SetEnvironmentVariableW(w "PERRY_UPDATE_URL", w "${BASE_FEED}") i.r4'
          ${If} $4 == 0
            Goto invalid
          ${EndIf}
          SetOutPath "$INSTDIR"
          ClearErrors
          Exec '"$INSTDIR\PERRY.exe"'
          IfErrors invalid
          SetErrorLevel 0
          Goto finished
        ${EndIf}
      ${EndIf}
      ${IfNot} ${Silent}
      ${AndIf} $EXEFILE == "PERRY-Setup.exe"
      ${AndIfNot} ${FileExists} "$INSTDIR\PERRY.exe"
        ExecShell "open" "${BASE_FEED}/PERRY-Setup.exe"
        SetErrorLevel 0
        Goto finished
      ${EndIf}
      invalid:
      MessageBox MB_OK|MB_ICONEXCLAMATION "Per questo aggiornamento serve PERRY 1.1.44 ufficiale per Windows x64." /SD IDOK
    ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Chiudi PERRY e riprova dalla stessa cartella di installazione." /SD IDOK
    ${EndIf}
    SetErrorLevel 1
    Abort
  finished:
SectionEnd
