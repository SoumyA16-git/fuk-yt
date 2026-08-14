// Package ytdlp implements YtDlpService and FormatService.
// SEC-05: all yt-dlp invocations use fixed argv arrays — no shell string building.
// SEC-06: URL/videoId inputs validated before use.
// NFR-03: child process stdout/stderr parsed line-by-line, never buffered in full.
package ytdlp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/fukyt/host/internal/logging"
	"github.com/fukyt/host/internal/process"
)

// ============================================================
// Domain types (PRD §18 FormatInfo / VideoInfo)
// ============================================================

// FormatInfo is the full PRD §18 format entry.
type FormatInfo struct {
	FormatID       string   `json:"formatId"`
	Resolution     string   `json:"resolution,omitempty"`
	Height         *int     `json:"height,omitempty"`
	Width          *int     `json:"width,omitempty"`
	FPS            *float64 `json:"fps,omitempty"`
	Ext            string   `json:"ext"`
	VCodec         string   `json:"vcodec,omitempty"`
	ACodec         string   `json:"acodec,omitempty"`
	Filesize       *int64   `json:"filesize,omitempty"`
	FilesizeApprox *int64   `json:"filesizeApprox,omitempty"`
	ABR            *float64 `json:"abr,omitempty"`
	AudioOnly      bool     `json:"audioOnly"`
	VideoOnly      bool     `json:"videoOnly"`
	HDR            bool     `json:"hdr,omitempty"`
}

// VideoInfo is the PRD §18 getVideoInfo response payload.
type VideoInfo struct {
	VideoID   string  `json:"videoId"`
	Title     string  `json:"title"`
	Duration  float64 `json:"duration"`
	Thumbnail string  `json:"thumbnail"`
	Channel   string  `json:"channel,omitempty"`
}

// ProgressEvent is a structured download progress update from yt-dlp stdout.
type ProgressEvent struct {
	JobID      string
	Percent    float64
	SpeedBps   *float64
	ETASec     *float64
	Downloaded *int64
	Total      *int64
}

// ============================================================
// URL / videoId validation (SEC-06)
// ============================================================

var validVideoIDRe = regexp.MustCompile(`^[A-Za-z0-9_\-]{8,16}$`)
var validYTURLRe = regexp.MustCompile(`(?i)^https?://(www\.)?youtube\.com/(watch\?(?:.*&)?v=[A-Za-z0-9_\-]{8,16}|shorts/[A-Za-z0-9_\-]{8,16})`)

func ValidateVideoID(id string) error {
	if !regexp.MustCompile(`^[a-zA-Z0-9_-]{11}$`).MatchString(id) {
		return fmt.Errorf("INVALID_VIDEO_ID")
	}
	return nil
}

// ValidateYouTubeURL returns an error if the URL is not a YouTube watch/shorts URL (SEC-06).
func ValidateYouTubeURL(url string) error {
	if !validYTURLRe.MatchString(url) {
		return fmt.Errorf("ytdlp: invalid YouTube URL: %q", url)
	}
	return nil
}

func extractVideoID(u string) string {
	parsed, err := url.Parse(u)
	if err == nil {
		if v := parsed.Query().Get("v"); v != "" {
			return v
		}
	}
	if strings.Contains(u, "youtu.be/") {
		parts := strings.Split(u, "youtu.be/")
		if len(parts) > 1 {
			return strings.Split(parts[1], "?")[0]
		}
	}
	return ""
}

// VideoIDToURL converts a clean ID to a full URL. from a videoId.
func VideoIDToURL(videoID string) string {
	return "https://www.youtube.com/watch?v=" + videoID
}

// ============================================================
// Service
// ============================================================

// Service wraps the yt-dlp binary.
type Service struct {
	binaryPath string
	pm         *process.ProcessManager
}

// New creates a new YtDlpService.
func New(binaryPath string, pm *process.ProcessManager) *Service {
	return &Service{binaryPath: binaryPath, pm: pm}
}

