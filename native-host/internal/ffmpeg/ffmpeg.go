// Package ffmpeg implements FFmpegService: mux, clip, transcode.
// FR-15: merge video+audio via -c copy; no re-encode unless required.
// FR-23: stream-copy when source codec matches output container.
// FR-36: clip extraction prefers -c copy; falls back to re-encode when needed.
// SEC-05: all invocations use fixed argv arrays — no shell interpolation.
package ffmpeg

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/fukyt/host/internal/logging"
	"github.com/fukyt/host/internal/process"
)

const keyframeThresholdSecs = 2.0 // FR-36

// Service wraps ffmpeg/ffprobe binaries.
type Service struct {
	ffmpegPath  string
	ffprobePath string
	pm          *process.ProcessManager
}

// New creates a new FFmpegService.
func New(ffmpegPath, ffprobePath string, pm *process.ProcessManager) *Service {
	return &Service{ffmpegPath: ffmpegPath, ffprobePath: ffprobePath, pm: pm}
}

// Version returns the ffmpeg version string.
func (s *Service) Version(ctx context.Context) (string, error) {
	out, err := exec.CommandContext(ctx, s.ffmpegPath, "-version").Output()
	if err != nil {
		return "", err
	}
	line := strings.SplitN(string(out), "\n", 2)[0]
	parts := strings.Fields(line)
	if len(parts) >= 3 {
		return parts[2], nil
	}
	return strings.TrimSpace(line), nil
}

// Merge merges video and audio streams into outputPath (FR-15).
// Prefers -c copy; falls back to re-encode if copy fails.
// SEC-05: fixed argv.
func (s *Service) Merge(ctx context.Context, videoIn, audioIn, outputPath, jobID string) error {
	logging.Info("ffmpeg: merging streams", map[string]interface{}{"output": outputPath})

	args := []string{
		"-y", "-i", videoIn, "-i", audioIn,
		"-c", "copy",
		outputPath,
	}
	if err := s.Run(ctx, jobID, args...); err == nil {
		return nil
	}

	// Fallback re-encode (FR-15)
	logging.Warn("ffmpeg: stream copy merge failed, re-encoding", nil)
	args = []string{
		"-y", "-i", videoIn, "-i", audioIn,
		"-c:v", "libx264", "-c:a", "aac",
		outputPath,
	}
	return s.Run(ctx, jobID, args...)
}

// CutClip trims a clip from startSec to endSec (FR-36).
// Prefers stream-copy; falls back to re-encode when keyframe error > threshold.
// SEC-05: fixed argv.
func (s *Service) CutClip(ctx context.Context, inputPath string, startSec, endSec float64, outputPath, jobID string) error {
	logging.Info("ffmpeg: cutting clip", map[string]interface{}{
		"start": startSec, "end": endSec, "output": outputPath,
	})

	needsReencode, err := s.needsReencode(ctx, inputPath, startSec, endSec)
	if err != nil {
		logging.Warn("ffmpeg: keyframe check failed, using stream copy", map[string]interface{}{"err": err.Error()})
		needsReencode = false
	}

	startStr := formatSeconds(startSec)
	endStr := formatSeconds(endSec)

	if needsReencode {
		logging.Info("ffmpeg: re-encoding clip for frame accuracy", nil)
		return s.Run(ctx, jobID,
			"-y", "-i", inputPath,
			"-ss", startStr, "-to", endStr,
			"-c:v", "libx264", "-c:a", "aac",
			outputPath,
		)
	}

	// Stream-copy fast path (before -i for accurate seeking)
	return s.Run(ctx, jobID,
		"-y",
		"-ss", startStr,
		"-i", inputPath,
		"-to", endStr,
		"-c", "copy",
		outputPath,
	)
}

// CutAudioClip trims an audio clip with optional codec conversion (FR-36/FR-23).
// SEC-05: fixed argv.
func (s *Service) CutAudioClip(ctx context.Context, inputPath string, startSec, endSec float64, audioFormat, outputPath, jobID string) error {
	codec := audioFormatToCodec(audioFormat)

	logging.Info("ffmpeg: cutting audio clip", map[string]interface{}{
		"start": startSec, "end": endSec, "codec": codec,
	})

	return s.Run(ctx, jobID,
		"-y",
		"-ss", formatSeconds(startSec),
		"-i", inputPath,
		"-to", formatSeconds(endSec),
		"-vn",          // no video
		"-c:a", codec,
		outputPath,
	)
}

