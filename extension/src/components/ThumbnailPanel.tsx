import React, { useState } from 'react';
import { Download, CheckCircle, Loader2 } from 'lucide-react';
import type { VideoInfo } from '@/types';
import { NativeClient } from '@/services/nativeClient';

interface ThumbnailPanelProps {
  videoId: string;
  videoInfo: VideoInfo | null;
}

export function ThumbnailPanel({ videoId, videoInfo }: ThumbnailPanelProps) {
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'complete'>('idle');

  const title = videoInfo?.title || 'Video Thumbnail';

  async function handleDownload() {
    setDownloadState('downloading');
    try {
      await NativeClient.downloadThumbnail(videoId, title);
      setDownloadState('complete');
      setTimeout(() => setDownloadState('idle'), 3000);
    } catch (err) {
      console.error('[ThumbnailPanel] Download failed:', err);
      setDownloadState('idle');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#aaa' }}>Format: JPEG Image</span>
          <span style={{ fontSize: 13, color: '#aaa' }}>Resolution: Highest Quality Available</span>
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
