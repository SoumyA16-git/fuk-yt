// FUK-YT Native Host — main entrypoint.
// Wires all internal packages per PRD §6 architecture.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/fukyt/host/internal/download"
	"github.com/fukyt/host/internal/ffmpeg"
	"github.com/fukyt/host/internal/files"
	"github.com/fukyt/host/internal/host"
	"github.com/fukyt/host/internal/jobs"
	"github.com/fukyt/host/internal/logging"
	"github.com/fukyt/host/internal/process"
	"github.com/fukyt/host/internal/router"
	"github.com/fukyt/host/internal/ytdlp"
)

var Version = "0.2.0"

type Config struct {
	InstallDir   string
	DownloadRoot string
	YtDlpPath    string
	FFmpegPath   string
	FFprobePath  string
	LogDir       string
	TempDir      string
}

func main() {
	healthCheck := flag.Bool("health-check", false, "Run engine health check and exit")
	debug := flag.Bool("debug", false, "Enable debug logging")
	flag.Parse()

	if *debug {
		logging.SetDebug(true)
	}

	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "fuk-yt: config error: %v\n", err)
		os.Exit(1)
	}

	// Init logger with rotating file output
	if err := logging.Init(cfg.LogDir); err != nil {
		fmt.Fprintf(os.Stderr, "fuk-yt: logger init error: %v\n", err)
		// Non-fatal: continue without file logging
	}

	if *healthCheck {
		os.Exit(runHealthCheck(cfg))
	}

	if err := run(cfg); err != nil {
		logging.Error("host: fatal error", map[string]interface{}{"err": err.Error()})
		os.Exit(1)
	}
}

func loadConfig() (*Config, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("config: cannot find executable: %w", err)
	}
	installDir := filepath.Dir(exe)

	binExt := ""
	if runtime.GOOS == "windows" {
		binExt = ".exe"
	}

	localData := os.Getenv("LOCALAPPDATA")
	if localData == "" {
		localData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
	}
	userProfile := os.Getenv("USERPROFILE")
	if userProfile == "" {
		userProfile = os.Getenv("HOMEPATH")
	}
	downloadsDir := filepath.Join(userProfile, "Downloads")
	var downloadRoot string
	if _, err := os.Stat(downloadsDir); err == nil {
		downloadRoot = filepath.Join(downloadsDir, "FUK-YT")
	} else {
		downloadRoot = filepath.Join(localData, "FUK-YT", "staging")
	}
	appDir := filepath.Join(localData, "FUK-YT")

	return &Config{
		InstallDir:   installDir,
		DownloadRoot: downloadRoot,
		YtDlpPath:    findBinary(installDir, "yt-dlp"+binExt),
		FFmpegPath:   findBinary(installDir, "ffmpeg"+binExt),
		FFprobePath:  findBinary(installDir, "ffprobe"+binExt),
		LogDir:       filepath.Join(appDir, "logs"),
		TempDir:      filepath.Join(appDir, "temp"),
	}, nil
}

func findBinary(installDir, binName string) string {
	// Candidate 1: installDir/bin/binName (e.g. bin/bin/yt-dlp.exe)
	p1 := filepath.Join(installDir, "bin", binName)
	if _, err := os.Stat(p1); err == nil {
		return p1
	}

	// Candidate 2: installDir/binName (e.g. bin/yt-dlp.exe)
	p2 := filepath.Join(installDir, binName)
	if _, err := os.Stat(p2); err == nil {
		return p2
	}

	// Candidate 3: System PATH
	if p3, err := exec.LookPath(binName); err == nil {
		return p3
	}

	return p1 // fallback
}

