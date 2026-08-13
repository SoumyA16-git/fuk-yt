package router

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
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

	// 3. Create updater.bat
	logging.Info("updater: creating Windows batch script updater", map[string]interface{}{"path": updaterBatPath})
	batContent := fmt.Sprintf(`@echo off
setlocal enabledelayedexpansion
echo [%%date%% %%time%%] Updater started > updater.log
set "EXE_PATH=%s"
set "NEW_PATH=%s"
set "EXE_NAME=%s"
set "OLD_PATH=%s.old"
set "EXT_ZIP=%s"

timeout /t 1 /nobreak > NUL

:: Replace Native Host Binary
if exist "!OLD_PATH!" del /f /q "!OLD_PATH!" > NUL 2>&1
echo [%%date%% %%time%%] Renaming active binary to .old >> updater.log
ren "!EXE_PATH!" "!EXE_NAME!.old" >> updater.log 2>&1
echo [%%date%% %%time%%] Renaming new binary to !EXE_NAME! >> updater.log
ren "!NEW_PATH!" "!EXE_NAME!" >> updater.log 2>&1

:: Extract Extension if zip exists
if exist "!EXT_ZIP!" (
    echo [%%date%% %%time%%] Extension ZIP found. Attempting extraction. >> updater.log
    set "EXT_DIR="
    if exist "%%~dp0..\..\extension\manifest.json" (
        set "EXT_DIR=%%~dp0..\..\extension"
    ) else if exist "%%~dp0..\extension\manifest.json" (
        set "EXT_DIR=%%~dp0..\extension"
    )
    
    if not "!EXT_DIR!"=="" (
        echo [%%date%% %%time%%] Extracting extension to !EXT_DIR! >> updater.log
        powershell -NoProfile -Command "Expand-Archive -Path '!EXT_ZIP!' -DestinationPath '!EXT_DIR!' -Force" >> updater.log 2>&1
    ) else (
        echo [%%date%% %%time%%] Could not locate extension folder. >> updater.log
    )
    del /f /q "!EXT_ZIP!" > NUL 2>&1
)

timeout /t 1 /nobreak > NUL
if exist "!OLD_PATH!" del /f /q "!OLD_PATH!" > NUL 2>&1

echo [%%date%% %%time%%] Finished >> updater.log
del "%%~f0" & exit
`, exePath, newExePath, exeName, exePath, extensionZipPath)

	err = os.WriteFile(updaterBatPath, []byte(batContent), 0755)
	if err != nil {
		return r.h.SendError(msg.RequestID, "UPDATER_SCRIPT_FAILED", "Failed to write updater script: "+err.Error())
	}

	// 4. Send success response before process exits
	err = r.h.SendResponse(msg.RequestID, map[string]bool{"updating": true})
	if err != nil {
		logging.Warn("updater: failed to send response to extension: " + err.Error())
	}

	// 5. Start updater.bat detached and exit immediately
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
