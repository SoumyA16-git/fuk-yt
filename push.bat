@echo off
setlocal enabledelayedexpansion
title Fuk-YT - Automated Git Push and Release
cd /d "%~dp0"

echo ========================================================
echo       Fuk-YT - Automated Git Push and Release
echo ========================================================
echo.

echo [1/5] Checking Git installation...
git --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git is not installed or not in PATH.
    pause
    exit /b 1
)

echo.
echo [2/5] Staging modified files...
git add .

echo.
echo [3/5] Creating commit...
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Update: auto-build and release sync"
    if errorlevel 1 (
        echo ERROR: Commit failed.
        pause
        exit /b 1
    )
) else (
    echo No uncommitted changes found.
)

echo.
echo [4/5] Pushing changes to GitHub main branch...
git push -u origin main
if errorlevel 1 (
    echo.
    echo ========================================================
    echo             GIT PUSH TO MAIN FAILED
    echo ========================================================
    pause
    exit /b 1
)

echo.
echo [5/5] Generating Auto-Version Tag for GitHub Release...

for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "$t = (git describe --tags --abbrev=0 2>$null); if (-not $t) { $t = 'v0.2.0' }; $parts = ($t -replace '^v','').Split('.'); [int]$patch = [int]$parts[2] + 1; Write-Output ('v' + $parts[0] + '.' + $parts[1] + '.' + $patch)"`) do (
    set "NEW_TAG=%%i"
)

if "%NEW_TAG%"=="" set "NEW_TAG=v0.2.1"

echo.
echo Auto-Generated Release Tag: !NEW_TAG!
echo Creating local tag !NEW_TAG!...
git tag -a "!NEW_TAG!" -m "Release !NEW_TAG! (Automated Extension and Engine Build)"

echo Pushing tag !NEW_TAG! to GitHub...
git push origin "!NEW_TAG!"

echo.
echo ========================================================
echo    PUSH AND RELEASE TRIGGER SUCCESSFUL!
echo    Release Tag: !NEW_TAG!
echo    GitHub Actions is building fuk-yt-extension.zip
echo    and publishing to GitHub Releases automatically!
echo ========================================================
echo.
pause