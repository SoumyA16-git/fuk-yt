import React, { useEffect, useRef, useState, useCallback } from 'react';

const MIN_CLIP_LENGTH = 1; // seconds (CLIP-03)

export interface ClipSelection {
  startTime: number; // seconds
  endTime: number;   // seconds
}

interface ClipTimelineProps {
  duration: number;         // video total duration in seconds
  selection: ClipSelection;
  onSelectionChange: (sel: ClipSelection) => void;
  playbackTime?: number;    // current player position (CLIP-06)
}

/**
 * ClipTimeline — PRD §15 CLIP-01–09
 * Renders as a custom timeline bar (inside our injected panel, not overlaid on
 * the YouTube seek bar — safer and avoids breaking YT controls CLIP-09).
 * Draggable start/end handles with highlighted selection band.
 * Current playback indicator visible independently (CLIP-06).
 */
export function ClipTimeline({
  duration,
  selection,
  onSelectionChange,
  playbackTime = 0,
}: ClipTimelineProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  const toPercent = (sec: number) =>
    duration > 0 ? Math.max(0, Math.min(100, (sec / duration) * 100)) : 0;

  const toSeconds = useCallback(
    (clientX: number): number => {
      const rail = railRef.current;
      if (!rail) return 0;
      const rect = rail.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  // Mouse move handler — updates visual position live during drag (CLIP-04)
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      const sec = toSeconds(e.clientX);

      if (dragging === 'start') {
        // CLIP-01: clamped to [0, endTime − minClipLength]
        const clamped = Math.max(0, Math.min(sec, selection.endTime - MIN_CLIP_LENGTH));
        onSelectionChange({ ...selection, startTime: clamped });
      } else {
        // CLIP-02: clamped to [startTime + minClipLength, duration]
        const clamped = Math.max(selection.startTime + MIN_CLIP_LENGTH, Math.min(sec, duration));
        onSelectionChange({ ...selection, endTime: clamped });
      }
    },
    [dragging, toSeconds, selection, onSelectionChange, duration]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  // Click on rail — CLIP-09: only handle clicks on the handle grab areas, not the rail itself
  // So rail itself does NOT intercept clicks (no seek behavior)

  const startPct = toPercent(selection.startTime);
  const endPct = toPercent(selection.endTime);
  const playPct = toPercent(playbackTime);

  return (
    <div
      id="fyk-clip-timeline"
      className="relative w-full select-none"
      style={{ height: 40, touchAction: 'none' }}
    >
      {/* Background rail */}
      <div
        ref={railRef}
        className="absolute inset-x-0 rounded-full bg-zinc-700"
        style={{ top: 16, height: 8 }}
      >
        {/* Unselected zones */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-full bg-zinc-600"
          style={{ width: `${startPct}%` }}
        />
        {/* Selection band (CLIP-05) */}
        <div
          id="fyk-clip-selection-band"
          className="absolute inset-y-0 bg-red-500/70"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
        />
        {/* Unselected right zone */}
        <div
          className="absolute inset-y-0 right-0 rounded-r-full bg-zinc-600"
          style={{ width: `${100 - endPct}%` }}
        />
      </div>

      {/* Current playback indicator (CLIP-06) — independent of selection band */}
      <div
        id="fyk-clip-playback-cursor"
        className="absolute z-10 pointer-events-none"
        style={{ left: `${playPct}%`, top: 8, width: 2, height: 24, marginLeft: -1 }}
      >
        <div className="w-full h-full bg-white/60 rounded-full" />
      </div>

      {/* Start handle (CLIP-01) */}
      <button
        id="fyk-clip-start-handle"
        aria-label={`Clip start: ${selection.startTime.toFixed(1)}s`}
        className="absolute z-20 flex items-center justify-center rounded-full bg-white shadow-md border-2 border-red-500 cursor-ew-resize hover:scale-110 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        style={{
          left: `${startPct}%`,
          top: 10,
          width: 20,
          height: 20,
          marginLeft: -10,
          touchAction: 'none',
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging('start');
        }}
      />

      {/* End handle (CLIP-02) */}
      <button
        id="fyk-clip-end-handle"
        aria-label={`Clip end: ${selection.endTime.toFixed(1)}s`}
        className="absolute z-20 flex items-center justify-center rounded-full bg-white shadow-md border-2 border-red-500 cursor-ew-resize hover:scale-110 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        style={{
          left: `${endPct}%`,
          top: 10,
          width: 20,
          height: 20,
          marginLeft: -10,
          touchAction: 'none',
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging('end');
        }}
      />
    </div>
  );
}
