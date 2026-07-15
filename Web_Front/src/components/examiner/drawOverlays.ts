// Two time-domain traces drawn on top of the waveform in the Examiner preview:
//   • loudness — a windowed-RMS level curve (dBFS) over time, and
//   • phase    — the inter-channel correlation of a stereo file over time.
// Both share the waveform's x-axis (time 0…duration → 0…w) so they line up with
// the peaks beneath them. No DOM/React here — pure canvas, like drawSpectrum.

import { type PlotGeo } from './audioAnalysis';

// Floor for the loudness curve. Frames quieter than this pin to the bottom of the
// plot rather than diving to −∞ (log of a near-silent RMS).
const LOUDNESS_FLOOR_DB = -60;

/** Windowed-RMS loudness, one value per pixel column, mapped [FLOOR…0] dB → the
 *  full plot height (quiet at the bottom, loud at the top) and stroked as a line.
 *  This is the "level of loudness" riding over the waveform's instantaneous peaks. */
export function drawLoudness(ctx: CanvasRenderingContext2D, mono: Float32Array, geo: PlotGeo, color: string) {
  const { w, plotTop, plotBottom, plotH } = geo;
  const n = mono.length;
  if (n === 0 || w < 2) return;

  const yDb = (db: number) => plotBottom - Math.max(0, Math.min(1, (db - LOUDNESS_FLOOR_DB) / -LOUDNESS_FLOOR_DB)) * plotH;

  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((x / w) * n);
    const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n));
    let sumSq = 0;
    for (let i = i0; i < i1 && i < n; i++) sumSq += mono[i] * mono[i];
    const rms = Math.sqrt(sumSq / Math.max(1, i1 - i0));
    const db = rms > 0 ? 20 * Math.log10(rms) : LOUDNESS_FLOOR_DB;
    const y = yDb(db);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color + 'E6';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('loudness', w - 4, 14);
}

/** Inter-channel phase over time: per-column normalised correlation of L and R,
 *  in [−1…+1], mapped so +1 (mono / in-phase) sits at the top, 0 at the centre
 *  line, and −1 (out-of-phase, a mono-fold cancellation risk) at the bottom.
 *  Only meaningful for stereo — the caller guards on numberOfChannels ≥ 2. */
export function drawPhase(ctx: CanvasRenderingContext2D, left: Float32Array, right: Float32Array, geo: PlotGeo, color: string) {
  const { w, mid, halfH } = geo;
  const n = Math.min(left.length, right.length);
  if (n === 0 || w < 2) return;

  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((x / w) * n);
    const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n));
    let lr = 0, ll = 0, rr = 0;
    for (let i = i0; i < i1 && i < n; i++) {
      lr += left[i] * right[i];
      ll += left[i] * left[i];
      rr += right[i] * right[i];
    }
    const denom = Math.sqrt(ll * rr);
    const corr = denom > 1e-12 ? lr / denom : 0; // silent window → treat as centred
    const y = mid - Math.max(-1, Math.min(1, corr)) * halfH;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color + 'E6';
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('phase', w - 4, 26);
}