func run(cfg *Config) error {
	logging.Info("FUK-YT native host starting", map[string]interface{}{"version": Version})

	// ── Wire up all services (PRD §6) ──────────────────────────

	pm := process.New()
	fm := files.New(cfg.DownloadRoot)

	// Clean orphaned temp files from previous session (§20)
	fm.CleanOrphanedTemp()

	ytSvc := ytdlp.New(cfg.YtDlpPath, pm)
	ffSvc := ffmpeg.New(cfg.FFmpegPath, cfg.FFprobePath, pm)
	dlSvc := download.New(ytSvc, ffSvc, fm)

	h := host.New()

	// PushFn: sends unsolicited events to Chrome (jobProgress / jobComplete / jobError)
	pushFn := func(eventType, jobID string, payload interface{}) {
		if err := h.SendPush(eventType, jobID, payload); err != nil {
			logging.Error("host: push failed", map[string]interface{}{"err": err.Error()})
		}
	}

	jm := jobs.New(dlSvc, pm, pushFn)

	// Pre-fetch binary versions for getEngineInfo responses
	ctx5s, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	ytVer, _ := ytSvc.Version(ctx5s)
	ffVer, _ := ffSvc.Version(ctx5s)
	cancel()

	rtr := router.New(h, router.Config{
		Version:       Version,
		YtDlpVersion:  ytVer,
		FFmpegVersion: ffVer,
		DownloadRoot:  cfg.DownloadRoot,
		YtDlpPath:    cfg.YtDlpPath,
		FFmpegPath:   cfg.FFmpegPath,
		FFprobePath:  cfg.FFprobePath,
	}, ytSvc, ffSvc, jm)

	logging.Info("FUK-YT native host ready", map[string]interface{}{
		"ytdlp": ytVer, "ffmpeg": ffVer,
	})

	// ── Main read loop ──────────────────────────────────────────

	for {
		msg, err := h.Read()
		if err != nil {
			if err == io.EOF {
				logging.Info("host: Chrome disconnected (EOF)")
				pm.KillAll()
				return nil
			}
			logging.Warn("host: read error", map[string]interface{}{"err": err.Error()})
			// SEC-08: malformed message → send error, don't crash
			_ = h.SendError("", "MALFORMED_MESSAGE", err.Error())
			continue
		}

		logging.Debug("host: received", map[string]interface{}{"type": msg.Type, "requestId": msg.RequestID})

		// Dispatch in a goroutine for non-blocking (long ops like getFormats/download won't stall ping)
		go rtr.Dispatch(msg)
	}
}

func runHealthCheck(cfg *Config) int {
	fmt.Println("=== FUK-YT Engine Health Check ===")
	ctx := context.Background()
	exitCode := 0

	checks := []struct {
		name string
		path string
		arg  string
	}{
		{"yt-dlp", cfg.YtDlpPath, "--version"},
		{"ffmpeg", cfg.FFmpegPath, "-version"},
		{"ffprobe", cfg.FFprobePath, "-version"},
	}

	for _, c := range checks {
		if _, err := os.Stat(c.path); err != nil {
			fmt.Printf("  ✗ %s: not found at %s\n", c.name, c.path)
			exitCode = 1
			continue
		}
		ytSvc := ytdlp.New(c.path, nil)
		if c.name == "yt-dlp" {
			v, err := ytSvc.Version(ctx)
			if err != nil {
				fmt.Printf("  ✗ %s: %v\n", c.name, err)
				exitCode = 1
			} else {
				fmt.Printf("  ✓ %s: %s\n", c.name, v)
			}
		} else {
			ffSvc := ffmpeg.New(cfg.FFmpegPath, cfg.FFprobePath, nil)
			v, err := ffSvc.Version(ctx)
			if err != nil {
				fmt.Printf("  ✗ %s: %v\n", c.name, err)
				exitCode = 1
			} else {
				fmt.Printf("  ✓ %s: %s\n", c.name, v)
			}
			break // checked both in one call
		}
	}

	if exitCode == 0 {
		fmt.Println("Health check passed.")
	} else {
		fmt.Println("Health check FAILED.")
	}
	return exitCode
}
