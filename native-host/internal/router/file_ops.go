package router

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/fukyt/host/internal/files"
	"github.com/fukyt/host/internal/host"
	"github.com/fukyt/host/internal/logging"
)

func (r *Router) handleMoveToDownloads(msg *host.RawMessage) error {
	var payload struct {
		JobID    string `json:"jobId"`
		Filepath string `json:"filepath"`
		Filename string `json:"filename"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	if payload.Filepath == "" || payload.Filename == "" {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", "filepath and filename are required")
	}

	// 1. Resolve user's Downloads folder
	downloadsDir, err := getDownloadsDir()
	if err != nil {
		downloadsDir = filepath.Join(os.Getenv("USERPROFILE"), "Downloads")
	}

	destPath := filepath.Join(downloadsDir, payload.Filename)

	// Ensure destination directory exists (usually it does)
	_ = os.MkdirAll(downloadsDir, 0755)

	// 2. Perform moving/rename
	logging.Info("fileops: moving file to Downloads folder", map[string]interface{}{
		"src":  payload.Filepath,
		"dest": destPath,
	})

	if err := os.Rename(payload.Filepath, destPath); err != nil {
		// Fallback to copy+delete if cross-volume move
		if err2 := copyFile(payload.Filepath, destPath); err2 != nil {
			return r.h.SendError(msg.RequestID, "MOVE_FAILED", "Failed to move file to Downloads: "+err2.Error())
		}
		_ = os.Remove(payload.Filepath)
	}

	// 3. Update the job filepath so "Open File" / "Open Folder" will open the new path!
	if payload.JobID != "" {
		r.jobs.UpdateJobFilepath(payload.JobID, destPath)
	}

	return r.h.SendResponse(msg.RequestID, map[string]string{"filepath": destPath})
}

func (r *Router) handleDeleteFile(msg *host.RawMessage) error {
	var payload struct {
		Filepath string `json:"filepath"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	if payload.Filepath == "" {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", "filepath is required")
	}

	logging.Info("fileops: deleting file", map[string]interface{}{"path": payload.Filepath})
	_ = os.Remove(payload.Filepath)

	return r.h.SendResponse(msg.RequestID, map[string]bool{"deleted": true})
}

// Helper: copyFile copies src to dest.
func copyFile(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	if err != nil {
		return err
	}
	return out.Sync()
}

func getDownloadsDir() (string, error) {
	if runtime.GOOS != "windows" {
		return filepath.Join(os.Getenv("HOME"), "Downloads"), nil
	}

	cmd := exec.Command("reg", "query", `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`, "/v", "{374DE290-123F-4565-9164-39C4925E467B}")
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
	err := cmd.Run()
	if err != nil {
		cmd = exec.Command("reg", "query", `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`, "/v", "{7512513A-2193-4A2C-AE4F-D8E3E14747ED}")
		out.Reset()
		cmd.Stdout = &out
		cmd.SysProcAttr = &syscall.SysProcAttr{
			HideWindow:    true,
			CreationFlags: 0x08000000,
		}
		if err2 := cmd.Run(); err2 != nil {
			return "", err2
		}
	}

	lines := strings.Split(out.String(), "\n")
	for _, line := range lines {
		if strings.Contains(line, "REG_EXPAND_SZ") || strings.Contains(line, "REG_SZ") {
			parts := strings.SplitN(strings.TrimSpace(line), "REG_EXPAND_SZ", 2)
			if len(parts) < 2 {
				parts = strings.SplitN(strings.TrimSpace(line), "REG_SZ", 2)
			}
			if len(parts) >= 2 {
				path := strings.TrimSpace(parts[1])
				if strings.Contains(path, "%USERPROFILE%") {
					path = strings.ReplaceAll(path, "%USERPROFILE%", os.Getenv("USERPROFILE"))
				}
				if strings.Contains(path, "%") {
					path = os.ExpandEnv(path)
				}
				return path, nil
			}
		}
	}
	return "", fmt.Errorf("reg query: could not parse path")
}

func (r *Router) handleDownloadThumbnail(msg *host.RawMessage) error {
	var payload struct {
		VideoID string `json:"videoId"`
		Title   string `json:"title"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}
	if payload.VideoID == "" {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", "videoId is required")
	}

	downloadsDir, err := getDownloadsDir()
	if err != nil || downloadsDir == "" {
		downloadsDir = filepath.Join(os.Getenv("USERPROFILE"), "Downloads")
	}

	title := payload.Title
	if title == "" {
		title = "Thumbnail_" + payload.VideoID
	}
	safeName, err := files.SanitizeFilename(title)
	if err != nil || safeName == "" {
		safeName = "Thumbnail_" + payload.VideoID
	}

	destPath := filepath.Join(downloadsDir, safeName+".jpg")

	urls := []string{
		fmt.Sprintf("https://img.youtube.com/vi/%s/maxresdefault.jpg", payload.VideoID),
		fmt.Sprintf("https://img.youtube.com/vi/%s/sddefault.jpg", payload.VideoID),
		fmt.Sprintf("https://img.youtube.com/vi/%s/hqdefault.jpg", payload.VideoID),
	}

	var downloaded bool
	for _, u := range urls {
		resp, err := http.Get(u)
		if err == nil && resp.StatusCode == http.StatusOK {
			buf, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err == nil && len(buf) > 5000 {
				_ = os.WriteFile(destPath, buf, 0644)
				downloaded = true
				break
			}
		} else if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
	}

	if !downloaded {
		return r.h.SendError(msg.RequestID, "THUMBNAIL_FAILED", "Could not fetch high resolution thumbnail")
	}

	logging.Info("fileops: thumbnail saved successfully", map[string]interface{}{"path": destPath})
	return r.h.SendResponse(msg.RequestID, map[string]string{"filepath": destPath})
}
