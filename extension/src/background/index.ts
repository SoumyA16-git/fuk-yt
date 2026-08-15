/**
 * FUK-YT Service Worker (MV3 Background Script)
 * - Native messaging bridge (DownloadManager, owns the Port — PRD §6/§16)
 * - Routes all §18 operations; content scripts never call native messaging directly
 * - Broadcasts unsolicited jobProgress/jobComplete/jobError to YouTube tabs
 * - Reconnects with exponential backoff on disconnect (NFR-10)
 */

import type { NativeEnvelope, NativeResponse, SWResponse, DownloadRequest } from '@/types';

const NATIVE_HOST_ID = 'com.fukyt.host';
const RECONNECT_MAX_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;

// ============================================================
// Native Port management
// ============================================================

let nativePort: chrome.runtime.Port | null = null;
let reconnectDelay = 1_000;

const pendingRequests = new Map<
  string,
  { resolve: (r: NativeResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

function connect(): chrome.runtime.Port {
  if (nativePort) return nativePort;

  const port = chrome.runtime.connectNative(NATIVE_HOST_ID);

  port.onMessage.addListener((message: Record<string, unknown>) => {
    const type = message.type as string;

    // Unsolicited push events (PRD §18) — broadcast to all YouTube tabs
    if (type === 'jobProgress' || type === 'jobComplete' || type === 'jobError') {
      broadcastToTabs({ type: 'NATIVE_PUSH', payload: message });
      return;
    }

    // Solicited response — resolve pending promise by requestId
    const requestId = message.requestId as string | undefined;
    if (requestId) {
      const pending = pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(requestId);
        const response = message as unknown as NativeResponse;
        if (response.ok === false) {
          pending.reject(
            new Error(response.error?.message || response.error?.code || 'UNKNOWN')
          );
        } else {
          pending.resolve(response);
        }
      }
    }
  });

  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message ?? 'disconnected';
    console.warn('[FUK-YT SW] Native host disconnected:', reason);
    nativePort = null;

    // Reject all pending requests
    const hadPending = pendingRequests.size > 0;
    for (const [id, { reject, timer }] of pendingRequests) {
      clearTimeout(timer);
      reject(new Error('ENGINE_UNREACHABLE'));
      pendingRequests.delete(id);
    }

    // Only broadcast error to UI if active requests actually failed
    if (hadPending) {
      broadcastToTabs({ type: 'ENGINE_STATUS_CHANGE', payload: { status: 'Error', reason } });
    }

    // Exponential backoff reconnect (NFR-10)
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
      if (nativePort === null) {
        try { connect(); } catch { /* will retry on next user action */ }
      }
    }, reconnectDelay);
  });

  nativePort = port;
  reconnectDelay = 1_000; // reset on success
  return port;
}

function sendNative(envelope: NativeEnvelope): Promise<NativeResponse> {
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = connect();
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      pendingRequests.delete(envelope.requestId);
      reject(new Error('ENGINE_UNREACHABLE'));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(envelope.requestId, { resolve, reject, timer });

    try {
      port.postMessage(envelope);
    } catch (err) {
      clearTimeout(timer);
      pendingRequests.delete(envelope.requestId);
      nativePort = null;
      reject(err);
    }
  });
}

// ============================================================
// Broadcast to all YouTube tabs
// ============================================================

function broadcastToTabs(message: unknown) {
  chrome.tabs.query(
    { url: ['https://www.youtube.com/*', 'https://youtube.com/*'] },
    (tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {
            // Tab may not have content script; ignore
          });
        }
      }
    }
  );
}

// ============================================================
// Message Router — handles messages from content scripts & popup
// ============================================================

chrome.runtime.onMessage.addListener(
  (message: { type: string; payload?: unknown }, _sender, sendResponse) => {
    if (!message?.type) return false;

    handleMessage(message)
      .then((data) => sendResponse({ success: true, data } as SWResponse))
      .catch((err: Error) =>
        sendResponse({ success: false, error: err.message } as SWResponse)
      );

    return true; // async response
  }
);

async function getYouTubeCookies() {
  return new Promise((resolve, reject) => {
    if (!chrome.cookies) {
      resolve([]);
      return;
    }
    chrome.cookies.getAll({ domain: '.youtube.com' }, (cookies) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(cookies);
      }
    });
  });
}

