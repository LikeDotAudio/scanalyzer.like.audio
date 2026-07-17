import { useRef, useEffect } from 'react';
import { drawRadialWaveform } from './drawRadialWaveform';

// Approx momentary loudness (LUFS-ish) of a short window around a playback fraction.
// This is the ungated BS.1770 mean-square loudness without the K-weighting filter —
// plenty accurate for driving the playhead's colour, and cheap enough to run per-frame.
function loudnessAt(samples: Float32Array, frac: number): number {
  const half = 2048; // ~85 ms at 48 kHz; short enough to "dance", long enough to be stable
  const center = Math.round(frac * samples.length);
  const start = Math.max(0, center - half);
  const end = Math.min(samples.length, center + half);
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  const ms = sum / Math.max(1, end - start);
  if (ms <= 1e-12) return -100;
  return -0.691 + 10 * Math.log10(ms);
}

// Heat ramp for the playhead: white (quiet) → yellow → orange → red hot (loud).
// -50 LUFS and below is white; -20 LUFS and above is full red.
const HEAT_STOPS: [number, [number, number, number]][] = [
  [0.0, [255, 255, 255]],
  [0.45, [255, 236, 120]],
  [0.75, [255, 150, 45]],
  [1.0, [255, 42, 18]],
];
// The complementary ("opposite") colour of a #RGB / #RRGGBB hex — each channel inverted.
// Falls back to white for anything it can't parse.
function invertHex(hex: string): string {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return '#ffffff';
  const inv = (i: number) => (255 - parseInt(h.slice(i, i + 2), 16)).toString(16).padStart(2, '0');
  return `#${inv(0)}${inv(2)}${inv(4)}`;
}

function heatColor(lufs: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (lufs + 50) / 30)); // -50→0, -20→1
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = HEAT_STOPS[i - 1];
      const k = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}

interface RadialWaveformProps {
  // Mono PCM samples of the whole file (e.g. from toMono(audioBuffer)) — or, when
  // samplesRight is also given, the LEFT channel.
  samples: Float32Array | null;
  // Stereo: the RIGHT channel. When present the ring splits down the middle of its
  // band — the outer half traces the left channel in `color`, the inner half traces
  // the right channel in the opposite (inverted) colour.
  samplesRight?: Float32Array | null;
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
  samplesRight = null,
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
  // The playhead loop reads samples through a ref so it stays a stable rAF loop while
  // still colouring itself from whatever waveform is currently loaded.
  const samplesRef = useRef(samples);
  samplesRef.current = samples;
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

    if (samplesRight && samplesRight.length) {
      // Stereo: split the band down the middle — left channel rings the outer half in
      // the base colour, right channel rings the inner half in the opposite colour.
      const midRadius = (innerRadius + outerRadius) / 2;
      drawRadialWaveform(ctx, samples, {
        cx, cy, innerRadius: midRadius, outerRadius, color,
        lineWidth: Math.max(1, dpr),
        startMarker,
        regions,
      });
      drawRadialWaveform(ctx, samplesRight, {
        cx, cy, innerRadius, outerRadius: midRadius, color: invertHex(color),
        lineWidth: Math.max(1, dpr),
        startMarker: false, // the outer band's tick already marks 0°
        regions,
      });
    } else {
      drawRadialWaveform(ctx, samples, {
        cx, cy, innerRadius, outerRadius, color,
        lineWidth: Math.max(1, dpr),
        startMarker,
        regions,
      });
    }

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
  }, [samples, samplesRight, size, color, holeRatio, startMarker, regions]);

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
        const f = Math.max(0, Math.min(1, frac));
        const a = f * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);

        // Colour + heft the playhead by the loudness right under it.
        const s = samplesRef.current;
        const lufs = s && s.length ? loudnessAt(s, f) : -100;
        const [r, g, b] = heatColor(lufs);
        const rgb = `rgb(${r}, ${g}, ${b})`;
        const hot = lufs > -20;             // above -20 LUFS the tip goes red-hot and glows
        const level = Math.max(0, Math.min(1, (lufs + 50) / 30)); // 0 quiet … 1 loud

        // Spoke: thicker than before and swelling a touch with loudness, tinted + softly glowing.
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgb;
        ctx.lineWidth = (3 + level * 2.5) * dpr;
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.9)`;
        ctx.shadowBlur = (4 + level * 10) * dpr;
        ctx.beginPath();
        ctx.moveTo(cx + (innerRadius - 2 * dpr) * ca, cy + (innerRadius - 2 * dpr) * sa);
        ctx.lineTo(cx + (outerRadius + 2 * dpr) * ca, cy + (outerRadius + 2 * dpr) * sa);
        ctx.stroke();

        // Tip dot: red-hot with a strong glow past -20 LUFS, otherwise it follows the heat ramp.
        const dotX = cx + outerRadius * ca, dotY = cy + outerRadius * sa;
        if (hot) {
          ctx.fillStyle = '#ff2810';
          ctx.shadowColor = 'rgba(255, 40, 16, 0.95)';
          ctx.shadowBlur = (14 + level * 12) * dpr;
          ctx.beginPath();
          ctx.arc(dotX, dotY, (4 + level * 2) * dpr, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = rgb;
          ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
          ctx.shadowBlur = (3 + level * 6) * dpr;
          ctx.beginPath();
          ctx.arc(dotX, dotY, (3.5 + level * 1.5) * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
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
            border: 'none', background: 'transparent', color: invertHex(color),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: Math.max(24, btn * 0.8), lineHeight: 1, padding: 0,
          }}
        >{playing ? '■' : '▶'}</button>
      )}
    </div>
  );
}