// Version returns the yt-dlp version string (used by getEngineInfo).
func (s *Service) Version(ctx context.Context) (string, error) {
	out, err := s.runCapture(ctx, "--version")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// GetVideoInfo fetches video metadata (§18 getVideoInfo).
// SEC-05: fixed argv. SEC-06: URL validated before call.
func (s *Service) GetVideoInfo(ctx context.Context, url string, cookies []Cookie) (*VideoInfo, error) {
	if err := ValidateYouTubeURL(url); err != nil {
		return nil, err
	}

	cookiePath, cleanup, err := WriteCookiesFile(cookies)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	args := []string{
		"--ignore-no-formats-error",
		"--ignore-config",
		"--dump-json",
		"--no-playlist",
		"--no-warnings",
		"--retries", "5",
	}

	vid := extractVideoID(url)
	if vid != "" {
		cachePath := filepath.Join(os.TempDir(), fmt.Sprintf("fuk-yt-info-%s.json", vid))
		if _, err := os.Stat(cachePath); err == nil {
			args = append(args, "--load-info-json", cachePath)
		}
	}

	if cookiePath != "" {
		args = append(args, "--cookies", cookiePath)
	}
	args = append(args, url)

	out, runErr := s.runCapture(ctx, args...)

	if len(out) > 0 {
		if info, err := parseVideoInfo(out, url); err == nil {
			return info, nil
		}
	}

	if runErr != nil {
		logging.Error("ytdlp: getVideoInfo failed", map[string]interface{}{
			"url": url,
			"err": runErr.Error(),
		})
		return nil, mapYtdlpError(runErr)
	}
	return nil, fmt.Errorf("ytdlp: no output and no error")
}

// GetFormats fetches the full format list (§18 getFormats / FR-41).
// SEC-06: videoId validated.
func (s *Service) GetFormats(ctx context.Context, videoID string, cookies []Cookie) ([]FormatInfo, error) {
	if err := ValidateVideoID(videoID); err != nil {
		return nil, err
	}
	url := VideoIDToURL(videoID)

	cookiePath, cleanup, err := WriteCookiesFile(cookies)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	args := []string{
		"--ignore-no-formats-error",
		"--ignore-config",
		"--dump-json",
		"--no-playlist",
		"--no-warnings",
		"--retries", "5",
	}
	if cookiePath != "" {
		args = append(args, "--cookies", cookiePath)
	}
	args = append(args, url)

	out, runErr := s.runCapture(ctx, args...)

	if len(out) > 0 {
		// Cache the output for immediate download later
		cachePath := filepath.Join(os.TempDir(), fmt.Sprintf("fuk-yt-info-%s.json", videoID))
		_ = os.WriteFile(cachePath, out, 0600)

		if formats, err := parseFormats(out); err == nil {
			return formats, nil
		}
	}

	if runErr != nil {
		logging.Error("ytdlp: getFormats failed", map[string]interface{}{
			"videoId": videoID,
			"err":     runErr.Error(),
		})
		return nil, mapYtdlpError(runErr)
	}
	return nil, fmt.Errorf("ytdlp: no output and no error")
}

// DownloadOptions configures a yt-dlp download (FR-42).
type DownloadOptions struct {
	FormatID     string // yt-dlp format string (e.g. "bestvideo[height<=1080]+bestaudio")
	MergeFormat  string // output container (e.g. "mp4", "mkv")
	OutputPath   string // full output path template
	ExtractAudio bool
	AudioFormat  string // "mp3", "m4a", "opus"
	AudioQuality string // bitrate string e.g. "192K"
	// For clip downloads via yt-dlp --download-sections
	SectionSpec          string // e.g. "*1:00-1:30"
	ForceKeyframesAtCuts bool
	Cookies              []Cookie
}

// Download runs yt-dlp and streams progress events via callback.
// NFR-03: output parsed line-by-line.
// SEC-05: all args are array elements, never shell-interpolated.
func (s *Service) Download(
	ctx context.Context,
	url string,
	opts DownloadOptions,
	jobID string,
	progressFn func(ProgressEvent),
) error {
	args := []string{
		"--no-playlist",
		"--newline", // forces one [download] line per progress update
		"--no-warnings",
		"--retries", "10",
		"--fragment-retries", "10",
		"--file-access-retries", "10",
		"-o", opts.OutputPath,
	}

	vid := extractVideoID(url)
	if vid != "" {
		cachePath := filepath.Join(os.TempDir(), fmt.Sprintf("fuk-yt-info-%s.json", vid))
		if _, err := os.Stat(cachePath); err == nil {
			args = append(args, "--load-info-json", cachePath)
			// Optional: delete cache after use if desired, but keeping it is fine as temp dir clears on reboot.
		}
	}

	cookiePath, cleanup, err := WriteCookiesFile(opts.Cookies)
	if err != nil {
		return err
	}
	defer cleanup()

	if cookiePath != "" {
		args = append(args, "--cookies", cookiePath)
	}

	if s.binaryPath != "" {
		binDir := filepath.Dir(s.binaryPath)
		if binDir != "" && binDir != "." {
			args = append(args, "--ffmpeg-location", binDir)
		}
	}

	if opts.ExtractAudio {
		args = append(args, "-x")
		if opts.AudioFormat != "" {
			args = append(args, "--audio-format", opts.AudioFormat)
		}
		if opts.AudioQuality != "" {
			args = append(args, "--audio-quality", opts.AudioQuality)
		}
	} else {
		if opts.FormatID != "" {
			args = append(args, "-f", opts.FormatID)
		}
		if opts.MergeFormat != "" {
			args = append(args, "--merge-output-format", opts.MergeFormat)
		}
	}

	if opts.SectionSpec != "" {
		args = append(args, "--download-sections", opts.SectionSpec)
		if opts.ForceKeyframesAtCuts {
			args = append(args, "--force-keyframes-at-cuts")
			// Pass ultrafast preset to ffmpeg to make re-encoding almost instant
			args = append(args, "--downloader-args", "ffmpeg:-preset ultrafast")
		}
	}

	args = append(args, url)

	cmd := exec.CommandContext(ctx, s.binaryPath, args...) // SEC-05: array, no shell

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("ytdlp: stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("ytdlp: stderr pipe: %w", err)
	}

	// Register with ProcessManager before Start
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("ytdlp: start: %w", err)
	}
	if s.pm != nil {
		s.pm.RegisterProcess(jobID, cmd.Process)
		defer s.pm.RemoveProcess(jobID, cmd.Process)
	}

	// NFR-03: parse stdout & stderr line-by-line concurrently
	var wg sync.WaitGroup
	wg.Add(2)

	var lastErrorLine string
	var errMu sync.Mutex

	scanStream := func(r io.Reader, isStderr bool) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			line := scanner.Text()
			if evt, ok := parseProgressLine(line, jobID); ok {
				progressFn(evt)
			} else if isStderr && strings.Contains(strings.ToLower(line), "error") {
				errMu.Lock()
				lastErrorLine = line
				errMu.Unlock()
				logging.Warn("ytdlp stderr", map[string]interface{}{"jobId": jobID, "line": line})
			}
		}
	}

	go scanStream(stdout, false)
	go scanStream(stderr, true)

	wg.Wait()

	if err := cmd.Wait(); err != nil {
		errMu.Lock()
		errMsg := err.Error()
		if lastErrorLine != "" {
			errMsg = lastErrorLine
		}
		errMu.Unlock()

		logging.Error("ytdlp: download failed", map[string]interface{}{
			"jobId": jobID, "err": errMsg,
		})
		return mapYtdlpError(fmt.Errorf("%s: %s", err.Error(), errMsg))
	}

	logging.Info("ytdlp: download complete", map[string]interface{}{"jobId": jobID})
	return nil
}

