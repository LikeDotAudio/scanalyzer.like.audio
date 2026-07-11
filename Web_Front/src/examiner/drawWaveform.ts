import type { PlotGeo } from './audioAnalysis';

// Whole-file waveform: min/max amplitude per pixel column, in the group colour.
export function drawWaveform(ctx: CanvasRenderingContext2D, mono: Float32Array, geo: PlotGeo, color: string) {
  const { w, mid, halfH } = geo;
  const len = mono.length;
  const samplesPerCol = len / w;
  ctx.strokeStyle = color + 'B3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const start = Math.floor(x * samplesPerCol);
    const end = Math.min(len, Math.floor((x + 1) * samplesPerCol));
    let min = 1.0, max = -1.0;
    for (let i = start; i < end; i++) {
      const v = mono[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) { min = 0; max = 0; }
    ctx.moveTo(x + 0.5, mid - max * halfH * 0.97);
    ctx.lineTo(x + 0.5, mid - min * halfH * 0.97);
  }
  ctx.stroke();
}
