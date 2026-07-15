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
  // Draw the green 0°/start tick at the 3 o'clock position.
  startMarker?: boolean;
  // When provided, a play/stop button sits in the hollow centre of the ring.
  onPlay?: () => void;
  // Reflects playback state so the centre button shows ▶ or ■.
  playing?: boolean;
  // Coloured arcs drawn just outside the ring, one per region. start/end are
  // fractions of the file (0 = 0°/right, 1 = full turn), matching the waveform.
  regions?: { start: number; end: number; color: string }[];
  className?: string;
  style?: React.CSSProperties;
}

// A self-contained circular waveform. Drop it in anywhere you have mono
// samples: the file starts at 0° (right) and wraps clockwise through 360°.
export default function RadialWaveform({
  samples,
  size = 180,
  color = '#f4902c',
  holeRatio = 0.35,
  startMarker = true,
  onPlay,
  playing = false,
  regions,
  className,
  style,
}: RadialWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Render at device-pixel resolution so the spokes stay crisp on HiDPI.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!samples || samples.length === 0) return;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const outerRadius = (size * dpr) / 2 - 6 * dpr; // small margin for the marker
    const innerRadius = outerRadius * holeRatio;
    drawRadialWaveform(ctx, samples, {
      cx, cy, innerRadius, outerRadius, color,
      lineWidth: Math.max(1, dpr),
      startMarker,
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

  // Diameter of the central button so it sits inside the ring's hollow core.
  const btn = Math.round(size * holeRatio * 1.15);

  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, ...style }}>
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
      {onPlay && (
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          title={playing ? 'Stop' : 'Play'}
          style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: btn, height: btn, borderRadius: '50%', cursor: 'pointer',
            border: `1px solid ${color}`, background: 'rgba(0,0,0,0.55)', color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: Math.max(12, btn * 0.4), lineHeight: 1, padding: 0,
          }}
        >{playing ? '■' : '▶'}</button>
      )}
    </div>
  );
}
