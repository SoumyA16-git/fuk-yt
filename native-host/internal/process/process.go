// Package process implements ProcessManager: spawn, track, and kill child processes.
// SEC-07: cancelJob terminates the full child process group, no orphans.
// NFR-13: group kill completes within 2 seconds.
package process

import (
	"fmt"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/fukyt/host/internal/logging"
)

const killTimeout = 2 * time.Second // NFR-13

// ProcessManager tracks all child processes per job.
type ProcessManager struct {
	mu   sync.Mutex
	jobs map[string][]*os.Process // jobId → all child processes
}

// New creates a new ProcessManager.
func New() *ProcessManager {
	return &ProcessManager{
		jobs: make(map[string][]*os.Process),
	}
}

// StartProcess starts a child process and registers it under the given jobId.
// cmd must already have Cmd.SysProcAttr configured for process group if needed.
func (pm *ProcessManager) StartProcess(jobID string, cmd *exec.Cmd) error {
	setSysProcAttr(cmd) // platform-specific group creation

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("process: start failed: %w", err)
	}
	logging.Debug("process: started", map[string]interface{}{
		"jobId": jobID, "pid": cmd.Process.Pid, "path": cmd.Path,
	})

	pm.mu.Lock()
	pm.jobs[jobID] = append(pm.jobs[jobID], cmd.Process)
	pm.mu.Unlock()

	return nil
}

// RegisterProcess registers an already-started process under jobId.
func (pm *ProcessManager) RegisterProcess(jobID string, p *os.Process) {
	pm.mu.Lock()
	pm.jobs[jobID] = append(pm.jobs[jobID], p)
	pm.mu.Unlock()
}

// RemoveProcess removes a specific process from tracking (called on Wait() success).
func (pm *ProcessManager) RemoveProcess(jobID string, p *os.Process) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	procs := pm.jobs[jobID]
	for i, proc := range procs {
		if proc.Pid == p.Pid {
			pm.jobs[jobID] = append(procs[:i], procs[i+1:]...)
			return
		}
	}
}

// KillJob kills all processes registered under jobId within killTimeout (SEC-07, NFR-13).
func (pm *ProcessManager) KillJob(jobID string) {
	pm.mu.Lock()
	procs := pm.jobs[jobID]
	delete(pm.jobs, jobID)
	pm.mu.Unlock()

	if len(procs) == 0 {
		return
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for _, p := range procs {
			killGroup(p) // platform-specific
		}
	}()

	select {
	case <-done:
		logging.Info("process: killed job", map[string]interface{}{"jobId": jobID})
	case <-time.After(killTimeout):
		logging.Warn("process: kill timeout exceeded", map[string]interface{}{"jobId": jobID})
		// Force SIGKILL on each process
		for _, p := range procs {
			_ = p.Kill()
		}
	}
}

// KillAll kills all tracked processes (called on host shutdown).
func (pm *ProcessManager) KillAll() {
	pm.mu.Lock()
	jobIDs := make([]string, 0, len(pm.jobs))
	for id := range pm.jobs {
		jobIDs = append(jobIDs, id)
	}
	pm.mu.Unlock()

	for _, id := range jobIDs {
		pm.KillJob(id)
	}
}
