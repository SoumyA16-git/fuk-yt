// Package download implements DownloadService: orchestrates the yt-dlp→FFmpeg pipeline.
// FR-45: atomic rename from temp to final path only after successful completion.
// NFR-12: disk-full condition detected and mapped to DISK_FULL error.
package download

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/fukyt/host/internal/ffmpeg"
	"github.com/fukyt/host/internal/files"
	"github.com/fukyt/host/internal/logging"
	"github.com/fukyt/host/internal/ytdlp"
)

// ProgressFn receives progress events from the download pipeline.
type ProgressFn func(percent float64, speedBps, etaSec *float64, downloaded, total *int64)

// Service orchestrates the full download pipeline.
type Service struct {
	ytdlp    *ytdlp.Service
	ffmpeg   *ffmpeg.Service
	files    *files.Manager
}

// New creates a DownloadService.
func New(yt *ytdlp.Service, ff *ffmpeg.Service, fm *files.Manager) *Service {
	return &Service{ytdlp: yt, ffmpeg: ff, files: fm}
}

// DownloadVideo downloads a full video (FR-14/FR-15).
// Returns the final output path.
func (s *Service) DownloadVideo(ctx context.Context, videoID, quality, format, jobID string, progressFn ProgressFn, cookies []ytdlp.Cookie) (string, error) {
	if err := ytdlp.ValidateVideoID(videoID); err != nil {
		return "", fmt.Errorf("INVALID_URL: %w", err)
	}
	url := ytdlp.VideoIDToURL(videoID)

	title := videoID
	if info, err := s.ytdlp.GetVideoInfo(ctx, url, cookies); err == nil && info.Title != "" {
		title = info.Title
	}

	// Append quality tag e.g. "Title [1080p]"
	title = fmt.Sprintf("%s [%s]", title, formatQualityTag(quality))

	// Build yt-dlp format string from quality/format choice (FR-42)
	formatStr := buildVideoFormatStr(quality, format)
	mergeExt := "mp4"
	if format == "mkv" {
		mergeExt = "mkv"
	}

	// Temp output path (FR-45 — atomic rename after success)
	tempPath := s.files.TempPath("." + mergeExt)
	outputTemplate := tempPath

	opts := ytdlp.DownloadOptions{
		FormatID:    formatStr,
		MergeFormat: mergeExt,
		OutputPath:  outputTemplate,
		Cookies:     cookies,
	}

	if err := s.files.EnsureDir(files.JobTypeVideo); err != nil {
		return "", fmt.Errorf("DISK_FULL: %w", err)
	}

	err := s.ytdlp.Download(ctx, url, opts, jobID, func(p ytdlp.ProgressEvent) {
		progressFn(p.Percent, p.SpeedBps, p.ETASec, p.Downloaded, p.Total)
	})
	if err != nil {
		_ = os.Remove(tempPath)
		return "", mapDownloadError(err)
	}

	// Resolve final filename using actual video title with quality
	finalPath, err := s.atomicMoveWithTitle(tempPath, files.JobTypeVideo, title)
	if err != nil {
		return "", err
	}
	return finalPath, nil
}

// DownloadAudio downloads a full audio file (FR-20–24).
func (s *Service) DownloadAudio(ctx context.Context, videoID, audioFormat, quality, jobID string, progressFn ProgressFn, cookies []ytdlp.Cookie) (string, error) {
	if err := ytdlp.ValidateVideoID(videoID); err != nil {
		return "", fmt.Errorf("INVALID_URL: %w", err)
	}
	url := ytdlp.VideoIDToURL(videoID)

	title := videoID
	if info, err := s.ytdlp.GetVideoInfo(ctx, url, cookies); err == nil && info.Title != "" {
		title = info.Title
	}

	// Append audio bitrate tag e.g. "Title [320k]"
	audioTag := formatAudioTag(quality)
	title = fmt.Sprintf("%s [%s]", title, audioTag)

	tempPath := s.files.TempPath("." + audioFormat)

	opts := ytdlp.DownloadOptions{
		ExtractAudio: true,
		AudioFormat:  audioFormat,
		AudioQuality: bitrateToYtdlp(quality),
		OutputPath:   tempPath,
		Cookies:      cookies,
	}

	if err := s.files.EnsureDir(files.JobTypeAudio); err != nil {
		return "", fmt.Errorf("DISK_FULL: %w", err)
	}

	err := s.ytdlp.Download(ctx, url, opts, jobID, func(p ytdlp.ProgressEvent) {
		progressFn(p.Percent, p.SpeedBps, p.ETASec, p.Downloaded, p.Total)
	})
	if err != nil {
		_ = os.Remove(tempPath)
		return "", mapDownloadError(err)
	}

	finalPath, err := s.atomicMoveWithTitle(tempPath, files.JobTypeAudio, title)
	if err != nil {
		return "", err
	}
	return finalPath, nil
}

