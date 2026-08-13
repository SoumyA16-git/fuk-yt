import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle, WifiOff, Loader2, Download, RefreshCw } from 'lucide-react';
import type { EngineInfo, EngineStatus } from '@/types';
import { NativeClient } from '@/services/nativeClient';
import { useTheme } from '@/hooks/useTheme';

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
  const theme = useTheme();

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: theme.isDark ? '#22c55e22' : '#ecfdf5', border: `1px solid ${theme.isDark ? '#22c55e55' : '#a7f3d0'}`, fontSize: 12, color: theme.isDark ? '#22c55e' : '#059669', transition: theme.transition }}>
        <CheckCircle size={14} />
        <span>Engine ready · yt-dlp {engineInfo.ytDlpVersion} · ffmpeg {engineInfo.ffmpegVersion}</span>
      </div>
    );
  }

  if (status === 'NotInstalled') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 8, background: theme.cardSubtleBg, border: `1px solid ${theme.border}`, transition: theme.transition }}>
        <p style={{ fontSize: 12, color: theme.textSecondary, margin: 0 }}>
          The download engine isn't installed. Click to download the installer — then just
          double-click it to complete setup.
        </p>
        <button
          id="fyk-install-engine-btn"
          onClick={handleInstallEngine}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 6, background: theme.primaryRed,
            color: '#fff', fontSize: 12, fontWeight: 600, border: 'none',
            cursor: 'pointer', transition: theme.transition, width: 'fit-content',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = theme.primaryRedHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = theme.primaryRed; }}
        >
          <Download size={13} />
          <span>Install Engine</span>
        </button>
      </div>
    );
  }

  if (status === 'Installing') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 8, background: theme.cardSubtleBg, border: `1px solid ${theme.border}`, transition: theme.transition }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: theme.textSecondary }}>
          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
          <span>
            {timedOut
              ? 'Installer not detected yet.'
              : `Waiting for engine… (${POLL_MAX_ATTEMPTS - pollCount}s)`}
          </span>
        </div>
        {timedOut && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ fontSize: 12, color: theme.textMuted, margin: 0 }}>
              Double-click the downloaded <code>fuk-yt-installer.exe</code> to complete installation, then click below.
            </p>
            <button
              id="fyk-check-again-btn"
              onClick={handleCheckAgain}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 6, background: theme.pillBg,
                color: theme.text, fontSize: 12, fontWeight: 600, border: `1px solid ${theme.border}`,
                cursor: 'pointer', transition: theme.transition, width: 'fit-content',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = theme.pillBgHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = theme.pillBg; }}
            >
              <RefreshCw size={12} />
              <span>Check Again</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  if (status === 'Error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 8, background: theme.cardSubtleBg, border: '1px solid rgba(239, 68, 68, 0.4)', transition: theme.transition }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#ef4444' }}>
          <WifiOff size={13} />
          <span>Engine error — can't reach the download engine.</span>
        </div>
        <button
          id="fyk-engine-retry-btn"
          onClick={checkEngine}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 6, background: theme.pillBg,
            color: theme.text, fontSize: 12, fontWeight: 600, border: `1px solid ${theme.border}`,
            cursor: 'pointer', transition: theme.transition, width: 'fit-content',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = theme.pillBgHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = theme.pillBg; }}
        >
          <RefreshCw size={12} />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  // Updating / other states — guard status in case of unexpected value
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: theme.textSecondary, transition: theme.transition }}>
      <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
      <span>Engine {(status ?? 'loading').toLowerCase()}…</span>
    </div>
  );
}

