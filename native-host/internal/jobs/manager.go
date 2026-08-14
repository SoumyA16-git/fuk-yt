// Package jobs implements JobManager: registry, state transitions, progress broadcast.
// §16 job lifecycle (simplified states: downloading/processing/done/failed/cancelled).
package jobs

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/fukyt/host/internal/download"
	"github.com/fukyt/host/internal/logging"
	"github.com/fukyt/host/internal/process"
	"github.com/fukyt/host/internal/server"
	"github.com/fukyt/host/internal/ytdlp"
	"github.com/google/uuid"
)

// JobState mirrors the extension-side simplified state set.
type JobState string

const (
	StateDownloading JobState = "downloading"
	StateProcessing  JobState = "processing"
	StateDone        JobState = "done"
	StateFailed      JobState = "failed"
	StateCancelled   JobState = "cancelled"
)

// Job holds the runtime state of a download job.
type Job struct {
	JobID           string
	VideoID         string
	OutputType      string // "video" | "audio"
	State           JobState
	Percent         float64
	SpeedBps        *float64
	ETASec          *float64
	DownloadedBytes *int64
	TotalBytes      *int64
	Filepath        string
	ErrorCode       string
	CreatedAt       time.Time
}

// PushFn is called by the manager to send unsolicited events to Chrome.
type PushFn func(eventType, jobID string, payload interface{})

// Manager is the job registry.
type Manager struct {
	mu        sync.Mutex
	jobs      map[string]*Job
	cancels   map[string]context.CancelFunc
	downSvc   *download.Service
	pm        *process.ProcessManager
	pushFn    PushFn
	throttle  map[string]time.Time // NFR-02: progress throttle per job
}

const progressThrottle = 250 * time.Millisecond // NFR-02

// New creates a JobManager.
func New(ds *download.Service, pm *process.ProcessManager, pushFn PushFn) *Manager {
	return &Manager{
		jobs:     make(map[string]*Job),
		cancels:  make(map[string]context.CancelFunc),
		downSvc:  ds,
		pm:       pm,
		pushFn:   pushFn,
		throttle: make(map[string]time.Time),
	}
}

// StartDownload starts a video or audio download job. Returns jobId.
func (m *Manager) StartDownload(videoID, outputType, quality, format string, cookies []ytdlp.Cookie) (string, error) {
	jobID := uuid.New().String()
	ctx, cancel := context.WithCancel(context.Background())

	job := &Job{
		JobID:      jobID,
		VideoID:    videoID,
		OutputType: outputType,
		State:      StateDownloading,
		CreatedAt:  time.Now(),
	}

	m.mu.Lock()
	m.jobs[jobID] = job
	m.cancels[jobID] = cancel
	m.mu.Unlock()

	m.sendProgress(jobID, StateDownloading, 0, nil, nil, nil, nil)

	go m.runDownload(ctx, jobID, videoID, outputType, quality, format, cookies)
	return jobID, nil
}

// StartClip starts a clip download job. Returns jobId.
func (m *Manager) StartClip(videoID string, startSec, endSec float64, outputType, quality, format string, cookies []ytdlp.Cookie) (string, error) {
	jobID := uuid.New().String()
	ctx, cancel := context.WithCancel(context.Background())

	job := &Job{
		JobID:      jobID,
		VideoID:    videoID,
		OutputType: outputType,
		State:      StateDownloading,
		CreatedAt:  time.Now(),
	}

	m.mu.Lock()
	m.jobs[jobID] = job
	m.cancels[jobID] = cancel
	m.mu.Unlock()

	m.sendProgress(jobID, StateDownloading, 0, nil, nil, nil, nil)

	go m.runClip(ctx, jobID, videoID, startSec, endSec, outputType, quality, format, cookies)
	return jobID, nil
}

// CancelJob cancels an active job (SEC-07, NFR-13). Returns error if not found.
func (m *Manager) CancelJob(jobID string) error {
	m.mu.Lock()
	cancel, ok := m.cancels[jobID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("jobs: job not found: %s", jobID)
	}
	cancel()
	delete(m.cancels, jobID)
	if j, exists := m.jobs[jobID]; exists {
		j.State = StateCancelled
	}
	m.mu.Unlock()

	// Also kill child processes
	m.pm.KillJob(jobID)

	m.pushFn("jobError", jobID, map[string]interface{}{
		"code": "CANCELLED", "message": "Download cancelled.",
	})
	return nil
}

// GetJobStatus returns a snapshot of the job's current state.
func (m *Manager) GetJobStatus(jobID string) (*Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, ok := m.jobs[jobID]
	if !ok {
		return nil, fmt.Errorf("jobs: job not found: %s", jobID)
	}
	// Return a copy
	cp := *job
	return &cp, nil
}

// ============================================================
// Job runners
// ============================================================