// ============================================================
// Parsing helpers
// ============================================================

type ytdlpRaw struct {
	ID        string           `json:"id"`
	Title     string           `json:"title"`
	Channel   string           `json:"channel"`
	Uploader  string           `json:"uploader"`
	Duration  float64          `json:"duration"`
	Thumbnail string           `json:"thumbnail"`
	Formats   []ytdlpRawFormat `json:"formats"`
}

type ytdlpRawFormat struct {
	FormatID       string   `json:"format_id"`
	FormatNote     string   `json:"format_note"`
	Ext            string   `json:"ext"`
	Protocol       string   `json:"protocol"`
	Width          *int     `json:"width"`
	Height         *int     `json:"height"`
	FPS            *float64 `json:"fps"`
	VCodec         string   `json:"vcodec"`
	ACodec         string   `json:"acodec"`
	Filesize       *int64   `json:"filesize"`
	FilesizeApprox *int64   `json:"filesize_approx"`
	ABR            *float64 `json:"abr"`
	DynamicRange   string   `json:"dynamic_range"`
}

func parseVideoInfo(data []byte, originalURL string) (*VideoInfo, error) {
	var raw ytdlpRaw
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("ytdlp: parse video info: %w", err)
	}
	ch := raw.Channel
	if ch == "" {
		ch = raw.Uploader
	}
	return &VideoInfo{
		VideoID:   raw.ID,
		Title:     raw.Title,
		Duration:  raw.Duration,
		Thumbnail: raw.Thumbnail,
		Channel:   ch,
	}, nil
}

