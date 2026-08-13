@echo off
setlocal EnableDelayedExpansion
title FUK-YT One-Click Installer

echo ===================================================
echo               FUK-YT 1-Click Installer
echo ===================================================
echo.

set "ROOT_DIR=%~dp0"
set "HOST_DIR=%ROOT_DIR%native-host"
set "BIN_DIR=%HOST_DIR%\bin"
set "TOOLS_DIR=%BIN_DIR%\bin"
set "MANIFEST_PATH=%HOST_DIR%\com.fukyt.host.json"
set "EXTENSION_ID=afkbnpippihdclgeodpmmpeocbbinpeo"

:: 1. Check if native-host.exe exists
if not exist "%BIN_DIR%\native-host.exe" (
    echo [ERROR] native-host.exe not found!
    echo Please run 'powershell .\scripts\build.ps1' to compile the backend first.
    pause
    exit /b 1
)

:: 2. Create tools directory
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"

:: 3. Download yt-dlp
if not exist "%TOOLS_DIR%\yt-dlp.exe" (
    echo [1/3] Downloading yt-dlp...
    powershell -Command "$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile '%TOOLS_DIR%\yt-dlp.exe'"
    echo  - yt-dlp downloaded!
) else (
    echo [1/3] yt-dlp already installed.
)

:: 4. Download FFmpeg
if not exist "%TOOLS_DIR%\ffmpeg.exe" (
    echo [2/3] Downloading FFmpeg - This might take a minute...
    powershell -Command "$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile '%TOOLS_DIR%\ffmpeg.zip' ; Write-Host 'Extracting...'; Expand-Archive -Path '%TOOLS_DIR%\ffmpeg.zip' -DestinationPath '%TOOLS_DIR%\extracted' -Force ; Move-Item -Path '%TOOLS_DIR%\extracted\ffmpeg-*\bin\*.exe' -Destination '%TOOLS_DIR%\' -Force ; Remove-Item '%TOOLS_DIR%\ffmpeg.zip' ; Remove-Item '%TOOLS_DIR%\extracted' -Recurse -Force"
    echo  - FFmpeg downloaded!
) else (
    echo [2/3] FFmpeg already installed.
)

:: 5. Create Manifest File
echo [3/3] Registering Chrome Native Host...
set "ESCAPED_HOST_PATH=%BIN_DIR:\=\\%\\native-host.exe"

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
echo [SUCCESS] FUK-YT has been successfully installed!
echo ===================================================
echo.
echo You can now use the extension on YouTube.
echo (Make sure to reload the extension in chrome://extensions if it's already open)
echo.
pause