func (m *Manager) runDownload(ctx context.Context, jobID, videoID, outputType, quality, format string, cookies []ytdlp.Cookie) {
	var (
		finalPath string
		runErr    error
	)

	progressFn := m.makeProgressFn(jobID)

	maxAttempts := 3
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if outputType == "audio" {
			finalPath, runErr = m.downSvc.DownloadAudio(ctx, videoID, format, quality, jobID, progressFn, cookies)
		} else {
			finalPath, runErr = m.downSvc.DownloadVideo(ctx, videoID, quality, format, jobID, progressFn, cookies)
		}

		if ctx.Err() != nil {
			// Cancelled by user
			return
		}

		if runErr == nil {
			// Success
			break
		}

		if attempt < maxAttempts {
			logging.Warn("jobs: download attempt failed, retrying...", map[string]interface{}{"jobId": jobID, "attempt": attempt, "err": runErr.Error()})
			time.Sleep(2 * time.Second) // wait before retry
		}
	}

	if ctx.Err() != nil {
		// Cancelled by user — already handled in CancelJob
		return
	}

	m.mu.Lock()
	job, exists := m.jobs[jobID]
	m.mu.Unlock()

	if !exists {
		return
	}

	if runErr != nil {
		logging.Error("jobs: download failed", map[string]interface{}{"jobId": jobID, "err": runErr.Error()})
		m.mu.Lock()
		job.State = StateFailed
		job.ErrorCode = runErr.Error()
		m.mu.Unlock()

		m.pushFn("jobError", jobID, map[string]interface{}{
			"code": job.ErrorCode, "message": friendlyError(job.ErrorCode),
		})
		return
	}

	m.mu.Lock()
	job.State = StateDone
	job.Percent = 100
	job.Filepath = finalPath
	m.mu.Unlock()

	filename := filepath.Base(finalPath)
	downloadURL := server.GetDownloadURL(filename)

	m.pushFn("jobComplete", jobID, map[string]interface{}{
		"filepath":    finalPath,
		"filename":    filename,
		"downloadUrl": downloadURL,
		"jobType":     outputType,
	})
}

func (m *Manager) runClip(ctx context.Context, jobID, videoID string, startSec, endSec float64, outputType, quality, format string, cookies []ytdlp.Cookie) {
	progressFn := m.makeProgressFn(jobID)

	finalPath, runErr := m.downSvc.DownloadClip(ctx, videoID, startSec, endSec, outputType, quality, format, jobID, progressFn, cookies)

	if ctx.Err() != nil {
		return
	}

	m.mu.Lock()
	job, exists := m.jobs[jobID]
	m.mu.Unlock()
	if !exists {
		return
	}

	if runErr != nil {
		logging.Error("jobs: clip failed", map[string]interface{}{"jobId": jobID, "err": runErr.Error()})
		m.mu.Lock()
		job.State = StateFailed
		job.ErrorCode = runErr.Error()
		m.mu.Unlock()

		m.pushFn("jobError", jobID, map[string]interface{}{
			"code": job.ErrorCode, "message": friendlyError(job.ErrorCode),
		})
		return
	}

	m.mu.Lock()
	job.State = StateDone
	job.Percent = 100
	job.Filepath = finalPath
	m.mu.Unlock()

	filename := filepath.Base(finalPath)
	downloadURL := server.GetDownloadURL(filename)

	m.pushFn("jobComplete", jobID, map[string]interface{}{
		"filepath":    finalPath,
		"filename":    filename,
		"downloadUrl": downloadURL,
		"jobType":     outputType,
	})
}

// ============================================================
// Progress helpers (NFR-02)
// ============================================================

func (m *Manager) makeProgressFn(jobID string) download.ProgressFn {
	return func(percent float64, speedBps, etaSec *float64, downloaded, total *int64) {
		m.sendProgress(jobID, StateDownloading, percent, speedBps, etaSec, downloaded, total)
	}
}

func (m *Manager) sendProgress(jobID string, state JobState, percent float64, speedBps, etaSec *float64, downloaded, total *int64) {
	// NFR-02: throttle to ≤1 push per 250ms per job
	now := time.Now()
	m.mu.Lock()
	last := m.throttle[jobID]
	if state != StateDone && state != StateFailed && state != StateCancelled && now.Sub(last) < progressThrottle {
		m.mu.Unlock()
		return
	}
	m.throttle[jobID] = now
	if job, ok := m.jobs[jobID]; ok {
		// Prevent late progress events from resurrecting cancelled/failed/done jobs
		if job.State == StateCancelled || job.State == StateFailed || job.State == StateDone {
			m.mu.Unlock()
			return
		}
		job.Percent = percent
		job.State = state
		job.SpeedBps = speedBps
		job.ETASec = etaSec
		job.DownloadedBytes = downloaded
		job.TotalBytes = total
	}
	m.mu.Unlock()

	payload := map[string]interface{}{
		"state":   state,
		"percent": percent,
	}
	if speedBps != nil {
		payload["speedBps"] = *speedBps
	}
	if etaSec != nil {
		payload["etaSec"] = *etaSec
	}
	if downloaded != nil {
		payload["downloadedBytes"] = *downloaded
	}
	if total != nil {
		payload["totalBytes"] = *total
	}

	m.pushFn("jobProgress", jobID, payload)
}

func friendlyError(code string) string {
	switch code {
	case "UNSUPPORTED_VIDEO":
		return "This video can't be downloaded (private, live, or age-restricted)."
	case "NETWORK_ERROR":
		return "Network error during download."
	case "DISK_FULL":
		return "Not enough disk space."
	case "FFMPEG_FAILED":
		return "Couldn't process this file."
	case "INVALID_URL":
		return "This page isn't a supported YouTube video."
	default:
		return "Couldn't fetch this video."
	}
}

// UpdateJobFilepath updates the resolved filepath for a job.
func (m *Manager) UpdateJobFilepath(jobID, filepath string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, ok := m.jobs[jobID]; ok {
		job.Filepath = filepath
	}
}
