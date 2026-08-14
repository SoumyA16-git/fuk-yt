import React, { useState, useEffect } from 'react';
import { Download, Loader2, AlertCircle, HardDrive, Sparkles } from 'lucide-react';
import type { FormatInfo, DownloadRequest, Job, VideoInfo } from '@/types';
import { ProgressIndicator } from './ProgressIndicator';
import { NativeClient } from '@/services/nativeClient';
import { useTheme } from '@/hooks/useTheme';

const QUALITY_LABEL_ORDER = [
  'Best',
  '2160p60', '2160p',
  '1440p60', '1440p',
  '1080p60', '1080p',
  '720p60',  '720p',
  '480p',    '360p',
] as const;

type QualityLabel = typeof QUALITY_LABEL_ORDER[number];

interface VideoQualityGroup {
  label: QualityLabel;
  height: number;
  fps60: boolean;
  formats: FormatInfo[];
  audioFormats: FormatInfo[];
}

function buildQualityGroups(formats: FormatInfo[]): VideoQualityGroup[] {
  const videoFormats = formats.filter((f) => !f.audioOnly);
  const audioFormats = formats.filter((f) => f.audioOnly);
  const heightMap = new Map<string, VideoQualityGroup>();

  for (const f of videoFormats) {
    if (!f.height) continue;
    const fps60 = (f.fps ?? 0) >= 50;
    const label = `${f.height}p${fps60 ? '60' : ''}` as QualityLabel;

    if (!heightMap.has(label)) {
      heightMap.set(label, { label, height: f.height, fps60, formats: [], audioFormats });
    }
    heightMap.get(label)!.formats.push(f);
  }

  return QUALITY_LABEL_ORDER
    .filter((l) => l !== 'Best' && heightMap.has(l))
    .map((l) => heightMap.get(l)!);
}

