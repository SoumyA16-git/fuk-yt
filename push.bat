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
powershell -NoProfile -Command "Compress-Archive -Path extension\dist\* -DestinationPath fuk-yt-extension.zip -Force"

set "GO_PATH=C:\Program Files\Go\bin\go.exe"
if not exist "%GO_PATH%" set "GO_PATH=go"

echo.
echo [2/6] Building Go Native Host Engine...
cd native-host
"%GO_PATH%" build -ldflags="-s -w" -o bin\native-host.exe .\cmd\host
if errorlevel 1 (
    echo ERROR: Native host build failed.
    pause
    exit /b 1
)
cd ..

echo Zipping native host engine package...
powershell -NoProfile -Command "Compress-Archive -Path native-host\bin\native-host.exe, native-host\com.fukyt.host.json, install.bat -DestinationPath fuk-yt-engine-windows.zip -Force"

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

for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "$t = (git describe --tags --abbrev=0 2>$null); if (-not $t) { $t = 'v0.2.0' }; $parts = ($t -replace '^v','').Split('.'); [int]$patch = [int]$parts[2] + 1; Write-Output ('v' + $parts[0] + '.' + $parts[1] + '.' + $patch)"`) do (
    set "NEW_TAG=%%i"
)

if "%NEW_TAG%"=="" set "NEW_TAG=v0.2.4"

echo.
echo Generated Release Version: !NEW_TAG!
echo Uploading fuk-yt-extension.zip and fuk-yt-engine-windows.zip to GitHub Releases...

"%GH_PATH%" release create "!NEW_TAG!" fuk-yt-extension.zip fuk-yt-engine-windows.zip --title "Fuk-YT Release !NEW_TAG!" --notes "Automated local build release for Fuk-YT Extension and Go Engine Host." --clobber

echo.
echo ========================================================
echo    DIRECT GITHUB RELEASE UPLOAD SUCCESSFUL!
echo    Version: !NEW_TAG!
echo    Files Uploaded to GitHub Releases:
echo    - fuk-yt-extension.zip
echo    - fuk-yt-engine-windows.zip
echo ========================================================
echo.
pause