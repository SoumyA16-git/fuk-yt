; FUK-YT Windows Installer (NSIS)
; PRD §19: one-click engine install flow
; Installs native host + bundled binaries to %LOCALAPPDATA%\FUK-YT\bin\
; Registers Chrome Native Messaging manifest under HKCU (no admin required)
; Requires NSIS 3.x (https://nsis.sourceforge.io/)

!define APPNAME "FUK-YT"
!define APPVERSION "0.2.0"
!define PUBLISHER "FUK-YT Project"
!define HOST_ID "com.fukyt.host"

; §19: Install to %LOCALAPPDATA% (no admin required — PRIV-05)
; NSIS uses $LOCALAPPDATA for this
!define INSTALL_DIR "$LOCALAPPDATA\${APPNAME}"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

; §18: HKCU registry key for Chrome Native Messaging
!define NM_KEY "Software\Google\Chrome\NativeMessagingHosts\${HOST_ID}"
!define MANIFEST_PATH "${INSTALL_DIR}\${HOST_ID}.json"

; Published extension ID — baked in at build/release time (§19, OQ-03)
; Replace this with the actual Chrome Web Store ID before release
!define EXTENSION_ID "EXTENSION_ID_PLACEHOLDER"

Name "${APPNAME} ${APPVERSION}"
OutFile "FUK-YT-Setup-${APPVERSION}.exe"
InstallDir "${INSTALL_DIR}"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallDir"

; No admin needed — user-level install (§19, PRIV-05)
RequestExecutionLevel user

; Silent/unattended after launch (§19)
SilentInstall silent

; ============================================================
; Install Section
; ============================================================

Section "Main" SecMain
  SectionIn RO

  ; §19 step 4a: Extract binaries to %LOCALAPPDATA%\FUK-YT\bin\
  SetOutPath "${INSTALL_DIR}\bin"
  File "bin\native-host.exe"
  File "bin\yt-dlp.exe"
  File "bin\ffmpeg.exe"
  File "bin\ffprobe.exe"

  ; §19 step 4b: Create required directories
  CreateDirectory "${INSTALL_DIR}\logs"
  CreateDirectory "${INSTALL_DIR}\temp"

  ; §19 step 4c: Write Native Messaging host manifest JSON
  ; allowed_origins: only the published extension ID (SEC-01)
  WriteFile "${MANIFEST_PATH}" \
    '{"name":"${HOST_ID}","description":"FUK-YT Local Download Engine","path":"${INSTALL_DIR}\\bin\\native-host.exe","type":"stdio","allowed_origins":["chrome-extension://${EXTENSION_ID}/"]}'

  ; §19 step 4d: Register manifest in HKCU (no admin, picked up by Chrome immediately in most cases)
  WriteRegStr HKCU "${NM_KEY}" "" "${MANIFEST_PATH}"

  ; §19 step 4f: Write config.json (install metadata)
  WriteFile "${INSTALL_DIR}\config.json" \
    '{"version":"${APPVERSION}","installDir":"${INSTALL_DIR}","binDir":"${INSTALL_DIR}\\bin","downloadRoot":"%USERPROFILE%\\Downloads\\FUK-YT"}'

  ; §19 step 4e: Run each binary with --version to verify integrity
  ExecWait '"${INSTALL_DIR}\bin\native-host.exe" --health-check' $0

  ; Write uninstall info
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallDir" "${INSTALL_DIR}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"${INSTALL_DIR}\uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  WriteUninstaller "${INSTALL_DIR}\uninstall.exe"

SectionEnd

; ============================================================
; Uninstall Section
; ============================================================

Section "Uninstall"

  Delete "${INSTALL_DIR}\bin\native-host.exe"
  Delete "${INSTALL_DIR}\bin\yt-dlp.exe"
  Delete "${INSTALL_DIR}\bin\ffmpeg.exe"
  Delete "${INSTALL_DIR}\bin\ffprobe.exe"
  Delete "${INSTALL_DIR}\config.json"
  Delete "${MANIFEST_PATH}"
  Delete "${INSTALL_DIR}\uninstall.exe"
  RMDir "${INSTALL_DIR}\bin"
  RMDir "${INSTALL_DIR}\logs"
  RMDir "${INSTALL_DIR}\temp"
  RMDir "${INSTALL_DIR}"

  DeleteRegKey HKCU "${NM_KEY}"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"

SectionEnd
