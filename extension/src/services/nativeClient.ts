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

const TIMEOUT_MS = 60_000;

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

// Helper to fetch cookies from background
function getYoutubeCookies(): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_YOUTUBE_COOKIES' }, (res: SWResponse) => {
      if (res?.success && Array.isArray(res.data)) {
        resolve(res.data);
      } else {
        resolve([]);
      }
    });
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
    const cookies = await getYoutubeCookies();
    return sendNative<VideoInfo>('getVideoInfo', { url, cookies });
  },

  /** §18 getFormats — returns full FormatInfo[] */
  async getFormats(videoId: string): Promise<FormatInfo[]> {
    const cookies = await getYoutubeCookies();
    const res = await sendNative<{ formats: FormatInfo[] }>('getFormats', { videoId, cookies });
    return res.formats;
  },

  /** §18 startDownload — returns jobId */
  async startDownload(req: DownloadRequest): Promise<string> {
    const cookies = await getYoutubeCookies();
    const payload = { ...req, cookies } as unknown as Record<string, unknown>;
    const res = await sendNative<{ jobId: string }>('startDownload', payload);
    return res.jobId;
  },

  /** §18 startClip — returns jobId */
  async startClip(req: ClipRequest): Promise<string> {
    const cookies = await getYoutubeCookies();
    const payload = { ...req, cookies } as unknown as Record<string, unknown>;
    const res = await sendNative<{ jobId: string }>('startClip', payload);
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



  /** triggerUpdate */
  async triggerUpdate(downloadUrl: string, version: string = ""): Promise<void> {
    await sendNative('triggerUpdate', { downloadUrl, version });
  },

  /** downloadThumbnail */
  async downloadThumbnail(videoId: string, title: string): Promise<{ filepath: string }> {
    return sendNative<{ filepath: string }>('downloadThumbnail', { videoId, title });
  },

  /** Open a file directly by its path (no jobId needed — e.g. thumbnails) */
  async openFileDirect(filepath: string): Promise<void> {
    await sendNative('openFilePath', { filepath });
  },

  /** Open the containing folder for a file by its path and highlight it */
  async openFolderDirect(filepath: string): Promise<void> {
    await sendNative('openFolderPath', { filepath });
  },
};
