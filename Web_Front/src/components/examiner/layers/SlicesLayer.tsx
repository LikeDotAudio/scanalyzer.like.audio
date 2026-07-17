// Slices layer: instantaneous spectrum slices at anchor times through the file —
// the Sonic Visualiser SliceLayer idea (layers audit §5): one column of the
// time×frequency surface, log-frequency x, peak-normalized dB y. Three anchors
// (25% / 50% / 75%) show how the spectrum evolves; brightness ramps with time.

import { fftRadix2, type PlotGeo } from '../audioAnalysis';
import { freqMapper } from './freqScale';
import type { ExaminerLayer, LayerData } from './types';

const SLICE_COLOUR = '#34D399';
const ANCHORS = [0.25, 0.5, 0.75];
const FFT_SIZE = 4096;
const FLOOR_DB = -90;

function sliceMagnitudes(mono: Float32Array, centre: number): Float64Array | null {
  const n = mono.length;
  if (n < 512) return null;
  const size = Math.min(FFT_SIZE, 1 << Math.floor(Math.log2(n)));
  const start = Math.max(0, Math.min(n - size, Math.round(centre * n - size / 2)));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    re[i] = mono[start + i] * w;
  }
  fftRadix2(re, im);
  const half = size >> 1;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return mag;
}

export const SlicesLayer: ExaminerLayer = {
  id: 'slices',
  label: 'slices',
  legendColour: () => SLICE_COLOUR,
  domain: 'time',
  defaultPlacement: 'off',
  rowHeightWeight: 1,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const { mono, sampleRate, duration } = data;
    const slices = ANCHORS.map(a => sliceMagnitudes(mono, a)).filter((s): s is Float64Array => !!s);
    if (!slices.length) return;

    // Shared peak across the anchors, so relative level differences survive.
    let peak = 0;
    for (const s of slices) for (let k = 1; k < s.length; k++) if (s[k] > peak) peak = s[k];
    if (peak <= 0) return;

    const { fFor } = freqMapper(data, geo);
    ctx.font = '600 9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    slices.forEach((mag, si) => {
      const half = mag.length - 1;
      const size = half * 2;
      const alpha = 0.35 + 0.3 * si;                 // later slices brighter
      ctx.strokeStyle = SLICE_COLOUR;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = 0; x < geo.w; x++) {
        // Pixel column → frequency → bin span; take the max, never the average.
        const f = fFor(x);
        const fNext = fFor(x + 1);
        const b0 = Math.max(1, Math.min(half, Math.floor((f * size) / sampleRate)));
        const b1 = Math.max(b0 + 1, Math.min(half + 1, Math.ceil((fNext * size) / sampleRate)));
        let m = 0;
        for (let k = b0; k < b1; k++) if (mag[k] > m) m = mag[k];
        const db = 20 * Math.log10(Math.max(m / peak, 1e-6));
        const y = geo.plotBottom - Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB)) * geo.plotH * 0.96;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Anchor time chip.
      ctx.globalAlpha = Math.min(1, alpha + 0.25);
      ctx.fillStyle = SLICE_COLOUR;
      ctx.fillText(`${(ANCHORS[si] * duration).toFixed(2)}s`, 5 + si * 52, geo.plotTop + 4);
    });
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  },
};