// DownloadClip downloads a time-ranged clip (FR-34–36).
func (s *Service) DownloadClip(ctx context.Context, videoID string, startSec, endSec float64, outputType, quality, format, jobID string, progressFn ProgressFn, cookies []ytdlp.Cookie) (string, error) {
	if err := ytdlp.ValidateVideoID(videoID); err != nil {
		return "", fmt.Errorf("INVALID_URL: %w", err)
	}
	url := ytdlp.VideoIDToURL(videoID)

	baseTitle := videoID
	if info, err := s.ytdlp.GetVideoInfo(ctx, url, cookies); err == nil && info.Title != "" {
		baseTitle = info.Title
	}

	tag := formatQualityTag(quality)
	if outputType == "audio" {
		tag = formatAudioTag(quality)
	}
	title := fmt.Sprintf("%s [Clip %s]", baseTitle, tag)

	sectionSpec := fmt.Sprintf("*%s-%s", formatSeconds(startSec), formatSeconds(endSec))

	var ext string
	if outputType == "audio" {
		ext = format
		if ext == "" {
			ext = "mp3"
		}
	} else {
		ext = format
		if ext == "" {
			ext = "mp4"
		}
	}

	tempPath := s.files.TempPath("." + ext)

	jobType := files.JobTypeClip
	if err := s.files.EnsureDir(jobType); err != nil {
		return "", fmt.Errorf("DISK_FULL: %w", err)
	}

	if outputType == "audio" {
		opts := ytdlp.DownloadOptions{
			ExtractAudio:         true,
			AudioFormat:          ext,
			AudioQuality:         bitrateToYtdlp(quality),
			OutputPath:           tempPath,
			SectionSpec:          sectionSpec,
			ForceKeyframesAtCuts: true,
			Cookies:              cookies,
		}
		err := s.ytdlp.Download(ctx, url, opts, jobID, func(p ytdlp.ProgressEvent) {
			progressFn(p.Percent, p.SpeedBps, p.ETASec, p.Downloaded, p.Total)
		})
		if err != nil {
			_ = os.Remove(tempPath)
			return "", mapDownloadError(err)
		}
	} else {
		formatStr := "bestvideo[height<=1080]+bestaudio/best[height<=1080]"
		stage1Path := tempPath + ".stage1.mp4"
		opts := ytdlp.DownloadOptions{
			FormatID:             formatStr,
			MergeFormat:          ext,
			OutputPath:           stage1Path,
			SectionSpec:          sectionSpec,
			ForceKeyframesAtCuts: false,
			RetainTimestamps:     true,
			Cookies:              cookies,
		}
		err := s.ytdlp.Download(ctx, url, opts, jobID, func(p ytdlp.ProgressEvent) {
			// Fake progress up to 50% for Stage A
			p.Percent = p.Percent * 0.5
			progressFn(p.Percent, p.SpeedBps, p.ETASec, p.Downloaded, p.Total)
		})
		if err != nil {
			_ = os.Remove(stage1Path)
			return "", mapDownloadError(err)
		}

		// Progress for Stage B
		progressFn(50.0, nil, nil, nil, nil)

		// Stage B: Exact Boundary Correction
		args := []string{
			"-y",
			"-i", stage1Path,
			"-ss", fmt.Sprintf("%.3f", startSec),
			"-to", fmt.Sprintf("%.3f", endSec),
			"-c:v", "libx264",
			"-preset", "ultrafast",
			"-c:a", "copy",
			tempPath,
		}
		err = s.ffmpeg.Run(ctx, jobID, args...)
		_ = os.Remove(stage1Path)
		if err != nil {
			_ = os.Remove(tempPath)
			return "", fmt.Errorf("FFMPEG_FAILED")
		}

		progressFn(100.0, nil, nil, nil, nil)
	}

	finalPath, err := s.atomicMoveWithTitle(tempPath, jobType, title)
	if err != nil {
		return "", err
	}
	return finalPath, nil
}

