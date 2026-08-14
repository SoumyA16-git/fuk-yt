// Package potmanager manages the bgutil PO Token provider server lifecycle.
package potmanager

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/fukyt/host/internal/logging"
)

const potServerPort = 4416

var (
	mu      sync.Mutex
	started bool
	cmd     *exec.Cmd
)

// EnsureRunning starts the bgutil PO token server if it is not already running.
func EnsureRunning(installDir string) {
	mu.Lock()
	defer mu.Unlock()

	if started {
		return
	}

	if isServerRunning() {
		logging.Info("potmanager: bgutil server already running", nil)
		started = true
		return
	}

	bgutilPath := findBgutil(installDir)
	if bgutilPath == "" {
		logging.Warn("potmanager: bgutil binary not found -- PO tokens unavailable", nil)
		return
	}

	cmd = exec.Command(bgutilPath, "server")
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{
			HideWindow:    true,
			CreationFlags: 0x08000000,
		}
	}

	if err := cmd.Start(); err != nil {
		logging.Error("potmanager: failed to start bgutil server", map[string]interface{}{
			"path": bgutilPath, "err": err.Error(),
		})
		return
	}

	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if isServerRunning() {
			logging.Info("potmanager: bgutil PO token server started", map[string]interface{}{
				"port": potServerPort, "pid": cmd.Process.Pid,
			})
			started = true
			return
		}
		time.Sleep(300 * time.Millisecond)
	}

	logging.Warn("potmanager: bgutil server started but not yet responding on /ping", nil)
	started = true
}

// Stop terminates the bgutil server process if it was started by this process.
func Stop() {
	mu.Lock()
	defer mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		cmd = nil
		started = false
		logging.Info("potmanager: bgutil server stopped", nil)
	}
}

func findBgutil(installDir string) string {
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	candidates := []string{
		filepath.Join(installDir, "bin", "bgutil-pot-windows-x86_64"+ext),
		filepath.Join(installDir, "bgutil-pot-windows-x86_64"+ext),
		filepath.Join(installDir, "bin", "bgutil-pot"+ext),
		filepath.Join(installDir, "bgutil-pot"+ext),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func isServerRunning() bool {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/ping", potServerPort))
	if err != nil {
		return false
	}
	_ = resp.Body.Close()
	return resp.StatusCode < 500
}