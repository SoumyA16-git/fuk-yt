import React, { useState, useEffect } from 'react';
import { Download, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { NativeClient } from '@/services/nativeClient';

interface ShortsDownloadButtonProps {
  videoIdResolver: () => string | null;
}

export function ShortsDownloadButton({ videoIdResolver }: ShortsDownloadButtonProps) {
  const [status, setStatus] = useState<'idle' | 'downloading' | 'success' | 'error'>('idle');
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    function handlePush(e: Event) {
      const msg = (e as CustomEvent).detail;
      if (!jobId || !msg?.payload) return;

      if (msg.type === 'jobProgress' && msg.payload.jobId === jobId) {
        setStatus('downloading');
      } else if (msg.type === 'jobComplete' && msg.payload.jobId === jobId) {
        setStatus('success');
      } else if (msg.type === 'jobError' && msg.payload.jobId === jobId) {
        setStatus('error');
        setTimeout(() => setStatus('idle'), 3000);
      }
    }

    window.addEventListener('fuk-yt-native-push', handlePush);
    return () => window.removeEventListener('fuk-yt-native-push', handlePush);
  }, [jobId]);

  const handleClick = async () => {
    if (status === 'success' && jobId) {
      // Open the downloaded file in explorer
      await NativeClient.openFolder(jobId);
      return;
    }

    if (status !== 'idle') return;

    const vid = videoIdResolver();
    if (!vid) {
      console.warn('[FUK-YT] Could not resolve videoId for this Short');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
      return;
    }

    setStatus('downloading');
    try {
      const newJobId = await NativeClient.startDownload({
        videoId: vid,
        outputType: 'video',
        quality: '1080p',
        format: 'mp4',
        isShort: true
      });
      setJobId(newJobId);
    } catch (err) {
      console.error('[FUK-YT] Failed to start download:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return (
    <div 
      className="fuk-yt-shorts-btn" 
      onClick={handleClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: '8px',
        marginBottom: '8px',
        cursor: 'pointer'
      }}
    >
      <style>
        {`
          @keyframes fuk-yt-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          .fuk-yt-spin-anim {
            animation: fuk-yt-spin 1s linear infinite;
          }
        `}
      </style>
      <div 
        className="fuk-yt-shorts-btn-circle"
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: 'var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.4))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--yt-spec-text-primary, white)',
          transition: 'background-color 0.2s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--yt-spec-button-chip-background-hover, rgba(0, 0, 0, 0.6))'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--yt-spec-badge-chip-background, rgba(0, 0, 0, 0.4))'}
      >
        {status === 'idle' && <Download size={24} />}
        {status === 'downloading' && <Loader2 size={24} className="fuk-yt-spin-anim" />}
        {status === 'success' && <CheckCircle2 size={24} color="#4ade80" />}
        {status === 'error' && <XCircle size={24} color="#f87171" />}
      </div>
      <span 
        style={{ 
          color: 'var(--yt-spec-text-primary, white)', 
          fontSize: '14px', 
          marginTop: '6px',
          fontWeight: 400,
          fontFamily: 'Roboto, Arial, sans-serif',
          textShadow: '0 1px 2px rgba(0,0,0,0.5)'
        }}
      >
        {status === 'success' ? 'Open' : 'Save'}
      </span>
    </div>
  );
}
