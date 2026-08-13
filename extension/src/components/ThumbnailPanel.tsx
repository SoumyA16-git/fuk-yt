import React, { useState } from 'react';
import { Download, CheckCircle, Loader2, FolderOpen, FileImage } from 'lucide-react';
import type { VideoInfo } from '@/types';
import { NativeClient } from '@/services/nativeClient';
import { useTheme } from '@/hooks/useTheme';

interface ThumbnailPanelProps {
  videoId: string;
  videoInfo: VideoInfo | null;
}

export function ThumbnailPanel({ videoId, videoInfo }: ThumbnailPanelProps) {
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'done'>('idle');
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [openingFile, setOpeningFile] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);

  const theme = useTheme();
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0', transition: theme.transition }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: theme.textSecondary, transition: theme.transition }}>Format: PNG Image</span>
          <span style={{ fontSize: 13, color: theme.textSecondary, transition: theme.transition }}>Resolution: Highest Quality Available</span>
          {savedPath && (
            <span style={{ fontSize: 11, color: theme.textMuted, wordBreak: 'break-all', transition: theme.transition }}>
              {savedPath.split(/[\\/]/).pop()}
            </span>
          )}
        </div>

        {downloadState === 'idle' && (
          <button
            onClick={handleDownload}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: theme.primaryRed, color: '#fff', border: 'none',
              padding: '10px 20px', borderRadius: 20, fontSize: 14,
              fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              transition: theme.transition,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.primaryRedHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = theme.primaryRed; }}
          >
            <Download size={16} />
            <span>Download Thumbnail</span>
          </button>
        )}

        {downloadState === 'downloading' && (
          <button disabled style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: theme.pillBg, color: theme.textMuted, border: 'none',
            padding: '10px 20px', borderRadius: 20, fontSize: 14,
            fontWeight: 600, cursor: 'not-allowed', whiteSpace: 'nowrap',
            transition: theme.transition,
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
            background: theme.isDark ? '#22c55e22' : '#ecfdf5',
            border: `1px solid ${theme.isDark ? '#22c55e55' : '#a7f3d0'}`,
            color: theme.isDark ? '#22c55e' : '#059669',
            padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            transition: theme.transition,
          }}>
            <CheckCircle size={15} />
            <span>Saved to Downloads folder!</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button
              onClick={handleOpenFile}
              disabled={openingFile}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 36, padding: '0 18px', borderRadius: 18, border: 'none',
                background: '#22c55e', color: '#000', fontSize: 14,
                fontWeight: 500, cursor: openingFile ? 'not-allowed' : 'pointer',
                transition: theme.transition,
              }}
            >
              <FileImage size={14} />
              <span>Open File</span>
            </button>

            <button
              onClick={handleOpenFolder}
              disabled={openingFolder}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 36, padding: '0 18px', borderRadius: 18, border: 'none',
                background: theme.pillBg, color: theme.text, fontSize: 14,
                fontWeight: 500, cursor: openingFolder ? 'not-allowed' : 'pointer',
                transition: theme.transition,
              }}
              onMouseEnter={(e) => { if (!openingFolder) e.currentTarget.style.background = theme.pillBgHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = theme.pillBg; }}
            >
              <FolderOpen size={14} />
              <span>Open Folder</span>
            </button>

            <button
              onClick={() => { setDownloadState('idle'); setSavedPath(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 36, padding: '0 16px', borderRadius: 18, border: 'none',
                background: 'transparent', color: theme.textSecondary, fontSize: 13,
                fontWeight: 500, cursor: 'pointer', marginLeft: 'auto',
                transition: theme.transition,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = theme.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = theme.textSecondary; }}
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

