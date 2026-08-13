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
	exeName := filepath.Base(exePath)

	newExePath := exePath + ".new"
	updaterBatPath := filepath.Join(exeDir, "updater.bat")

	// 1. Download the new binary from URL
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
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return r.h.SendError(msg.RequestID, "DOWNLOAD_INCOMPLETE", "Failed to save download stream: "+err.Error())
	}
	out.Close() // Close before renaming/operating

	// 2. Create updater.bat
	logging.Info("updater: creating Windows batch script updater", map[string]interface{}{"path": updaterBatPath})
	batContent := fmt.Sprintf(`@echo off
setlocal enabledelayedexpansion
timeout /t 1 /nobreak > NUL
set retry=0
:loop
if exist "%s" (
    del /f /q "%s" > NUL 2>&1
    if errorlevel 1 (
        set /a retry+=1
        if !retry! LSS 5 (
            timeout /t 1 /nobreak > NUL
            goto loop
        )
    )
)
ren "%s" "%s"
del "%%~f0" & exit
`, exePath, exePath, newExePath, exeName)

	err = os.WriteFile(updaterBatPath, []byte(batContent), 0755)
	if err != nil {
		return r.h.SendError(msg.RequestID, "UPDATER_SCRIPT_FAILED", "Failed to write updater script: "+err.Error())
	}

	// 3. Send success response before process exits
	err = r.h.SendResponse(msg.RequestID, map[string]bool{"updating": true})
	if err != nil {
		logging.Warn("updater: failed to send response to extension: " + err.Error())
	}

	// 4. Start updater.bat detached and exit immediately
	logging.Info("updater: launching updater.bat detached", nil)
	cmd := exec.Command("cmd", "/c", updaterBatPath)
	cmd.Dir = exeDir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
	err = cmd.Start()
	if err != nil {
		// Cleanup if starting batch file failed
		_ = os.Remove(newExePath)
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
