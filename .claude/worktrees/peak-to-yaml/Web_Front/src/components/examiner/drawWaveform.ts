import type { PlotGeo } from './audioAnalysis';

// Whole-file waveform: min/max amplitude per pixel column, in the group colour.
// Draws one channel into a vertical band centred on `centerY` with `halfHeight`
// vertical reach. Defaults to the full plot (geo.mid / geo.halfH) so the mono
// call site is unchanged; stereo passes a half-height band per channel.
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  samples: Float32Array,
  geo: PlotGeo,
  color: string,
  centerY: number = geo.mid,
  halfHeight: number = geo.halfH,
) {
  const { w } = geo;
  const len = samples.length;
  const samplesPerCol = len / w;
  ctx.strokeStyle = color + 'B3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const start = Math.floor(x * samplesPerCol);
    const end = Math.min(len, Math.floor((x + 1) * samplesPerCol));
    let min = 1.0, max = -1.0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) { min = 0; max = 0; }
    ctx.moveTo(x + 0.5, centerY - max * halfHeight * 0.97);
    ctx.lineTo(x + 0.5, centerY - min * halfHeight * 0.97);
  }
  ctx.stroke();
}
