// Circular ("ring") whole-file waveform: the linear min/max peak trace of
// drawWaveform.ts wrapped around a circle instead of laid out left-to-right.
//
// The sound file starts at 0° (the 3 o'clock / right-most position) and wraps
// once, clockwise, back to the start over a full 360°. Each angular column
// draws a radial spoke: the loudest positive peak reaches outward from the
// baseline ring, the loudest negative peak reaches inward — the same min/max
// envelope as the flat waveform, just bent into a circle.

export interface RadialWaveformOpts {
  cx: number;             // ring centre X (device px)
  cy: number;             // ring centre Y (device px)
  innerRadius: number;    // radius the most-negative peak reaches inward to
  outerRadius: number;    // radius the most-positive peak reaches outward to
  color: string;          // '#RRGGBB' — alpha is appended, matching drawWaveform
  bins?: number;          // angular columns (spokes) around the ring
  lineWidth?: number;     // spoke stroke width
  startMarker?: boolean;  // draw a tick at 0° marking where the file starts
}

// Screen-space note: canvas Y grows downward, so increasing the math angle
// sweeps *clockwise* on screen — exactly the direction we want. 0 rad points
// right, so the file's first sample sits at 3 o'clock.
export function drawRadialWaveform(
  ctx: CanvasRenderingContext2D,
  samples: Float32Array,
  opts: RadialWaveformOpts,
) {
  const {
    cx, cy, innerRadius, outerRadius, color,
    bins = 720, lineWidth = 1, startMarker = true,
  } = opts;

  const len = samples.length;
  if (len === 0 || outerRadius <= 0) return;

  // Baseline ring (amplitude 0) sits midway; peaks swing ±reach from it.
  const baseR = (innerRadius + outerRadius) / 2;
  const reach = (outerRadius - innerRadius) / 2;
  const samplesPerBin = len / bins;

  // Faint baseline ring so a near-silent file still reads as a circle.
  ctx.strokeStyle = color + '33';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = color + 'B3';
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * samplesPerBin);
    const end = Math.min(len, Math.floor((b + 1) * samplesPerBin));
    let min = 1.0, max = -1.0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) { min = 0; max = 0; }

    const angle = (b / bins) * Math.PI * 2; // 0 → 2π, clockwise on screen
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const rInner = baseR + min * reach * 0.97; // min ≤ 0 → reaches inward
    const rOuter = baseR + max * reach * 0.97; // max ≥ 0 → reaches outward
    ctx.moveTo(cx + cos * rInner, cy + sin * rInner);
    ctx.lineTo(cx + cos * rOuter, cy + sin * rOuter);
  }
  ctx.stroke();

  // A tick at 0° (right) showing where the file starts and the sweep begins.
  if (startMarker) {
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + innerRadius - reach * 0.15, cy);
    ctx.lineTo(cx + outerRadius + reach * 0.15, cy);
    ctx.stroke();
  }
}
