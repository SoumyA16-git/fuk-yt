import React, { useState } from 'react';
import { Download, CheckCircle, Loader2 } from 'lucide-react';
import type { VideoInfo } from '@/types';

interface ThumbnailPanelProps {
  videoId: string;
  videoInfo: VideoInfo | null;
}

export function ThumbnailPanel({ videoId, videoInfo }: ThumbnailPanelProps) {
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'complete'>('idle');

  const title = videoInfo?.title || 'Video Thumbnail';
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  async function handleDownload() {
    setDownloadState('downloading');
    try {
      const sanitizedTitle = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      const filename = `FUK-YT/Thumbnails/${sanitizedTitle}.jpg`;

      chrome.downloads.download({
        url: thumbnailUrl,
        filename: filename,
        conflictAction: 'uniquify',
        saveAs: false,
      }, (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          // fallback to hqdefault if maxresdefault is not available (404)
          const fallbackUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
          chrome.downloads.download({
            url: fallbackUrl,
            filename: filename,
            conflictAction: 'uniquify',
            saveAs: false,
          }, () => {
            setDownloadState('complete');
            setTimeout(() => setDownloadState('idle'), 3000);
          });
        } else {
          setDownloadState('complete');
          setTimeout(() => setDownloadState('idle'), 3000);
        }
      });
    } catch {
      setDownloadState('idle');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0' }}>
      {/* HD Preview */}
      <div
        style={{
          width: '100%',
          maxHeight: 280,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          background: '#000',
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <img
          src={thumbnailUrl}
          alt={title}
          style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
          onError={(e) => {
            // fallback if maxresdefault fails to load in browser
            e.currentTarget.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#aaa' }}>Format: JPEG Image</span>
          <span style={{ fontSize: 13, color: '#aaa' }}>Resolution: 1280x720 (HD) / 480x360 (SD)</span>
        </div>

        {downloadState === 'complete' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#22c55e', color: '#fff', padding: '10px 20px', borderRadius: 20, fontSize: 14, fontWeight: 600 }}>
            <CheckCircle size={16} />
            <span>Download Complete!</span>
          </div>
        ) : (
          <button
            onClick={handleDownload}
            disabled={downloadState === 'downloading'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#ff0000',
              color: '#fff',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 20,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (downloadState !== 'downloading') e.currentTarget.style.backgroundColor = '#cc0000';
            }}
            onMouseLeave={(e) => {
              if (downloadState !== 'downloading') e.currentTarget.style.backgroundColor = '#ff0000';
            }}
          >
            {downloadState === 'downloading' ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Downloading...</span>
              </>
            ) : (
              <>
                <Download size={16} />
                <span>Download Thumbnail</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
