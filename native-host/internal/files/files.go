// Package files implements FileManager: path resolution, sanitization, directory creation.
// SEC-03: output paths validated to resolve within downloadRoot only.
// SEC-04: Windows-invalid characters stripped, reserved device names rejected.
package files

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"
)

// Windows reserved device names (SEC-04)
var windowsReservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true,
	"COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true,
	"LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// Windows-invalid filename characters (SEC-04)
var invalidCharsRe = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

const maxFilenameLen = 200 // well within Windows MAX_PATH with typical dir depth

// Manager resolves and validates output paths.
type Manager struct {
	downloadRoot string // base output directory (configured in §21)
}

// New creates a FileManager with the given download root.
func New(downloadRoot string) *Manager {
	if downloadRoot == "" || strings.Contains(downloadRoot, "staging") {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			downloadRoot = filepath.Join(home, "Downloads")
		} else {
			downloadRoot = filepath.Join(os.Getenv("USERPROFILE"), "Downloads")
		}
	}
	_ = os.MkdirAll(downloadRoot, 0755)
	return &Manager{downloadRoot: downloadRoot}
}

// JobType determines which subfolder to use.
type JobType string

const (
	JobTypeVideo JobType = "video"
	JobTypeAudio JobType = "audio"
	JobTypeClip  JobType = "clip"
)

func (jt JobType) Subfolder() string {
	switch jt {
	case JobTypeAudio:
		return "Audio"
	case JobTypeClip:
		return "Clips"
	default:
		return "Videos"
	}
}

// ResolvePath builds and validates the output path for a job.
// Returns the sanitized absolute path inside downloadRoot.
// SEC-03: rejects traversal outside downloadRoot.
// SEC-04: sanitizes filename.
func (m *Manager) ResolvePath(jobType JobType, filename string) (string, error) {
	safe, err := SanitizeFilename(filename)
	if err != nil {
		return "", err
	}

	outDir := m.downloadRoot
	outPath := filepath.Join(outDir, safe)

	// SEC-03: ensure resolved path stays within downloadRoot
	rel, err := filepath.Rel(m.downloadRoot, outPath)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("files: path traversal rejected: %s", filename)
	}

	return outPath, nil
}

// EnsureDir creates the output directory (and parents) if they don't exist.
// Called by DownloadService before writing (FR-45).
func (m *Manager) EnsureDir(jobType JobType) error {
	return os.MkdirAll(m.downloadRoot, 0o755)
}

// TempPath returns a temp file path in the temp directory (§20).
func (m *Manager) TempPath(suffix string) string {
	localData := os.Getenv("LOCALAPPDATA")
	if localData == "" {
		localData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
	}
	tempDir := filepath.Join(localData, "FUK-YT", "temp")
	_ = os.MkdirAll(tempDir, 0o755)
	return filepath.Join(tempDir, fmt.Sprintf(".fuk-yt-tmp-%s%s", randomHex(8), suffix))
}

// DownloadRoot returns the configured root.
func (m *Manager) DownloadRoot() string {
	return m.downloadRoot
}

// SanitizeFilename strips Windows-invalid characters and rejects reserved names (SEC-04).
func SanitizeFilename(name string) (string, error) {
	// Remove invalid characters
	safe := invalidCharsRe.ReplaceAllString(name, "_")

	// Trim trailing dots and spaces (Windows ignores them)
	safe = strings.TrimRight(safe, ". ")

	// Truncate to max length (rune-aware)
	if utf8.RuneCountInString(safe) > maxFilenameLen {
		runes := []rune(safe)
		// Preserve extension
		ext := filepath.Ext(safe)
		base := string(runes[:maxFilenameLen-len([]rune(ext))])
		safe = base + ext
	}

	if safe == "" {
		safe = "download"
	}

	// SEC-04: reject / rename Windows reserved device names
	nameWithoutExt := strings.ToUpper(strings.TrimSuffix(safe, filepath.Ext(safe)))
	if windowsReservedNames[nameWithoutExt] {
		safe = "_" + safe
	}

	// Windows path length (SEC-04) — leave room for directory prefix
	if runtime.GOOS == "windows" && len(safe) > 255 {
		ext := filepath.Ext(safe)
		safe = safe[:255-len(ext)] + ext
	}

	return safe, nil
}

// CleanOrphanedTemp removes any .fuk-yt-tmp-* files from the temp directory
// (called on host startup per §20).
func (m *Manager) CleanOrphanedTemp() {
	tempDir := filepath.Join(m.downloadRoot, "..", "temp")
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".fuk-yt-tmp-") {
			_ = os.Remove(filepath.Join(tempDir, e.Name()))
		}
	}
}

// randomHex returns n random hex characters.
func randomHex(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		s := fmt.Sprintf("%016x", time.Now().UnixNano())
		if len(s) > n {
			return s[:n]
		}
		return s
	}
	s := hex.EncodeToString(b)
	if len(s) > n {
		return s[:n]
	}
	return s
}
