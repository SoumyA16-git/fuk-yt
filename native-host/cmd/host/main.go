// FUK-YT Native Host — main entrypoint.
// Wires all internal packages per PRD §6 architecture.
package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/fukyt/host/internal/download"
	"github.com/fukyt/host/internal/ffmpeg"
	"github.com/fukyt/host/internal/files"
	"github.com/fukyt/host/internal/host"
	"github.com/fukyt/host/internal/jobs"
	"github.com/fukyt/host/internal/logging"
	"github.com/fukyt/host/internal/process"
	"github.com/fukyt/host/internal/router"
	"github.com/fukyt/host/internal/server"
	"github.com/fukyt/host/internal/ytdlp"
)

var Version = "v0.2.16"

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

	var downloadRoot string
	if runtime.GOOS == "windows" {
		if dDir, err := getWindowsDownloadsDir(); err == nil && dDir != "" {
			downloadRoot = dDir
		}
	}
	if downloadRoot == "" {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			downloadRoot = filepath.Join(home, "Downloads")
		} else if userProfile != "" {
			downloadRoot = filepath.Join(userProfile, "Downloads")
		} else {
			downloadRoot = filepath.Join(localData, "FUK-YT", "Downloads")
		}
	}
	_ = os.MkdirAll(downloadRoot, 0755)
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

func getWindowsDownloadsDir() (string, error) {
	// Query known Downloads folder GUIDs / names in User Shell Folders
	keys := []string{
		"{374DE290-123F-4565-9164-39C4925E467B}", // Legacy Downloads GUID
		"{7D83EE9B-2244-4E70-B1F5-54F5E68C6AE2}", // Modern Win 10/11 Downloads GUID
		"{7512513A-2193-4A2C-AE4F-D8E3E14747ED}", // Alternate Downloads GUID
		"Downloads",
	}

	for _, k := range keys {
		cmd := exec.Command("reg", "query", `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`, "/v", k)
		var out bytes.Buffer
		cmd.Stdout = &out
		cmd.SysProcAttr = &syscall.SysProcAttr{
			HideWindow:    true,
			CreationFlags: 0x08000000, // CREATE_NO_WINDOW
		}
		if err := cmd.Run(); err == nil {
			lines := strings.Split(out.String(), "\n")
			for _, line := range lines {
				if strings.Contains(line, "REG_EXPAND_SZ") || strings.Contains(line, "REG_SZ") {
					parts := strings.SplitN(strings.TrimSpace(line), "REG_EXPAND_SZ", 2)
					if len(parts) < 2 {
						parts = strings.SplitN(strings.TrimSpace(line), "REG_SZ", 2)
					}
					if len(parts) >= 2 {
						path := strings.TrimSpace(parts[1])
						if strings.Contains(path, "%USERPROFILE%") {
							path = strings.ReplaceAll(path, "%USERPROFILE%", os.Getenv("USERPROFILE"))
						}
						if strings.Contains(path, "%") {
							path = os.ExpandEnv(path)
						}
						if path != "" {
							return path, nil
						}
					}
				}
			}
		}
	}

	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, "Downloads"), nil
	}

	return "", fmt.Errorf("reg query: could not parse path")
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

	// Start local HTTP server on loopback to serve staging files to Chrome
	if _, err := server.Start(cfg.DownloadRoot); err != nil {
		logging.Warn("main: failed to start local HTTP server: " + err.Error())
	}

	// Clean orphaned temp files from previous session (§20)
	fm.CleanOrphanedTemp()

	// Clean leftover update binaries/scripts
	if exePath, err := os.Executable(); err == nil {
		_ = os.Remove(exePath + ".old")
		_ = os.Remove(filepath.Join(filepath.Dir(exePath), "updater.bat"))
	}

	// Migrate any previous files from staging directory to user's real Downloads folder
	localData := os.Getenv("LOCALAPPDATA")
	if localData == "" {
		localData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
	}
	stagingDir := filepath.Join(localData, "FUK-YT", "staging")
	if _, err := os.Stat(stagingDir); err == nil {
		_ = filepath.Walk(stagingDir, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				dest := filepath.Join(cfg.DownloadRoot, info.Name())
				_ = os.Rename(path, dest)
			}
			return nil
		})
		_ = os.RemoveAll(stagingDir)
	}

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
