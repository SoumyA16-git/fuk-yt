import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Film, Music, Scissors } from 'lucide-react';
import type { EngineInfo, FormatInfo, VideoInfo, Job, JobState } from '@/types';
import { NativeClient } from '@/services/nativeClient';
import { EngineStatusPanel } from './EngineStatus';
import { VideoPanel } from './VideoPanel';
import { AudioPanel } from './AudioPanel';
import { ClipPanel } from './ClipPanel';
import type { VideoMetadataDom } from '@/adapter/YouTubeAdapter';

type TabId = 'video' | 'audio' | 'clip';

interface DownloaderControlsProps {
  videoId: string;
  initialMetadata: VideoMetadataDom | null;
}

const TAB_BUTTONS: Array<{ id: TabId; label: string; icon: React.ReactNode; ariaLabel: string }> = [
  { id: 'video', label: 'Video', icon: <Film size={14} />, ariaLabel: 'Video download' },
  { id: 'audio', label: 'Audio', icon: <Music size={14} />, ariaLabel: 'Audio download' },
  { id: 'clip',  label: 'Clip',  icon: <Scissors size={14} />, ariaLabel: 'Clip download' },
];

/**
 * DownloaderControls — Premium YouTube-Native Injected Bar (PRD §11, UI-01)
 * Injected directly below the YouTube player / above title.
 */
