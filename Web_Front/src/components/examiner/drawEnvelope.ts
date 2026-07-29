import type { PlotGeo } from './audioAnalysis';
import { envelopeSlices } from '../../envelopeSlices';

// ADSR envelope overlay: a white dashed attack→decay→sustain→release line with
// markers, positioned in time across the plot.
//
// One curve PER TRANSIENT, not one across the file. A file with several hits has
// several envelopes — drawing a single ADSR over all of them was the visual form
// of the same bug the analyzer had: the "attack" ramp stretched from the start of
// the file to whichever hit happened to be loudest.
export function drawEnvelope(ctx: CanvasRenderingContext2D, item: any, duration: number, geo: PlotGeo) {
  if (duration <= 0) return;
  const slices = envelopeSlices(item);

  if (slices.length) {
    slices.forEach((s) => {
      const start = Number(s.start_seconds) || 0;
      const end = Math.min(duration, Number(s.end_seconds) || duration);
      // Each slice's ADSR is relative to ITS OWN peak, so scale the curve by how
      // loud this slice is against the file — otherwise every hit would draw
      // full-height and the quiet ones would read as loud as the loud one.
      const level = Math.max(0, Math.min(1, Number(s.relative_level ?? 1)));
      drawOne(ctx, geo, duration, start, end, level, {
        att: Number(s.envelope_attack_seconds) || 0,
        dec: Number(s.envelope_decay_seconds) || 0,
        sus: Number(s.envelope_sustain_level) || 0,
        rel: Number(s.envelope_release_seconds) || 0,
      });
    });
    return;
  }

  // No slice array: a legacy .PEAK or a preview-only record. Fall back to the
  // single file-level curve, which is what those records carry.
  const env = item?.envelope ?? {};
  drawOne(ctx, geo, duration, 0, duration, 1, {
    att: Number(env.envelope_attack_seconds ?? env.attack_seconds ?? 0) || 0,
    dec: Number(env.envelope_decay_seconds ?? 0) || 0,
    sus: Number(env.envelope_sustain_level ?? 0) || 0,
    rel: Number(env.envelope_release_seconds ?? 0) || 0,
  });
}

/** One ADSR curve over [start, end], drawn at `level` of full height. */
function drawOne(
  ctx: CanvasRenderingContext2D,
  geo: PlotGeo,
  duration: number,
  start: number,
  end: number,
  level: number,
  adsr: { att: number; dec: number; sus: number; rel: number },
) {
  const { w, mid, halfH } = geo;
  const { att, dec, sus, rel } = adsr;
  const span = end - start;
  if (span <= 0 || !(att || dec || sus || rel)) return;

  const t1 = Math.min(span, att);
  const t2 = Math.min(span, t1 + dec);
  const t3 = Math.max(t2, span - rel);
  const pts: [number, number][] = [[0, 0], [t1, 1], [t2, sus], [t3, sus], [span, 0]];

  const px = (t: number) => ((start + t) / duration) * w;
  const py = (v: number) => mid - v * level * halfH * 0.97;

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  pts.forEach(([t, v], i) => {
    if (i === 0) ctx.moveTo(px(t), py(v)); else ctx.lineTo(px(t), py(v));
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  pts.forEach(([t, v]) => {
    ctx.beginPath();
    ctx.arc(px(t), py(v), 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Beat grid: a coloured dot on every beat (red 1, orange 2, yellow 3, green 4 —
// the downbeat is red and larger), with faint vertical gridlines. `est` marks
// the tempo as estimated rather than read from an ACID tag.
const BEAT_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e'];
export function drawBeats(ctx: CanvasRenderingContext2D, geo: PlotGeo, duration: number, bpm: number, est: boolean) {
  if (!bpm || bpm <= 0 || duration <= 0) return;
  const { w, plotTop, plotBottom } = geo;
  const beat = 60 / bpm;
  // Beat dots ride along the bottom of the plot; the downbeat dot is 2× the radius
  // of the off-beats so beat 1 reads at a glance.
  const R = 3.5;
  const y = plotBottom - 2 * R - 3;
  let i = 0;
  for (let t = 0; t <= duration + 1e-6; t += beat, i++) {
    const x = (t / duration) * w;
    if (x > w) break;
    const down = i % 4 === 0;
    ctx.strokeStyle = down ? 'rgba(239,68,68,0.28)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = down ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, down ? 2 * R : R, 0, Math.PI * 2);
    ctx.fillStyle = BEAT_COLORS[i % 4];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#9ca3af';
  ctx.fillText(`♩ ${bpm}${est ? ' (est)' : ''} BPM`, w - 4, plotTop + 3);
}

// Bottom time axis (seconds) + the sample name at the top-left.
export function drawAxesAndName(ctx: CanvasRenderingContext2D, item: any, duration: number, geo: PlotGeo) {
  const { w, h, plotBottom, padTop } = geo;
  if (duration > 0) {
    const nTicks = 8;
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i <= nTicks; i++) {
      const X = (i / nTicks) * w;
      const t = (i / nTicks) * duration;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.moveTo(X, plotBottom);
      ctx.lineTo(X, plotBottom + 4);
      ctx.stroke();
      ctx.fillStyle = '#999';
      ctx.textAlign = i === 0 ? 'left' : i === nTicks ? 'right' : 'center';
      ctx.fillText(`${t.toFixed(1)}`, Math.max(2, Math.min(w - 2, X)), h - 2);
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#cddc39';
  ctx.fillText(String(item?.name || '').slice(0, 60), 4, padTop - 2);
}
