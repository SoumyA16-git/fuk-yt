@echo off
setlocal enabledelayedexpansion
title Fuk-YT - Automated Local Build and GitHub Release
cd /d "%~dp0"

echo ========================================================
echo       Fuk-YT - Local Build and GitHub Release
echo ========================================================
echo.

set "GH_PATH=C:\Program Files\GitHub CLI\gh.exe"
if not exist "%GH_PATH%" set "GH_PATH=gh"

set "GO_PATH=C:\Program Files\Go\bin\go.exe"
if not exist "%GO_PATH%" set "GO_PATH=go"

echo Fetching next version tag...
for /f "usebackq tokens=*" %%i in (`powershell -ExecutionPolicy Bypass -File .\scripts\get-next-tag.ps1`) do (
    set "NEW_TAG=%%i"
)
if "%NEW_TAG%"=="" set "NEW_TAG=v0.2.13"
echo Version tag set to: !NEW_TAG!

echo [1/6] Building Chrome Extension dist package...
cd extension
call npm run build
if errorlevel 1 (
    echo ERROR: Extension build failed.
    pause
    exit /b 1
)
cd ..

echo Zipping extension dist folder...
if exist fuk-yt-extension.zip del /f /q fuk-yt-extension.zip
powershell -NoProfile -Command "Compress-Archive -Path extension\dist\* -DestinationPath fuk-yt-extension.zip -Force"

echo.
echo [2/6] Building Go Native Host Engine...
cd native-host
"%GO_PATH%" build -ldflags="-s -w -X main.Version=!NEW_TAG!" -o bin\native-host.exe .\cmd\host
if errorlevel 1 (
    echo ERROR: Native host build failed.
    pause
    exit /b 1
)
cd ..

echo Zipping native host engine package (including bundled yt-dlp and FFmpeg)...
if exist fuk-yt-engine-windows.zip del /f /q fuk-yt-engine-windows.zip
powershell -NoProfile -Command "Compress-Archive -Path native-host\bin\*, install.bat, native-host\com.fukyt.host.json -DestinationPath fuk-yt-engine-windows.zip -Force"

echo.
echo [3/6] Staging modified files...
git add .

echo.
echo [4/6] Creating git commit...
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Update: auto-build and release package sync"
) else (
    echo No uncommitted changes found.
)

echo.
echo [5/6] Pushing code to GitHub main branch...
git push -u origin main

echo.
echo [6/6] Creating Auto-Version Tag and Uploading Release Files to GitHub...

echo.
echo Generated Release Version: !NEW_TAG!
echo Uploading extension, engine, and native-host.exe to GitHub Releases...

"%GH_PATH%" release create "!NEW_TAG!" fuk-yt-extension.zip fuk-yt-engine-windows.zip native-host\bin\native-host.exe --title "Fuk-YT Release !NEW_TAG!" --generate-notes

echo.
echo ========================================================
echo    DIRECT GITHUB RELEASE UPLOAD SUCCESSFUL!
echo    Version: !NEW_TAG!
echo    Files Uploaded to GitHub Releases:
echo    - fuk-yt-extension.zip
echo    - fuk-yt-engine-windows.zip
echo    - native-host.exe (standalone asset for selective update)
echo ========================================================
echo.
pause