func parseFormats(data []byte) ([]FormatInfo, error) {
	var raw ytdlpRaw
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("ytdlp: parse formats: %w", err)
	}

	out := make([]FormatInfo, 0, len(raw.Formats))
	for _, rf := range raw.Formats {
		// Skip storyboard thumbnails and DASH manifests
		if rf.Protocol == "mhtml" || rf.Protocol == "http_dash_segments" {
			continue
		}
		f := FormatInfo{
			FormatID:       rf.FormatID,
			Ext:            rf.Ext,
			Width:          rf.Width,
			Height:         rf.Height,
			FPS:            rf.FPS,
			VCodec:         rf.VCodec,
			ACodec:         rf.ACodec,
			Filesize:       rf.Filesize,
			FilesizeApprox: rf.FilesizeApprox,
			ABR:            rf.ABR,
			HDR:            strings.Contains(strings.ToLower(rf.DynamicRange), "hdr"),
		}
		if rf.Height != nil {
			fps := 0.0
			if rf.FPS != nil {
				fps = *rf.FPS
			}
			if fps >= 50 {
				f.Resolution = fmt.Sprintf("%dp60", *rf.Height)
			} else {
				f.Resolution = fmt.Sprintf("%dp", *rf.Height)
			}
		}
		f.AudioOnly = (rf.VCodec == "none" || rf.VCodec == "") && rf.ACodec != ""
		f.VideoOnly = (rf.ACodec == "none" || rf.ACodec == "") && rf.VCodec != ""
		out = append(out, f)
	}
	return out, nil
}

// parseProgressLine implementation moved to progress_parser.go

func toBytes(val float64, unit string) float64 {
	u := strings.ToLower(strings.TrimSpace(unit))
	switch {
	case strings.HasPrefix(u, "kib") || strings.HasPrefix(u, "ki"):
		return val * 1024
	case strings.HasPrefix(u, "mib") || strings.HasPrefix(u, "mi"):
		return val * 1024 * 1024
	case strings.HasPrefix(u, "gib") || strings.HasPrefix(u, "gi"):
		return val * 1024 * 1024 * 1024
	case strings.HasPrefix(u, "k"):
		return val * 1024
	case strings.HasPrefix(u, "m"):
		return val * 1024 * 1024
	case strings.HasPrefix(u, "g"):
		return val * 1024 * 1024 * 1024
	default:
		return val
	}
}

func mapYtdlpError(err error) error {
	if err == nil {
		return nil
	}
	s := err.Error()
	switch {
	case strings.Contains(s, "Video unavailable"),
		strings.Contains(s, "Private video"),
		strings.Contains(s, "age-restricted"):
		return fmt.Errorf("UNSUPPORTED_VIDEO: %w", err)
	case strings.Contains(s, "network"), strings.Contains(s, "connection"):
		return fmt.Errorf("NETWORK_ERROR: %w", err)
	default:
		return fmt.Errorf("YTDLP_FAILED: %w", err)
	}
}

// runCapture runs yt-dlp and captures stdout. SEC-05: uses exec.Command array form.
func (s *Service) runCapture(ctx context.Context, args ...string) ([]byte, error) {
	// Look for deno.exe in the same folder as yt-dlp.exe
	denoPath := filepath.Join(filepath.Dir(s.binaryPath), "deno.exe")
	if _, err := os.Stat(denoPath); err == nil {
		args = append([]string{"--js-runtimes", "deno:" + denoPath}, args...)
	}

	cmd := exec.CommandContext(ctx, s.binaryPath, args...)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("ytdlp: exit %d: %s", ee.ExitCode(), string(ee.Stderr))
		}
		return nil, err
	}
	return out, nil
}
