# PRD — Local Media Downloader

## 1. Product Overview
Local Media Downloader (LMD) lets a non-technical Windows user download and clip YouTube video/audio directly from the browser, using a local native engine (yt-dlp + FFmpeg) reachable only via Chrome Native Messaging. No backend, accounts, or manual configuration. Two deliverables:
- **Extension**: Chrome MV3, TypeScript/React/Vite/Tailwind. UI + YouTube integration.
- **Native Engine**: Go, single Windows executable. Download/processing via yt-dlp + FFmpeg.

## 2. Goals
| ID | Goal |
|---|---|
| G-01 | One-click engine install, zero CLI/config interaction (§19). |
| G-02 | YouTube-native-feeling UI for video/audio/clip downloads (§11). |
| G-03 | Support full video, full audio, and time-ranged clip downloads (§12–14). |
| G-04 | 100% local processing; no backend, accounts, telemetry (§24–25). |
| G-05 | Resilient to YouTube DOM changes and engine failures (§27). |

## 3. Non-Goals (MVP)
NG-01 Playlists · NG-02 Subtitles/chapters · NG-03 Multi-clip/batch edit · NG-04 Cloud sync/accounts · NG-05 Non-YouTube sites · NG-06 Media library · NG-07 Telemetry/analytics. See §30–31 for phased scope.

## 4. Target Users
Non-technical Windows 10/11 Chrome users who want local YouTube video/audio/clip downloads without touching a terminal.

## 5. Product Principles
P-01 Local-first — all processing on-device. P-02 Zero-CLI — never require terminal/manual config. P-03 Native feel — visually consistent with YouTube dark theme. P-04 Fail-soft — extension stays usable when engine/network/YouTube fails. P-05 Minimal surface — MVP excludes non-essential features.

## 6. Architecture
```
YouTube Page → Content Script (YouTubeAdapter, UI mount)
                     ↓ chrome.runtime messaging
             Service Worker (DownloadManager, port to native host)
                     ↓ Native Messaging (stdio, JSON, length-prefixed)
             Native Host (Go exe) → yt-dlp / FFmpeg (child processes)
                     ↓
             Local Disk (Downloads/Local Media Downloader/…)
```
No remote backend at any layer. All cross-layer contracts defined in §18.

**Extension components** (responsibility, one line each — referenced by name elsewhere, not re-described):
| Component | Responsibility |
|---|---|
| YouTubeAdapter | Player/video/navigation detection, DOM abstraction (§10) |
| DownloaderControls | Root UI bar injected under player controls (§11) |
| VideoPanel / AudioPanel / ClipPanel | Mode-specific controls (§12–14) |
| ClipTimeline | Start/end handle UI over YouTube timeline (§15) |
| QualitySelector / FormatSelector | Dropdowns populated from native `getFormats` |
| DownloadButton | Triggers `startDownload`/`startClip`; reflects job state |
| ProgressIndicator | Renders job state machine (§16) |
| EngineStatus | Renders engine state (§19) |
| DownloadManager | Service-worker singleton; owns native port, job registry, message routing |
| SettingsPanel | Reads/writes `chrome.storage.local` settings (§21) |

**Native engine components** (Go, single process, internal modules):
| Component | Responsibility |
|---|---|
| NativeHost | stdio framing, process lifecycle, entrypoint |
| MessageRouter | Validates/dispatches operations (§18) to services |
| JobManager | Job registry, state transitions, progress broadcast |
| YtDlpService | Invokes yt-dlp for info/formats/download (fixed argv, §17) |
| FFmpegService | Invokes FFmpeg/ffprobe for merge/clip/convert |
| FormatService | Parses yt-dlp `-J` output into `FormatInfo[]` |
| DownloadService | Orchestrates yt-dlp→FFmpeg pipeline per job type |
| ProcessManager | Spawns/tracks/kills child processes, group cleanup |
| FileManager | Path resolution, sanitization, directory creation |
| Logger | Rotating local log file, never exposed raw to UI |

## 7. Technology Stack
| Layer | Choice | Reason |
|---|---|---|
| Extension platform | Chrome MV3 | Chrome requirement |
| UI | React 18 + TypeScript | Maintainability |
| Build | Vite (+ `@crxjs/vite-plugin`) | Fast MV3 dev/build |
| Styling | Tailwind CSS | Consistent, themeable UI |
| Extension state | `chrome.storage.local` + React context | No DB needed |
| Native engine | Go 1.22+ | Single static Windows exe, no runtime dep |
| Downloader | yt-dlp (bundled binary) | Format/stream extraction |
| Processing | FFmpeg + ffprobe (bundled) | Merge/clip/convert |
| IPC | Chrome Native Messaging | Local-only, sandboxed by Chrome |
| Installer | Inno Setup–packaged signed .exe | Unattended install, registry + files |

