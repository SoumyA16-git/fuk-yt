/**
 * YouTubeAdapter — PRD §10 FR-01–07
 * ALL YouTube-DOM-coupled code lives ONLY here.
 * Never import YouTube DOM selectors anywhere else in the codebase.
 */

// ============================================================
// FR-01: URL Detection
// ============================================================

/** Returns true if the URL is a supported YouTube watch or Shorts page */
export function isWatchPage(url: string): boolean {
  return /youtube\.com\/(watch(\?v=|\/)|shorts\/[^?#/]+)/.test(url);
}

/** Returns true if this is a Shorts page */
export function isShortsPage(url: string): boolean {
  return /youtube\.com\/shorts\//.test(url);
}

// ============================================================
// FR-02: Video ID extraction
// ============================================================

/** Extracts the videoId from a YouTube watch/Shorts URL */
export function extractVideoId(url: string): string | null {
  // watch?v=
  const watchMatch = url.match(/[?&]v=([^&#]+)/);
  if (watchMatch) return watchMatch[1];

  // /shorts/<id>
  const shortsMatch = url.match(/\/shorts\/([^?#/]+)/);
  if (shortsMatch) return shortsMatch[1];

  return null;
}

// ============================================================
// FR-03: Video metadata extraction
// ============================================================

export interface VideoMetadataDom {
  videoId: string;
  title: string;
  channel: string;
  duration: number; // seconds
  thumbnail: string;
}

/**
 * Extracts video metadata from ytInitialPlayerResponse (injected by YouTube into the page).
 * Falls back to DOM queries. Called at nav time, not polled.
 */
export function extractVideoMetadata(videoId: string): VideoMetadataDom | null {
  try {
    // Primary: ytInitialPlayerResponse (injected by YouTube)
    const ipr = (window as unknown as Record<string, unknown>)['ytInitialPlayerResponse'] as Record<string, unknown> | undefined;
    if (ipr) {
      const details = (ipr['videoDetails'] as Record<string, unknown> | undefined);
      if (details) {
        const title = (details['title'] as string) || '';
        const author = (details['author'] as string) || '';
        const lengthStr = (details['lengthSeconds'] as string) || '0';
        const duration = parseInt(lengthStr, 10);
        const thumbnails = (details['thumbnail'] as Record<string, unknown> | undefined)?.['thumbnails'] as Array<{ url: string; width?: number }> | undefined;
        const thumbnail = thumbnails?.[thumbnails.length - 1]?.url ?? '';

        if (title && duration) {
          return { videoId, title, channel: author, duration, thumbnail };
        }
      }
    }
  } catch { /* fall through */ }

  // Fallback: DOM queries
  try {
    const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata');
    const title = titleEl?.textContent?.trim() ?? '';

    const channelEl = document.querySelector(
      'ytd-channel-name a, #owner #channel-name a, #upload-info ytd-channel-name a'
    );
    const channel = channelEl?.textContent?.trim() ?? '';

    const videoEl = document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
    const duration = videoEl?.duration ?? 0;

    const thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    if (title) {
      return { videoId, title, channel, duration: Math.floor(duration), thumbnail };
    }
  } catch { /* ignore */ }

  return null;
}

// ============================================================
// FR-05: Control bar injection anchor
// ============================================================

/**
 * Finds the DOM node immediately below the YouTube player control bar.
 * Primary: the row inside #below (watch pages) or equivalent Shorts container.
 * Returns null if not found — caller must handle graceful hide (NFR-14).
 */
export function findControlBarAnchor(): Element | null {
  if (isShortsPage(window.location.href)) {
    return null; // Do not inject the big DownloaderControls bar on Shorts pages
  }
  // 1. Modern YouTube Watch Page: #above-the-fold inside #primary-inner
  const aboveFold = document.querySelector('#primary-inner #above-the-fold, #above-the-fold');
  if (aboveFold && aboveFold.isConnected && !aboveFold.hasAttribute('hidden')) {
    return aboveFold;
  }

  // 2. Metadata / Below container
  const below = document.querySelector('ytd-watch-metadata, #below');
  if (below && below.isConnected) return below;

  // 3. Primary Inner column root
  const primaryInner = document.querySelector('#primary-inner');
  if (primaryInner && primaryInner.isConnected) return primaryInner;

  // 4. Shorts (disabled for the big bar, handled by watchShortsActions instead)
  // const shorts = document.querySelector('ytd-shorts');
  // if (shorts) return shorts;

  return null;
}

/**
 * Waits for the injection anchor to appear in the DOM.
 * Resolves with the element or null after maxMs.
 */
export function waitForAnchor(maxMs = 10_000): Promise<Element | null> {
  const anchor = findControlBarAnchor();
  if (anchor) return Promise.resolve(anchor);

  return new Promise((resolve) => {
    const start = Date.now();
    const obs = new MutationObserver(() => {
      const el = findControlBarAnchor();
      if (el) {
        obs.disconnect();
        resolve(el);
      } else if (Date.now() - start > maxMs) {
        obs.disconnect();
        resolve(null);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(findControlBarAnchor()); }, maxMs);
  });
}

// ============================================================
// Shorts Feed Action Bar Observer
// ============================================================

/**
 * Observes the DOM for newly added Shorts (#actions inside ytd-reel-video-renderer).
 * Calls onActionsFound(actionsContainer, videoRenderer) when a new one is discovered.
 */
export function watchShortsActions(
  onActionsFound: (actionsContainer: Element, renderer: Element) => void
): () => void {
  // Find already rendered ones
  const existingRenderers = document.querySelectorAll('ytd-reel-video-renderer');
  existingRenderers.forEach((renderer) => {
    const actions = renderer.querySelector('#actions');
    if (actions) onActionsFound(actions, renderer);
  });

  const obs = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          // Check if the added node is the renderer itself
          if (node.tagName.toLowerCase() === 'ytd-reel-video-renderer') {
            const actions = node.querySelector('#actions');
            if (actions) onActionsFound(actions, node);
          } 
          // Check if the added node contains the renderer or actions
          else if (node.querySelectorAll) {
            const renderers = node.querySelectorAll('ytd-reel-video-renderer');
            renderers.forEach((renderer) => {
              const actions = renderer.querySelector('#actions');
              if (actions) onActionsFound(actions, renderer);
            });
            // Sometimes just #actions is added dynamically inside an existing renderer
            if (node.id === 'actions' && node.closest('ytd-reel-video-renderer')) {
              onActionsFound(node, node.closest('ytd-reel-video-renderer')!);
            }
          }
        }
      }
    }
  });

  obs.observe(document.documentElement, { childList: true, subtree: true });
  return () => obs.disconnect();
}

// ============================================================
// FR-06: Playback time / duration
// ============================================================

/** Returns the current video element's playback position in seconds */
export function getPlaybackTime(): number {
  const video = document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
  return video?.currentTime ?? 0;
}

/** Returns the video element's total duration in seconds */
export function getVideoDuration(): number {
  const video = document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
  return video?.duration ?? 0;
}

/** Pauses the YouTube video player */
export function pauseVideo(): void {
  const video = document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
  if (video && !video.paused) {
    video.pause();
  }
}

/** Seeks the YouTube video player to a specific timestamp in seconds (live frame preview) */
export function seekVideo(seconds: number): void {
  const video = document.querySelector('video.html5-main-video') as HTMLVideoElement | null;
  if (video && !isNaN(seconds) && isFinite(seconds)) {
    video.currentTime = seconds;
  }
}

// ============================================================
// FR-04/07: SPA navigation helper
// ============================================================

/**
 * Returns a cleanup function.
 * Calls onNavigation(url) whenever YouTube SPA navigation is detected.
 * Primary: yt-navigate-finish event.
 * Fallback: MutationObserver scoped to #content (NFR-01), debounced 150ms.
 */
export function watchNavigation(onNavigation: (url: string) => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastHref = window.location.href;

  function fireNavigation() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onNavigation(window.location.href);
    }, 150);
  }

  // Primary YouTube SPA navigation events
  window.addEventListener('yt-navigate-finish', fireNavigation);
  window.addEventListener('yt-page-data-updated', fireNavigation);
  window.addEventListener('popstate', fireNavigation);

  // Poll URL every 500ms as fail-safe backup for SPA transitions
  const pollInterval = setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      fireNavigation();
    }
  }, 500);

  // Fallback: MutationObserver scoped to #content (NFR-01)
  const contentRoot = document.querySelector('#content') ?? document.documentElement;
  const obs = new MutationObserver(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      fireNavigation();
    }
  });
  obs.observe(contentRoot, { childList: true, subtree: true });

  return () => {
    window.removeEventListener('yt-navigate-finish', fireNavigation);
    window.removeEventListener('yt-page-data-updated', fireNavigation);
    window.removeEventListener('popstate', fireNavigation);
    clearInterval(pollInterval);
    obs.disconnect();
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}
