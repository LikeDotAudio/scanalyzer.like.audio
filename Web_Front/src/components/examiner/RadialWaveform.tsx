import { useRef, useEffect } from 'react';
import { drawRadialWaveform } from './drawRadialWaveform';

interface RadialWaveformProps {
  // Mono PCM samples of the whole file (e.g. from toMono(audioBuffer)).
  samples: Float32Array | null;
  // Square edge length of the widget in CSS px.
  size?: number;
  // Ring colour ('#RRGGBB'); alpha is applied internally.
  color?: string;
  // Fraction of the radius left hollow in the centre (0–1).
  holeRatio?: number;
  // Draw the 0°/start tick (rgb(244,144,44)) at the 3 o'clock position.
  startMarker?: boolean;
  // When provided, a play/stop button sits in the hollow centre of the ring.
  onPlay?: () => void;
  // Reflects playback state so the centre button shows ▶ or ■.
  playing?: boolean;
  // Coloured arcs drawn just outside the ring, one per region. start/end are
  // fractions of the file (0 = 0°/right, 1 = full turn), matching the waveform.
  regions?: { start: number; end: number; color: string }[];
  // Current playback position as a fraction of the file (0..1), or null to hide the
  // playhead. Polled every frame on a separate overlay canvas, so the heavy waveform
  // underneath is never redrawn just to move the playhead.
  getProgress?: () => number | null;
  // Click / drag anywhere on the ring to seek: reports the fraction (0..1) under the
  // pointer. The centre hole (the play button) is excluded.
  onScrub?: (fraction: number) => void;
  // Fires as the pointer moves over the ring (fraction 0..1), and null on leave — used
  // to loop the region under the cursor.
  onHover?: (fraction: number | null) => void;
  className?: string;
  style?: React.CSSProperties;
}

// A self-contained circular waveform. Drop it in anywhere you have mono
// samples: the file starts at 0° (right) and wraps clockwise through 360°.
export default function RadialWaveform({
  samples,
  size = 180,
  color = '#f4902c',
  // No hollow centre: the spokes reach all the way in. The play button below floats
  // over the middle at a fixed size rather than filling a hole.
  holeRatio = 0,
  startMarker = true,
  onPlay,
  playing = false,
  regions,
  getProgress,
  onScrub,
  onHover,
  className,
  style,
}: RadialWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLCanvasElement>(null);
  // getProgress changes identity each render; read it through a ref so the rAF loop
  // below is set up once and never resubscribes.
  const getProgressRef = useRef(getProgress);
  getProgressRef.current = getProgress;
  const draggingRef = useRef(false);

  // Ring geometry in device px — shared by the waveform draw, the playhead and the
  // pointer maths so they always agree.
  const geom = () => {
    const dpr = window.devicePixelRatio || 1;
    const dim = size * dpr;
    const outerRadius = dim / 2 - 6 * dpr; // small margin for the marker
    return { dpr, dim, cx: dim / 2, cy: dim / 2, outerRadius, innerRadius: outerRadius * holeRatio };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { dpr, dim, cx, cy, outerRadius, innerRadius } = geom();
    canvas.width = dim;
    canvas.height = dim;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!samples || samples.length === 0) return;

    drawRadialWaveform(ctx, samples, {
      cx, cy, innerRadius, outerRadius, color,
      lineWidth: Math.max(1, dpr),
      startMarker,
      regions,
    });

    // Region arcs sit just outside the ring — each spans its slice of the file.
    if (regions && regions.length) {
      const arcR = outerRadius + 3 * dpr;
      ctx.lineWidth = 3 * dpr;
      for (const r of regions) {
        // Fraction → angle; 0 rad is 3 o'clock and the sweep runs clockwise,
        // exactly like the waveform beneath it.
        const a0 = r.start * Math.PI * 2;
        const a1 = r.end * Math.PI * 2;
        ctx.strokeStyle = r.color;
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, a0, a1);
        ctx.stroke();
      }
    }
  }, [samples, size, color, holeRatio, startMarker, regions]);

  // Playhead loop: a spoke from inner→outer radius at the current-time angle, redrawn
  // every frame on the overlay canvas only. Runs for the life of the widget.
  useEffect(() => {
    const canvas = playheadRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let id: number;
    const tick = () => {
      const { dpr, dim, cx, cy, outerRadius, innerRadius } = geom();
      if (canvas.width !== dim) { canvas.width = dim; canvas.height = dim; }
      ctx.clearRect(0, 0, dim, dim);
      const frac = getProgressRef.current?.();
      if (frac != null && Number.isFinite(frac)) {
        const a = Math.max(0, Math.min(1, frac)) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(cx + (innerRadius - 2 * dpr) * ca, cy + (innerRadius - 2 * dpr) * sa);
        ctx.lineTo(cx + (outerRadius + 2 * dpr) * ca, cy + (outerRadius + 2 * dpr) * sa);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx + outerRadius * ca, cy + outerRadius * sa, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [size, holeRatio]);

  // Pointer → fraction, or null when inside the hollow centre (the play button) or
  // outside the ring's neighbourhood.
  const fractionAt = (clientX: number, clientY: number): number | null => {
    const host = playheadRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const dx = clientX - rect.left - rect.width / 2;
    const dy = clientY - rect.top - rect.height / 2;
    const dist = Math.hypot(dx, dy);
    const outerCss = size / 2 - 6;
    const innerCss = outerCss * holeRatio;
    if (dist < innerCss) return null; // the centre hole belongs to the play button
    let a = Math.atan2(dy, dx);
    if (a < 0) a += Math.PI * 2;
    return a / (Math.PI * 2);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!onScrub) return;
    const f = fractionAt(e.clientX, e.clientY);
    if (f == null) return; // let the centre button handle its own clicks
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onScrub(f);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const f = fractionAt(e.clientX, e.clientY);
    if (draggingRef.current && onScrub) {
      if (f != null) onScrub(f);
    } else {
      onHover?.(f); // f is null over the centre hole → clears the hover loop
    }
  };
  const endDrag = () => { draggingRef.current = false; };
  const onLeave = () => { draggingRef.current = false; onHover?.(null); };

  // Diameter of the central play button. Fixed to the widget size (not the hole, which
  // may be zero) so it stays a usable target and floats over the centre of the spokes.
  const btn = Math.round(size * 0.2);

  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, ...style }}>
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
      <canvas
        ref={playheadRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onLeave}
        style={{
          position: 'absolute', top: 0, left: 0, width: size, height: size, display: 'block',
          cursor: onScrub ? 'pointer' : 'default',
          // Let the centre button (rendered above) receive its own clicks.
          pointerEvents: (onScrub || onHover) ? 'auto' : 'none',
        }}
      />
      {onPlay && (
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          title={playing ? 'Stop' : 'Play'}
          style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: btn, height: btn, borderRadius: '50%', cursor: 'pointer', zIndex: 1,
            border: 'none', background: 'transparent', color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: Math.max(12, btn * 0.4), lineHeight: 1, padding: 0,
          }}
        >{playing ? '■' : '▶'}</button>
      )}
    </div>
  );
}
