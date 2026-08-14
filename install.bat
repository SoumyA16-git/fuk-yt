@echo off
setlocal EnableDelayedExpansion
title FUK-YT One-Click Installer

echo ===================================================
echo               FUK-YT 1-Click Installer
echo ===================================================
echo.

set "ROOT_DIR=%~dp0"
set "EXTENSION_ID=afkbnpippihdclgeodpmmpeocbbinpeo"

:: Find native-host.exe in top directory, bin/, or native-host/bin/
set "NATIVE_EXE="
if exist "%ROOT_DIR%native-host.exe" (
    set "NATIVE_EXE=%ROOT_DIR%native-host.exe"
    set "BIN_DIR=%ROOT_DIR%"
) else if exist "%ROOT_DIR%bin\native-host.exe" (
    set "NATIVE_EXE=%ROOT_DIR%bin\native-host.exe"
    set "BIN_DIR=%ROOT_DIR%bin"
) else if exist "%ROOT_DIR%native-host\bin\native-host.exe" (
    set "NATIVE_EXE=%ROOT_DIR%native-host\bin\native-host.exe"
    set "BIN_DIR=%ROOT_DIR%native-host\bin"
)

if "%NATIVE_EXE%"=="" (
    echo [ERROR] native-host.exe not found!
    echo Please make sure native-host.exe is in the same directory as install.bat.
    pause
    exit /b 1
)

set "TOOLS_DIR=%BIN_DIR%\bin"
set "MANIFEST_PATH=%BIN_DIR%\com.fukyt.host.json"

:: 2. Create tools directory
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"

:: 3. Download yt-dlp
if not exist "%TOOLS_DIR%\yt-dlp.exe" (
    echo [1/4] Downloading yt-dlp...
    powershell -Command "$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile '%TOOLS_DIR%\yt-dlp.exe'"
    echo  - yt-dlp downloaded!
) else (
    echo [1/4] yt-dlp already installed.
)

:: 4. Download FFmpeg
if not exist "%TOOLS_DIR%\ffmpeg.exe" (
    echo [2/4] Downloading FFmpeg - This might take a minute...
    powershell -Command "$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile '%TOOLS_DIR%\ffmpeg.zip' ; Write-Host 'Extracting...'; Expand-Archive -Path '%TOOLS_DIR%\ffmpeg.zip' -DestinationPath '%TOOLS_DIR%\extracted' -Force ; Move-Item -Path '%TOOLS_DIR%\extracted\ffmpeg-*\bin\*.exe' -Destination '%TOOLS_DIR%\' -Force ; Remove-Item '%TOOLS_DIR%\ffmpeg.zip' ; Remove-Item '%TOOLS_DIR%\extracted' -Recurse -Force"
    echo  - FFmpeg downloaded!
) else (
    echo [2/4] FFmpeg already installed.
)

:: 5. Download Deno (JS Runtime for yt-dlp)
if not exist "%TOOLS_DIR%\deno.exe" (
    echo [3/6] Downloading Deno JS Engine for yt-dlp...
    powershell -Command "$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' -OutFile '%TOOLS_DIR%\deno.zip' ; Write-Host 'Extracting...'; Expand-Archive -Path '%TOOLS_DIR%\deno.zip' -DestinationPath '%TOOLS_DIR%\deno_extracted' -Force ; Move-Item -Path '%TOOLS_DIR%\deno_extracted\deno.exe' -Destination '%TOOLS_DIR%\' -Force ; Remove-Item '%TOOLS_DIR%\deno.zip' ; Remove-Item '%TOOLS_DIR%\deno_extracted' -Recurse -Force"
    echo  - Deno downloaded!
) else (
    echo [3/6] Deno already installed.
)

:: 6. Download bgutil PO Token Provider (enables 1080p downloads)
if not exist "%TOOLS_DIR%\bgutil-pot-windows-x86_64.exe" (
    echo [4/6] Downloading PO Token Provider for 1080p support...
    powershell -Command "$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-pot-windows-x86_64.exe' -OutFile '%TOOLS_DIR%\bgutil-pot-windows-x86_64.exe'"
    echo  - PO Token Provider downloaded!
) else (
    echo [4/6] PO Token Provider already installed.
)

:: 7. Download yt-dlp PO Token plugin files
if not exist "%TOOLS_DIR%\yt-dlp-plugins\yt_dlp_plugins\extractor\getpot_bgutil_http.py" (
    echo [5/6] Downloading yt-dlp PO Token plugin...
    powershell -Command "$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases/latest/download/bgutil-ytdlp-pot-provider-rs.zip' -OutFile '%TOOLS_DIR%\pot-plugin.zip' ; Expand-Archive -Path '%TOOLS_DIR%\pot-plugin.zip' -DestinationPath '%TOOLS_DIR%\yt-dlp-plugins' -Force ; Remove-Item '%TOOLS_DIR%\pot-plugin.zip'"
    echo  - yt-dlp PO Token plugin installed!
) else (
    echo [5/6] yt-dlp PO Token plugin already installed.
)

:: 8. Create Manifest File
echo [6/6] Registering Chrome Native Host...
set "ESCAPED_HOST_PATH=%NATIVE_EXE:\=\\%"

(
echo {
echo   "name": "com.fukyt.host",
echo   "description": "FUK-YT Native Host",
echo   "path": "%ESCAPED_HOST_PATH%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXTENSION_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"

:: 6. Add Registry Key
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fukyt.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul

echo.
echo ===================================================
echo [SUCCESS] FUK-YT Engine has been successfully installed!
echo ===================================================
echo.
echo Host Path: %NATIVE_EXE%
echo.
echo You can now use the extension on YouTube.
echo (Make sure to reload the extension in chrome://extensions if it's already open)
echo.
pause
