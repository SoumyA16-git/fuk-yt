// Package logging provides structured JSON logging for the FUK-YT native host.
package logging

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

// Level represents log severity.
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelInfo:
		return "info"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	default:
		return "unknown"
	}
}

// Logger writes structured JSON log lines.
type Logger struct {
	mu      sync.Mutex
	out     io.Writer
	level   Level
	debug   bool
}

var std = &Logger{
	out:   os.Stderr,
	level: LevelInfo,
}

// SetDebug enables debug-level logging.
func SetDebug(enabled bool) {
	std.mu.Lock()
	defer std.mu.Unlock()
	std.debug = enabled
	if enabled {
		std.level = LevelDebug
	} else {
		std.level = LevelInfo
	}
}

type entry struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Message string `json:"msg"`
	// Additional fields merged in
	Extra map[string]interface{} `json:"-"`
}

func log(level Level, msg string, fields map[string]interface{}) {
	std.mu.Lock()
	defer std.mu.Unlock()
	if level < std.level {
		return
	}
	out := map[string]interface{}{
		"time":  time.Now().UTC().Format(time.RFC3339),
		"level": level.String(),
		"msg":   msg,
	}
	for k, v := range fields {
		out[k] = v
	}
	b, err := json.Marshal(out)
	if err != nil {
		fmt.Fprintf(std.out, `{"level":"error","msg":"logger marshal error: %s"}`+"\n", err)
		return
	}
	std.out.Write(b)
	std.out.Write([]byte("\n"))
}

// Debug logs at debug level.
func Debug(msg string, fields ...map[string]interface{}) {
	f := merge(fields)
	log(LevelDebug, msg, f)
}

// Info logs at info level.
func Info(msg string, fields ...map[string]interface{}) {
	f := merge(fields)
	log(LevelInfo, msg, f)
}

// Warn logs at warn level.
func Warn(msg string, fields ...map[string]interface{}) {
	f := merge(fields)
	log(LevelWarn, msg, f)
}

// Error logs at error level.
func Error(msg string, fields ...map[string]interface{}) {
	f := merge(fields)
	log(LevelError, msg, f)
}

func merge(fields []map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{})
	for _, f := range fields {
		for k, v := range f {
			out[k] = v
		}
	}
	return out
}

// F is a shorthand to build a field map.
func F(key string, value interface{}) map[string]interface{} {
	return map[string]interface{}{key: value}
}

// Init opens a log file in logDir for persistent logging (§17 rotating log).
// Falls back to stderr if the directory cannot be created.
// Never exposes log content to the extension UI (§23 UI-ERR-01).
func Init(logDir string) error {
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return fmt.Errorf("logging: create log dir: %w", err)
	}
	logPath := fmt.Sprintf("%s/fuk-yt-%s.log", logDir, time.Now().UTC().Format("2006-01-02"))
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("logging: open log file: %w", err)
	}
	// Write to both stderr (for Chrome debug) and log file
	std.mu.Lock()
	std.out = io.MultiWriter(os.Stderr, f)
	std.mu.Unlock()
	return nil
}
