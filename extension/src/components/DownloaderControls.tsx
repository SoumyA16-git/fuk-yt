import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Film, Music, Scissors, Star, Image, Loader2 } from 'lucide-react';
import type { EngineInfo, FormatInfo, VideoInfo, Job, JobState } from '@/types';
import { NativeClient } from '@/services/nativeClient';
import { EngineStatusPanel } from './EngineStatus';
import { VideoPanel } from './VideoPanel';
import { AudioPanel } from './AudioPanel';
import { ClipPanel } from './ClipPanel';
import { ThumbnailPanel } from './ThumbnailPanel';
import { useTheme } from '@/hooks/useTheme';
import type { VideoMetadataDom } from '@/adapter/YouTubeAdapter';

const GithubIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    height={size}
    width={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    style={{ display: 'inline-block', verticalAlign: 'middle' }}
  >
    <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

type TabId = 'video' | 'audio' | 'clip' | 'thumbnail';

interface DownloaderControlsProps {
  videoId: string;
  initialMetadata: VideoMetadataDom | null;
}

function isNewerVersion(remote: string, local: string): boolean {
  if (!remote || !local) return false;
  const r = remote.replace(/^v/, '').split('.').map(Number);
  const l = local.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

const TAB_BUTTONS: Array<{ id: TabId; label: string; icon: React.ReactNode; ariaLabel: string }> = [
  { id: 'video', label: 'Video', icon: <Film size={14} />, ariaLabel: 'Video download' },
  { id: 'audio', label: 'Audio', icon: <Music size={14} />, ariaLabel: 'Audio download' },
  { id: 'clip',  label: 'Clip',  icon: <Scissors size={14} />, ariaLabel: 'Clip download' },
  { id: 'thumbnail', label: 'Thumbnail', icon: <Image size={14} />, ariaLabel: 'Thumbnail download' },
];

/**
 * DownloaderControls — Premium YouTube-Native Injected Bar (PRD §11, UI-01)
 * Injected directly below the YouTube player / above title.
 */
export function DownloaderControls({ videoId }: DownloaderControlsProps) {
  const [engineReady, setEngineReady] = useState(false);
  const [engineChecking, setEngineChecking] = useState(true); // suppress Install Engine flash until initial ping done
  const [engineInfo, setEngineInfo] = useState<EngineInfo | null>(null);
  const [githubVersion, setGithubVersion] = useState<string>('v0.2.11');
  const [starsCount, setStarsCount] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('video');
  const [isUpdating, setIsUpdating] = useState(false);
  const [fileAccessAllowed, setFileAccessAllowed] = useState(true);

  async function handleUpdateEngine() {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const downloadUrl = `https://github.com/SoumyA16-git/fuk-yt/releases/download/${githubVersion}/native-host.exe`;
      // Pass both the binary URL and the version so the native host can download the extension ZIP too.
      await NativeClient.triggerUpdate(downloadUrl, githubVersion);
      
      setTimeout(async () => {
        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          const alive = await NativeClient.ping();
          if (alive || attempts > 20) {
            clearInterval(interval);
            window.location.reload();
          }
        }, 1000);
      }, 2000);
    } catch (err) {
      console.error('Update failed:', err);
      alert('Update failed: ' + (err as Error).message);
      setIsUpdating(false);
    }
  }

  useEffect(() => {
    async function fetchGitHubStats() {
      try {
        const res = await fetch('https://api.github.com/repos/SoumyA16-git/fuk-yt');
        if (res.ok) {
          const data = await res.json();
          if (typeof data.stargazers_count === 'number') {
            setStarsCount(data.stargazers_count);
          }
        }
      } catch {
        // network fallback
      }
      try {
        const res = await fetch('https://api.github.com/repos/SoumyA16-git/fuk-yt/releases/latest');
        if (res.ok) {
          const data = await res.json();
          if (data.tag_name) {
            setGithubVersion(data.tag_name);
          }
        }
      } catch {
        // network fallback
      }
    }
    fetchGitHubStats();

    // Initial engine ping — done here so we never flash Install Engine before knowing engine state
    NativeClient.getEngineInfo().then((info) => {
      if (info?.status === 'Ready') {
        setEngineReady(true);
        setEngineInfo(info);
      }
    }).catch(() => {
      // Engine not installed — engineChecking false will show EngineStatusPanel
    }).finally(() => {
      setEngineChecking(false);
    });

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'CHECK_FILE_ACCESS' }, (res) => {
        if (res?.success && typeof res.data === 'boolean') {
          setFileAccessAllowed(res.data);
        }
      });
    }
  }, []);

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
            // Prevent late progress events from resurrecting cancelled/failed/done jobs
            if (prevJob.state === 'cancelled' || prevJob.state === 'failed' || prevJob.state === 'done') {
              return prevJob;
            }
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

  const theme = useTheme();

  return (
    <div
      id="fyk-downloader-controls"
      style={{
        background: theme.cardBg,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        fontFamily: '"Roboto", system-ui, -apple-system, sans-serif',
        fontSize: 14,
        color: theme.text,
        boxSizing: 'border-box',
        width: '100%',
        margin: '12px 0 16px 0',
        padding: '12px 16px',
        userSelect: 'none',
        transition: theme.transition,
        boxShadow: theme.isDark ? 'none' : '0 1px 4px rgba(0, 0, 0, 0.05)',
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
          borderBottom: `1px solid ${theme.divider}`,
          transition: theme.transition,
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
                  background: isSelected ? theme.pillActiveBg : theme.pillBg,
                  color: isSelected ? theme.pillActiveText : theme.text,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: theme.transition,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = theme.pillBgHover;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = theme.pillBg;
                  }
                }}
              >
                {icon}
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Section: GitHub Stats + Engine Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* GitHub Repository Widget */}
          <a
            href="https://github.com/SoumyA16-git/fuk-yt"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 12px',
              borderRadius: 16,
              background: theme.cardSubtleBg,
              border: `1px solid ${theme.cardSubtleBorder}`,
              color: theme.text,
              textDecoration: 'none',
              fontSize: 12,
              fontWeight: 500,
              transition: theme.transition,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.pillBgHover;
              e.currentTarget.style.borderColor = theme.border;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme.cardSubtleBg;
              e.currentTarget.style.borderColor = theme.cardSubtleBorder;
            }}
          >
            <GithubIcon size={14} />
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                borderLeft: `1px solid ${theme.border}`,
                paddingLeft: 8,
                marginLeft: 2,
                color: '#f1c40f',
                height: 14,
                lineHeight: 1,
              }}
            >
              <Star size={11} fill="#f1c40f" stroke="#f1c40f" style={{ display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1, display: 'inline-block' }}>
                {starsCount !== null ? starsCount : 'Star'}
              </span>
            </div>
          </a>

          {/* Update Now Button (if available) */}
          {engineReady && engineInfo && githubVersion && isNewerVersion(githubVersion, engineInfo.version) && (
            <button
              onClick={handleUpdateEngine}
              disabled={isUpdating}
              style={{
                background: '#f1c40f',
                color: '#0f0f0f',
                border: 'none',
                height: 32,
                padding: '0 12px',
                borderRadius: 16,
                fontSize: 11,
                fontWeight: 600,
                cursor: isUpdating ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'opacity 0.2s ease',
                opacity: isUpdating ? 0.7 : 1,
              }}
            >
              {isUpdating ? (
                <>
                  <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Updating...</span>
                </>
              ) : (
                <span>Update to {githubVersion}</span>
              )}
            </button>
          )}

          {/* Engine Status Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 12px',
              borderRadius: 16,
              background: theme.cardSubtleBg,
              border: `1px solid ${theme.cardSubtleBorder}`,
              fontSize: 12,
              color: theme.textSecondary,
              transition: theme.transition,
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: engineReady ? '#22c55e' : '#ef4444',
              }}
            />
            <span style={{ fontWeight: 600 }}>
              {engineReady
                ? engineInfo?.version
                  ? engineInfo.version.startsWith('v')
                    ? engineInfo.version
                    : 'v' + engineInfo.version
                  : ''
                : 'Offline'}
            </span>
          </div>

          <div id="HACKY-TEST-DIV">HELLOOOOO</div> {/* High Quality App Icon */}
          <div
            title="FUK-YT"
            style={{
              height: 32,
              width: 32,
              minWidth: 32,
              marginLeft: 4,
              backgroundImage: `url(${typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('ICON.png') : 'ICON.png'})`,
              backgroundSize: 'contain',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat', backgroundColor: 'red',
              flexShrink: 0,
            }}
          />
        </div>
      </div>

      {/* Body Area */}
      <ErrorBoundary>
        <div>
          {engineChecking ? (
            // Waiting for initial ping — render nothing to prevent Install Engine flash
            null
          ) : !engineReady ? (
            <EngineStatusPanel
              onReady={(info) => { setEngineReady(true); setEngineInfo(info); }}
            />
          ) : (
            <>
              {!fileAccessAllowed && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 16px',
                    borderRadius: 8,
                    background: theme.alertTipBg,
                    border: `1px solid ${theme.alertTipBorder}`,
                    marginBottom: 12,
                    fontSize: 12,
                    color: theme.alertTipText,
                    transition: theme.transition,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>💡</span>
                    <span>
                      Enable <strong>"Allow access to file URLs"</strong> in Chrome settings to view downloads in history.
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      chrome.runtime.sendMessage({ type: 'OPEN_EXTENSIONS_PAGE' });
                    }}
                    style={{
                      background: theme.accentBlue,
                      color: '#fff',
                      border: 'none',
                      padding: '4px 12px',
                      borderRadius: 12,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Configure
                  </button>
                </div>
              )}
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
              {activeTab === 'thumbnail' && (
                <ThumbnailPanel
                  videoId={videoId}
                  videoInfo={videoInfo}
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
