@echo off
title Fuk-YT - Git Push
cd /d "C:\Users\soumy\Documents\Fuk-YT"

echo ========================================
echo        Fuk-YT - Git Push
echo ========================================
echo.

echo [1/4] Checking Git...
git --version
if errorlevel 1 (
    echo.
    echo ERROR: Git is not installed or not in PATH.
    pause
    exit /b 1
)

echo.
echo [2/4] Adding files...
git add .
if errorlevel 1 (
    echo ERROR: git add failed.
    pause
    exit /b 1
)

echo.
echo [3/4] Creating commit...
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Update"
    if errorlevel 1 (
        echo ERROR: Commit failed.
        pause
        exit /b 1
    )
) else (
    echo No new changes to commit.
)

echo.
echo [4/4] Pushing to GitHub...
git push -u origin main
if errorlevel 1 (
    echo.
    echo ========================================
    echo          PUSH FAILED
    echo ========================================
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo          PUSH SUCCESSFUL
echo ========================================
echo.
pause