export function DownloaderControls({ videoId }: DownloaderControlsProps) {
  const [engineReady, setEngineReady] = useState(false);
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('video');

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [formats, setFormats] = useState<FormatInfo[] | null>(null);
  const [formatsLoading, setFormatsLoading] = useState(false);
  const [formatsError, setFormatsError] = useState<string | null>(null);
  const formatsLoadedFor = useRef<string | null>(null);

  const [videoJob, setVideoJob] = useState<Job | null>(null);
  const [audioJob, setAudioJob] = useState<Job | null>(null);
  const [clipJob, setClipJob] = useState<Job | null>(null);

  const fetchFormats = useCallback(async () => {
    if (!engineReady || !videoId) return;
    if (formatsLoadedFor.current === videoId) return;

    setFormatsLoading(true);
    setFormatsError(null);
    formatsLoadedFor.current = videoId;

    try {
      const [info, fmts] = await Promise.all([
        NativeClient.getVideoInfo(`https://www.youtube.com/watch?v=${videoId}`),
        NativeClient.getFormats(videoId),
      ]);
      setVideoInfo(info);
      setFormats(fmts);
    } catch (err) {
      formatsLoadedFor.current = null;
      setFormatsError((err as Error).message?.includes('INVALID_URL')
        ? "This page isn't a supported YouTube video."
        : "Couldn't fetch video formats.");
    } finally {
      setFormatsLoading(false);
    }
  }, [engineReady, videoId]);

  useEffect(() => {
    if (engineReady) {
      fetchFormats();
    }
  }, [engineReady, fetchFormats]);

  useEffect(() => {
    function handleNativePush(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.type) return;

      if (detail.type === 'NATIVE_PUSH') {
        const push = detail.payload;
        const jobId = push?.jobId as string | undefined;
        if (!jobId) return;

        const updateJob = (prevJob: Job | null): Job | null => {
          if (!prevJob) return prevJob;
          if (prevJob.jobId !== jobId && prevJob.jobId !== '') return prevJob;

          if (push.type === 'jobProgress') {
            const p = push.payload || {};
            return {
              ...prevJob,
              jobId: jobId,
              state: (p.state as JobState) || prevJob.state,
              percent: typeof p.percent === 'number' ? p.percent : prevJob.percent,
              speedBps: p.speedBps !== undefined ? p.speedBps : prevJob.speedBps,
              etaSec: p.etaSec !== undefined ? p.etaSec : prevJob.etaSec,
              downloadedBytes: p.downloadedBytes !== undefined ? p.downloadedBytes : prevJob.downloadedBytes,
              totalBytes: p.totalBytes !== undefined ? p.totalBytes : prevJob.totalBytes,
            };
          }
          if (push.type === 'jobComplete') {
            return { ...prevJob, jobId: jobId, state: 'done', percent: 100, filepath: push.payload?.filepath };
          }
          if (push.type === 'jobError') {
            return { ...prevJob, jobId: jobId, state: 'failed', errorCode: push.payload?.code, error: push.payload?.message };
          }
          return prevJob;
        };

        setVideoJob(updateJob);
        setAudioJob(updateJob);
        setClipJob(updateJob);
      }

      if (detail.type === 'ENGINE_STATUS_CHANGE') {
        if (detail.payload?.status === 'Error') {
          setEngineReady(false);
          setEngineInfo(null);
        }
      }
    }

    const root = document.getElementById('fuk-yt-controls-root');
    if (root) root.addEventListener('fuk-yt-native-push', handleNativePush);
    window.addEventListener('fuk-yt-native-push', handleNativePush as EventListener);

    return () => {
      if (root) root.removeEventListener('fuk-yt-native-push', handleNativePush);
      window.removeEventListener('fuk-yt-native-push', handleNativePush as EventListener);
    };
  }, []);

  return (
    <div
      id="fyk-downloader-controls"
      style={{
        background: '#0f0f0f',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 12,
        fontFamily: '"Roboto", system-ui, -apple-system, sans-serif',
        fontSize: 14,
        color: '#f1f1f1',
        boxSizing: 'border-box',
        width: '100%',
        margin: '12px 0 16px 0',
        padding: '12px 16px',
        userSelect: 'none',
      }}
    >
      {/* Header Row: YouTube Native Pill Tabs + Engine Status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          paddingBottom: 10,
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Sleek YouTube Pill Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {TAB_BUTTONS.map(({ id, label, icon, ariaLabel }) => {
            const isSelected = activeTab === id;
            return (
              <button
                key={id}
                id={`fyk-tab-${id}`}
                aria-label={ariaLabel}
                onClick={() => setActiveTab(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 36,
                  padding: '0 16px',
                  borderRadius: 18,
                  border: 'none',
                  background: isSelected ? '#f1f1f1' : 'rgba(255, 255, 255, 0.1)',
                  color: isSelected ? '#0f0f0f' : '#f1f1f1',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
              >
                {icon}
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Engine Status Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 16, background: 'rgba(255, 255, 255, 0.05)', fontSize: 12, color: '#aaa' }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: engineReady ? '#22c55e' : '#ef4444',
            }}
          />
          <span>{engineReady ? `Engine Ready · ${engineInfo?.ytDlpVersion ?? 'v2026'}` : 'Engine Offline'}</span>
        </div>
      </div>

      {/* Body Area */}
      <ErrorBoundary>
        <div>
          {!engineReady ? (
            <EngineStatusPanel onReady={(info) => { setEngineReady(true); setEngineInfo(info); }} />
          ) : (
            <>
              {activeTab === 'video' && (
                <VideoPanel
                  videoId={videoId}
                  videoInfo={videoInfo}
                  formats={formats}
                  formatsLoading={formatsLoading}
                  formatsError={formatsError}
                  activeJob={videoJob}
                  onJobUpdate={setVideoJob}
                />
              )}
              {activeTab === 'audio' && (
                <AudioPanel
                  videoId={videoId}
                  videoInfo={videoInfo}
                  formats={formats}
                  formatsLoading={formatsLoading}
                  formatsError={formatsError}
                  activeJob={audioJob}
                  onJobUpdate={setAudioJob}
                />
              )}
              {activeTab === 'clip' && (
                <ClipPanel
                  videoId={videoId}
                  videoInfo={videoInfo}
                  formats={formats}
                  formatsLoading={formatsLoading}
                  formatsError={formatsError}
                  activeJob={clipJob}
                  onJobUpdate={setClipJob}
                />
              )}
            </>
          )}
        </div>
      </ErrorBoundary>
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('[FUK-YT Controls] Component error caught:', err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 12, borderRadius: 12, background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Download controls encountered an issue.</span>
          <button onClick={() => this.setState({ hasError: false })} style={{ padding: '4px 12px', borderRadius: 16, border: 'none', background: '#333', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
            Reset
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
