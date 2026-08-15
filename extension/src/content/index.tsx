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
  wrapper.className = 'fuk-yt-shorts-btn-wrapper';
  // Use cssText with !important to override any YouTube CSS that might hide non-native elements
  wrapper.style.cssText = `
    width: 100% !important;
    min-height: 48px !important;
    margin: 16px 0 !important;
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    z-index: 9999 !important;
  `;
  
  // Try to insert above the Like button, otherwise at the top of actions
  const likeButton = actionsContainer.querySelector('#like-button') || actionsContainer.querySelector('ytd-toggle-button-renderer');
  if (likeButton) {
    actionsContainer.insertBefore(wrapper, likeButton);
  } else {
    actionsContainer.insertBefore(wrapper, actionsContainer.firstChild);
  }
  
  console.log('[FUK-YT] Injected Shorts Download Button into', actionsContainer);
  
  const root = createRoot(wrapper);
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
    // Some versions of YT use #actions, some use different classes.
    // The most reliable anchor is the Like button itself.
    const likeButton = renderer.querySelector('#like-button') || renderer.querySelector('ytd-toggle-button-renderer');
    
    if (likeButton && likeButton.parentElement) {
      const actionsContainer = likeButton.parentElement;
      injectShortsButton(actionsContainer, renderer);
    } else {
      // Fallback if like button isn't found yet
      const actions = renderer.querySelector('#actions');
      if (actions) {
        injectShortsButton(actions, renderer);
      }
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