function formatFilesize(bytes?: number): string | null {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface VideoPanelProps {
  videoId: string;
  videoInfo: VideoInfo | null;
  formats: FormatInfo[] | null;
  formatsLoading: boolean;
  formatsError: string | null;
  activeJob: Job | null;
  onJobUpdate: (job: Job | null) => void;
}

export function VideoPanel({
  videoId,
  videoInfo,
  formats,
  formatsLoading,
  formatsError,
  activeJob,
  onJobUpdate,
}: VideoPanelProps) {
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const [selectedFormat, setSelectedFormat] = useState<string>('mp4');

  const qualityGroups = formats ? buildQualityGroups(formats) : [];
  const allQualities: Array<{ label: string; value: string }> = [
    { label: 'Best Quality', value: 'best' },
    ...qualityGroups.map((g) => ({ label: g.label, value: g.label })),
  ];

  useEffect(() => {
    if (!formats || formats.length === 0) return;
    const groups = buildQualityGroups(formats);
    const prefer = ['1080p', '1080p60', '720p', '720p60', '480p'];
    for (const p of prefer) {
      if (groups.some((g) => g.label === p)) {
        setSelectedQuality(p);
        return;
      }
    }
    if (groups.length > 0) setSelectedQuality(groups[0].label);
    else setSelectedQuality('best');
  }, [formats]);

  // Fallback status polling (500ms) while job is active
  useEffect(() => {
    if (!activeJob || (activeJob.state !== 'downloading' && activeJob.state !== 'processing')) return;

    const timer = setInterval(async () => {
      try {
        const res = await NativeClient.getJobStatus(activeJob.jobId);
        if (res && res.jobId) {
          onJobUpdate({
            jobId: res.jobId as string,
            type: activeJob.type,
            state: (res.state as any) ?? activeJob.state,
            percent: (res.percent as number) ?? activeJob.percent,
            speedBps: res.speedBps as number | undefined,
            etaSec: res.etaSec as number | undefined,
            downloadedBytes: res.downloadedBytes as number | undefined,
            totalBytes: res.totalBytes as number | undefined,
            filepath: res.filepath as string | undefined,
            errorCode: res.errorCode as any,
          });
        }
      } catch { /* ignore */ }
    }, 500);

    return () => clearInterval(timer);
  }, [activeJob?.jobId, activeJob?.state]);

  const availableContainers = (() => {
    const group = qualityGroups.find((g) => g.label === selectedQuality);
    if (!group) return ['mp4'];
    const exts = new Set(group.formats.map((f) => f.ext).filter(Boolean));
    const containers: string[] = [];
    if (exts.has('mp4') || exts.has('m4v')) containers.push('mp4');
    if (exts.has('webm') || exts.has('mkv')) containers.push('mkv');
    if (containers.length === 0) containers.push('mp4');
    return containers;
  })();

  const estimatedSize = (() => {
    if (!formats || !selectedQuality) return null;
    const group = qualityGroups.find((g) => g.label === selectedQuality);
    if (!group) return null;
    const bestFormat = group.formats.find((f) => f.filesize || f.filesizeApprox);
    if (!bestFormat) return null;
    return formatFilesize(bestFormat.filesize ?? bestFormat.filesizeApprox ?? undefined);
  })();

  const isActive = activeJob?.state === 'downloading' || activeJob?.state === 'processing';
  const canDownload = !!selectedQuality && !isActive;

  async function handleDownload() {
    if (!canDownload) return;
    const req: DownloadRequest = {
      videoId,
      outputType: 'video',
      quality: selectedQuality,
      format: selectedFormat,
    };
    try {
      const jobId = await NativeClient.startDownload(req);
      onJobUpdate({
        jobId,
        type: 'video',
        state: 'downloading',
        percent: 0,
      });
    } catch (err) {
      console.error('[FUK-YT VideoPanel] startDownload failed:', err);
    }
  }

  const theme = useTheme();

  if (formatsError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5', fontSize: 12 }}>
        <AlertCircle size={14} style={{ flexShrink: 0 }} />
        <span>{formatsError}</span>
      </div>
    );
  }

  if (formatsLoading || !formats) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', fontSize: 12, color: theme.textSecondary, transition: theme.transition }}>
        <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
        <span>Fetching high-res formats...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, transition: theme.transition }}>
      {/* Main Horizontal Controls Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        
        {/* Left: Thumbnail & Title Preview */}
        {videoInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200, maxWidth: 300, flexShrink: 0 }}>
            {videoInfo.thumbnail && (
              <img
                src={videoInfo.thumbnail}
                alt="Thumbnail"
                style={{ width: 48, height: 27, borderRadius: 4, objectFit: 'cover', background: theme.isDark ? '#222' : '#eee', flexShrink: 0 }}
              />
            )}
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: theme.transition }} title={videoInfo.title}>
                {videoInfo.title}
              </div>
              {videoInfo.channel && (
                <div style={{ fontSize: 12, color: theme.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: theme.transition }}>
                  {videoInfo.channel}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Center: Controls Group (Quality + Container + Size) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexGrow: 1 }}>
          
          {/* Quality Dropdown Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: theme.pillBg, height: 36, padding: '0 14px', borderRadius: 18, transition: theme.transition }}>
            <span style={{ fontSize: 13, color: theme.textSecondary, fontWeight: 500, transition: theme.transition }}>Quality</span>
            <select
              id="fyk-quality-select"
              value={selectedQuality}
              onChange={(e) => setSelectedQuality(e.target.value)}
              disabled={isActive}
              style={{
                background: 'transparent',
                border: 'none',
                color: theme.text,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                outline: 'none',
                transition: theme.transition,
              }}
            >
              {allQualities.map((q) => (
                <option key={q.value} value={q.value} style={{ background: theme.dropdownBg, color: theme.dropdownText }}>
                  {q.label}
                </option>
              ))}
            </select>
          </div>

          {/* Container Selector Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: theme.pillBg, height: 36, padding: 3, borderRadius: 18, transition: theme.transition }}>
            {availableContainers.map((c) => {
              const isSelected = selectedFormat === c;
              return (
                <button
                  key={c}
                  id={`fyk-format-btn-${c}`}
                  onClick={() => setSelectedFormat(c)}
                  disabled={isActive}
                  style={{
                    height: 30,
                    padding: '0 14px',
                    borderRadius: 15,
                    border: 'none',
                    background: isSelected ? theme.pillActiveBg : 'transparent',
                    color: isSelected ? theme.pillActiveText : theme.textSecondary,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: theme.transition,
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.color = theme.text;
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.color = theme.textSecondary;
                  }}
                >
                  {c.toUpperCase()}
                </button>
              );
            })}
          </div>

          {/* Estimated Size Badge */}
          {estimatedSize && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 18, background: theme.cardSubtleBg, fontSize: 13, color: theme.textSecondary, transition: theme.transition }}>
              <HardDrive size={13} color={theme.textSecondary} />
              <span>~{estimatedSize}</span>
            </div>
          )}
        </div>

        {/* Right: YouTube Native Red Download Pill Button */}
        <button
          id="fyk-video-download-btn"
          onClick={handleDownload}
          disabled={!canDownload}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 36,
            padding: '0 20px',
            borderRadius: 18,
            border: 'none',
            background: canDownload ? theme.primaryRed : theme.pillBg,
            color: canDownload ? '#ffffff' : theme.textMuted,
            fontSize: 14,
            fontWeight: 500,
            cursor: canDownload ? 'pointer' : 'not-allowed',
            transition: theme.transition,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            marginLeft: 'auto',
          }}
          onMouseEnter={(e) => {
            if (canDownload) (e.currentTarget as HTMLElement).style.background = theme.primaryRedHover;
          }}
          onMouseLeave={(e) => {
            if (canDownload) (e.currentTarget as HTMLElement).style.background = theme.primaryRed;
          }}
        >
          {isActive ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={15} />}
          <span>{isActive ? 'Downloading...' : 'Download Video'}</span>
        </button>
      </div>

      {/* Progress Card (When Active or Finished) */}
      {activeJob && (
        <ProgressIndicator
          job={activeJob}
          onCancel={async () => {
            try {
              await NativeClient.cancelJob(activeJob.jobId);
            } catch (err) {
              console.warn('cancelJob error:', err);
            } finally {
              onJobUpdate({ ...activeJob, state: 'cancelled' });
            }
          }}
          onRetry={() => { onJobUpdate(null); handleDownload(); }}
          onDismiss={() => onJobUpdate(null)}
        />
      )}
    </div>
  );
}
