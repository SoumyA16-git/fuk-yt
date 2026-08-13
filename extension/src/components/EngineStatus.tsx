import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle, WifiOff, Loader2, Download, RefreshCw } from 'lucide-react';
import type { EngineInfo, EngineStatus } from '@/types';
import { NativeClient } from '@/services/nativeClient';

// Static installer URL — §19. Replace with GitHub Releases URL at build/release time.
const INSTALLER_URL =
  'https://github.com/fukyt/fuk-yt/releases/latest/download/fuk-yt-installer.exe';

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_ATTEMPTS = 30; // 60 seconds total

interface EngineStatusProps {
  onReady: (info: EngineInfo) => void;
}

/**
 * EngineStatus — PRD §19 one-click install flow.
 * States: NotInstalled → Installing → Ready | Error
 * Polls ping every 2s for up to 60s after install trigger.
 */
export function EngineStatusPanel({ onReady }: EngineStatusProps) {
  const [status, setStatus] = useState<EngineStatus>('NotInstalled');
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check engine on mount
  useEffect(() => {
    checkEngine();
    return () => stopPolling();
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  async function checkEngine() {
    try {
      const info = await NativeClient.getEngineInfo();
      // Guard: old host format may not have a 'status' field at all.
      // Treating any missing/unrecognised status as 'Error' prevents
      // setStatus(undefined) → undefined.toLowerCase() crash.
      const status: EngineStatus = (
        info?.status === 'Ready' ||
        info?.status === 'Installing' ||
        info?.status === 'Updating' ||
        info?.status === 'Error'
          ? info.status
          : info?.status === undefined
          ? 'Error'
          : 'Error'
      );
      if (status === 'Ready') {
        setStatus('Ready');
        setEngineInfo(info);
        onReady(info);
      } else {
        setStatus(status);
      }
    } catch {
      setStatus('NotInstalled');
    }
  }

  function startPolling() {
    stopPolling();
    setPollCount(0);
    setTimedOut(false);

    pollRef.current = setInterval(async () => {
      setPollCount((c) => {
        const next = c + 1;
        if (next >= POLL_MAX_ATTEMPTS) {
          stopPolling();
          setTimedOut(true);
        }
        return next;
      });

      const alive = await NativeClient.ping();
      if (alive) {
        stopPolling();
        try {
          const info = await NativeClient.getEngineInfo();
          setStatus('Ready');
          setEngineInfo(info);
          onReady(info);
        } catch {
          setStatus('Error');
        }
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleInstallEngine() {
    setStatus('Installing');
    // §19: chrome.downloads is NOT available in content scripts.
    // Route through the service worker which has the 'downloads' permission.
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_INSTALLER',
      payload: { url: INSTALLER_URL },
    });
    startPolling();
  }

  async function handleCheckAgain() {
    setTimedOut(false);
    startPolling();
  }

  // ── Render ─────────────────────────────────────────────────

  if (status === 'Ready' && engineInfo) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-900/20 border border-green-700/30 text-xs text-green-400">
        <CheckCircle size={14} />
        <span>Engine ready · yt-dlp {engineInfo.ytDlpVersion} · ffmpeg {engineInfo.ffmpegVersion}</span>
      </div>
    );
  }

  if (status === 'NotInstalled') {
    return (
      <div className="flex flex-col gap-2 p-3 rounded-lg bg-zinc-800 border border-zinc-700">
        <p className="text-xs text-zinc-300">
          The download engine isn't installed. Click to download the installer — then just
          double-click it to complete setup.
        </p>
        <button
          id="fyk-install-engine-btn"
          onClick={handleInstallEngine}
          className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-semibold transition-colors"
        >
          <Download size={13} />
          Install Engine
        </button>
      </div>
    );
  }

  if (status === 'Installing') {
    return (
      <div className="flex flex-col gap-2 p-3 rounded-lg bg-zinc-800 border border-zinc-700">
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <Loader2 size={13} className="animate-spin text-zinc-400" />
          <span>
            {timedOut
              ? 'Installer not detected yet.'
              : `Waiting for engine… (${POLL_MAX_ATTEMPTS - pollCount}s)`}
          </span>
        </div>
        {timedOut && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-zinc-400">
              Double-click the downloaded <code className="text-zinc-200">fuk-yt-installer.exe</code>{' '}
              to complete installation, then click below.
            </p>
            <button
              id="fyk-check-again-btn"
              onClick={handleCheckAgain}
              className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-semibold transition-colors"
            >
              <RefreshCw size={12} />
              Check Again
            </button>
          </div>
        )}
      </div>
    );
  }

  if (status === 'Error') {
    return (
      <div className="flex flex-col gap-2 p-3 rounded-lg bg-zinc-800 border border-red-800/40">
        <div className="flex items-center gap-2 text-xs text-red-400">
          <WifiOff size={13} />
          <span>Engine error — can't reach the download engine.</span>
        </div>
        <button
          id="fyk-engine-retry-btn"
          onClick={checkEngine}
          className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-semibold transition-colors"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    );
  }

  // Updating / other states — guard status in case of unexpected value
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <Loader2 size={13} className="animate-spin" />
      <span>Engine {(status ?? 'loading').toLowerCase()}…</span>
    </div>
  );
}
