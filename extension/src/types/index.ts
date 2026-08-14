// ============================================================
// FUK-YT Shared Types — PRD §16/§18/§23
// ============================================================

// --- Engine Info (§18 getEngineInfo, §19) ---

export type EngineStatus = 'NotInstalled' | 'Installing' | 'Ready' | 'Updating' | 'Error';

export interface EngineInfo {
  version: string;
  ytDlpVersion: string;
  ffmpegVersion: string;
  status: EngineStatus;
}

// --- Video / Format (§18 getVideoInfo, getFormats) ---

export interface VideoInfo {
  videoId: string;
  title: string;
  duration: number; // seconds
  thumbnail: string;
  channel?: string;
}

export interface FormatInfo {
  formatId: string;
  resolution: string;       // e.g. "1080p", "720p"
  fps?: number;
  ext: string;              // e.g. "mp4", "webm"
  vcodec?: string;
  acodec?: string;
  filesize?: number;        // bytes
  filesizeApprox?: number;  // bytes
  abr?: number;             // kbps
  audioOnly: boolean;
  videoOnly: boolean;
  hdr: boolean;
  height?: number;
  width?: number;
}

// --- Download / Clip Requests (§18) ---

export type OutputType = 'video' | 'audio';

export interface DownloadRequest {
  videoId: string;
  outputType: OutputType;
  quality: string;   // e.g. "best", "1080p", "720p", "480p", "360p"
  format: string;    // e.g. "mp4", "mkv", "mp3", "m4a", "opus"
}

export interface ClipRequest {
  videoId: string;
  title?: string;
  startTime: number;  // seconds
  endTime: number;    // seconds
  outputType: OutputType;
  quality: string;
  format: string;
}

// --- Job (§16, simplified states per decision) ---

export type JobState = 'downloading' | 'processing' | 'done' | 'failed' | 'cancelled';

export interface Job {
  jobId: string;
  type: 'video' | 'audio' | 'clip-video' | 'clip-audio';
  state: JobState;
  percent: number;
  speedBps?: number;
  etaSec?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  filepath?: string;
  error?: string;
  errorCode?: ErrorCode;
}

// --- Error Codes (§23) ---

export type ErrorCode =
  | 'ENGINE_NOT_INSTALLED'
  | 'ENGINE_UNREACHABLE'
  | 'FORMAT_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'DISK_FULL'
  | 'FFMPEG_FAILED'
  | 'YTDLP_FAILED'
  | 'INVALID_URL'
  | 'UNSUPPORTED_VIDEO'
  | 'CANCELLED'
  | 'UNSUPPORTED_OPERATION'
  | 'UNKNOWN';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ENGINE_NOT_INSTALLED: "Download engine isn't installed.",
  ENGINE_UNREACHABLE: "Can't reach the download engine.",
  FORMAT_UNAVAILABLE: "This quality/format isn't available for this video.",
  NETWORK_ERROR: 'Network error during download.',
  DISK_FULL: 'Not enough disk space.',
  FFMPEG_FAILED: "Couldn't process this file.",
  YTDLP_FAILED: "Couldn't fetch this video.",
  INVALID_URL: "This page isn't a supported YouTube video.",
  UNSUPPORTED_VIDEO: "This video can't be downloaded (private, live, or age-restricted).",
  CANCELLED: 'Download cancelled.',
  UNSUPPORTED_OPERATION: 'Unsupported operation.',
  UNKNOWN: 'An unexpected error occurred.',
};

export const RETRYABLE_ERRORS: Set<ErrorCode> = new Set([
  'ENGINE_UNREACHABLE',
  'FORMAT_UNAVAILABLE',
  'NETWORK_ERROR',
  'DISK_FULL',
  'FFMPEG_FAILED',
  'YTDLP_FAILED',
]);

// --- Native Messaging Protocol (§18) ---

export interface NativeEnvelope {
  type: string;
  requestId: string;
  payload?: Record<string, unknown>;
}

export interface NativeResponse {
  type: string;
  requestId: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
}

// Unsolicited push messages from native host
export type NativePush =
  | { type: 'jobProgress'; jobId: string; payload: { state: JobState; percent: number; speedBps?: number; etaSec?: number; downloadedBytes?: number; totalBytes?: number } }
  | { type: 'jobComplete'; jobId: string; payload: { filepath: string } }
  | { type: 'jobError'; jobId: string; payload: { code: string; message: string } };

// --- Chrome extension internal messages ---

export interface SWMessage {
  type: string;
  payload?: unknown;
}

export interface SWResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}
