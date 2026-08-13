package router

import (
	"fmt"
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
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	if payload.DownloadURL == "" {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", "downloadUrl is required")
	}

	// Resolve executable paths
	exePath, err := os.Executable()
	if err != nil {
		return r.h.SendError(msg.RequestID, "UPDATE_FAILED", "Could not find host executable path: "+err.Error())
	}
	exeDir := filepath.Dir(exePath)

	updaterBatPath := filepath.Join(exeDir, "updater.bat")

	// 1. Create updater.bat to run git pull
	logging.Info("updater: creating Windows batch script updater", map[string]interface{}{"path": updaterBatPath})
	batContent := fmt.Sprintf(`@echo off
setlocal enabledelayedexpansion
echo [%%date%% %%time%%] Updater started > updater.log

:: Go to the repository root (two directories up from native-host\bin)
cd /d "%%~dp0..\.."

echo [%%date%% %%time%%] Running git pull >> "%s\updater.log"
git pull >> "%s\updater.log" 2>&1

echo [%%date%% %%time%%] Finished >> "%s\updater.log"
del "%%~f0" & exit
`, exeDir, exeDir, exeDir)

	err = os.WriteFile(updaterBatPath, []byte(batContent), 0755)
	if err != nil {
		return r.h.SendError(msg.RequestID, "UPDATER_SCRIPT_FAILED", "Failed to write updater script: "+err.Error())
	}

	// 2. Send success response before process exits
	err = r.h.SendResponse(msg.RequestID, map[string]bool{"updating": true})
	if err != nil {
		logging.Warn("updater: failed to send response to extension: " + err.Error())
	}

	// 3. Start updater.bat detached and exit immediately
	logging.Info("updater: launching updater.bat detached", nil)
	cmd := exec.Command("cmd", "/c", "updater.bat")
	cmd.Dir = exeDir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
	err = cmd.Start()
	if err != nil {
		_ = os.Remove(updaterBatPath)
		return r.h.SendError(msg.RequestID, "UPDATER_LAUNCH_FAILED", "Failed to start updater script: "+err.Error())
	}

	// Sleep 500ms to ensure the Chrome extension finishes reading the socket
	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()

	return nil
}
