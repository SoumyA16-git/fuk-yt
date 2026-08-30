

## 1. Product Summary
Windows Chrome Extension that adds a "Download" button overlay on YouTube. One click downloads the video/audio; a simple slider lets the user grab a clip. All processing happens locally via a small native app (yt-dlp + FFmpeg) — no server, no accounts, no configuration screens. Install is one click; the extension works immediately after.

## 2. Goals
- Bare-minimum feature set: detect video → pick quality → download. Optional: clip a range.
- Zero setup friction: one installer, no manual steps, no technical settings exposed.
- Usable by a non-technical person with no explanation needed.
- Fully local — nothing leaves the user's PC.

## 3. Explicitly Cut (Non-Goals)
Removed from scope — do not build these:
- No database / persistent history of past downloads.
- No download queue management (reorder, pause/resume, multi-job dashboard).
- No playlists, subtitles, chapters, thumbnail/metadata embedding.
- No presets, filename template editor, folder auto-organization rules.
- No advanced settings screen (FFmpeg/yt-dlp paths, hardware acceleration, etc.).
- No detailed format table (codec/HDR/bitrate). Show quality in plain labels only.

If any of these are wanted later, they get added as a separate follow-up spec — not part of this build.

## 4. Users
Regular YouTube viewers with no technical background. Assume they will not read instructions, will not edit settings files, and expect it to "just work" after install.

## 5. Architecture
```
YouTube Page
  → Content Script (small overlay button/panel)
  → Service Worker
  → Native Messaging
  → Native Host (host.exe, Go)
  → yt-dlp.exe + ffmpeg.exe
  → File saved to Downloads
```
Extension never runs yt-dlp/FFmpeg directly. Native host is the only process that touches disk/media engines.

## 6. Tech Stack
| Layer | Stack |
|---|---|
| Extension | Manifest V3, TypeScript, React, Vite, Tailwind CSS |
| Overlay | Shadow DOM (style isolation only) |
| Native host | Go, single static binary, in-memory job state (no database) |
| Media engines | yt-dlp.exe, ffmpeg.exe, ffprobe.exe — bundled with installer |
| IPC | Chrome Native Messaging (length-prefixed JSON) |
| Installer | Single Windows installer — installs everything, registers native host, done |

## 7. Repository Structure
```
project/
├── extension/
│   ├── src/
│   │   ├── content/       # overlay button + panel
│   │   ├── background/    # service worker, native messaging bridge
│   │   ├── components/    # React UI (one panel, no multi-tab settings)
│   │   ├── services/      # nativeClient
│   │   └── types/
│   └── manifest.json
├── native-host/
│   ├── cmd/host/
│   ├── internal/
│   │   ├── ipc/           # native messaging framing
│   │   ├── jobs/          # in-memory job tracking (no persistence)
│   │   ├── ytdlp/
│   │   ├── ffmpeg/
│   │   └── validate/      # path/input safety checks
│   └── bin/                # bundled yt-dlp.exe, ffmpeg.exe, ffprobe.exe
├── installer/
├── docs/
└── README.md
```

## 8. Feature Requirements (this is the entire feature set — nothing implicit beyond this)

### 8.1 Overlay
- Small floating button appears on YouTube watch/Shorts pages.
- Click opens one compact panel: thumbnail, title, quality dropdown, two buttons (Download Video / Download Audio), a progress bar area, and a "Clip" toggle.
- Survives YouTube's in-page navigation (SPA) without page reload.
- No YouTube UI elements are modified or removed.

