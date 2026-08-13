# ⚡ Fuk-YT — Ultra-Fast YouTube Downloader Extension & Local Engine

<div align="center">

![GitHub release](https://img.shields.io/badge/version-v0.2.0-red?style=for-the-badge&logo=youtube)
![Go](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Chrome MV3](https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

<br />

**A sleek, YouTube-native Chrome extension powered by a local high-performance Go engine for instant video, audio, and clip downloads.**

</div>

---

## 🖼️ Preview & Screenshots

> [!NOTE]  
> **Placeholder links** are provided below. Replace `YOUR_..._IMAGE_URL_HERE` with your hosted screenshot URLs or repository asset paths.

### 🌟 Hero Banner
![Fuk-YT Hero Banner](YOUR_HERO_IMAGE_URL_HERE)

---

### 🎨 In-Page Downloader Bar
![YouTube In-Page Downloader Bar](YOUR_CONTROL_BAR_IMAGE_URL_HERE)

---

### ✂️ Precision Clip Trimmer with Live Frame Seeking
![Clip Trimming Interface](YOUR_CLIP_TRIMMER_IMAGE_URL_HERE)

---

### 📥 Chrome Browser Downloads Manager Integration
![Chrome Download Manager Integration](YOUR_CHROME_DOWNLOADS_IMAGE_URL_HERE)

---

## 🔥 Key Features

- 🎨 **YouTube Native Dark Theme UI**: Seamlessly embeds right below the YouTube player on watch pages with 36px YouTube pill controls.
- ⚡ **High-Speed Downloads**: Instant 50–100+ Mbps downloads using stream copy and optimized chunk fetching.
- 📹 **Universal H.264 (AVC) & AAC Output**: Guaranteed 100% playback compatibility across Windows Media Player, QuickTime, TVs, and editors (Premiere Pro, DaVinci Resolve).
- ✂️ **Interactive Video & Audio Trimmer**:
  - Automatically **pauses YouTube player** when opening the Clip tab.
  - **Live Frame Seeking**: Dragging start or end timeline handles seeks the YouTube player live so you can preview exact frames.
  - Instant loss-free clip cutting with zero green screen or corruption artifacts.
- 🏷️ **Smart Filename Formatting**: Output files are automatically named after the video title with quality tags:
  - Video: `Song Title [1080p].mp4`
  - Audio: `Song Title [320k].mp3`
  - Clip: `Song Title [Clip 1080p].mp4`
- 📥 **Chrome Downloads Integration**: Automatically registers completed downloads in Chrome's `chrome://downloads` history and native browser shelf.
- 🔒 **Local & Privacy First**: Zero tracking, zero ads, zero telemetry. All operations run 100% locally via Chrome Native Messaging and Go binaries.

---

## 🛠️ Requirements & Prerequisites

Before setting up Fuk-YT, ensure you have:
- **OS**: Windows 10 or Windows 11 (64-bit)
- **Browser**: Google Chrome, Brave, Edge, or any MV3 Chromium browser
- **Go**: [Go 1.22+](https://go.dev/dl/) (Required to build the local native engine)
- **Node.js**: [Node.js 18+](https://nodejs.org/) & `npm` (Required to build the Chrome extension)
- **FFmpeg & yt-dlp**: Automatically bundled or resolved by `install.bat`.

---

## 🚀 Quick Setup & Installation (1-Click)

### Step 1: Clone the Repository
Open your terminal or Command Prompt and run:
```bash
git clone https://github.com/SoumyA16-git/fuk-yt.git
cd fuk-yt
```

---

### Step 2: Run the Automated Installer
Double-click `install.bat` or run it from Command Prompt:
```cmd
install.bat
```
What `install.bat` does automatically:
1. Compiles the high-performance Go native host (`native-host/bin/native-host.exe`).
2. Registers the Chrome Native Messaging host in Windows Registry (`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fukyt.host`).
3. Installs NPM dependencies and builds the Chrome Extension bundle (`extension/dist/`).

---

### Step 3: Load Extension into Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `extension/dist` folder inside the `fuk-yt` repository directory.

![Chrome Extensions Load Unpacked Placeholder](YOUR_CHROME_EXTENSIONS_PAGE_IMAGE_URL_HERE)

---

### Step 4: Verify & Enjoy!
1. Open any YouTube video (e.g. `https://www.youtube.com/watch?v=...`).
2. You will see the **Fuk-YT** control bar directly underneath the video player with an `Engine Ready` indicator!

<details>
<summary>🛠️ <b>Click here for Manual Developer Build Instructions</b></summary>

### Manual Build Instructions

If you prefer building components individually:

#### 1. Build the Go Native Host
```bash
cd native-host
go mod tidy
go build -ldflags="-s -w" -o bin/native-host.exe ./cmd/host
```

#### 2. Register Native Host Manifest
Create/update registry key:
`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fukyt.host`
pointing to the absolute path of `native-host/com.fukyt.host.json`.

#### 3. Build the Extension
```bash
cd extension
npm install
npm run build
```

</details>

---

## 📖 How to Use

### 🎥 1. Video Downloading
1. Click the **Video** tab on the control bar.
2. Select desired quality (e.g. **1080p**, **720p**, **4K**) from the dropdown.
3. Choose container format (**MP4** or **MKV**).
4. Click **Download Video**.
5. Once complete, click **Open File** / **Open Folder** or check Chrome's download manager (`chrome://downloads`).

---

### 🎵 2. Audio Downloading
1. Click the **Audio** tab.
2. Choose audio format (**MP3**, **M4A**, **OPUS**).
3. Select audio bitrate (**320k**, **256k**, **192k**, **128k**).
4. Click **Download Audio**.

---

### ✂️ 3. Precision Clipping / Trimming
1. Click the **Clip** tab (YouTube video player will **auto-pause**).
2. Drag the **Start** and **End** timeline handles or type exact timestamps (`MM:SS`).
3. While dragging, watch the YouTube video player — it will **seek live** to display the exact frame!
4. Click **Video Clip** or **Audio Clip**.
5. Your clip will be cut cleanly with H.264 keyframe alignment and saved in seconds.

---

## 📁 File Output Location

All downloaded files are organized in your local Downloads folder under:
```
%USERPROFILE%\Downloads\FUK-YT\
├── Videos/    # Video downloads (.mp4 / .mkv)
├── Audio/     # Audio extractions (.mp3 / .m4a)
└── Clips/     # Trimmed clips (.mp4 / .mp3)
```

---

## 🔍 Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **Engine Offline** badge in UI | Native host registry key missing or Go binary missing | Run `install.bat` again to register host binary in Registry. |
| **UI disappeared on page reload** | Chrome extension updated or tab cached | Refresh extension in `chrome://extensions` and press `F5` on YouTube. |
| **Download stuck at 0%** | Native engine connection reset | Click **Cancel**, then click **Retry** on the progress card. |

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

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<div align="center">
Made with ❤️ by <b>SoumyA16-git</b>
</div>