## 8. Project Structure
```
local-media-downloader/
├── extension/        # MV3 extension source
├── native-engine/     # Go native host source
├── installer/          # Inno Setup script + packaging assets
├── scripts/            # Build/release scripts
├── tests/               # Extension + engine test suites
├── docs/
├── README.md
└── PRD.md
```

## 9. User Experience
**Flow A — First run (engine missing).** Extension opens on a `youtube.com/watch` page → EngineStatus = `NotInstalled` → user clicks **Install Engine** → §19 flow → EngineStatus = `Ready`.

**Flow B — Full video download.** User clicks **Video** → VideoPanel calls `getFormats` → user picks Quality/Format → clicks **Download** → `startDownload` → ProgressIndicator tracks job → on `Completed`, shows Open File/Open Folder.

**Flow C — Full audio download.** Same as B via AudioPanel, `outputType=audio`.

**Flow D — Clip download.** User clicks **Clip** → ClipTimeline activates (§15) → sets start/end (drag or manual input) → clicks **Download Video Clip** or **Download Audio Clip** → `startClip` → same progress/completion pattern as B.

**Flow E — Engine failure.** Any native port disconnect or job `Failed` → compact error card (§23) with Retry; EngineStatus reflects `Error` if the disconnect is at the connection level.

## 10. YouTube Integration
**YouTubeAdapter** responsibilities (isolated module — all YouTube-DOM-coupled code lives here only):
| ID | Responsibility |
|---|---|
| FR-01 | Detect `youtube.com/watch?v=` and `youtube.com/shorts/` URLs |
| FR-02 | Extract current `videoId` |
| FR-03 | Extract title, thumbnail URL, duration (seconds), channel name (when present) |
| FR-04 | Detect SPA navigation without full reload |
| FR-05 | Locate player control bar DOM anchor for control injection |
| FR-06 | Expose current playback time and duration to ClipTimeline |
| FR-07 | Re-run detection/injection after navigation without page reload |

**Detection strategy**: primary trigger is YouTube's own `yt-navigate-finish` document event (fired on SPA nav); fallback is a `MutationObserver` scoped to `#content` (not `document.body`), debounced 150ms. No `setInterval` polling of the DOM for navigation. Video metadata (title/duration/channel) read from `ytInitialPlayerResponse`/DOM at nav time, not polled continuously.

**Injection anchor**: primary target is the row immediately below `.html5-video-player`'s control bar (inside `#below` on watch pages / equivalent Shorts container). Fallback: a fixed bar pinned to the bottom-right corner of the player container if the primary anchor is not found. If neither anchor resolves, controls are hidden entirely (NFR-14) — never overlay YouTube's native controls.

## 11. UI Design System
**Visual tokens** (derived from YouTube dark theme, not copied assets):
| Token | Value guidance |
|---|---|
| Surface bg | Neutral dark gray (`#0f0f0f`–`#212121` range), matches YT chrome |
| Border | 1px, low-contrast gray, subtle |
| Radius | 8px (matches YT pill/menu radius) |
| Font | System/Roboto-equivalent stack, 13–14px body |
| Icon size | 20–24px, single-color line icons |
| Spacing | 8px base grid |
| Shadow | None/minimal — no glow, no glassmorphism, no gradients |

**Button states** (required for every interactive control): default, hover, active, disabled, loading, keyboard-focus, plus `aria-label` for accessibility. Buttons use icon + short label (e.g. `🎬 Video`, `🎵 Audio`, `✂ Clip`), YouTube-proportioned (compact height ~32–36px), never full-width app-style buttons.

**Layout** (UI-01): `DownloaderControls` bar renders directly below the YouTube player control row; a secondary row below it renders the active mode's panel (Video/Audio/Clip). Bar must remain usable at theater mode, fullscreen-exit, and minimized player widths (UI-02: min supported width 320px, controls wrap/collapse to icon-only below that).

Component names/props are defined once in §6 and reused by ID (`VideoPanel`, `AudioPanel`, `ClipPanel`, etc.) — not re-specified per section.

