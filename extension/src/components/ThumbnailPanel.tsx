import React, { useState } from 'react';
import { Download, CheckCircle, Loader2, FolderOpen, FileImage } from 'lucide-react';
import type { VideoInfo } from '@/types';
import { NativeClient } from '@/services/nativeClient';

interface ThumbnailPanelProps {
  videoId: string;
  videoInfo: VideoInfo | null;
}

export function ThumbnailPanel({ videoId, videoInfo }: ThumbnailPanelProps) {
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'done'>('idle');
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [openingFile, setOpeningFile] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);

  const title = videoInfo?.title || 'Video Thumbnail';

  async function handleDownload() {
    setDownloadState('downloading');
    setSavedPath(null);
    try {
      const res = await NativeClient.downloadThumbnail(videoId, title);
      setSavedPath(res.filepath);
      setDownloadState('done');
    } catch (err) {
      console.error('[ThumbnailPanel] Download failed:', err);
      setDownloadState('idle');
    }
  }

  async function handleOpenFile() {
    if (!savedPath) return;
    setOpeningFile(true);
    try {
      await NativeClient.openFileDirect(savedPath);
    } catch (err) {
      console.error('[ThumbnailPanel] Open file failed:', err);
    } finally {
      setTimeout(() => setOpeningFile(false), 1000);
    }
  }

  async function handleOpenFolder() {
    if (!savedPath) return;
    setOpeningFolder(true);
    try {
      await NativeClient.openFolderDirect(savedPath);
    } catch (err) {
      console.error('[ThumbnailPanel] Open folder failed:', err);
    } finally {
      setTimeout(() => setOpeningFolder(false), 1000);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#aaa' }}>Format: JPEG Image</span>
          <span style={{ fontSize: 13, color: '#aaa' }}>Resolution: Highest Quality Available</span>
          {savedPath && (
            <span style={{ fontSize: 11, color: '#666', wordBreak: 'break-all' }}>
              {savedPath.split(/[\\/]/).pop()}
            </span>
          )}
        </div>

        {downloadState === 'idle' && (
          <button
            onClick={handleDownload}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#ff0000', color: '#fff', border: 'none',
              padding: '10px 20px', borderRadius: 20, fontSize: 14,
              fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background-color 0.2s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#cc0000'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#ff0000'; }}
          >
            <Download size={16} />
            <span>Download Thumbnail</span>
          </button>
        )}

        {downloadState === 'downloading' && (
          <button disabled style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#555', color: '#fff', border: 'none',
            padding: '10px 20px', borderRadius: 20, fontSize: 14,
            fontWeight: 600, cursor: 'not-allowed', whiteSpace: 'nowrap',
          }}>
            <Loader2 size={16} className="animate-spin" />
            <span>Downloading...</span>
          </button>
        )}
      </div>

      {downloadState === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#22c55e22', border: '1px solid #22c55e55',
            color: '#22c55e', padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          }}>
            <CheckCircle size={15} />
            <span>Saved to Downloads folder!</span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handleOpenFile}
              disabled={openingFile}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155',
                padding: '8px 14px', borderRadius: 8, fontSize: 13,
                fontWeight: 500, cursor: openingFile ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { if (!openingFile) e.currentTarget.style.background = '#334155'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#1e293b'; }}
            >
              <FileImage size={14} />
              <span>Open File</span>
            </button>

            <button
              onClick={handleOpenFolder}
              disabled={openingFolder}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155',
                padding: '8px 14px', borderRadius: 8, fontSize: 13,
                fontWeight: 500, cursor: openingFolder ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { if (!openingFolder) e.currentTarget.style.background = '#334155'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#1e293b'; }}
            >
              <FolderOpen size={14} />
              <span>Open Folder</span>
            </button>

            <button
              onClick={() => { setDownloadState('idle'); setSavedPath(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'transparent', color: '#64748b', border: '1px solid #334155',
                padding: '8px 14px', borderRadius: 8, fontSize: 13,
                fontWeight: 500, cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#1e293b'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Download size={14} />
              <span>Download Again</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
