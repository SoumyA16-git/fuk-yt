# FUK-YT

**Local YouTube downloader and clipper — Windows Chrome Extension + Go Native Host**

No remote backend. No data leaves your machine. All processing happens locally via bundled yt-dlp and FFmpeg binaries.

---

## Features (MVP)

- ✅ YouTube overlay injected on watch pages and Shorts (Shadow DOM isolated)
- ✅ SPA navigation detection (no page reload needed)
- ✅ Engine health check (yt-dlp, FFmpeg, FFprobe status)
- ✅ Format detection from live yt-dlp output (no hardcoded quality lists)
- ✅ Video download (best quality or selected format)
- ✅ Audio download (MP3, M4A, OPUS, WAV with quality tiers)
- ✅ Timeline clip (drag or manual HH:MM:SS input, video or audio clip)
- ✅ Download queue with real-time progress, cancel, retry, remove
- ✅ Download history
- ✅ Configurable settings (download folder, quality, concurrency, etc.)
- ✅ Windows NSIS installer

---

## Architecture

```
YouTube Page
  → Content Script (Shadow DOM overlay, React)
  → Service Worker (MV3 background, native messaging bridge)
  → chrome.runtime.connectNative("com.fukyt.host")
  → Native Host (host.exe, Go)
  → yt-dlp.exe + ffmpeg.exe/ffprobe.exe
  → %USERPROFILE%\Downloads\FUK-YT\
```

**Key rules:**
- Content script never calls native messaging directly
- Native host is the only process that spawns yt-dlp/FFmpeg
- All exec calls use argument arrays — no shell string construction
- Path traversal is validated by native host before any file I/O

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 18+ | Extension build |
| npm | 9+ | Extension dependencies |
| Go | 1.22+ | Native host build |
| NSIS | 3.x | Installer build (optional for dev) |

> **⚠️ SmartScreen Warning**: The native host binary is unsigned in MVP. Windows SmartScreen will warn on first launch. Click "More info → Run anyway". This will be addressed in a future release with code signing.

---

## Setup & Build

### 1. Extension

```powershell
cd extension
npm install
npm run build   # builds to extension/dist/
```

To load in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/dist/`
4. Note your extension ID (you'll need it for the installer)

### 2. Native Host

```powershell
# Install Go from https://go.dev/dl/ first

cd native-host

# Download yt-dlp.exe, ffmpeg.exe, ffprobe.exe into native-host/bin/
# yt-dlp: https://github.com/yt-dlp/yt-dlp/releases/latest
# FFmpeg: https://www.gyan.dev/ffmpeg/builds/ (essentials build)

# Build
go mod tidy
go build -o bin/host.exe ./cmd/host/

# Verify
./bin/host.exe --health-check
```

### 3. Register Native Messaging Manifest (Manual Dev Setup)

Before using the installer, you can register manually:

```powershell
# Replace EXTENSION_ID with your actual Chrome extension ID
$manifest = @"
{
  "name": "com.fukyt.host",
  "description": "FUK-YT Local Download Engine",
  "path": "C:\\path\\to\\native-host\\bin\\host.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID/"]
}
"@

$manifestPath = "$env:APPDATA\FUK-YT\com.fukyt.host.json"
New-Item -ItemType Directory -Force -Path (Split-Path $manifestPath)
$manifest | Out-File -Encoding UTF8 -FilePath $manifestPath

# Register in HKCU (no admin needed)
New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fukyt.host" -Force
Set-ItemProperty -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fukyt.host" -Name "(default)" -Value $manifestPath
```

### 4. Installer (NSIS)

```powershell
# Ensure host.exe and bin/*.exe are built
cd installer

# Edit fuk-yt.nsi: replace EXTENSION_ID_PLACEHOLDER with real extension ID
# Then compile:
makensis fuk-yt.nsi
```

---

## Project Structure

```
Fuk-YT/
├── extension/           # Chrome Extension (Vite + React + TS + Tailwind v4)
│   ├── src/
│   │   ├── background/  # Service worker (native messaging bridge)
│   │   ├── content/     # Content script + Shadow DOM mount
│   │   ├── popup/       # Browser action popup
│   │   ├── options/     # Settings page
│   │   ├── components/  # React UI (overlay, tabs)
│   │   ├── services/    # NativeClient, StorageClient
│   │   └── types/       # Shared TS types & message contracts
│   └── manifest.json    # MV3 manifest
├── native-host/         # Go native host
│   ├── cmd/host/        # Entry point (main.go)
│   ├── internal/
│   │   ├── ipc/         # Native Messaging framing (length-prefixed JSON)
│   │   ├── jobs/        # Job manager, state machine, concurrency
│   │   ├── ytdlp/       # yt-dlp wrapper (argument-array exec)
│   │   ├── ffmpeg/      # FFmpeg wrapper (merge, clip, audio)
│   │   ├── validate/    # Input validation, path sanitization
│   │   ├── store/       # SQLite persistence
│   │   └── logging/     # Structured JSON logger
│   └── bin/             # yt-dlp.exe, ffmpeg.exe, ffprobe.exe (not committed)
├── installer/           # NSIS installer + NM manifest template
├── docs/
└── README.md
```

---

## Settings

| Group | Key Settings |
|---|---|
| General | Download folder, default quality, audio format, filename template |
| Downloads | Max concurrent (1–5), auto-retry count, overwrite behavior, organize-into-folders |
| Processing | FFmpeg/yt-dlp paths (read-only display), hardware acceleration |
| UI | Compact mode |
| Advanced | Debug logging, engine status, check for yt-dlp updates, reset settings |

---

## Security Model

- All URLs, format IDs, timestamps, filenames from the webpage are treated as **untrusted**
- Native host validates all inputs against a strict allowlist before acting
- yt-dlp and FFmpeg are invoked via **argument arrays only** — no shell string construction
- Output paths are validated to stay within the configured download root
- Filenames are sanitized for Windows (no reserved names, no invalid characters)
- Malformed IPC messages return a structured error; the host stays alive

---

## Retry Policy

Failed downloads are retried **3 times** with exponential backoff:
- Attempt 1 → wait 1s → retry
- Attempt 2 → wait 2s → retry
- Attempt 3 → wait 4s → retry
- After 3 failures: status = `failed`

---

## Clip Accuracy

For timeline clips:
- **Stream copy** (`ffmpeg -c copy`) is tried first (fast, preserves quality)
- If the keyframe misalignment at either the start or end exceeds **2 seconds**, the native host automatically falls back to **re-encode** for accuracy
- This decision is made entirely by the native host; the user is not asked

---

## Privacy

- No remote backend; no telemetry
- All data stays on-device: YouTube page → yt-dlp → FFmpeg → local file
- History is stored locally in `%APPDATA%\FUK-YT\data.db` (SQLite)

---

## Phase 2 Roadmap

- Playlist support
- Multiple clip ranges (download separately or merge)
- Presets
- Subtitles (SRT/VTT embed or separate file)
- Chapters display + per-chapter download
- Thumbnail/metadata embedding
- Full queue reordering / pause-resume
- Configurable keyboard shortcuts

---

## License

See [LICENSE](LICENSE).