## 12. Video Mode
| ID | Requirement |
|---|---|
| FR-10 | Clicking **Video** opens `VideoPanel` and triggers `getFormats` for current `videoId` |
| FR-11 | `QualitySelector` options populated only from formats actually returned (never hardcoded); label set restricted to: Best, 2160p60, 2160p, 1440p60, 1440p, 1080p60, 1080p, 720p60, 720p, 480p, 360p — display only labels present in response |
| FR-12 | `FormatSelector` offers container options available for the chosen quality (e.g. MP4; MKV where MP4 remux isn't lossless-compatible) |
| FR-13 | Estimated file size shown when yt-dlp reports `filesize`/`filesize_approx`; otherwise omitted (no fabricated estimate) |
| FR-14 | **Download** button disabled until a quality is selected; triggers `startDownload` with `{videoId, quality, format}` |
| FR-15 | Video+audio streams merged server-side (native engine) when YouTube serves them separately; muxing via FFmpeg, no re-encode unless container requires it |

## 13. Audio Mode
| ID | Requirement |
|---|---|
| FR-20 | Clicking **Audio** opens `AudioPanel`, reuses cached `getFormats` result from current session if available, else re-fetches |
| FR-21 | Supported output formats: MP3, M4A, OPUS |
| FR-22 | Quality options presented as bitrate (e.g. 320/256/192/128 kbps) or "Best available", limited to what source audio streams support |
| FR-23 | Stream-copy (no re-encode) when source codec matches requested output container/codec (e.g. source OPUS → output OPUS); re-encode only when conversion is required (e.g. → MP3) |
| FR-24 | **Download** triggers `startDownload` with `{videoId, outputType:"audio", format, quality}` |

## 14. Clip Mode
| ID | Requirement |
|---|---|
| FR-30 | Clicking **Clip** opens `ClipPanel` and activates `ClipTimeline` selection mode (§15) without altering normal playback |
| FR-31 | Displays Start, End, Duration (computed `end-start`) fields, live-updated from timeline state |
| FR-32 | Manual timestamp input accepted in `HH:MM:SS`, `MM:SS`, or plain seconds; parsed and clamped per §15 |
| FR-33 | **Reset Selection** restores Start=0, End=video duration |
| FR-34 | **Download Video Clip** triggers `startClip` with `{videoId, startTime, endTime, outputType:"video", quality, format}` |
| FR-35 | **Download Audio Clip** triggers `startClip` with `{videoId, startTime, endTime, outputType:"audio", format, quality}` |
| FR-36 | Clip extraction prefers FFmpeg stream-copy (`-c copy` with accurate seek) when cut points align with keyframe-safe boundaries; falls back to re-encode when stream-copy would produce inaccurate in/out points |
| FR-37 | Leaving Clip mode (switching to Video/Audio) discards the in-progress selection state (not persisted) |
| FR-38 | Clip selection has no effect on the actual YouTube player's playback range — user can still play/seek/pause normally while a clip is selected |

## 15. Timeline Specification
**States**: `Idle → Selecting → Selected → Downloading`. `Downloading` returns to `Selected` on completion/failure/cancel; `Selected → Selecting` on any handle drag.

| ID | Rule |
|---|---|
| CLIP-01 | Start handle position clamped to `[0, endTime − minClipLength]` |
| CLIP-02 | End handle position clamped to `[startTime + minClipLength, videoDuration]` |
| CLIP-03 | `minClipLength` = 1 second |
| CLIP-04 | Handles update live during drag (no debounce on visual position; native calls only fire on drag-end or manual input commit) |
| CLIP-05 | Selected range rendered as a highlighted band on the timeline between the two handles |
| CLIP-06 | Current playback position indicator remains visible and independent of the selection band |
| CLIP-07 | Manual input is validated on blur/enter: non-numeric or out-of-range input is rejected and the field reverts to last valid value |
| CLIP-08 | Duration display = `endTime − startTime`, recalculated on every handle/input change |
| CLIP-09 | Timeline UI does not intercept clicks on the native YouTube seek bar outside of active handle-drag gestures |

## 16. Download System
**Job lifecycle (state machine)**: `Idle → Preparing → FetchingFormats → Downloading → Processing → Completed`, with `Failed` and `Cancelled` reachable from any non-terminal state.

| State | Meaning |
|---|---|
| Idle | No active job |
| Preparing | Request validated, job created |
| FetchingFormats | yt-dlp resolving stream URLs/formats |
| Downloading | Streams being fetched to temp location |
| Processing | FFmpeg merge/clip/convert in progress |
| Completed | Final file written to target path |
| Failed | Terminal error (see §23 taxonomy) |
| Cancelled | User-initiated stop; temp files removed |

**DownloadManager** (service worker) owns job registry keyed by `jobId`, renders `ProgressIndicator` from pushed `jobProgress` messages, and is the sole owner of the native messaging `Port`.

**Core schemas** (JSON, camelCase; used verbatim in §18 messages):
```
DownloadRequest { videoId, outputType: "video"|"audio", quality, format }
ClipRequest      { videoId, startTime:number(sec), endTime:number(sec), outputType, quality, format }
DownloadJob      { jobId, request: DownloadRequest|ClipRequest, state, createdAt }
ProgressEvent    { jobId, state, percent, downloadedBytes, totalBytes, speedBps, etaSec }
```
NFR-02 governs progress push throttling.

## 17. Native Engine
Component table defined once in §6 (`NativeHost`, `MessageRouter`, `JobManager`, `YtDlpService`, `FFmpegService`, `FormatService`, `DownloadService`, `ProcessManager`, `FileManager`, `Logger`) — referenced by name here.

| ID | Requirement |
|---|---|
| FR-40 | `YtDlpService` invokes bundled `yt-dlp.exe` with fixed argv arrays only (no shell string building) — see SEC-05 |
| FR-41 | `FormatService` parses `yt-dlp -J <url>` output into `FormatInfo[]`: `{formatId, resolution, fps, ext, vcodec, acodec, filesize?, abr?}` |
| FR-42 | `DownloadService` selects yt-dlp format string from user's `quality`/`format` choice, mapped against `FormatInfo[]` |
| FR-43 | `FFmpegService` performs mux (video+audio merge), clip trim (`-ss`/`-to`), and audio transcode, preferring `-c copy` (FR-15/FR-23/FR-36 govern when) |
| FR-44 | `ProcessManager` tracks all spawned child PIDs per job; `cancelJob` kills the full process group within 2s (NFR-13) |
| FR-45 | `JobManager` writes final files to `FileManager`-resolved path only after successful completion (atomic rename from temp) |
| FR-46 | All child process stdout/stderr streamed and parsed line-by-line for progress (NFR-03); never buffered in full |

## 18. Native Messaging Protocol
Transport: Chrome Native Messaging over stdio, 4-byte little-endian length-prefixed UTF-8 JSON (Chrome-mandated framing). Host name: `com.localmediadownloader.host`.

**Envelope**:
```
Request:  { "type": string, "requestId": string, "payload": object }
Response: { "type": string, "requestId": string, "ok": boolean, "payload"?: object, "error"?: { "code": string, "message": string } }
Async (unsolicited, jobId-keyed): { "type": "jobProgress"|"jobComplete"|"jobError", "jobId": string, "payload": object }
```

**Operations** (only these are accepted by `MessageRouter`; anything else → `ok:false`, `error.code=UNSUPPORTED_OPERATION`, SEC-02):
| Operation | Request payload | Response payload |
|---|---|---|
| `ping` | `{}` | `{ pong: true }` |
| `getEngineInfo` | `{}` | `EngineInfo { version, ytDlpVersion, ffmpegVersion, status }` |
| `getVideoInfo` | `{ url }` | `VideoInfo { videoId, title, duration, thumbnail, channel? }` |
| `getFormats` | `{ videoId }` | `{ formats: FormatInfo[] }` |
| `startDownload` | `DownloadRequest` | `{ jobId }` |
| `startClip` | `ClipRequest` | `{ jobId }` |
| `cancelJob` | `{ jobId }` | `{ jobId, cancelled: true }` |
| `getJobStatus` | `{ jobId }` | `DownloadJob` |
| `openFile` | `{ jobId }` | `{ opened: true }` |
| `openFolder` | `{ jobId }` | `{ opened: true }` |

`EngineInfo.status` ∈ `{NotInstalled, Installing, Ready, Updating, Error}` (§19). `url` in `getVideoInfo` validated per SEC-06.

## 19. One-Click Installation
Distribution is a signed Windows installer (Inno Setup output), obtained via a static download link (e.g. GitHub Releases) — this is app *distribution*, not a runtime backend; it does not violate the no-backend/no-hosting requirement for the download engine's operation.

**Exact flow**:
1. Extension detects `EngineInfo.status = NotInstalled` (native port connect fails, or `ping` times out) → shows **Install Engine**.
2. Click triggers `chrome.downloads.download()` of the installer `.exe` from the static release URL to the user's Downloads folder. (Extensions cannot execute binaries directly — this download is required.)
3. **User's one required action**: double-click the downloaded installer.
4. Installer (silent/unattended after launch) performs, in order:
   a. Extracts `native-host.exe`, `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe` to `%LOCALAPPDATA%\LocalMediaDownloader\bin\`.
   b. Creates `%LOCALAPPDATA%\LocalMediaDownloader\{logs,temp}\` directories.
   c. Writes Native Messaging host manifest JSON (`name`, `path` to `native-host.exe`, `type: stdio`, `allowed_origins: ["chrome-extension://<PUBLISHED_EXTENSION_ID>/"]`) to `%LOCALAPPDATA%\LocalMediaDownloader\host-manifest.json`. `<PUBLISHED_EXTENSION_ID>` is a build-time constant baked into the installer at build/release time — never user-supplied.
   d. Writes registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.localmediadownloader.host` = path to the manifest.
   e. Runs each bundled binary with a version/health check (`--version`) to verify integrity.
   f. Writes engine `config.json` (install paths, bundled versions) to `%LOCALAPPDATA%\LocalMediaDownloader\`.
5. Extension polls `ping` every 2s (max 60s) starting when the user returns focus to the tab/popup. On success, `EngineStatus → Ready`.
6. If polling times out (rare — registry changes are picked up by Chrome without a browser restart in the standard case), UI shows a single **Check Again** button — not a technical instruction, just a retry click, preserving one-click compliance.

No step in 4a–4f is user-facing; the installer UI shows only the checklist in the product spec (`✓ Download engine / ✓ yt-dlp / ✓ FFmpeg / ✓ Chrome integration / ✓ Verification / Ready!`).

## 20. Storage
No database anywhere in the system.

**`chrome.storage.local`** keys:
| Key | Shape | Notes |
|---|---|---|
| `settings` | `Settings` (§21) | Single object |
| `history` | `HistoryEntry[]` | Capped at 100 (§22) |
| `engineInfoCache` | `EngineInfo` | Last known engine state, refreshed on popup open |
| `activeJobs` | `DownloadJob[]` | Transient; cleared/reconciled on service worker start via `getJobStatus` |

**Native engine local files** (no DB): `config.json` (install metadata), rotating log files under `logs/`, ephemeral files under `temp/` (cleaned on job completion/cancel and on host startup for orphaned temp files).

## 21. Settings
| Field | Type | Default | Group |
|---|---|---|---|
| `downloadFolder` | string (path) | `%USERPROFILE%\Downloads\Local Media Downloader` | General |
| `defaultVideoQuality` | enum (§12 quality list) | `1080p` | General |
| `defaultAudioFormat` | enum `mp3\|m4a\|opus` | `mp3` | General |
| `filenameTemplate` | string | `%(title)s.%(ext)s` | General |
| `overwriteBehavior` | enum `overwrite\|rename\|skip` | `rename` | Downloads |
| `retryCount` | int | `2` | Downloads |
| `compactMode` | bool | `false` | Interface |
| `overlayVisibility` | enum `always\|onHover\|hidden` | `always` | Interface |

Subfolders under `downloadFolder`: `Videos/`, `Audio/`, `Clips/` (auto-created by `FileManager`, FR-45).
Engine group (read-only + actions): current `EngineInfo`, **Reinstall/Repair Engine** (re-runs §19 flow).

## 22. History
```
HistoryEntry { id, title, url, type: "video"|"audio"|"clip", filename, filepath, timestamp, status: "completed"|"failed"|"cancelled" }
```
Actions: `Open File`, `Open Folder` (both call native `openFile`/`openFolder` with the job's persisted `filepath`), `Remove History` (single entry), `Clear History` (all). Cap 100 entries, FIFO eviction on insert. No media files or extended metadata stored (§20).

## 23. Error Handling
| Code | User message | Retryable |
|---|---|---|
| `ENGINE_NOT_INSTALLED` | "Download engine isn't installed." | N/A → routes to §19 |
| `ENGINE_UNREACHABLE` | "Can't reach the download engine." | Yes |
| `FORMAT_UNAVAILABLE` | "This quality/format isn't available for this video." | Yes (reselect) |
| `NETWORK_ERROR` | "Network error during download." | Yes |
| `DISK_FULL` | "Not enough disk space." | Yes (after freeing space) |
| `FFMPEG_FAILED` | "Couldn't process this file." | Yes |
| `YTDLP_FAILED` | "Couldn't fetch this video." | Yes |
| `INVALID_URL` | "This page isn't a supported YouTube video." | No |
| `UNSUPPORTED_VIDEO` | "This video can't be downloaded (private, live, or age-restricted)." | No |
| `CANCELLED` | "Download cancelled." | N/A |

UI-ERR-01: compact card — reason text + **Retry** button when `retryable`. Full stderr/stack traces are written only to the `Logger` file (§17), never rendered in the extension UI.

## 24. Security
| ID | Requirement |
|---|---|
| SEC-01 | Native host manifest `allowed_origins` restricted to the published extension ID only; Chrome enforces this at connection time |
| SEC-02 | `MessageRouter` accepts only the operations listed in §18; unknown types rejected, host does not crash |
| SEC-03 | All output paths validated to resolve within the configured `downloadFolder` (or its `Videos/Audio/Clips` subfolders); traversal outside is rejected |
| SEC-04 | Filenames sanitized: Windows-invalid characters stripped, reserved device names (`CON`,`PRN`,`AUX`,`NUL`,`COM1-9`,`LPT1-9`) rejected/renamed, path length kept within Windows limits (long-path aware) |
| SEC-05 | yt-dlp/FFmpeg invoked via fixed argv arrays; no shell interpolation, no `shell:true` equivalent |
| SEC-06 | `url`/`videoId` inputs validated as YouTube watch/shorts identifiers before use in any native call |
| SEC-07 | `ProcessManager` kills full child process group on job cancel/host exit; no orphaned yt-dlp/FFmpeg processes |
| SEC-08 | Malformed Native Messaging payloads (bad JSON/schema) are rejected with an error response, not a crash |
| SEC-09 | No post-install remote code execution: yt-dlp/FFmpeg versions are pinned at install time; binary updates only via a new signed installer (auto-update is Phase 3, §31) |

## 25. Privacy
| ID | Requirement |
|---|---|
| PRIV-01 | No backend; the only outbound network calls are yt-dlp↔YouTube (download) and the one-time installer download (§19) |
| PRIV-02 | No account, login, or API key anywhere in the product |
| PRIV-03 | No telemetry/analytics collected or transmitted by default (Phase 3, opt-in only — out of MVP) |
| PRIV-04 | Settings/history stored only in `chrome.storage.local` and local engine files (§20); never transmitted |
| PRIV-05 | Extension requests only: `nativeMessaging`, `storage`, `downloads`, host permission `*://*.youtube.com/*`; no broader host permissions |

## 26. Performance
| ID | Requirement |
|---|---|
| NFR-01 | Content script uses `yt-navigate-finish` + scoped `MutationObserver`; no `setInterval` DOM polling |
| NFR-02 | `jobProgress` pushes throttled to ≤1 per 250ms per job |
| NFR-03 | Native engine parses child process output line-by-line streaming; no full-buffer accumulation |
| NFR-04 | No media data is ever fully loaded into engine process memory; all I/O via file streams/pipes |
| NFR-05 | Idle extension (no watch page open) performs no background polling; service worker is event-driven only |

## 27. Reliability
| ID | Requirement |
|---|---|
| NFR-10 | Native port disconnect surfaces `EngineStatus = Error`; service worker attempts reconnect with backoff, without crashing the popup/content UI |
| NFR-11 | Non-zero exit from yt-dlp/FFmpeg transitions job to `Failed` with a mapped error code (§23); no orphan process left behind |
| NFR-12 | Disk-full condition surfaces `DISK_FULL`, halts the job, and removes partial temp output |
| NFR-13 | `cancelJob` terminates the job's process group within 2s and removes partial/temp files |
| NFR-14 | If YouTube DOM changes break selector-based injection, controls hide and a non-blocking banner is shown; native YouTube playback/controls are never altered or broken |
| NFR-15 | Unexpected native host exit is detected via `Port.onDisconnect` and reflected as `EngineStatus = Error` |

## 28. Testing
**Extension**: YouTube watch/Shorts detection (FR-01/02) · SPA navigation without reload (FR-04) · control injection at primary and fallback anchors (§10) · degrade-gracefully when anchor missing (NFR-14) · VideoPanel format population from mocked `getFormats` (FR-11) · AudioPanel format/quality population (FR-20–22) · ClipTimeline handle clamping (CLIP-01/02) · manual timestamp parse/validate (CLIP-07) · native messaging round-trip for each operation in §18 · EngineStatus rendering for all five states · settings persistence round-trip (§21).

**Native engine**: host startup + stdio framing · dependency/version check on start · yt-dlp invocation with fixed argv (SEC-05) · FFmpeg mux/clip/transcode paths (FR-15/23/36/43) · progress line parsing and throttled emission (NFR-02/03) · `cancelJob` kills process group within 2s (NFR-13) · error mapping for each code in §23 · output path validation rejects traversal (SEC-03) · filename sanitization (SEC-04) · orphaned temp-file cleanup on host startup.

**Integration**:
```
YouTube URL → Extension → Native Host → yt-dlp → FFmpeg → Local File → UI Completion
YouTube URL → Clip Start/End → Native Host → FFmpeg → Clip File → UI Completion
```
Both paths tested for: success, cancellation mid-job, forced yt-dlp failure, forced FFmpeg failure, disk-full simulation, native host kill mid-job.

## 29. MVP
**Extension**: FR-01–07 (YouTube integration), FR-10–15 (Video), FR-20–24 (Audio), FR-30–38 (Clip), CLIP-01–09 (Timeline), §16 job lifecycle + ProgressIndicator, Cancel (`cancelJob`), §21 Settings, §22 History, §19 EngineStatus.
**Native engine**: §19 one-click install, §18 full Native Messaging protocol, FR-40–46 (yt-dlp/FFmpeg integration), video+audio full downloads, video+audio clips, local file output (§20), §23 error handling.
Explicitly excluded from MVP: everything listed in §3 (NG-01–07).

## 30. Phase 2
Playlist downloads · multiple clip ranges per job · presets · subtitle download · chapter download · metadata embedding · thumbnail embedding · advanced/manual format selection · queue management for concurrent jobs · retry/resume improvements.

## 31. Phase 3
Additional yt-dlp-supported sites · advanced media processing · automatic engine/binary updates (relaxes SEC-09) · advanced scheduling · broader browser support (Edge/Brave via shared Chromium base).

## 32. Acceptance Criteria
| ID | Criterion |
|---|---|
| AC-001 | Opening a supported YouTube watch page displays `DownloaderControls` below the player (UI-01). |
| AC-002 | Opening a supported Shorts page also displays `DownloaderControls` (FR-01). |
| AC-003 | Clicking Video displays quality/format options sourced only from the live `getFormats` response (FR-10/11). |
| AC-004 | Selecting a format and clicking Download creates the requested file at `downloadFolder/Videos/` (FR-14, §21). |
| AC-005 | Clicking Audio displays only supported output formats MP3/M4A/OPUS (FR-21). |
| AC-006 | Audio download to a format matching the source codec completes via stream-copy, not re-encode (FR-23). |
| AC-007 | Clicking Clip activates `ClipTimeline` selection mode without pausing/altering normal playback (FR-30, FR-38). |
| AC-008 | Dragging the start handle past the end handle is prevented; it stops at `endTime − minClipLength` (CLIP-01). |
| AC-009 | Dragging the end handle past video duration is prevented; it stops at `videoDuration` (CLIP-02). |
| AC-010 | Manual timestamp entry accepts `HH:MM:SS`, `MM:SS`, and plain seconds, and rejects invalid input by reverting the field (CLIP-07). |
| AC-011 | Downloading a clip produces a file containing only the selected `[startTime, endTime]` range (FR-34–36). |
| AC-012 | Cancelling an in-progress job stops child processes within 2s and leaves no output file (NFR-13). |
| AC-013 | A `Failed` job displays the mapped error message from §23, never a raw stack trace. |
| AC-014 | `EngineStatus` shows `Not Installed` before install and `Ready` after §19 completes, with no CMD/PATH/Python/manual FFmpeg or yt-dlp step performed by the user (AC matches PROMPT AC-007/AC-008). |
| AC-015 | A fresh non-technical Windows user completes engine installation using only: click **Install Engine**, save the download, double-click the installer (§19 steps 1–3) — no further user action beyond an optional **Check Again** click. |
| AC-016 | History records a completed job with `id, title, url, type, filename, filepath, timestamp, status` and supports Open File/Open Folder/Remove (§22). |
| AC-017 | Settings changes to `downloadFolder` are respected by the next download without requiring restart (§21). |
| AC-018 | If the YouTube player DOM anchor is not found, controls hide and native YouTube playback is unaffected (NFR-14). |
| AC-019 | A native message with an unsupported `type` is rejected by the host without crashing it (SEC-02). |
| AC-020 | An output path that resolves outside `downloadFolder` is rejected before any file write (SEC-03). |

## 33. Development Tasks
**Phase 1 — Project foundation**
| TASK | Title | Goal | Dependencies | Files/Modules | AC |
|---|---|---|---|---|---|
| TASK-001 | Monorepo scaffold | Create §8 structure, base tsconfig/vite/tailwind, Go module | — | repo root, `extension/`, `native-engine/` | — |
| TASK-002 | MV3 manifest + permissions | Manifest with `nativeMessaging, storage, downloads`, host permission `*://*.youtube.com/*` | TASK-001 | `extension/manifest.json` | PRIV-05 |

**Phase 2 — YouTube integration**
| TASK-010 | YouTubeAdapter core | Implement FR-01–04 detection + nav events | TASK-002 | `extension/src/adapter/` | AC-001,002 |
| TASK-011 | Control injection + fallback | UI-01 anchor logic + fallback + hide-on-missing | TASK-010 | `extension/src/adapter/inject.ts` | AC-018 |
| TASK-012 | DownloaderControls shell + design tokens | §11 tokens, button states | TASK-011 | `extension/src/components/DownloaderControls.tsx` | AC-001 |

**Phase 3 — Native engine core**
| TASK-020 | NativeHost stdio framing | Length-prefixed JSON read/write loop | TASK-001 | `native-engine/host/` | AC-019 |
| TASK-021 | MessageRouter + operation whitelist | §18 operations dispatch, SEC-02/08 | TASK-020 | `native-engine/router/` | AC-019 |
| TASK-022 | FileManager: paths + sanitization | SEC-03/04, subfolder creation | TASK-021 | `native-engine/files/` | AC-020 |
| TASK-023 | YtDlpService + FormatService | `getVideoInfo`, `getFormats`, FR-40/41 | TASK-021 | `native-engine/ytdlp/` | AC-003 |

**Phase 4 — Video download**
| TASK-030 | DownloadService (video) | FR-14/15, mux via FFmpeg | TASK-023 | `native-engine/download/` | AC-004 |
| TASK-031 | JobManager + job state machine | §16 states, `getJobStatus` | TASK-030 | `native-engine/jobs/` | AC-004 |
| TASK-032 | VideoPanel + QualitySelector/FormatSelector | FR-10–13 UI | TASK-012, TASK-023 | `extension/src/components/VideoPanel.tsx` | AC-003 |
| TASK-033 | ProgressIndicator + progress streaming | NFR-02/03, `jobProgress` | TASK-031 | both sides | AC-011 area (progress) |

**Phase 5 — Audio download**
| TASK-040 | Audio path in DownloadService | FR-21–23 | TASK-030 | `native-engine/download/` | AC-005,006 |
| TASK-041 | AudioPanel | FR-20–24 UI | TASK-032 | `extension/src/components/AudioPanel.tsx` | AC-005 |

**Phase 6 — Clip timeline**
| TASK-050 | ClipTimeline component | CLIP-01–09 | TASK-012 | `extension/src/components/ClipTimeline.tsx` | AC-008,009,010 |
| TASK-051 | ClipPanel + manual input | FR-30–33,37 | TASK-050 | `extension/src/components/ClipPanel.tsx` | AC-010 |
| TASK-052 | Clip extraction in DownloadService | FR-34–36, `startClip` | TASK-040 | `native-engine/download/clip.go` | AC-011 |

**Phase 7 — Progress/errors/cancel**
| TASK-060 | cancelJob + ProcessManager group-kill | SEC-07, NFR-13 | TASK-031 | `native-engine/process/` | AC-012 |
| TASK-061 | Error taxonomy + UI error card | §23, UI-ERR-01 | TASK-033 | both sides | AC-013 |

**Phase 8 — One-click installer**
| TASK-070 | Inno Setup script | §19 steps 4a–4f | TASK-020 | `installer/` | AC-014,015 |
| TASK-071 | Engine install/repair UI flow | EngineStatus states, polling, Check Again | TASK-061 | `extension/src/components/EngineStatus.tsx` | AC-014,015 |

**Phase 9 — Testing/hardening**
| TASK-080 | Extension test suite | §28 extension cases | all extension tasks | `tests/extension/` | AC-001–003,008–010,018 |
| TASK-081 | Native engine test suite | §28 engine cases | all engine tasks | `tests/native-engine/` | AC-012,019,020 |
| TASK-082 | Integration test suite | §28 integration flows | TASK-080,081 | `tests/integration/` | AC-004,011 |
| TASK-083 | Settings + History wiring | §21/§22 schemas, storage round-trip | TASK-061 | `extension/src/storage/` | AC-016,017 |

## 34. Technical Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Chrome Native Messaging host registration edge cases (AV/antivirus flags installer, per-profile registry scoping) | Install fails silently for some users | Code-sign installer; write registry under `HKCU` (no admin needed); §19 step 6 fallback |
| YouTube DOM/player structure changes | Control injection breaks | YouTubeAdapter isolation (§10); fallback anchor + graceful hide (NFR-14) |
| yt-dlp compatibility breaks (YouTube-side changes) | Downloads/format fetch fail | Pin tested yt-dlp version per release; Phase 3 auto-update path |
| FFmpeg processing time for long videos/clips | Slow `Processing` state, perceived hang | Stream-copy preferred (FR-15/23/36); progress state clearly shown (§16) |
| Format availability varies per video (age-restriction, region, live) | Some downloads impossible | `UNSUPPORTED_VIDEO` error code (§23), no silent failure |
| Windows permission/AV interference with spawned child processes | Downloads blocked or flagged | Bundle signed binaries; write only to `%LOCALAPPDATA%` (no admin paths) |
| Installer/update flow drift from Chrome policy changes | One-click flow could require an extra step | §19 designed with single fallback action (Check Again) already accounted for |
| Extension ID changes between dev/unpacked and published builds | `allowed_origins` mismatch breaks native messaging | Installer build pipeline injects the correct ID per build target (dev vs. Web Store) |

## 35. Open Questions
- OQ-01: Final distribution host for the installer binary (GitHub Releases vs. a dedicated static domain) — an ops/business decision, not architectural.
- OQ-02: Code-signing certificate provider/cost — required for SmartScreen reputation, decision outside engineering scope.
- OQ-03: Whether initial release targets Chrome Web Store publish (stable extension ID) or sideloaded/dev-mode distribution during beta — affects when `allowed_origins` can be finalized in the installer build (§19).