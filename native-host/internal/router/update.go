package router

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
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

	if payload.DownloadURL == "" {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", "downloadUrl is required")
	}

	exePath, err := os.Executable()
	if err != nil {
		return r.h.SendError(msg.RequestID, "UPDATE_FAILED", "Could not find host executable path: "+err.Error())
	}
	exeDir := filepath.Dir(exePath)
	exeName := filepath.Base(exePath)

	newExePath := exePath + ".new"
	updaterBatPath := filepath.Join(exeDir, "updater.bat")
	extensionZipPath := filepath.Join(exeDir, "extension.zip")

	// 1. Download native-host.exe
	logging.Info("updater: downloading new binary", map[string]interface{}{"url": payload.DownloadURL})
	resp, err := http.Get(payload.DownloadURL)
	if err != nil {
		return r.h.SendError(msg.RequestID, "DOWNLOAD_FAILED", "Failed to request download URL: "+err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return r.h.SendError(msg.RequestID, "DOWNLOAD_FAILED", fmt.Sprintf("Download failed with HTTP %d", resp.StatusCode))
	}

	out, err := os.Create(newExePath)
	if err != nil {
		return r.h.SendError(msg.RequestID, "FILE_WRITE_FAILED", "Failed to create staging file: "+err.Error())
	}
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		out.Close()
		return r.h.SendError(msg.RequestID, "DOWNLOAD_INCOMPLETE", "Failed to save download stream: "+err.Error())
	}
	out.Close()

	// 2. Download fuk-yt-extension.zip if version is provided
	if payload.Version != "" {
		extUrl := fmt.Sprintf("https://github.com/SoumyA16-git/fuk-yt/releases/download/%s/fuk-yt-extension.zip", payload.Version)
		logging.Info("updater: downloading extension zip", map[string]interface{}{"url": extUrl})
		extResp, err := http.Get(extUrl)
		if err == nil && extResp.StatusCode == http.StatusOK {
			extOut, err := os.Create(extensionZipPath)
			if err == nil {
				io.Copy(extOut, extResp.Body)
				extOut.Close()
			}
		}
		if extResp != nil {
			extResp.Body.Close()
		}
	}

	// 3. Auto-detect Extension Directory across Chrome / Edge / Brave profiles and known candidate folders
	detectedExtDir := findExtensionDirectory(exeDir)
	logging.Info("updater: detected extension directory", map[string]interface{}{"path": detectedExtDir})

	// 4. Create updater.bat
	logging.Info("updater: creating Windows batch script updater", map[string]interface{}{"path": updaterBatPath})
	batContent := fmt.Sprintf(`@echo off
setlocal enabledelayedexpansion
echo [%%date%% %%time%%] Updater started > updater.log
set "EXE_PATH=%s"
set "NEW_PATH=%s"
set "EXE_NAME=%s"
set "OLD_PATH=%s.old"
set "EXT_ZIP=%s"
set "DETECTED_EXT_DIR=%s"

timeout /t 1 /nobreak > NUL

:: Replace Native Host Binary
if exist "!OLD_PATH!" del /f /q "!OLD_PATH!" > NUL 2>&1
echo [%%date%% %%time%%] Renaming active binary to .old >> updater.log
ren "!EXE_PATH!" "!EXE_NAME!.old" >> updater.log 2>&1
:: Extract Extension if zip exists
if exist "!EXT_ZIP!" (
    echo [%%date%% %%time%%] Extension ZIP found. Attempting extraction. >> updater.log
    set "EXT_DIR=!DETECTED_EXT_DIR!"
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
        echo [%%date%% %%time%%] Extracting extension to !EXT_DIR!_new >> updater.log
        if exist "!EXT_DIR!_new" rmdir /s /q "!EXT_DIR!_new"
        powershell -NoProfile -Command "Expand-Archive -Path '!EXT_ZIP!' -DestinationPath '!EXT_DIR!_new' -Force" >> updater.log 2>&1
        echo [%%date%% %%time%%] Copying files to overwrite old extension >> updater.log
        xcopy /s /e /y "!EXT_DIR!_new\*" "!EXT_DIR!\" >> updater.log 2>&1
        rmdir /s /q "!EXT_DIR!_new" >> updater.log 2>&1
        echo [%%date%% %%time%%] Extension extracted successfully >> updater.log
    ) else (
        echo [%%date%% %%time%%] Could not locate extension folder. >> updater.log
    )
    del /f /q "!EXT_ZIP!" > NUL 2>&1
)

echo [%%date%% %%time%%] Renaming new binary to !EXE_NAME! >> updater.log
ren "!NEW_PATH!" "!EXE_NAME!" >> updater.log 2>&1

:: Update yt-dlp if present in binary directory
if exist "%%~dp0yt-dlp.exe" (
    echo [%%date%% %%time%%] Updating yt-dlp binary >> updater.log
    start /b "" "%%~dp0yt-dlp.exe" -U >> updater.log 2>&1
) else if exist "%%~dp0bin\yt-dlp.exe" (
    echo [%%date%% %%time%%] Updating yt-dlp binary in bin >> updater.log
    start /b "" "%%~dp0bin\yt-dlp.exe" -U >> updater.log 2>&1
)

timeout /t 1 /nobreak > NUL
if exist "!OLD_PATH!" del /f /q "!OLD_PATH!" > NUL 2>&1

echo [%%date%% %%time%%] Finished successfully >> updater.log
del "%%~f0" & exit
`, exePath, newExePath, exeName, exePath, extensionZipPath, detectedExtDir)

	err = os.WriteFile(updaterBatPath, []byte(batContent), 0755)
	if err != nil {
		return r.h.SendError(msg.RequestID, "UPDATER_SCRIPT_FAILED", "Failed to write updater script: "+err.Error())
	}

	// 5. Send success response before process exits
	err = r.h.SendResponse(msg.RequestID, map[string]bool{"updating": true})
	if err != nil {
		logging.Warn("updater: failed to send response to extension: " + err.Error())
	}

	// 6. Start updater.bat detached and exit immediately
	logging.Info("updater: launching updater.bat detached", nil)
	cmd := exec.Command("cmd", "/c", "updater.bat")
	cmd.Dir = exeDir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
	err = cmd.Start()
	if err != nil {
		_ = os.Remove(newExePath)
		_ = os.Remove(extensionZipPath)
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
