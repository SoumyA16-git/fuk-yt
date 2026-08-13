import React, { useState, useEffect } from 'react';
import { Download, Loader2, AlertCircle, Music } from 'lucide-react';
import type { FormatInfo, DownloadRequest, Job, VideoInfo } from '@/types';
import { ProgressIndicator } from './ProgressIndicator';
import { NativeClient } from '@/services/nativeClient';
import { useTheme } from '@/hooks/useTheme';

const AUDIO_OUTPUT_FORMATS = ['mp3', 'm4a', 'opus'] as const;
type AudioFormat = typeof AUDIO_OUTPUT_FORMATS[number];

interface AudioQualityOption {
  value: string;
  label: string;
}

function buildAudioQualities(formats: FormatInfo[]): AudioQualityOption[] {
  const audioFormats = formats.filter((f) => f.audioOnly && f.abr);
  const abrs = new Set<number>(audioFormats.map((f) => Math.round(f.abr!)));
  const options: AudioQualityOption[] = [{ value: 'best', label: 'Best Quality' }];

  for (const bitrate of [320, 256, 192, 128]) {
    if ([...abrs].some((a) => a >= bitrate)) {
      options.push({ value: String(bitrate), label: `${bitrate} kbps` });
    }
  }

  return options;
}

interface AudioPanelProps {
  videoId: string;
  videoInfo: VideoInfo | null;
  formats: FormatInfo[] | null;
  formatsLoading: boolean;
  formatsError: string | null;
  activeJob: Job | null;
  onJobUpdate: (job: Job | null) => void;
}

export function AudioPanel({
  videoId,
  videoInfo,
  formats,
  formatsLoading,
  formatsError,
  activeJob,
  onJobUpdate,
}: AudioPanelProps) {
  const [selectedFormat, setSelectedFormat] = useState<AudioFormat>('mp3');
  const [selectedQuality, setSelectedQuality] = useState<string>('best');

  const qualityOptions = formats ? buildAudioQualities(formats) : [{ value: 'best', label: 'Best Quality' }];

  useEffect(() => {
    if (formats) setSelectedQuality('best');
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

  const isActive = activeJob?.state === 'downloading' || activeJob?.state === 'processing';

  async function handleDownload() {
    if (isActive) return;
    const req: DownloadRequest = {
      videoId,
      outputType: 'audio',
      quality: selectedQuality,
      format: selectedFormat,
    };
    try {
      const jobId = await NativeClient.startDownload(req);
      onJobUpdate({
        jobId,
        type: 'audio',
        state: 'downloading',
        percent: 0,
      });
    } catch (err) {
      console.error('[FUK-YT AudioPanel] startDownload failed:', err);
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
        <span>Fetching audio streams...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, transition: theme.transition }}>
      {/* Main Horizontal Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        
        {/* Left: Video Title */}
        {videoInfo && (
          <div style={{ minWidth: 180, maxWidth: 280, overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: theme.transition }} title={videoInfo.title}>
              {videoInfo.title}
            </div>
            {videoInfo.channel && (
              <div style={{ fontSize: 12, color: theme.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: theme.transition }}>
                {videoInfo.channel}
              </div>
            )}
          </div>
        )}

        {/* Center: Format & Quality Group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexGrow: 1 }}>
          
          {/* Format Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: theme.pillBg, height: 36, padding: 3, borderRadius: 18, transition: theme.transition }}>
            {AUDIO_OUTPUT_FORMATS.map((fmt) => {
              const isSelected = selectedFormat === fmt;
              return (
                <button
                  key={fmt}
                  id={`fyk-audio-format-btn-${fmt}`}
                  onClick={() => setSelectedFormat(fmt)}
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
                  {fmt.toUpperCase()}
                </button>
              );
            })}
          </div>

          {/* Bitrate / Quality Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: theme.pillBg, height: 36, padding: '0 14px', borderRadius: 18, transition: theme.transition }}>
            <span style={{ fontSize: 13, color: theme.textSecondary, fontWeight: 500, transition: theme.transition }}>Bitrate</span>
            <select
              id="fyk-audio-quality-select"
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
              {qualityOptions.map((q) => (
                <option key={q.value} value={q.value} style={{ background: theme.dropdownBg, color: theme.dropdownText }}>
                  {q.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right: YouTube Native Red Download Audio Pill Button */}
        <button
          id="fyk-audio-download-btn"
          onClick={handleDownload}
          disabled={isActive}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 36,
            padding: '0 20px',
            borderRadius: 18,
            border: 'none',
            background: isActive ? theme.pillBg : theme.primaryRed,
            color: isActive ? theme.textMuted : '#ffffff',
            fontSize: 14,
            fontWeight: 500,
            cursor: isActive ? 'not-allowed' : 'pointer',
            transition: theme.transition,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            marginLeft: 'auto',
          }}
          onMouseEnter={(e) => {
            if (!isActive) (e.currentTarget as HTMLElement).style.background = theme.primaryRedHover;
          }}
          onMouseLeave={(e) => {
            if (!isActive) (e.currentTarget as HTMLElement).style.background = theme.primaryRed;
          }}
        >
          {isActive ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Music size={15} />}
          <span>{isActive ? 'Downloading...' : 'Download Audio'}</span>
        </button>
      </div>

      {/* Progress */}
      {activeJob && (
        <ProgressIndicator
          job={activeJob}
          onCancel={async () => {
            await NativeClient.cancelJob(activeJob.jobId);
            onJobUpdate({ ...activeJob, state: 'cancelled' });
          }}
          onRetry={() => { onJobUpdate(null); handleDownload(); }}
          onDismiss={() => onJobUpdate(null)}
        />
      )}
    </div>
  );
}
