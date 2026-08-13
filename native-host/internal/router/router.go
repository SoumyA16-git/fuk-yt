// Package router implements MessageRouter: validates and dispatches §18 operations.
// SEC-02: only operations listed in §18 are accepted; anything else → UNSUPPORTED_OPERATION.
// SEC-08: malformed payloads are rejected with error response, not a crash.
package router

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"syscall"

	"github.com/fukyt/host/internal/ffmpeg"
	"github.com/fukyt/host/internal/host"
	"github.com/fukyt/host/internal/jobs"
	"github.com/fukyt/host/internal/logging"
	"github.com/fukyt/host/internal/ytdlp"
)

// Config holds engine binary paths and version strings (from main).
type Config struct {
	Version        string
	YtDlpVersion   string
	FFmpegVersion  string
	DownloadRoot   string
	YtDlpPath      string
	FFmpegPath     string
	FFprobePath    string
}

// Router dispatches §18 operations to the appropriate service.
type Router struct {
	h      *host.Host
	cfg    Config
	ytdlp  *ytdlp.Service
	ffmpeg *ffmpeg.Service
	jobs   *jobs.Manager
}

// New creates a Router wired to all services.
func New(h *host.Host, cfg Config, yt *ytdlp.Service, ff *ffmpeg.Service, jm *jobs.Manager) *Router {
	return &Router{h: h, cfg: cfg, ytdlp: yt, ffmpeg: ff, jobs: jm}
}

// Dispatch routes a raw message to the correct handler.
// SEC-02: unknown types return UNSUPPORTED_OPERATION without crashing.
func (r *Router) Dispatch(msg *host.RawMessage) {
	var err error

	switch msg.Type {
	case "ping":
		err = r.h.SendResponse(msg.RequestID, map[string]bool{"pong": true})

	case "getEngineInfo":
		err = r.handleGetEngineInfo(msg)

	case "getVideoInfo":
		err = r.handleGetVideoInfo(msg)

	case "getFormats":
		err = r.handleGetFormats(msg)

	case "startDownload":
		err = r.handleStartDownload(msg)

	case "startClip":
		err = r.handleStartClip(msg)

	case "cancelJob":
		err = r.handleCancelJob(msg)

	case "getJobStatus":
		err = r.handleGetJobStatus(msg)

	case "openFile":
		err = r.handleOpenFile(msg)

	case "openFolder":
		err = r.handleOpenFolder(msg)

	case "moveToDownloads":
		err = r.handleMoveToDownloads(msg)

	case "deleteFile":
		err = r.handleDeleteFile(msg)

	case "downloadThumbnail":
		err = r.handleDownloadThumbnail(msg)

	case "openFilePath":
		err = r.handleOpenFilePath(msg)

	case "openFolderPath":
		err = r.handleOpenFolderPath(msg)

	case "triggerUpdate":
		err = r.handleTriggerUpdate(msg)

	default:
		// SEC-02: unsupported operation → ok:false, no crash
		logging.Warn("router: unsupported operation", map[string]interface{}{"type": msg.Type})
		err = r.h.SendError(msg.RequestID, "UNSUPPORTED_OPERATION",
			fmt.Sprintf("Operation %q is not supported", msg.Type))
	}

	if err != nil {
		logging.Error("router: send failed", map[string]interface{}{
			"type": msg.Type, "err": err.Error(),
		})
	}
}

// ============================================================
// Handlers
// ============================================================

func (r *Router) handleGetEngineInfo(msg *host.RawMessage) error {
	return r.h.SendResponse(msg.RequestID, map[string]interface{}{
		"version":       r.cfg.Version,
		"ytDlpVersion":  r.cfg.YtDlpVersion,
		"ffmpegVersion": r.cfg.FFmpegVersion,
		"status":        "Ready",
	})
}

