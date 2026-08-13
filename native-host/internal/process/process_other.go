//go:build !windows

package process

import (
	"os"
	"os/exec"
	"syscall"
)

// setSysProcAttr configures process group creation on Unix (for dev/testing).
func setSysProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}
}

// killGroup sends SIGKILL to the entire process group on Unix.
func killGroup(p *os.Process) {
	// Negative PID = kill process group
	_ = syscall.Kill(-p.Pid, syscall.SIGKILL)
}
