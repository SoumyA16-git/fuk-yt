package router

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/fukyt/host/internal/host"
	"github.com/fukyt/host/internal/logging"
)

func (r *Router) handleTriggerUpdate(msg *host.RawMessage) error {
	var payload struct {
		DownloadURL string `json:"downloadUrl"`
		Version     string `json:"version"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	if payload.Version == "" {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", "version is required")
	}

	exePath, err := os.Executable()
	if err != nil {
		return r.h.SendError(msg.RequestID, "UPDATE_FAILED", "Could not find host executable path: "+err.Error())
	}
	exeDir := filepath.Dir(exePath)
	updaterBatPath := filepath.Join(exeDir, "updater.bat")

	// Auto-detect Extension Directory across Chrome / Edge / Brave profiles and known candidate folders
	detectedExtDir := findExtensionDirectory(exeDir)
	logging.Info("updater: detected extension directory", map[string]interface{}{"path": detectedExtDir})

	// Create updater.bat
	logging.Info("updater: creating Windows batch script updater", map[string]interface{}{"path": updaterBatPath})

	engineUrl := fmt.Sprintf("https://github.com/SoumyA16-git/fuk-yt/releases/download/%s/fuk-yt-engine-windows.zip", payload.Version)
	extUrl := fmt.Sprintf("https://github.com/SoumyA16-git/fuk-yt/releases/download/%s/fuk-yt-extension.zip", payload.Version)

	batContent := fmt.Sprintf(`@echo off
setlocal enabledelayedexpansion
cd /d "%%~dp0"

echo ===================================================
echo             FUK-YT AUTO UPDATER
echo ===================================================
echo.
echo Please wait, update in progress...
echo.

:: 1. Wait for native-host to exit so files unlock
ping 127.0.0.1 -n 3 > NUL

:: 2. Force close browsers
echo [1/5] Closing browsers...
taskkill /F /IM chrome.exe > NUL 2>&1
taskkill /F /IM msedge.exe > NUL 2>&1
taskkill /F /IM brave.exe > NUL 2>&1

:: 3. Download updates
echo [2/5] Downloading Native Engine %s...
powershell -NoProfile -Command "$ProgressPreference = 'Continue'; Invoke-WebRequest -Uri '%s' -OutFile 'fuk-yt-engine-windows.zip'"

echo [3/5] Downloading Extension %s...
powershell -NoProfile -Command "$ProgressPreference = 'Continue'; Invoke-WebRequest -Uri '%s' -OutFile 'fuk-yt-extension.zip'"

:: 4. Extract Engine
echo [4/5] Extracting Engine files...
if exist "engine_temp" rmdir /s /q "engine_temp"
powershell -NoProfile -Command "Expand-Archive -Path 'fuk-yt-engine-windows.zip' -DestinationPath 'engine_temp' -Force"
xcopy /s /e /y "engine_temp\*" "%%~dp0" > NUL
rmdir /s /q "engine_temp"
del /f /q "fuk-yt-engine-windows.zip"

:: 5. Extract Extension
set "EXT_DIR=%s"
if "!EXT_DIR!"=="" (
    if exist "%%~dp0..\..\extension\manifest.json" (
        set "EXT_DIR=%%~dp0..\..\extension"
    ) else if exist "%%~dp0..\extension\manifest.json" (
        set "EXT_DIR=%%~dp0..\extension"
    ) else if exist "%%~dp0..\..\fuk-yt-extension\manifest.json" (
        set "EXT_DIR=%%~dp0..\..\fuk-yt-extension"
    ) else if exist "%%~dp0..\fuk-yt-extension\manifest.json" (
        set "EXT_DIR=%%~dp0..\fuk-yt-extension"
    ) else if exist "%%~dp0extension\manifest.json" (
        set "EXT_DIR=%%~dp0extension"
    ) else if exist "%%~dp0fuk-yt-extension\manifest.json" (
        set "EXT_DIR=%%~dp0fuk-yt-extension"
    ) else if exist "%%USERPROFILE%%\Downloads\fuk-yt-extension\manifest.json" (
        set "EXT_DIR=%%USERPROFILE%%\Downloads\fuk-yt-extension"
    ) else if exist "%%USERPROFILE%%\Desktop\fuk-yt-extension\manifest.json" (
        set "EXT_DIR=%%USERPROFILE%%\Desktop\fuk-yt-extension"
    )
)

if not "!EXT_DIR!"=="" (
    echo [5/5] Extracting Extension...
    if exist "ext_temp" rmdir /s /q "ext_temp"
    powershell -NoProfile -Command "Expand-Archive -Path 'fuk-yt-extension.zip' -DestinationPath 'ext_temp' -Force"
    xcopy /s /e /y "ext_temp\*" "!EXT_DIR!\" > NUL
    rmdir /s /q "ext_temp"
    echo Extension updated at: !EXT_DIR!
) else (
    echo [!] Could not locate extension folder. Extension update skipped.
)
del /f /q "fuk-yt-extension.zip" > NUL 2>&1

echo.
echo ===================================================
echo     UPDATE COMPLETE SUCCESSFULLY!
echo ===================================================
echo Running fresh install.bat to verify setup...
if exist "%%~dp0install.bat" (
    call "%%~dp0install.bat"
) else (
    echo.
    echo You can now reopen your browser.
    echo.
)
echo.
pause
del "%%~f0" & exit
`, payload.Version, engineUrl, payload.Version, extUrl, detectedExtDir)

	err = os.WriteFile(updaterBatPath, []byte(batContent), 0755)
	if err != nil {
		return r.h.SendError(msg.RequestID, "UPDATER_SCRIPT_FAILED", "Failed to write updater script: "+err.Error())
	}

	// Send success response before process exits
	err = r.h.SendResponse(msg.RequestID, map[string]bool{"updating": true})
	if err != nil {
		logging.Warn("updater: failed to send response to extension: " + err.Error())
	}

	// Start updater.bat using WMI to completely escape Chrome's Job Object so it survives taskkill
	logging.Info("updater: launching updater.bat via WMI", nil)
	wmiCmd := fmt.Sprintf(`Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList 'cmd.exe /c start "FUK-YT Updater" "%s"'`, updaterBatPath)
	cmd := exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", wmiCmd)

	err = cmd.Start()
	if err != nil {
		logging.Warn("updater: WMI launch failed, falling back to explorer: " + err.Error())
		cmd = exec.Command("explorer.exe", updaterBatPath)
		err = cmd.Start()
	}

	if err != nil {
		_ = os.Remove(updaterBatPath)
		return r.h.SendError(msg.RequestID, "UPDATER_LAUNCH_FAILED", "Failed to start updater script: "+err.Error())
	}

	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()

	return nil
}

func findExtensionDirectory(exeDir string) string {
	extId := "afkbnpippihdclgeodpmmpeocbbinpeo"

	// 1. Check Chrome / Edge / Brave Preferences file for exact loaded extension directory
	if p := findExtensionFromBrowserPreferences(extId); p != "" {
		return p
	}

	// 2. Scan candidate directory paths
	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(exeDir, "..", "..", "extension"),
		filepath.Join(exeDir, "..", "extension"),
		filepath.Join(exeDir, "..", "..", "fuk-yt-extension"),
		filepath.Join(exeDir, "..", "fuk-yt-extension"),
		filepath.Join(exeDir, "..", "..", "extension", "dist"),
		filepath.Join(exeDir, "..", "extension", "dist"),
		filepath.Join(exeDir, "extension"),
		filepath.Join(exeDir, "fuk-yt-extension"),
		filepath.Join(home, "Downloads", "fuk-yt-extension"),
		filepath.Join(home, "Downloads", "extension"),
		filepath.Join(home, "Desktop", "fuk-yt-extension"),
		filepath.Join(home, "Desktop", "extension"),
		filepath.Join(home, "Documents", "fuk-yt-extension"),
		filepath.Join(home, "Documents", "Fuk-YT", "extension"),
		filepath.Join(home, "Documents", "Fuk-YT", "extension", "dist"),
	}

	for _, c := range candidates {
		if _, err := os.Stat(filepath.Join(c, "manifest.json")); err == nil {
			return c
		}
	}

	return ""
}

func findExtensionFromBrowserPreferences(extId string) string {
	localData := os.Getenv("LOCALAPPDATA")
	if localData == "" {
		return ""
	}

	browserDataDirs := []string{
		filepath.Join(localData, "Google", "Chrome", "User Data"),
		filepath.Join(localData, "Microsoft", "Edge", "User Data"),
		filepath.Join(localData, "BraveSoftware", "Brave-Browser", "User Data"),
	}

	for _, bDir := range browserDataDirs {
		entries, err := os.ReadDir(bDir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() && (entry.Name() == "Default" || strings.HasPrefix(entry.Name(), "Profile ")) {
				prefPath := filepath.Join(bDir, entry.Name(), "Preferences")
				data, err := os.ReadFile(prefPath)
				if err != nil {
					continue
				}
				var prefMap struct {
					Extensions struct {
						Settings map[string]struct {
							Path string `json:"path"`
						} `json:"settings"`
					} `json:"extensions"`
				}
				if err := json.Unmarshal(data, &prefMap); err == nil {
					if setting, ok := prefMap.Extensions.Settings[extId]; ok && setting.Path != "" {
						if _, err := os.Stat(filepath.Join(setting.Path, "manifest.json")); err == nil {
							return setting.Path
						}
					}
				}
			}
		}
	}
	return ""
}
