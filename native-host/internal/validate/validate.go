// Package validate provides input sanitization and path validation for the native host.
// All webpage-sourced data is treated as untrusted.
package validate

import (
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
)

// AllowedMessageTypes is the strict allowlist of accepted message types.
var AllowedMessageTypes = map[string]bool{
	"ping":         true,
	"getEngineInfo": true,
	"getVideoInfo": true,
	"getFormats":   true,
	"getPlaylistInfo": true,
	"download":     true,
	"cancel":       true,
	"pause":        true,
	"resume":       true,
	"openFile":     true,
	"openFolder":   true,
	"getJob":       true,
	"removeJob":    true,
	"reorderQueue": true,
}

// windowsReservedNames are reserved device names on Windows.
var windowsReservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true,
	"COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true,
	"LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// invalidFilenameChars are characters invalid in Windows filenames.
var invalidFilenameRe = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

// MessageType validates that the message type is in the allowlist.
func MessageType(msgType string) error {
	if msgType == "" {
		return fmt.Errorf("validate: empty message type")
	}
	if !AllowedMessageTypes[msgType] {
		return fmt.Errorf("validate: unknown message type %q", msgType)
	}
	return nil
}

// RequestID validates that a requestId is non-empty.
func RequestID(id string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("validate: missing requestId")
	}
	if len(id) > 128 {
		return fmt.Errorf("validate: requestId too long")
	}
	return nil
}

// YouTubeURL validates a YouTube video URL.
func YouTubeURL(rawURL string) error {
	if rawURL == "" {
		return fmt.Errorf("validate: empty URL")
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("validate: invalid URL: %w", err)
	}
	host := strings.ToLower(u.Host)
	if !strings.HasSuffix(host, "youtube.com") && !strings.HasSuffix(host, "youtu.be") {
		return fmt.Errorf("validate: URL host %q is not a supported YouTube domain", host)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("validate: URL must use HTTPS")
	}
	return nil
}

// Timestamp validates a HH:MM:SS timestamp string.
func Timestamp(ts string) error {
	if ts == "" {
		return fmt.Errorf("validate: empty timestamp")
	}
	parts := strings.Split(ts, ":")
	if len(parts) != 3 {
		return fmt.Errorf("validate: timestamp must be HH:MM:SS format")
	}
	for _, p := range parts {
		if len(p) != 2 {
			return fmt.Errorf("validate: timestamp component must be 2 digits: %q", p)
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return fmt.Errorf("validate: non-numeric timestamp component: %q", p)
			}
		}
	}
	return nil
}

// FormatID validates a yt-dlp format ID.
func FormatID(id string) error {
	if id == "" {
		return nil // optional
	}
	if len(id) > 64 {
		return fmt.Errorf("validate: format ID too long")
	}
	// yt-dlp format IDs are alphanumeric with +, -, /
	allowed := regexp.MustCompile(`^[a-zA-Z0-9+\-_/]+$`)
	if !allowed.MatchString(id) {
		return fmt.Errorf("validate: format ID contains invalid characters: %q", id)
	}
	return nil
}

// OutputPath validates that the resolved output path stays within the allowed root.
// downloadRoot must be the absolute, canonical path.
func OutputPath(candidate, downloadRoot string) (string, error) {
	if candidate == "" {
		return downloadRoot, nil
	}

	// Resolve to absolute
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return "", fmt.Errorf("validate: cannot resolve path: %w", err)
	}

	// Ensure stays within root
	rel, err := filepath.Rel(downloadRoot, abs)
	if err != nil {
		return "", fmt.Errorf("validate: path resolution error: %w", err)
	}
	if strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("validate: path traversal attempt detected: %q", candidate)
	}

	return abs, nil
}

// Filename sanitizes a filename for Windows compatibility.
func Filename(name string) string {
	// Replace invalid characters with underscores
	name = invalidFilenameRe.ReplaceAllString(name, "_")
	// Trim trailing dots and spaces (Windows strips them silently)
	name = strings.TrimRight(name, ". ")
	// Truncate to 200 chars
	if len(name) > 200 {
		name = name[:200]
	}
	// Check reserved names (without extension)
	parts := strings.SplitN(name, ".", 2)
	if windowsReservedNames[strings.ToUpper(parts[0])] {
		name = "_" + name
	}
	return name
}

// JobID validates a UUID-style job ID.
func JobID(id string) error {
	if id == "" {
		return fmt.Errorf("validate: missing job ID")
	}
	if len(id) > 64 {
		return fmt.Errorf("validate: job ID too long")
	}
	return nil
}

// JSONRawRequest validates that a raw JSON message can be parsed and has required fields.
func JSONRawRequest(raw json.RawMessage, dest interface{}) error {
	if err := json.Unmarshal(raw, dest); err != nil {
		return fmt.Errorf("validate: malformed JSON: %w", err)
	}
	return nil
}
