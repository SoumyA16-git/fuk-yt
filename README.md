<div align="center">

![Fuk-YT logo](https://i.ibb.co/JjQfKqyx/ICON.png)

# ⚡ Fuk-YT — Free YouTube Video & Audio Downloader for Chrome (Windows)

### Download YouTube videos in 1080p/4K, extract MP3 audio, and trim clips — directly from the YouTube page, 100% local and private.

[![Latest Release](https://img.shields.io/github/v/release/SoumyA16-git/fuk-yt?style=for-the-badge&color=red&logo=youtube&label=Download)](https://github.com/SoumyA16-git/fuk-yt/releases)
[![Go](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://go.dev/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![Chrome MV3](https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Stars](https://img.shields.io/github/stars/SoumyA16-git/fuk-yt?style=for-the-badge&color=yellow)](https://github.com/SoumyA16-git/fuk-yt/stargazers)

**[⬇️ Download Latest Release](https://github.com/SoumyA16-git/fuk-yt/releases) · [🐛 Report a Bug](https://github.com/SoumyA16-git/fuk-yt/issues) · [💡 Request a Feature](https://github.com/SoumyA16-git/fuk-yt/issues)**

</div>

---

## What is Fuk-YT?

**Fuk-YT** is a free, open-source **YouTube downloader Chrome extension** that adds a native-feeling download bar directly under any YouTube video. Unlike online YouTube-to-MP4 converter websites, Fuk-YT runs a lightweight local engine (built in Go, powered by **yt-dlp** and **FFmpeg**) on your own PC — so there are no upload limits, no ads, no watermarks, and no third-party server ever touches your video.

Use it to **download YouTube videos as MP4/MKV in 1080p, 720p, or 4K**, **convert YouTube to MP3/M4A/OPUS audio**, or **trim and export a precise clip** with live frame-accurate seeking — all in a couple of clicks.

---

## 📋 Table of Contents

- [Key Features](#-key-features)
- [Screenshots](#-screenshots)
- [Requirements](#️-requirements--system-support)
- [Installation Guide](#-quick-setup--installation-no-coding--no-build-required)
- [How to Use](#-how-to-use)
- [File Output Location](#-file-output-location--storage)
- [Troubleshooting / FAQ](#-troubleshooting--faq)
- [Tech Stack & Architecture](#️-tech-stack--architecture)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🔥 Key Features

- 🎨 **Native YouTube UI Integration** — embeds a dark-themed control bar right below the YouTube player on any watch page, styled to match YouTube's own 36px pill buttons.
- ⚡ **High-Speed Local Downloads** — 50–100+ Mbps throughput using stream copy and optimized chunk fetching, since everything runs on your machine instead of a remote server.
- 📹 **Universal MP4 Compatibility (H.264/AAC)** — every video download is guaranteed to play in Windows Media Player, QuickTime, smart TVs, and NLEs like Premiere Pro and DaVinci Resolve.
- ✂️ **Interactive Clip Trimmer with Live Frame Seeking** — auto-pauses the YouTube player, then lets you drag start/end handles while the player seeks live so you can preview the exact frame before exporting.
- 🎵 **YouTube to MP3 / M4A / OPUS Converter** — extract audio at 320k, 256k, 192k, or 128k bitrate in one click.
- 🏷️ **Automatic Smart Filenames** — outputs are named after the video title with quality tags baked in, e.g. `Song Title [1080p].mp4` or `Song Title [320k].mp3`.
- 📥 **Native Chrome Downloads Integration** — every file shows up in `chrome://downloads` and the browser's download shelf like any normal download.
- 🔒 **Privacy-First, Fully Local** — zero tracking, zero ads, zero telemetry, zero cloud upload. Everything runs through Chrome Native Messaging straight to a local Go binary on your PC.

---

## 🎨 Screenshots

**Fuk-YT control bar overview**
![Fuk-YT Chrome extension hero banner showing the YouTube downloader UI](https://i.ibb.co/pNbGX4q/image.png)

**In-page downloader bar embedded under the YouTube video player**
![Fuk-YT in-page YouTube video and audio downloader bar](https://i.ibb.co/236dcmHY/image.png)

**Precision clip trimmer with live frame seeking**
![Fuk-YT YouTube clip trimming interface with live frame preview](https://i.ibb.co/M53QcPN5/image.png)

---

## 🛠️ Requirements & System Support

| Requirement | Details |
| :--- | :--- |
| **OS** | Windows 10 or Windows 11 (64-bit) |
| **Browser** | Google Chrome, Brave, Edge, or any Chromium MV3 browser |
| **Setup** | No manual build or coding needed — everything is pre-built in the release package |

For contributors who want to build from source, install dev dependencies with `winget`:

```cmd
winget install Go.Go.1.22 OpenJS.NodeJS.LTS Git.Git
```

---

## 🚀 Quick Setup & Installation (No Coding / No Build Required)

### Step 1 — Download the Release
1. Go to the [**Fuk-YT GitHub Releases page**](https://github.com/SoumyA16-git/fuk-yt/releases).
2. Download the two pre-built zip files from the latest release:
   - 📦 `fuk-yt-extension.zip` (Chrome Extension)
   - ⚙️ `fuk-yt-engine-windows.zip` (Local Go Engine)
3. Extract both `.zip` files to any folder on your PC.

### Step 2 — Run the One-Click Engine Installer (one-time only)
1. Open the extracted `fuk-yt-engine-windows` folder.
2. Double-click `install.bat` (or right-click → **Run as administrator**).
3. This registers the local engine in the Windows Registry.

> 💡 You only need to run `install.bat` **once**. The registry entry persists across restarts, so Chrome will keep connecting to the engine automatically afterward.

### Step 3 — Load the Extension into Chrome
1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the extracted `fuk-yt-extension` folder.

![Loading the Fuk-YT unpacked extension in chrome://extensions](https://i.ibb.co/k26svn50/image.png)

### Step 4 — Verify & Enjoy
Open any YouTube video and confirm the **Fuk-YT** control bar appears below the player with an **Engine Ready** indicator.

<details>
<summary><b>🛠️ Developer / Source Build Instructions</b></summary>

#### 1. Build the Go native host
```bash
cd native-host
go mod tidy
go build -ldflags="-s -w" -o bin/native-host.exe ./cmd/host
```

#### 2. Register the native host manifest
Create/update the registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fukyt.host` pointing to the absolute path of `native-host/com.fukyt.host.json`.

#### 3. Build the extension
```bash
cd extension
npm install
npm run build
```

</details>

---

## 📖 How to Use

### 🎥 Downloading a YouTube Video
1. Open the **Video** tab on the control bar.
2. Pick a quality (1080p, 720p, 4K).
3. Pick a container (MP4 or MKV).
4. Click **Download Video**, then open it from the progress card or `chrome://downloads`.

### 🎵 Converting YouTube to MP3 / Audio
1. Open the **Audio** tab.
2. Choose a format (MP3, M4A, OPUS) and bitrate (320k / 256k / 192k / 128k).
3. Click **Download Audio**.

### ✂️ Trimming a Precise Clip
1. Open the **Clip** tab — the YouTube player auto-pauses.
2. Drag the **Start**/**End** timeline handles, or type exact `MM:SS` timestamps. The player seeks live so you can see the exact frame.
3. Click **Video Clip** or **Audio Clip** — the clip is cut with H.264 keyframe alignment in seconds.

---

## 📁 File Output Location & Storage

Every download is saved as a single clean file (no duplicates) under:

```
%USERPROFILE%\Downloads\FUK-YT\
├── Videos/    # Full video downloads (.mp4 / .mkv) with quality tags
├── Audio/     # Audio extractions (.mp3 / .m4a) with bitrate tags
└── Clips/     # Trimmed video & audio clips (.mp4 / .mp3)
```

Click **Open File** or **Open Folder** on any progress card to jump straight to it in File Explorer.

---

## 🔍 Troubleshooting / FAQ

**Q: The extension shows "Engine Offline" — how do I fix it?**
A: The native host registry key or Go binary is missing. Re-run `install.bat` from the `fuk-yt-engine-windows` folder as administrator.

**Q: The control bar disappeared after a Chrome update or page reload.**
A: Refresh the extension at `chrome://extensions`, then reload the YouTube tab (`F5`).

**Q: My download is stuck at 0%.**
A: The native engine connection was reset. Click **Cancel**, then **Retry** on the progress card.

**Q: Is Fuk-YT safe to use? Does it collect any data?**
A: Fuk-YT runs 100% locally — there's no telemetry, no analytics, and no server that sees your video URLs or files.

**Q: Does this work on Mac or Linux?**
A: Not currently — Fuk-YT's local engine is Windows-only today. Mac/Linux support may be considered in future releases; contributions are welcome.

---

## 🏗️ Tech Stack & Architecture

```
┌─────────────────────────┐         Chrome Native Messaging         ┌──────────────────────────┐
│ Chrome Extension (MV3)  │ ◄─────────────────────────────────────► │  Go Native Engine Host   │
│ React + TypeScript      │   (JSON stdin/stdout IPC protocol)      │  (native-host.exe)       │
└─────────────────────────┘                                         └────────────┬─────────────┘
             │                                                                   │
             ▼                                                                   ▼
┌─────────────────────────┐                                         ┌──────────────────────────┐
│  Injected Content Script│                                         │ yt-dlp & FFmpeg Pipeline │
│  (YouTube DOM Anchor)   │                                         │ (H.264 + Stream Copy)    │
└─────────────────────────┘                                         └──────────────────────────┘
```

**Built with:** Go · React · TypeScript · Chrome Extension Manifest V3 · yt-dlp · FFmpeg · Chrome Native Messaging

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Check the [issues page](https://github.com/SoumyA16-git/fuk-yt/issues) or open a pull request.

If Fuk-YT saved you time, consider ⭐ **starring the repo** — it helps other people find the project.

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

---

<div align="center">

**Keywords:** YouTube downloader Chrome extension · download YouTube videos 1080p 4K · YouTube to MP3 converter · YouTube clip trimmer · yt-dlp GUI · free local YouTube downloader Windows · no ads no server video downloader

Made with ❤️ by [**SoumyA16-git**](https://github.com/SoumyA16-git)

</div>