// ============================================================
// Helpers
// ============================================================

// atomicMoveWithTitle renames tempPath to a final sanitized path based on the video title.
func (s *Service) atomicMoveWithTitle(tempPath string, jobType files.JobType, title string) (string, error) {
	ext := filepath.Ext(tempPath)
	if ext == "" {
		ext = ".mp4"
	}

	cleanTitle := strings.TrimSpace(title)
	if cleanTitle == "" {
		cleanTitle = "video"
	}

	safeName, err := files.SanitizeFilename(cleanTitle + ext)
	if err != nil || safeName == "" {
		safeName = fmt.Sprintf("fuk-yt-%d%s", time.Now().Unix(), ext)
	}

	finalPath, err := s.files.ResolvePath(jobType, safeName)
	if err != nil {
		_ = os.Remove(tempPath)
		return "", fmt.Errorf("files: resolve final path: %w", err)
	}

	finalPath = getUniqueFilePath(finalPath)

	if err := os.Rename(tempPath, finalPath); err != nil {
		if err2 := copyFile(tempPath, finalPath); err2 != nil {
			_ = os.Remove(tempPath)
			return "", fmt.Errorf("files: move to final path: %w", err2)
		}
		_ = os.Remove(tempPath)
	}

	logging.Info("download: final file written", map[string]interface{}{
		"path": finalPath, "title": title,
	})
	return finalPath, nil
}

func getUniqueFilePath(path string) string {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}

	dir := filepath.Dir(path)
	ext := filepath.Ext(path)
	base := strings.TrimSuffix(filepath.Base(path), ext)

	for counter := 1; counter <= 999; counter++ {
		newPath := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, counter, ext))
		if _, err := os.Stat(newPath); os.IsNotExist(err) {
			return newPath
		}
	}
	return path
}

func formatQualityTag(q string) string {
	q = strings.TrimSpace(q)
	if q == "" || q == "best" {
		return "Best"
	}
	if matched, _ := regexp.MatchString(`^\d+$`, q); matched {
		return q + "p"
	}
	return q
}

func formatAudioTag(q string) string {
	q = strings.TrimSpace(q)
	if q == "" || q == "best" {
		return "Best"
	}
	if strings.HasSuffix(strings.ToLower(q), "k") {
		return q
	}
	if matched, _ := regexp.MatchString(`^\d+$`, q); matched {
		return q + "k"
	}
	return q
}

func buildVideoFormatStr(quality, format string) string {
	switch quality {
	case "best", "":
		return "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=1080][vcodec^=h264]+bestaudio/bestvideo[height<=1080]+bestaudio/best[height<=1080]"
	default:
		// Strip trailing 'p' or 'p60': "1080p60" → 1080, "720p" → 720
		h := quality
		h = strings.TrimSuffix(h, "p60")
		h = strings.TrimSuffix(h, "p")
		return fmt.Sprintf("bestvideo[height<=%s][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=%s][vcodec^=h264]+bestaudio/bestvideo[height<=%s]+bestaudio/best", h, h, h)
	}
}

func bitrateToYtdlp(quality string) string {
	if quality == "best" || quality == "" {
		return "0" // yt-dlp 0 = best
	}
	return quality + "K"
}

func formatSeconds(sec float64) string {
	h := int(sec) / 3600
	m := (int(sec) % 3600) / 60
	s := sec - float64(h*3600+m*60)
	return fmt.Sprintf("%02d:%02d:%06.3f", h, m, s)
}

func mapDownloadError(err error) error {
	if err == nil {
		return nil
	}
	s := err.Error()
	switch {
	case strings.HasPrefix(s, "UNSUPPORTED_VIDEO"):
		return errors.New("UNSUPPORTED_VIDEO")
	case strings.HasPrefix(s, "NETWORK_ERROR"):
		return errors.New("NETWORK_ERROR")
	case strings.Contains(s, "disk"), strings.Contains(s, "space"), strings.Contains(s, "ENOSPC"):
		return errors.New("DISK_FULL")
	case strings.Contains(s, "ffmpeg"):
		return errors.New("FFMPEG_FAILED")
	default:
		return errors.New("YTDLP_FAILED")
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	buf := make([]byte, 32*1024)
	for {
		n, err := in.Read(buf)
		if n > 0 {
			if _, werr := out.Write(buf[:n]); werr != nil {
				return werr
			}
		}
		if err != nil {
			break
		}
	}
	return nil
}
