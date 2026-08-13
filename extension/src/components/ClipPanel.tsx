import React, { useState, useEffect, useRef } from 'react';
import { Scissors, Download, RotateCcw, AlertCircle, Loader2 } from 'lucide-react';
import type { FormatInfo, ClipRequest, Job, VideoInfo } from '@/types';
import { ClipTimeline, type ClipSelection } from './ClipTimeline';
import { ProgressIndicator } from './ProgressIndicator';
import { NativeClient } from '@/services/nativeClient';
import { getPlaybackTime, getVideoDuration, pauseVideo, seekVideo } from '@/adapter/YouTubeAdapter';

function parseTimestamp(input: string): number {
  const s = input.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':');
  if (parts.length === 2) {
    const [m, sec] = parts.map(Number);
    if (isNaN(m) || isNaN(sec)) return NaN;
    return m * 60 + sec;
  }
  if (parts.length === 3) {
    const [h, m, sec] = parts.map(Number);
    if (isNaN(h) || isNaN(m) || isNaN(sec)) return NaN;
    return h * 3600 + m * 60 + sec;
  }
  return NaN;
}

function formatTimestamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface ClipPanelProps {
  videoId: string;
  videoInfo: VideoInfo | null;
  formats: FormatInfo[] | null;
  formatsLoading: boolean;
  formatsError: string | null;
  activeJob: Job | null;
  onJobUpdate: (job: Job | null) => void;
}

export function ClipPanel({
  videoId,
  videoInfo,
  formats,
  formatsLoading,
  formatsError,
  activeJob,
  onJobUpdate,
}: ClipPanelProps) {
  const duration = videoInfo?.duration ?? getVideoDuration();

  const [selection, setSelection] = useState<ClipSelection>({
    startTime: 0,
    endTime: duration > 0 ? duration : 60,
  });
  const [playbackTime, setPlaybackTime] = useState(0);

  const [startText, setStartText] = useState('0:00');
  const [endText, setEndText] = useState(formatTimestamp(duration > 0 ? duration : 60));

  const prevSelectionRef = useRef(selection);

  // Auto-pause YouTube video player when Clip tab is opened
  useEffect(() => {
    pauseVideo();
  }, []);

  // Live frame preview: seek player when handles are dragged
  useEffect(() => {
    if (selection.startTime !== prevSelectionRef.current.startTime) {
      seekVideo(selection.startTime);
    } else if (selection.endTime !== prevSelectionRef.current.endTime) {
      seekVideo(selection.endTime);
    }
    prevSelectionRef.current = selection;
  }, [selection.startTime, selection.endTime]);

  useEffect(() => {
    if (duration > 0) {
      setSelection((s) => ({ ...s, endTime: duration }));
      setEndText(formatTimestamp(duration));
    }
  }, [duration]);

  useEffect(() => {
    setStartText(formatTimestamp(selection.startTime));
    setEndText(formatTimestamp(selection.endTime));
  }, [selection]);

  useEffect(() => {
    const id = setInterval(() => {
      const t = getPlaybackTime();
      setPlaybackTime(t);
    }, 250);
    return () => clearInterval(id);
  }, []);

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

  function commitStartText() {
    const parsed = parseTimestamp(startText);
    if (isNaN(parsed) || parsed < 0 || parsed >= selection.endTime - 1) {
      setStartText(formatTimestamp(selection.startTime));
      return;
    }
    const clamped = Math.max(0, Math.min(parsed, selection.endTime - 1));
    setSelection((s) => ({ ...s, startTime: clamped }));
  }

  function commitEndText() {
    const parsed = parseTimestamp(endText);
    if (isNaN(parsed) || parsed <= selection.startTime + 1 || parsed > duration) {
      setEndText(formatTimestamp(selection.endTime));
      return;
    }
    const clamped = Math.min(parsed, duration);
    setSelection((s) => ({ ...s, endTime: clamped }));
  }

  function handleReset() {
    setSelection({ startTime: 0, endTime: duration });
  }

  const isActive = activeJob?.state === 'downloading' || activeJob?.state === 'processing';

  async function handleDownload(type: 'video' | 'audio') {
    if (isActive) return;

    const req: ClipRequest = {
      videoId,
      startTime: selection.startTime,
      endTime: selection.endTime,
      outputType: type,
      quality: 'best',
      format: type === 'video' ? 'mp4' : 'mp3',
    };

    try {
      const jobId = await NativeClient.startClip(req);
      onJobUpdate({
        jobId,
        type: type === 'video' ? 'clip-video' : 'clip-audio',
        state: 'downloading',
        percent: 0,
      });
    } catch (err) {
      console.error('[FUK-YT ClipPanel] startClip failed:', err);
    }
  }

  const clipDuration = selection.endTime - selection.startTime;

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', fontSize: 12, color: '#888' }}>
        <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
        <span>Preparing timeline...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Timeline Bar */}
      <ClipTimeline
        duration={duration}
        selection={selection}
        onSelectionChange={setSelection}
        playbackTime={playbackTime}
      />

      {/* Controls & Action Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        
        {/* Left: Start / End Inputs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 11, color: '#888' }}>Start</span>
            <input
              id="fyk-clip-start-input"
              type="text"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
              onBlur={commitStartText}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              disabled={isActive}
              style={{ width: 44, background: 'transparent', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, textAlign: 'center', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 11, color: '#888' }}>End</span>
            <input
              id="fyk-clip-end-input"
              type="text"
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
              onBlur={commitEndText}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              disabled={isActive}
              style={{ width: 44, background: 'transparent', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, textAlign: 'center', outline: 'none' }}
            />
          </div>

          <div style={{ padding: '4px 10px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', fontSize: 11, color: '#aaa' }}>
            Duration: <strong style={{ color: '#fff' }}>{formatTimestamp(clipDuration)}</strong>
          </div>

          <button
            id="fyk-clip-reset-btn"
            onClick={handleReset}
            disabled={isActive}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: '#888', fontSize: 11, cursor: 'pointer' }}
          >
            <RotateCcw size={11} />
            <span>Reset</span>
          </button>
        </div>

        {/* Right: Clip Video / Clip Audio Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button
            id="fyk-clip-download-video-btn"
            onClick={() => handleDownload('video')}
            disabled={isActive || clipDuration < 1}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 18px',
              borderRadius: 24,
              border: 'none',
              background: 'linear-gradient(135deg, #ff0000, #cc0000)',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 700,
              cursor: isActive ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 15px rgba(255, 0, 0, 0.35)',
            }}
          >
            <Scissors size={13} />
            <span>Video Clip</span>
          </button>

          <button
            id="fyk-clip-download-audio-btn"
            onClick={() => handleDownload('audio')}
            disabled={isActive || clipDuration < 1}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 18px',
              borderRadius: 24,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.06)',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 700,
              cursor: isActive ? 'not-allowed' : 'pointer',
            }}
          >
            <Download size={13} />
            <span>Audio Clip</span>
          </button>
        </div>
      </div>

      {/* Progress */}
      {activeJob && (
        <ProgressIndicator
          job={activeJob}
          onCancel={async () => {
            await NativeClient.cancelJob(activeJob.jobId);
            onJobUpdate({ ...activeJob, state: 'cancelled' });
          }}
          onRetry={() => { onJobUpdate(null); handleDownload('video'); }}
          onDismiss={() => onJobUpdate(null)}
        />
      )}
    </div>
  );
}
