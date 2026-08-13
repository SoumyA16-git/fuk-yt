/**
 * NativeClient — extension-side proxy for all PRD §18 native messaging operations.
 * All calls are routed through the service worker via chrome.runtime.sendMessage.
 * Content scripts and UI components never call native messaging directly.
 */

import type {
  EngineInfo,
  VideoInfo,
  FormatInfo,
  DownloadRequest,
  ClipRequest,
  SWResponse,
} from '@/types';

// ============================================================
// Internal helper — send via service worker
// ============================================================

const TIMEOUT_MS = 30_000;

function sendNative<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native request timed out')), TIMEOUT_MS);

    chrome.runtime.sendMessage(
      {
        type: 'NATIVE_REQUEST',
        payload: {
          type,
          requestId: crypto.randomUUID(),
          payload,
        },
      },
      (res: SWResponse) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res?.success) {
          reject(new Error(res?.error ?? 'Unknown error'));
          return;
        }
        resolve(res.data as T);
      }
    );
  });
}

// ============================================================
// PRD §18 Operations
// ============================================================

export const NativeClient = {
  /** Connectivity check — returns true if host responds within timeout */
  async ping(): Promise<boolean> {
    try {
      await sendNative<{ pong: boolean }>('ping');
      return true;
    } catch {
      return false;
    }
  },

  /** §18 getEngineInfo */
  async getEngineInfo(): Promise<EngineInfo> {
    return sendNative<EngineInfo>('getEngineInfo');
  },

  /** §18 getVideoInfo */
  async getVideoInfo(url: string): Promise<VideoInfo> {
    return sendNative<VideoInfo>('getVideoInfo', { url });
  },

  /** §18 getFormats — returns full FormatInfo[] */
  async getFormats(videoId: string): Promise<FormatInfo[]> {
    const res = await sendNative<{ formats: FormatInfo[] }>('getFormats', { videoId });
    return res.formats;
  },

  /** §18 startDownload — returns jobId */
  async startDownload(req: DownloadRequest): Promise<string> {
    const res = await sendNative<{ jobId: string }>('startDownload', req as unknown as Record<string, unknown>);
    return res.jobId;
  },

  /** §18 startClip — returns jobId */
  async startClip(req: ClipRequest): Promise<string> {
    const res = await sendNative<{ jobId: string }>('startClip', req as unknown as Record<string, unknown>);
    return res.jobId;
  },

  /** §18 cancelJob */
  async cancelJob(jobId: string): Promise<void> {
    await sendNative('cancelJob', { jobId });
  },

  /** §18 getJobStatus */
  async getJobStatus(jobId: string): Promise<Record<string, unknown>> {
    return sendNative('getJobStatus', { jobId });
  },

  /** §18 openFile */
  async openFile(jobId: string): Promise<void> {
    await sendNative('openFile', { jobId });
  },

  /** §18 openFolder */
  async openFolder(jobId: string): Promise<void> {
    await sendNative('openFolder', { jobId });
  },

  /** moveToDownloads */
  async moveToDownloads(jobId: string, filepath: string, filename: string): Promise<{ filepath: string }> {
    return sendNative<{ filepath: string }>('moveToDownloads', { jobId, filepath, filename });
  },

  /** deleteFile */
  async deleteFile(filepath: string): Promise<void> {
    await sendNative('deleteFile', { filepath });
  },

  /** triggerUpdate */
  async triggerUpdate(downloadUrl: string): Promise<void> {
    await sendNative('triggerUpdate', { downloadUrl });
  },

  /** downloadThumbnail */
  async downloadThumbnail(videoId: string, title: string): Promise<{ filepath: string }> {
    return sendNative<{ filepath: string }>('downloadThumbnail', { videoId, title });
  },
};