async function handleMessage(message: { type: string; payload?: unknown }): Promise<unknown> {
  const { type, payload } = message;

  switch (type) {
    case 'NATIVE_REQUEST': {
      // Content/popup sends { type: 'NATIVE_REQUEST', payload: NativeEnvelope }
      const envelope = payload as NativeEnvelope;
      if (envelope.type === 'triggerUpdate') {
        await chrome.storage.local.set({ isUpdating: true });
      }
      
      if (envelope.type === 'api-download') {
        const req = envelope.payload as unknown as DownloadRequest;
        
        // Inject cookies for age-restricted / premium content
        // However, for Shorts, cookies often cause 403 Forbidden on 1080p streams due to PoToken restrictions.
        // So we omit cookies if it's a Short.
        const cookies = req.isShort ? [] : await getYouTubeCookies();
        envelope.payload = {
          ...req,
          cookies
        };
      }

      const response = await sendNative(envelope);
      // Return the payload from the envelope response
      return response.payload ?? response;
    }

    case 'PING_HOST': {
      try {
        await sendNative({ type: 'ping', requestId: crypto.randomUUID(), payload: {} });
        
        // If we successfully pinged the host and an update was in progress,
        // it means updater.bat finished and the new host is running.
        const { isUpdating } = await chrome.storage.local.get('isUpdating');
        if (isUpdating) {
          await chrome.storage.local.remove('isUpdating');
          chrome.runtime.reload(); // Reload extension
          // We won't return anything since the context gets invalidated
          return new Promise(() => {}); 
        }

        return { pong: true };
      } catch {
        throw new Error('ENGINE_UNREACHABLE');
      }
    }

    case 'GET_SETTINGS': {
      const result = await chrome.storage.local.get('settings');
      return result.settings ?? null;
    }

    case 'SET_SETTINGS': {
      await chrome.storage.local.set({ settings: payload });
      return null;
    }

    case 'GET_HISTORY': {
      const result = await chrome.storage.local.get('history');
      return result.history ?? [];
    }

    case 'SET_HISTORY': {
      await chrome.storage.local.set({ history: payload });
      return null;
    }

    case 'GET_ENGINE_INFO_CACHE': {
      const result = await chrome.storage.local.get('engineInfoCache');
      return result.engineInfoCache ?? null;
    }

    case 'SET_ENGINE_INFO_CACHE': {
      await chrome.storage.local.set({ engineInfoCache: payload });
      return null;
    }

    case 'DOWNLOAD_INSTALLER': {
      // §19: content scripts cannot call chrome.downloads; service worker has the permission.
      const { url } = (payload ?? {}) as { url?: string };
      if (!url) throw new Error('DOWNLOAD_INSTALLER: missing url');
      await chrome.downloads.download({ url, filename: 'fuk-yt-installer.exe' });
      return null;
    }

    case 'OPEN_EXTENSIONS_PAGE': {
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
      return null;
    }

    case 'CHECK_FILE_ACCESS': {
      return new Promise<boolean>((resolve) => {
        chrome.extension.isAllowedFileSchemeAccess((allowed) => {
          resolve(allowed);
        });
      });
    }

    case 'DOWNLOAD_THUMBNAIL': {
      const { videoId, title } = (payload ?? {}) as { videoId?: string; title?: string };
      if (!videoId) throw new Error('DOWNLOAD_THUMBNAIL: missing videoId');

      // Route through native engine — saves directly to Downloads folder.
      // Does NOT use chrome.downloads so no "Allow access to file URLs" toggle needed.
      const nativeRes = await sendNative({ type: 'downloadThumbnail', requestId: crypto.randomUUID(), payload: { videoId, title: title ?? videoId } });
      return nativeRes.payload ?? null;
    }

    case 'GET_YOUTUBE_COOKIES': {
      return new Promise((resolve, reject) => {
        if (!chrome.cookies) {
          resolve([]);
          return;
        }
        chrome.cookies.getAll({ domain: '.youtube.com' }, (cookies) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(cookies);
          }
        });
      });
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

// ============================================================
// Lifecycle
// ============================================================

self.addEventListener('activate', () => {
  console.log('[FUK-YT SW] Activated');
});
