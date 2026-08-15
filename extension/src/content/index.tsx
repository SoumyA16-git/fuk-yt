/**
 * FUK-YT Content Script
 * - Detects YouTube watch/Shorts pages (FR-01)
 * - Injects DownloaderControls bar below the YouTube player (UI-01, §10/§11)
 * - SPA navigation detection via yt-navigate-finish + scoped MutationObserver (NFR-01)
 * - Gracefully hides if anchor not found; never alters YouTube's native controls (NFR-14)
 * - All native messaging proxied through service worker
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { DownloaderControls } from '@/components/DownloaderControls';
import {
  isWatchPage,
  isShortsPage,
  extractVideoId,
  extractVideoMetadata,
  waitForAnchor,
  watchNavigation,
  watchShortsActions,
} from '@/adapter/YouTubeAdapter';
import { ShortsDownloadButton } from '@/components/ShortsDownloadButton';

// ============================================================
// State
// ============================================================

let mountContainer: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let reactRoot: ReturnType<typeof createRoot> | null = null;
let currentVideoId: string | null = null;
let cleanupNavigation: (() => void) | null = null;

// ============================================================
// Mount / unmount
// ============================================================

async function mountControls(url: string) {
  if (!isWatchPage(url)) {
    unmountControls();
    return;
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    unmountControls();
    return;
  }

  // If container was detached by YouTube's framework re-render, reset state
  if (mountContainer && !mountContainer.isConnected) {
    unmountControls();
  }

  // If already mounted, connected in DOM, and for the same video — keep active
  if (mountContainer && mountContainer.isConnected && shadowRoot && reactRoot && currentVideoId === videoId) {
    return;
  }

  // Different video but container is still in DOM — update React tree
  if (mountContainer && mountContainer.isConnected && shadowRoot && reactRoot && currentVideoId !== videoId) {
    currentVideoId = videoId;
    const metadata = extractVideoMetadata(videoId);
    reactRoot.render(
      React.createElement(DownloaderControls, { videoId, initialMetadata: metadata })
    );
    return;
  }

  // First mount or re-attachment — find injection anchor
  const anchor = await waitForAnchor(10_000);
  if (!anchor) {
    // NFR-14: anchor not found, controls hidden; YouTube unaffected
    console.log('[FUK-YT] Injection anchor not found; big controls hidden (expected on Shorts)');
    return;
  }

  currentVideoId = videoId;

  // Cleanup any orphaned instances from previous script injections
  const existingContainer = document.getElementById('fuk-yt-controls-root');
  if (existingContainer) {
    existingContainer.remove();
  }

  // Create container injected before the anchor element
  mountContainer = document.createElement('div');
  mountContainer.id = 'fuk-yt-controls-root';
  mountContainer.style.cssText = `
    display: block !important;
    width: 100% !important;
    margin: 12px 0 16px 0 !important;
    clear: both !important;
    box-sizing: border-box !important;
    opacity: 1 !important;
    visibility: visible !important;
    transform: none !important;
    transition: none !important;
    position: relative !important;
    z-index: 100 !important;
  `.replace(/\s+/g, ' ');

  // Insert before the anchor element so we appear directly below the player
  anchor.parentNode?.insertBefore(mountContainer, anchor);
  console.log('[FUK-YT] Controls injected successfully before anchor:', anchor);

  // Shadow DOM for complete style isolation
  shadowRoot = mountContainer.attachShadow({ mode: 'closed' });

  // Inject the compiled Tailwind stylesheet into the Shadow DOM so all
  // utility classes work inside the isolated shadow root.
  // The sheet is at /popup.css in the built extension bundle.
  try {
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('popup.css');
    shadowRoot.appendChild(styleLink);
  } catch {
    // If CSS injection fails, the UI is unstyled but functional (NFR-14)
  }

  const mountPoint = document.createElement('div');
  mountPoint.id = 'fuk-yt-mount';
  shadowRoot.appendChild(mountPoint);

  reactRoot = createRoot(mountPoint);
  const metadata = extractVideoMetadata(videoId);
  reactRoot.render(
    React.createElement(DownloaderControls, { videoId, initialMetadata: metadata })
  );
}

function unmountControls() {
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
  if (mountContainer) {
    mountContainer.remove();
    mountContainer = null;
  }
  shadowRoot = null;
  currentVideoId = null;
}

// ============================================================
// Shorts Button Injection
// ============================================================

function injectShortsButton(actionsContainer: Element, renderer: Element) {
  // Prevent double injection
  if (actionsContainer.querySelector('.fuk-yt-shorts-btn-wrapper')) {
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'fuk-yt-shorts-btn-wrapper style-scope ytd-reel-player-overlay-renderer';
  // Use bulletproof CSS to ensure YouTube cannot hide this div
  wrapper.style.cssText = `
    width: 48px !important;
    height: 48px !important;
    min-height: 48px !important;
    margin: 16px 0 !important;
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    visibility: visible !important;
    opacity: 1 !important;
    z-index: 99999 !important;
    pointer-events: auto !important;
    position: relative !important;
    transform: none !important;
    clip-path: none !important;
  `;
  
  // Try to insert above the Like button renderer
  const likeButtonRenderer = actionsContainer.querySelector('ytd-like-button-renderer');
  if (likeButtonRenderer) {
    actionsContainer.insertBefore(wrapper, likeButtonRenderer);
  } else {
    actionsContainer.insertBefore(wrapper, actionsContainer.firstChild);
  }
  
  console.log('[FUK-YT] Injected Shorts Download Button directly into actions container:', actionsContainer);
  
  // Attach Shadow DOM so Tailwind classes work!
  const shadow = wrapper.attachShadow({ mode: 'closed' });
  try {
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('popup.css');
    shadow.appendChild(styleLink);
  } catch (e) {
    console.error('[FUK-YT] Failed to inject styles into Shorts button shadow DOM', e);
  }

  const mountPoint = document.createElement('div');
  // Fill the wrapper
  mountPoint.style.width = '100%';
  mountPoint.style.height = '100%';
  mountPoint.style.display = 'flex';
  mountPoint.style.justifyContent = 'center';
  mountPoint.style.alignItems = 'center';
  shadow.appendChild(mountPoint);
  
  const root = createRoot(mountPoint);
  root.render(
    <ShortsDownloadButton 
      videoIdResolver={() => {
        const urlVid = extractVideoId(window.location.href);
        if (urlVid) return urlVid;

        const rendererVid = renderer.getAttribute('data-video-id') || renderer.id;
        return rendererVid || null;
      }} 
    />
  );
}

function scanAndInjectShorts() {
  if (!isShortsPage(window.location.href)) return;

  const renderers = document.querySelectorAll('ytd-reel-video-renderer');
  
  renderers.forEach((renderer) => {
    // The actual container for the buttons is the #actions div.
    const actionsContainer = renderer.querySelector('#actions');
    if (actionsContainer) {
      injectShortsButton(actionsContainer, renderer);
    }
  });
}

// ============================================================
// SPA navigation watcher (FR-04/07)
// ============================================================

cleanupNavigation = watchNavigation((newUrl) => {
  mountControls(newUrl);
  scanAndInjectShorts();
});

// ============================================================
// Native push relay (jobProgress / jobComplete / jobError → overlay)
// ============================================================

chrome.runtime.onMessage.addListener((message: Record<string, unknown>) => {
  if (!message?.type) return;

  // Forward native push events to window so components can listen reliably
  window.dispatchEvent(
    new CustomEvent('fuk-yt-native-push', {
      detail: message,
    })
  );
  if (mountContainer) {
    mountContainer.dispatchEvent(
      new CustomEvent('fuk-yt-native-push', {
        detail: message,
        bubbles: false,
        composed: true,
      })
    );
  }
});

// ============================================================
// Initial page check & DOM persistence check loop
// ============================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    mountControls(window.location.href);
    scanAndInjectShorts();
  });
} else {
  mountControls(window.location.href);
  scanAndInjectShorts();
}

// Fail-safe persistence loop: Every 500ms, check if we're on a watch page and if our container
// was detached by YouTube re-rendering the DOM tree (e.g. skeleton loading transition).
setInterval(() => {
  if (isWatchPage(window.location.href)) {
    if (!mountContainer || !mountContainer.isConnected) {
      mountControls(window.location.href);
    }
  }
  
  if (isShortsPage(window.location.href)) {
    scanAndInjectShorts();
  }
}, 500);
