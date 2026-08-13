//go:build windows

package process

import (
	"os"
	"os/exec"
	"syscall"
)

// setSysProcAttr configures the command to create a new process group on Windows.
// This allows killing the entire job process group (yt-dlp + ffmpeg) atomically (SEC-07).
func setSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
}

// killGroup sends CTRL_BREAK_EVENT to the process group on Windows,
// then falls back to Process.Kill() if the group signal fails.
func killGroup(p *os.Process) {
	// On Windows, send CTRL_BREAK_EVENT to the process group
	dll, err := syscall.LoadDLL("kernel32.dll")
	if err == nil {
		proc, err := dll.FindProc("GenerateConsoleCtrlEvent")
		if err == nil {
			// CTRL_BREAK_EVENT = 1; dwProcessGroupId = pid of group leader
			r, _, _ := proc.Call(1, uintptr(p.Pid))
			if r != 0 {
				return
			}
		}
	}
	// Fallback: hard kill
	_ = p.Kill()
}
