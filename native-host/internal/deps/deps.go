package deps

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/fukyt/host/internal/logging"
)

// Ensure checks for required external binaries and downloads them if missing.
// This allows OTA updates to automatically provision new dependencies.
func Ensure(installDir string) {
	if runtime.GOOS != "windows" {
		return
	}

	binDir := filepath.Join(installDir, "bin")
	_ = os.MkdirAll(binDir, 0755)

	missing := []string{}
	
	if !exists(findBinary(installDir, "yt-dlp.exe")) {
		missing = append(missing, "ytdlp")
	}
	if !exists(findBinary(installDir, "ffmpeg.exe")) {
		missing = append(missing, "ffmpeg")
	}
	if !exists(findBinary(installDir, "deno.exe")) {
		missing = append(missing, "deno")
	}

	if len(missing) == 0 {
		return
	}

	logging.Info("deps: missing dependencies detected, starting auto-download", map[string]interface{}{
		"missing": missing,
	})

	for _, dep := range missing {
		switch dep {
		case "ytdlp":
			downloadYtdlp(binDir)
		case "ffmpeg":
			downloadFFmpeg(binDir)
		case "deno":
			downloadDeno(binDir)
		}
	}
}

func exists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func findBinary(installDir, binName string) string {
	p1 := filepath.Join(installDir, "bin", binName)
	if exists(p1) {
		return p1
	}
	p2 := filepath.Join(installDir, binName)
	if exists(p2) {
		return p2
	}
	if p3, err := exec.LookPath(binName); err == nil {
		return p3
	}
	return ""
}

func runPowershell(script string) {
	cmd := exec.Command("powershell", "-NoProfile", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		logging.Warn("deps: auto-download script failed", map[string]interface{}{
			"err": err.Error(),
			"out": string(out),
		})
	}
}

func downloadYtdlp(binDir string) {
	logging.Info("deps: downloading yt-dlp", nil)
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile '%s\yt-dlp.exe'`, binDir)
	runPowershell(script)
}

func downloadFFmpeg(binDir string) {
	logging.Info("deps: downloading ffmpeg", nil)
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile '%s\ffmpeg.zip' ; Expand-Archive -Path '%s\ffmpeg.zip' -DestinationPath '%s\extracted' -Force ; Move-Item -Path '%s\extracted\ffmpeg-*\bin\*.exe' -Destination '%s\' -Force ; Remove-Item '%s\ffmpeg.zip' ; Remove-Item '%s\extracted' -Recurse -Force`, binDir, binDir, binDir, binDir, binDir, binDir, binDir)
	runPowershell(script)
}

func downloadDeno(binDir string) {
	logging.Info("deps: downloading deno", nil)
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip' -OutFile '%s\deno.zip' ; Expand-Archive -Path '%s\deno.zip' -DestinationPath '%s\deno_extracted' -Force ; Move-Item -Path '%s\deno_extracted\deno.exe' -Destination '%s\' -Force ; Remove-Item '%s\deno.zip' ; Remove-Item '%s\deno_extracted' -Recurse -Force`, binDir, binDir, binDir, binDir, binDir, binDir, binDir)
	runPowershell(script)
}