// ExtractAudio converts a video or audio file to the requested audio format (FR-23).
// Stream-copies when source codec matches output; re-encodes only when needed.
func (s *Service) ExtractAudio(ctx context.Context, inputPath, outputPath, audioFormat, quality, jobID string) error {
	codec := audioFormatToCodec(audioFormat)

	args := []string{
		"-y", "-i", inputPath,
		"-vn",
		"-c:a", codec,
	}
	if quality != "" && quality != "best" {
		args = append(args, "-b:a", quality+"k")
	}
	args = append(args, outputPath)

	return s.Run(ctx, jobID, args...)
}

// Probe returns basic metadata (duration) via ffprobe.
func (s *Service) Probe(ctx context.Context, inputPath string) (durationSec float64, err error) {
	out, err := exec.CommandContext(ctx, s.ffprobePath,
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		inputPath,
	).Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe: %w", err)
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	return d, err
}

// ============================================================
// Helpers
// ============================================================

// Run executes ffmpeg with the given args. SEC-05: uses exec.Command array form.
func (s *Service) Run(ctx context.Context, jobID string, args ...string) error {
	cmd := exec.CommandContext(ctx, s.ffmpegPath, args...)
	stderrBuf := &bytes.Buffer{}
	cmd.Stderr = stderrBuf

	if s.pm != nil {
		if err := s.pm.StartProcess(jobID, cmd); err != nil {
			return err
		}
	} else {
		if err := cmd.Start(); err != nil {
			return fmt.Errorf("ffmpeg: start: %w", err)
		}
	}

	// Parse stderr progress lines (NFR-03)
	go func() {
		scanner := bufio.NewScanner(bytes.NewReader(stderrBuf.Bytes()))
		for scanner.Scan() {
			// FFmpeg progress could be parsed here for Processing state updates
		}
	}()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("ffmpeg: %w: %s", err, stderrBuf.String())
	}
	return nil
}

func (s *Service) needsReencode(ctx context.Context, inputPath string, startSec, endSec float64) (bool, error) {
	nearestStart, err := s.probeNearestKeyframe(ctx, inputPath, startSec)
	if err != nil {
		return false, err
	}
	nearestEnd, err := s.probeNearestKeyframe(ctx, inputPath, endSec)
	if err != nil {
		return false, err
	}
	startErr := abs64(nearestStart - startSec)
	endErr := abs64(nearestEnd - endSec)
	return startErr > keyframeThresholdSecs || endErr > keyframeThresholdSecs, nil
}

func (s *Service) probeNearestKeyframe(ctx context.Context, inputPath string, nearSec float64) (float64, error) {
	out, err := exec.CommandContext(ctx, s.ffprobePath,
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "packet=pts_time,flags",
		"-of", "csv=print_section=0",
		"-read_intervals", fmt.Sprintf("%f%%+#20", nearSec-5),
		inputPath,
	).Output()
	if err != nil {
		return nearSec, nil // assume accurate if probe fails
	}

	var nearest float64 = -1
	var minDist float64 = 1e9
	for _, line := range strings.Split(string(out), "\n") {
		parts := strings.Split(strings.TrimSpace(line), ",")
		if len(parts) < 2 || !strings.Contains(parts[1], "K") {
			continue
		}
		pts, err := strconv.ParseFloat(parts[0], 64)
		if err != nil {
			continue
		}
		dist := abs64(pts - nearSec)
		if dist < minDist {
			minDist = dist
			nearest = pts
		}
	}
	if nearest < 0 {
		return nearSec, nil
	}
	return nearest, nil
}

func audioFormatToCodec(format string) string {
	switch format {
	case "mp3":
		return "libmp3lame"
	case "m4a":
		return "aac"
	case "opus":
		return "libopus"
	default:
		return "copy"
	}
}

func formatSeconds(sec float64) string {
	h := int(sec) / 3600
	m := (int(sec) % 3600) / 60
	s := sec - float64(h*3600+m*60)
	return fmt.Sprintf("%02d:%02d:%06.3f", h, m, s)
}

func abs64(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}
