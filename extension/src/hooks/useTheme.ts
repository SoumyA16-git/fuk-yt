import { useState, useEffect } from 'react';

export type ThemeMode = 'dark' | 'light';

export interface ThemeTokens {
  isDark: boolean;
  theme: ThemeMode;
  bg: string;
  cardBg: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  pillBg: string;
  pillBgHover: string;
  pillActiveBg: string;
  pillActiveText: string;
  inputBg: string;
  inputBorder: string;
  cardSubtleBg: string;
  cardSubtleBorder: string;
  badgeBg: string;
  badgeText: string;
  dropdownBg: string;
  dropdownText: string;
  primaryRed: string;
  primaryRedHover: string;
  accentBlue: string;
  alertTipBg: string;
  alertTipBorder: string;
  alertTipText: string;
  timelineRail: string;
  timelineUnselected: string;
  timelineHandle: string;
  divider: string;
  transition: string;
}

const darkTokens: ThemeTokens = {
  isDark: true,
  theme: 'dark',
  bg: '#0f0f0f',
  cardBg: '#0f0f0f',
  border: 'rgba(255, 255, 255, 0.1)',
  text: '#f1f1f1',
  textSecondary: '#aaa',
  textMuted: '#717171',
  pillBg: 'rgba(255, 255, 255, 0.1)',
  pillBgHover: 'rgba(255, 255, 255, 0.18)',
  pillActiveBg: '#f1f1f1',
  pillActiveText: '#0f0f0f',
  inputBg: '#1f1f1f',
  inputBorder: 'rgba(255, 255, 255, 0.15)',
  cardSubtleBg: 'rgba(255, 255, 255, 0.05)',
  cardSubtleBorder: 'rgba(255, 255, 255, 0.08)',
  badgeBg: 'rgba(255, 255, 255, 0.08)',
  badgeText: '#aaa',
  dropdownBg: '#1f1f1f',
  dropdownText: '#f1f1f1',
  primaryRed: '#ff0000',
  primaryRedHover: '#cc0000',
  accentBlue: '#3ea6ff',
  alertTipBg: 'rgba(52, 152, 219, 0.12)',
  alertTipBorder: 'rgba(52, 152, 219, 0.3)',
  alertTipText: '#3ea6ff',
  timelineRail: '#3f3f46',
  timelineUnselected: 'rgba(0, 0, 0, 0.65)',
  timelineHandle: '#ffffff',
  divider: 'rgba(255, 255, 255, 0.08)',
  transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease',
};

const lightTokens: ThemeTokens = {
  isDark: false,
  theme: 'light',
  bg: '#ffffff',
  cardBg: '#ffffff',
  border: '#e5e5e5',
  text: '#0f0f0f',
  textSecondary: '#606060',
  textMuted: '#909090',
  pillBg: '#f2f2f2',
  pillBgHover: '#e5e5e5',
  pillActiveBg: '#0f0f0f',
  pillActiveText: '#ffffff',
  inputBg: '#f9f9f9',
  inputBorder: '#dcdcdc',
  cardSubtleBg: '#f8f9fa',
  cardSubtleBorder: '#e8e8e8',
  badgeBg: '#f2f2f2',
  badgeText: '#606060',
  dropdownBg: '#ffffff',
  dropdownText: '#0f0f0f',
  primaryRed: '#cc0000',
  primaryRedHover: '#990000',
  accentBlue: '#065fd4',
  alertTipBg: '#e9f5fe',
  alertTipBorder: '#b3dbff',
  alertTipText: '#065fd4',
  timelineRail: '#d4d4d8',
  timelineUnselected: 'rgba(255, 255, 255, 0.65)',
  timelineHandle: '#0f0f0f',
  divider: '#e5e5e5',
  transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease',
};

function getYouTubeTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'dark';
  
  // 1. Check YouTube HTML dark attribute (desktop YT sets <html dark="true"> or <html dark>)
  const html = document.documentElement;
  if (html.hasAttribute('dark')) {
    const attr = html.getAttribute('dark');
    if (attr === 'false') return 'light';
    return 'dark';
  }

  // 2. Check <ytd-app> dark attribute or class
  const ytdApp = document.querySelector('ytd-app');
  if (ytdApp && ytdApp.hasAttribute('dark')) {
    return 'dark';
  }

  // 3. Check system media query fallback
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'light';
}

export function useTheme(): ThemeTokens {
  const [theme, setTheme] = useState<ThemeMode>(() => getYouTubeTheme());

  useEffect(() => {
    const updateTheme = () => {
      const current = getYouTubeTheme();
      setTheme(current);
    };

    // Initial sync
    updateTheme();

    // 1. Observe changes to <html> attributes (YouTube toggles 'dark' attribute when Appearance changes)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'dark' || mutation.attributeName === 'class' || mutation.attributeName === 'style')
        ) {
          updateTheme();
          break;
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dark', 'class', 'style'],
    });

    // 2. Observe <ytd-app> if present
    const ytdApp = document.querySelector('ytd-app');
    let ytdObserver: MutationObserver | null = null;
    if (ytdApp) {
      ytdObserver = new MutationObserver(updateTheme);
      ytdObserver.observe(ytdApp, {
        attributes: true,
        attributeFilter: ['dark', 'class'],
      });
    }

    // 3. Listen to system color scheme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => updateTheme();
    mediaQuery.addEventListener?.('change', handleMediaChange);

    return () => {
      observer.disconnect();
      if (ytdObserver) ytdObserver.disconnect();
      mediaQuery.removeEventListener?.('change', handleMediaChange);
    };
  }, []);

  return theme === 'dark' ? darkTokens : lightTokens;
}
