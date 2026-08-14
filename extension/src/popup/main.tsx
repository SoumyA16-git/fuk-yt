import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, ExternalLink, CheckCircle, WifiOff, Loader2, RefreshCw } from 'lucide-react';
import type { EngineInfo } from '@/types';
import '../index.css';

// PRD §19 installer download URL
const INSTALLER_URL =
  'https://github.com/fukyt/fuk-yt/releases/latest/download/fuk-yt-installer.exe';

type ConnState = 'checking' | 'ready' | 'not-installed' | 'error';

function Popup() {
  const [state, setState] = useState<ConnState>('checking');
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);

  useEffect(() => {
    check();
  }, []);

  async function check() {
    setState('checking');
    chrome.runtime.sendMessage({ type: 'PING_HOST' }, (res) => {
      if (chrome.runtime.lastError || !res?.success) {
        setState('not-installed');
        return;
      }
      // Fetch engine info
      chrome.runtime.sendMessage(
        {
          type: 'NATIVE_REQUEST',
          payload: { type: 'getEngineInfo', requestId: crypto.randomUUID(), payload: {} },
        },
        (infoRes) => {
          if (infoRes?.success && infoRes.data) {
            setEngineInfo(infoRes.data as EngineInfo);
            setState(infoRes.data.status === 'Ready' ? 'ready' : 'error');
          } else {
            setState('error');
          }
        }
      );
    });
  }

  function openYouTube() {
    chrome.tabs.create({ url: 'https://www.youtube.com' });
    window.close();
  }

  function downloadInstaller() {
    chrome.downloads.download({ url: INSTALLER_URL, filename: 'fuk-yt-installer.exe' });
  }

  return (
    <div
      style={{
        width: 280,
        fontFamily: '"Roboto", system-ui, sans-serif',
        background: '#0f0f0f',
        color: '#f1f1f1',
        fontSize: 13,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          background: '#111',
          borderBottom: '1px solid #272727',
        }}
      >
        <img
          src="ICON.png"
          onError={(e) => {
            e.currentTarget.src = 'icons/icon128.png';
          }}
          alt="FUK-YT"
          style={{
            height: 30,
            width: 'auto',
            maxHeight: 30,
            maxWidth: 100,
            display: 'block',
            objectFit: 'contain',
          }}
        />
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f1f1', letterSpacing: -0.3 }}>
            FUK-YT
          </div>
          <div style={{ fontSize: 11, color: '#888' }}>Local YouTube Downloader</div>
        </div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Engine status card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 12px',
            background: '#1a1a1a',
            borderRadius: 8,
            border: '1px solid #272727',
          }}
        >
          {state === 'checking' && (
            <>
              <Loader2 size={14} style={{ color: '#888', animation: 'spin 1s linear infinite' }} />
              <span style={{ color: '#888', fontSize: 12 }}>Connecting…</span>
            </>
          )}
          {state === 'ready' && (
            <>
              <CheckCircle size={14} color="#22c55e" />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#22c55e' }}>Engine Ready</div>
                {engineInfo && (
                  <div style={{ fontSize: 10, color: '#666', marginTop: 1 }}>
                    yt-dlp {engineInfo.ytDlpVersion} · ffmpeg {engineInfo.ffmpegVersion}
                  </div>
                )}
              </div>
            </>
          )}
          {(state === 'not-installed' || state === 'error') && (
            <>
              <WifiOff size={14} color="#ef4444" />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#ef4444' }}>
                  {state === 'not-installed' ? 'Engine Not Installed' : 'Engine Error'}
                </div>
                <div style={{ fontSize: 10, color: '#666', marginTop: 1 }}>
                  {state === 'not-installed'
                    ? 'Download and run the installer'
                    : 'Click retry to reconnect'}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Install engine button (§19) — shown only when not installed */}
        {state === 'not-installed' && (
          <button
            id="fyk-popup-install-btn"
            onClick={downloadInstaller}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              width: '100%',
              padding: '9px 0',
              background: '#ef4444',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Download size={14} />
            Download Installer
          </button>
        )}

        {/* Retry */}
        {state === 'error' && (
          <button
            id="fyk-popup-retry-btn"
            onClick={check}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              width: '100%',
              padding: '9px 0',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 8,
              color: '#aaa',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <RefreshCw size={13} />
            Retry
          </button>
        )}

        {/* Open YouTube */}
        <button
          id="fyk-popup-open-yt"
          onClick={openYouTube}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            width: '100%',
            padding: '9px 0',
            background: state === 'ready' ? '#272727' : '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 8,
            color: '#f1f1f1',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <ExternalLink size={13} />
          Open YouTube
        </button>

        <div style={{ fontSize: 10, color: '#333', textAlign: 'center' }}>
          No data leaves your machine · v0.2.0
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById('root')!;
createRoot(root).render(<Popup />);