### 8.2 Quality Selection (simplified)
- Native host asks yt-dlp for available formats, but the UI collapses this into plain options: **Best**, **1080p**, **720p**, **480p**, **Audio (MP3)** — whichever are actually available for that video (no fake options shown if a resolution doesn't exist).
- No codec/fps/bitrate detail shown. If it's not available, it's just not in the list.

### 8.3 Video Download
- One click: fetch + merge (via FFmpeg, stream copy when possible) → MP4 file in the user's Downloads folder (or a folder picked once and remembered — see §8.6).
- No format ID picking, no container choice — always MP4 unless merge technically requires MKV, handled automatically without asking the user.

### 8.4 Audio Download
- One click: MP3, fixed to a single sensible default quality (e.g., best available up to 192kbps). No quality menu.

### 8.5 Simple Clip
- Toggle "Clip" in the panel → a basic timeline bar appears with a start handle and end handle (drag) plus small +/- time nudges.
- One "Download Clip" button — downloads that range as MP4 (or MP3 if audio-only was selected).
- Native host decides copy-cut vs. re-encode automatically; user is never asked.

### 8.6 Download Location
- One setting only: "Download folder" (defaults to the system Downloads folder). No filename templates, no auto-organization subfolders.

### 8.7 Progress
- Single progress bar per active download: percent + simple status text (Downloading… / Processing… / Done / Failed).
- One download at a time (no concurrent queue). If the user starts a second download while one is running, it's simply queued silently and starts when the first finishes — no visible queue UI needed for MVP.

### 8.8 Cancel
- One "Cancel" action on the active download. That's the only queue-management control that exists.

### 8.9 Engine Health (silent unless broken)
- On install, the installer verifies yt-dlp/FFmpeg are present and working.
- In normal use, the extension shows nothing about "engine status" unless something is actually broken — then a single plain message: "Downloader isn't working right now — try reinstalling." No technical status panel.

## 9. UI/UX
- One panel. No tabs, no settings page beyond the single download-folder picker (can live as a small link/gear inside the same panel, not a separate options page).
- Big, obvious buttons: **Download Video**, **Download Audio**, **Clip**.
- Dark, minimal, must be understandable with zero explanation — labels only, no jargon ("Best Quality" not "1080p60 VP9").

## 10. Data Model
Only one in-memory structure exists — no persistence, nothing written to disk except the actual media file:
```
Job
  id: string
  url: string
  type: "video" | "audio" | "clip-video" | "clip-audio"
  quality: "best" | "1080p" | "720p" | "480p" | "audio"
  start?: string   // clip only, HH:MM:SS
  end?: string     // clip only, HH:MM:SS
  status: "downloading" | "processing" | "done" | "failed" | "cancelled"
  progress: number
  filepath?: string
  error?: string
```
Job is discarded from memory once the panel is closed or the job completes — nothing is kept between browser sessions.

## 11. Native Messaging Protocol
Message types (this is the complete list — nothing else): `ping, getEngineInfo, getFormats, download, cancel`.

Request:
```json
{ "type": "download", "requestId": "abc", "url": "...", "quality": "1080p", "kind": "video", "start": null, "end": null }
```
Response:
```json
{ "type": "jobStarted", "requestId": "abc", "jobId": "123" }
```
Progress (unsolicited):
```json
{ "type": "progress", "jobId": "123", "percent": 72, "status": "downloading" }
```
Error:
```json
{ "type": "error", "requestId": "abc", "code": "DOWNLOAD_FAILED", "message": "..." }
```

## 12. User Flows

**Video/Audio Download**
1. Open YouTube video → click the overlay button.
2. Pick quality (or leave default "Best") → click Download Video (or Download Audio).
3. Progress bar shows; file lands in the configured Downloads folder; "Done" shown with nothing further required.

**Clip**
1. Open panel → toggle Clip → drag start/end handles.
2. Click Download Clip → same progress/done behavior as above.

## 13. Security
- All input from the page (URL, quality label, timestamps) is treated as untrusted and validated by the native host.
- yt-dlp/FFmpeg run via argument arrays only — never shell strings.
- Output path always resolves inside the configured download folder — no path traversal.
- Only `ping, getEngineInfo, getFormats, download, cancel` are accepted; anything else is rejected.

## 14. Privacy
- No server, no telemetry, no accounts. Nothing is sent anywhere except the request to YouTube itself (which yt-dlp needs to fetch the video).

## 15. Error Handling
Kept to plain, non-technical messages:
| Situation | Message shown |
|---|---|
| Engine broken/missing | "Downloader isn't working right now — try reinstalling." |
| Invalid/unsupported URL | "This page doesn't have a downloadable video." |
| Network issue | "Download failed — check your internet and try again." |
| Disk full / permission issue | "Couldn't save the file — check your download folder." |
| Cancelled | "Cancelled." |

No raw errors, stack traces, or logs shown in the UI.

## 16. Installer
- Single installer file. User double-clicks, clicks through at most one "Install" confirmation, done.
- Installs native host + yt-dlp + FFmpeg, registers the native messaging host automatically.
- No registry editing, no config files, no command line, no separate Python install.
- Uninstall available from Windows "Add/Remove Programs" — removes everything.

## 17. Testing
- Overlay appears and survives YouTube SPA navigation.
- Download Video / Download Audio each produce a valid playable file.
- Clip produces a file trimmed to the selected range.
- Cancel stops the active download and leaves no partial file mistaken for "Done."
- Fresh Windows machine: installer → extension works with zero manual configuration.

## 18. MVP (this PRD *is* the MVP — there is no phased scope)
1. Overlay button + panel
2. Quality-simplified format detection
3. Video download (MP4)
4. Audio download (MP3)
5. Simple clip (video or audio)
6. Progress bar + cancel
7. Download folder picker (one setting)
8. One-click installer

Nothing beyond this list is in scope unless requested separately.

## 19. Acceptance Criteria
- AC-01: Overlay button appears on any YouTube watch/Shorts page within normal load time.
- AC-02: Clicking Download Video with default quality produces a playable MP4 in the download folder.
- AC-03: Clicking Download Audio produces a playable MP3.
- AC-04: Clip mode with a selected range produces a file trimmed to that range.
- AC-05: Progress bar reflects real download progress, not a fake/simulated bar.
- AC-06: Cancel stops the job and no file is left marked "Done."
- AC-07: A non-technical tester can install and complete one download without any outside instructions.
- AC-08: No settings/config screen is required to complete a first successful download.

## 20. Development Tasks
```
EPIC-01 Extension Shell
TASK-01 MV3 + Vite + React + TS scaffold
TASK-02 Overlay button + Shadow DOM panel on YouTube pages
TASK-03 SPA navigation detection (debounced)

EPIC-02 Native Host Core
TASK-04 Native messaging IPC (ping/pong)
TASK-05 Message allowlist + input validation
TASK-06 Engine presence check (yt-dlp/ffmpeg/ffprobe)

EPIC-03 Download
TASK-07 getFormats → simplified quality list mapping
TASK-08 Video download + FFmpeg merge (stream copy first)
TASK-09 Audio download (MP3, fixed quality)
TASK-10 Progress event streaming
TASK-11 Cancel handling (process kill + temp cleanup)

EPIC-04 Clip
TASK-12 Timeline drag UI (start/end handles)
TASK-13 FFmpeg clip execution (copy-first, auto re-encode fallback)

EPIC-05 Settings & Install
TASK-14 Single download-folder picker
TASK-15 One-click Windows installer (host + binaries + native messaging registration)
TASK-16 Plain-language error messages wired to all failure paths
```

## 21. Technical Risks
- Collapsing yt-dlp's real format list into "Best/1080p/720p/480p" needs a clear, consistent mapping rule so it doesn't silently pick the wrong stream.
- Unsigned native host binary may trigger Windows SmartScreen on a "one-click" install — could break the simple-install promise. Needs a code-signing decision even in this trimmed scope.
- MV3 service workers are non-persistent; the native host must own job state (already the case here since there's no extension-side persistence at all).

## 22. Open Questions
- Where does the "Best" quality mapping cap out (e.g., is 4K/HDR included in "Best," or capped at 1080p to keep files small/predictable for non-technical users)?
- Should the single download-folder setting be asked once on first use, or default silently to the system Downloads folder with no prompt at all?
- Code-signing / SmartScreen handling for the installer — required for a truly frictionless one-click install, but not yet decided.