func (r *Router) handleGetVideoInfo(msg *host.RawMessage) error {
	var payload struct {
		URL string `json:"url"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	ctx := msg.Context()
	info, err := r.ytdlp.GetVideoInfo(ctx, payload.URL)
	if err != nil {
		return r.h.SendError(msg.RequestID, mapError(err), err.Error())
	}

	return r.h.SendResponse(msg.RequestID, info)
}

func (r *Router) handleGetFormats(msg *host.RawMessage) error {
	var payload struct {
		VideoID string `json:"videoId"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	ctx := msg.Context()
	formats, err := r.ytdlp.GetFormats(ctx, payload.VideoID)
	if err != nil {
		return r.h.SendError(msg.RequestID, mapError(err), err.Error())
	}

	return r.h.SendResponse(msg.RequestID, map[string]interface{}{"formats": formats})
}

func (r *Router) handleStartDownload(msg *host.RawMessage) error {
	var payload struct {
		VideoID    string `json:"videoId"`
		OutputType string `json:"outputType"`
		Quality    string `json:"quality"`
		Format     string `json:"format"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	jobID, err := r.jobs.StartDownload(payload.VideoID, payload.OutputType, payload.Quality, payload.Format)
	if err != nil {
		return r.h.SendError(msg.RequestID, "START_FAILED", err.Error())
	}

	return r.h.SendResponse(msg.RequestID, map[string]string{"jobId": jobID})
}

func (r *Router) handleStartClip(msg *host.RawMessage) error {
	var payload struct {
		VideoID    string  `json:"videoId"`
		StartTime  float64 `json:"startTime"`
		EndTime    float64 `json:"endTime"`
		OutputType string  `json:"outputType"`
		Quality    string  `json:"quality"`
		Format     string  `json:"format"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	jobID, err := r.jobs.StartClip(payload.VideoID, payload.StartTime, payload.EndTime, payload.OutputType, payload.Quality, payload.Format)
	if err != nil {
		return r.h.SendError(msg.RequestID, "START_FAILED", err.Error())
	}

	return r.h.SendResponse(msg.RequestID, map[string]string{"jobId": jobID})
}

func (r *Router) handleCancelJob(msg *host.RawMessage) error {
	var payload struct {
		JobID string `json:"jobId"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	if err := r.jobs.CancelJob(payload.JobID); err != nil {
		return r.h.SendError(msg.RequestID, "JOB_NOT_FOUND", err.Error())
	}

	return r.h.SendResponse(msg.RequestID, map[string]interface{}{"jobId": payload.JobID, "cancelled": true})
}

func (r *Router) handleGetJobStatus(msg *host.RawMessage) error {
	var payload struct {
		JobID string `json:"jobId"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	job, err := r.jobs.GetJobStatus(payload.JobID)
	if err != nil {
		return r.h.SendError(msg.RequestID, "JOB_NOT_FOUND", err.Error())
	}

	return r.h.SendResponse(msg.RequestID, map[string]interface{}{
		"jobId":           job.JobID,
		"state":           job.State,
		"percent":         job.Percent,
		"speedBps":        job.SpeedBps,
		"etaSec":          job.ETASec,
		"downloadedBytes": job.DownloadedBytes,
		"totalBytes":      job.TotalBytes,
		"filepath":        job.Filepath,
		"errorCode":       job.ErrorCode,
	})
}

func (r *Router) handleOpenFile(msg *host.RawMessage) error {
	var payload struct {
		JobID string `json:"jobId"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	job, err := r.jobs.GetJobStatus(payload.JobID)
	if err != nil || job.Filepath == "" {
		return r.h.SendError(msg.RequestID, "JOB_NOT_FOUND", "Job not found or no file")
	}

	// Open file with default app (Windows: explorer.exe or ShellExecute)
	openFileCmd(job.Filepath)
	return r.h.SendResponse(msg.RequestID, map[string]bool{"opened": true})
}

func (r *Router) handleOpenFolder(msg *host.RawMessage) error {
	var payload struct {
		JobID string `json:"jobId"`
	}
	if err := parsePayload(msg.Payload, &payload); err != nil {
		return r.h.SendError(msg.RequestID, "INVALID_REQUEST", err.Error())
	}

	job, err := r.jobs.GetJobStatus(payload.JobID)
	if err != nil || job.Filepath == "" {
		return r.h.SendError(msg.RequestID, "JOB_NOT_FOUND", "Job not found or no file")
	}

	logging.Info("router: openFolder called", map[string]interface{}{"path": job.Filepath})
	openFolderCmd(job.Filepath)
	return r.h.SendResponse(msg.RequestID, map[string]bool{"opened": true})
}

// ============================================================
// Utilities
// ============================================================

func parsePayload(raw json.RawMessage, dest interface{}) error {
	if len(raw) == 0 {
		return nil // empty payload is OK for some operations
	}
	return json.Unmarshal(raw, dest)
}

func mapError(err error) string {
	if err == nil {
		return "UNKNOWN"
	}
	s := err.Error()
	switch {
	case containsAny(s, "INVALID_URL", "invalid videoId", "invalid YouTube URL"):
		return "INVALID_URL"
	case containsAny(s, "UNSUPPORTED_VIDEO", "unavailable", "private", "age-restricted"):
		return "UNSUPPORTED_VIDEO"
	case containsAny(s, "NETWORK_ERROR", "network"):
		return "NETWORK_ERROR"
	case containsAny(s, "DISK_FULL", "disk", "space"):
		return "DISK_FULL"
	case containsAny(s, "YTDLP_FAILED"):
		return "YTDLP_FAILED"
	case containsAny(s, "FFMPEG_FAILED", "ffmpeg"):
		return "FFMPEG_FAILED"
	default:
		return "YTDLP_FAILED"
	}
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if len(s) >= len(sub) {
			// simple substring check
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
		}
	}
	return false
}

func openFileCmd(path string) {
	_ = exec.Command("cmd", "/c", "start", "", path).Start()
}

func openFolderCmd(path string) {
	// Using SysProcAttr.CmdLine bypasses Go's automatic argument escaping which
	// otherwise corrupts the /select,<path> argument if the path contains spaces
	// or brackets (like "[1080p]").
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: fmt.Sprintf(`explorer.exe /select,"%s"`, path),
	}
	_ = cmd.Start()
}
