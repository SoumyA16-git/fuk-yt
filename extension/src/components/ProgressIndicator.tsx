import React from 'react';
import { Loader2, CheckCircle, XCircle, FolderOpen, FileDown, RotateCcw, X } from 'lucide-react';
import type { Job, ErrorCode } from '@/types';
import { ERROR_MESSAGES, RETRYABLE_ERRORS } from '@/types';
import { NativeClient } from '@/services/nativeClient';
import { useTheme } from '@/hooks/useTheme';

interface ProgressIndicatorProps {
  job: Job;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/**
 * ProgressIndicator — Sleek YouTube Glass Progress Card
 */
export function ProgressIndicator({ job, onCancel, onRetry, onDismiss }: ProgressIndicatorProps) {
  const theme = useTheme();
  const isActive = job.state === 'downloading' || job.state === 'processing';

  async function handleOpenFile() {
    await NativeClient.openFile(job.jobId);
  }

  async function handleOpenFolder() {
    await NativeClient.openFolder(job.jobId);
  }

  const errorMsg = job.errorCode
    ? (ERROR_MESSAGES[job.errorCode as ErrorCode] ?? ERROR_MESSAGES.UNKNOWN)
    : (job.error ?? ERROR_MESSAGES.UNKNOWN);

  const isRetryable = job.errorCode ? RETRYABLE_ERRORS.has(job.errorCode as ErrorCode) : false;

  const percentVal = typeof job?.percent === 'number' && !isNaN(job.percent) ? job.percent : 0;

  return (
    <div
      id="fyk-progress-indicator"
      style={{
        marginTop: 10,
        padding: '12px 14px',
        borderRadius: 12,
        background: theme.cardSubtleBg,
        border: `1px solid ${theme.cardSubtleBorder}`,
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: theme.transition,
      }}
    >
      {/* Status Header Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isActive && <Loader2 size={14} style={{ color: theme.accentBlue, animation: 'spin 1s linear infinite' }} />}
          {job.state === 'done' && <CheckCircle size={14} color="#22c55e" />}
          {job.state === 'failed' && <XCircle size={14} color="#ef4444" />}
          
          <span style={{
            fontWeight: 600,
            color: job.state === 'done' ? '#22c55e' :
                   job.state === 'failed' ? '#ef4444' :
                   job.state === 'cancelled' ? theme.textMuted : theme.text,
            transition: theme.transition,
          }}>
            {job.state === 'downloading' ? 'Downloading' :
             job.state === 'processing' ? 'Processing File...' :
             job.state === 'done' ? 'Download Complete!' :
             job.state === 'failed' ? 'Download Failed' :
             'Cancelled'}
          </span>
        </div>

        {/* Stats (Speed / ETA / Bytes) */}
        {isActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: theme.textSecondary, transition: theme.transition }}>
            {job.speedBps !== undefined && job.speedBps !== null && <span>{formatSpeed(job.speedBps)}</span>}
            {job.etaSec !== undefined && job.etaSec !== null && <span>ETA {formatEta(job.etaSec)}</span>}
            {job.downloadedBytes !== undefined && job.downloadedBytes !== null && job.totalBytes !== undefined && job.totalBytes !== null && (
              <span>{formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)}</span>
            )}
            <span style={{ color: theme.text, fontWeight: 700, minWidth: 40, textAlign: 'right', transition: theme.transition }}>
              {percentVal.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* Progress Bar (Active state) */}
      {isActive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flexGrow: 1, height: 4, borderRadius: 2, background: theme.isDark ? 'rgba(255, 255, 255, 0.2)' : '#e5e5e5', overflow: 'hidden', transition: theme.transition }}>
            <div
              id="fyk-progress-bar-fill"
              style={{
                height: '100%',
                borderRadius: 2,
                background: theme.primaryRed,
                width: `${Math.min(100, Math.max(0, percentVal))}%`,
                transition: 'width 0.25s ease',
              }}
            />
          </div>

          {/* Compact YouTube Pill Cancel Button */}
          <button
            id="fyk-cancel-btn"
            onClick={onCancel}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 14px',
              borderRadius: 16,
              border: 'none',
              background: theme.pillBg,
              color: theme.text,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: theme.transition,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = theme.pillBgHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = theme.pillBg; }}
          >
            <X size={13} />
            <span>Cancel</span>
          </button>
        </div>
      )}

      {/* Error Card */}
      {job.state === 'failed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ color: '#ef4444', margin: 0 }}>{errorMsg}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {isRetryable && (
              <button
                id="fyk-retry-btn"
                onClick={onRetry}
                style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 16, border: 'none', background: theme.pillBg, color: theme.text, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: theme.transition }}
                onMouseEnter={(e) => { e.currentTarget.style.background = theme.pillBgHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = theme.pillBg; }}
              >
                <RotateCcw size={13} />
                Retry
              </button>
            )}
            <button
              id="fyk-dismiss-btn"
              onClick={onDismiss}
              style={{ height: 32, padding: '0 14px', borderRadius: 16, border: 'none', background: 'transparent', color: theme.textSecondary, fontSize: 13, cursor: 'pointer', transition: theme.transition }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Completion Actions (Open File / Open Folder) */}
      {job.state === 'done' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button
            id="fyk-open-file-btn"
            onClick={handleOpenFile}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 18px', borderRadius: 18, border: 'none', background: '#22c55e', color: '#000', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: theme.transition }}
          >
            <FileDown size={14} />
            <span>Open File</span>
          </button>

          <button
            id="fyk-open-folder-btn"
            onClick={handleOpenFolder}
            style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 18px', borderRadius: 18, border: 'none', background: theme.pillBg, color: theme.text, fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: theme.transition }}
            onMouseEnter={(e) => { e.currentTarget.style.background = theme.pillBgHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = theme.pillBg; }}
          >
            <FolderOpen size={14} />
            <span>Open Folder</span>
          </button>

          <button
            id="fyk-dismiss-done-btn"
            onClick={onDismiss}
            style={{ height: 36, padding: '0 16px', borderRadius: 18, border: 'none', background: 'transparent', color: theme.textSecondary, fontSize: 13, cursor: 'pointer', marginLeft: 'auto', transition: theme.transition }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Cancelled */}
      {job.state === 'cancelled' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: theme.textMuted }}>{ERROR_MESSAGES.CANCELLED}</span>
          <button
            id="fyk-dismiss-cancelled-btn"
            onClick={onDismiss}
            style={{ background: 'transparent', border: 'none', color: theme.textSecondary, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

