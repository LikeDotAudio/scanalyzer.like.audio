import { useRef, useEffect, useCallback, useState } from 'react';
import { type PlotGeo } from '../examiner/audioAnalysis';
import { drawWaveform } from '../examiner/drawWaveform';
import { regionColor, HANDLE_H, type ExtractorRegion } from './shared';

interface WavePlayerProps {
  samples: Float32Array | null;
  length: number;                 // clip length in seconds
  regions: ExtractorRegion[];
  color: string;
  onUpdateRegion: (i: number, patch: Partial<ExtractorRegion>) => void;
  onHoverTime: (t: number | null) => void;
  getProgress: () => number | null; // 0..1 for the playhead, or null to hide it
}

// The linear "wave player": the waveform with per-region spans, in/out boundaries with
// drag handles, fade ramps, a moving playhead, plus mouse-wheel zoom and right-drag pan.
export default function WavePlayer({ samples, length, regions, color, onUpdateRegion, onHoverTime, getProgress }: WavePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  // View window: zoom (1 = whole file) and the time at the left edge.
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  // Left-button edit (move a boundary / drag a fade) vs right-button pan.
  const dragRef = useRef<{ region: number; edge: 'start' | 'end'; mode: 'move' | 'fade' } | null>(null);
  const panRef = useRef<{ x: number; viewStart: number } | null>(null);

  const viewDur = Math.max(1e-3, (length || 1) / zoom);
  const clampStart = useCallback((s: number) => Math.max(0, Math.min(s, Math.max(0, (length || 0) - viewDur))), [length, viewDur]);
  const start = clampStart(viewStart);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(1, Math.floor(canvas.clientWidth || 800));
    const h = Math.max(1, Math.floor(canvas.clientHeight || 200));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, w, h);
    if (!samples || !length) return;

    const pad = 6;
    const geo: PlotGeo = { w, h, padTop: pad, plotTop: pad, plotBottom: h - pad, plotH: Math.max(1, h - 2 * pad), mid: h / 2, halfH: Math.max(1, (h - 2 * pad) / 2) };
    const xOf = (t: number) => ((t - start) / viewDur) * w;

    // Only the visible slice of the file is drawn, stretched across the width.
    const i0 = Math.max(0, Math.floor((start / length) * samples.length));
    const i1 = Math.min(samples.length, Math.ceil(((start + viewDur) / length) * samples.length));

    regions.forEach((r, i) => {
      const x0 = xOf(r.start_seconds), x1 = xOf(r.end_seconds);
      ctx.fillStyle = regionColor(i).replace('58%)', '58% / 0.16)');
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    });
    if (i1 > i0) drawWaveform(ctx, samples.subarray(i0, i1), geo, color);
    regions.forEach((r, i) => {
      const x0 = xOf(r.start_seconds), x1 = xOf(r.end_seconds);
      ctx.strokeStyle = regionColor(i);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, h); ctx.moveTo(x1 - 0.5, 0); ctx.lineTo(x1 - 0.5, h); ctx.stroke();
      ctx.lineWidth = 1;
      const span = r.end_seconds - r.start_seconds;
      if ((r.fade_in_seconds || 0) > 0) { const xf = xOf(r.start_seconds + Math.min(r.fade_in_seconds!, span)); ctx.beginPath(); ctx.moveTo(x0, h / 2); ctx.lineTo(xf, 0); ctx.stroke(); }
      if ((r.fade_out_seconds || 0) > 0) { const xf = xOf(r.end_seconds - Math.min(r.fade_out_seconds!, span)); ctx.beginPath(); ctx.moveTo(xf, 0); ctx.lineTo(x1, h / 2); ctx.stroke(); }
      ctx.fillStyle = regionColor(i);
      ctx.fillRect(x0 - 1, 0, 5, HANDLE_H);
      ctx.fillRect(x1 - 4, h - HANDLE_H, 5, HANDLE_H);
      ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'top';
      ctx.fillText(r.name || `${i + 1}`, x0 + 6, 3);
    });
  }, [samples, length, regions, color, start, viewDur]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // Playhead loop reads getProgress each frame (view-relative position).
  useEffect(() => {
    let id: number;
    const tick = () => {
      const ph = playheadRef.current;
      if (ph) {
        const f = getProgress();
        if (f != null && length) {
          const t = f * length;
          const inView = t >= start && t <= start + viewDur;
          ph.style.left = `${((t - start) / viewDur) * 100}%`;
          ph.style.display = inView ? 'block' : 'none';
        } else ph.style.display = 'none';
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [getProgress, start, viewDur, length]);

  const timeAt = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.max(0, Math.min(length, start + frac * viewDur));
  };
  const boundaryHit = (clientX: number): { region: number; edge: 'start' | 'end' } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const tol = (6 / rect.width) * viewDur; // ~6px in seconds at the current zoom
    const t = timeAt(clientX);
    let best: { region: number; edge: 'start' | 'end' } | null = null, bestD = tol;
    regions.forEach((r, i) => {
      const ds = Math.abs(t - r.start_seconds), de = Math.abs(t - r.end_seconds);
      if (ds < bestD) { bestD = ds; best = { region: i, edge: 'start' }; }
      if (de < bestD) { bestD = de; best = { region: i, edge: 'end' }; }
    });
    return best;
  };
  const aboveCenter = (clientY: number): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    return (clientY - rect.top) < rect.height / 2;
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2) { // right button → pan
      panRef.current = { x: e.clientX, viewStart: start };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    const hit = boundaryHit(e.clientX);
    if (hit) {
      dragRef.current = { ...hit, mode: aboveCenter(e.clientY) ? 'fade' : 'move' };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (panRef.current) {
      const rect = canvas!.getBoundingClientRect();
      const dt = ((e.clientX - panRef.current.x) / rect.width) * viewDur;
      setViewStart(clampStart(panRef.current.viewStart - dt));
      return;
    }
    if (dragRef.current) {
      const t = timeAt(e.clientX);
      const { region, edge, mode } = dragRef.current;
      const r = regions[region];
      if (!r) return;
      const span = r.end_seconds - r.start_seconds;
      if (mode === 'fade') {
        if (edge === 'start') onUpdateRegion(region, { fade_in_seconds: Math.max(0, Math.min(t - r.start_seconds, span)) });
        else onUpdateRegion(region, { fade_out_seconds: Math.max(0, Math.min(r.end_seconds - t, span)) });
      } else if (edge === 'start') onUpdateRegion(region, { start_seconds: Math.max(0, Math.min(t, r.end_seconds - 0.01)) });
      else onUpdateRegion(region, { end_seconds: Math.min(length || t, Math.max(t, r.start_seconds + 0.01)) });
    } else {
      if (canvas) canvas.style.cursor = boundaryHit(e.clientX) ? (aboveCenter(e.clientY) ? 'crosshair' : 'ew-resize') : 'pointer';
      onHoverTime(timeAt(e.clientX));
    }
  };
  const onUp = () => { dragRef.current = null; panRef.current = null; };
  const onLeave = () => { dragRef.current = null; panRef.current = null; onHoverTime(null); };
  const onWheel = (e: React.WheelEvent) => {
    if (!length) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const tCursor = start + frac * viewDur;                 // keep this time under the cursor
    const nextZoom = Math.max(1, Math.min(200, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    const nextDur = (length || 1) / nextZoom;
    setZoom(nextZoom);
    setViewStart(Math.max(0, Math.min(tCursor - frac * nextDur, Math.max(0, length - nextDur))));
  };

  return (
    <div style={{ height: 180, flexShrink: 0, position: 'relative', padding: '0.5rem 0.75rem' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <canvas ref={canvasRef}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave}
          onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
          style={{ width: '100%', height: '100%', display: 'block', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }} />
        <div ref={playheadRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, background: 'rgb(244,144,44)', pointerEvents: 'none', display: 'none' }} />
        {zoom > 1 && (
          <div style={{ position: 'absolute', top: 4, right: 6, fontSize: '0.65rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.5)', padding: '0 4px', borderRadius: 3, pointerEvents: 'none' }}>
            {zoom.toFixed(1)}× · wheel zoom, right-drag pan
          </div>
        )}
      </div>
    </div>
  );
}
