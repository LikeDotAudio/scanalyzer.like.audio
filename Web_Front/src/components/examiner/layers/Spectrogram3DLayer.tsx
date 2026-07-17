// 3-D spectrum layer: a ridgeline waterfall — the same STFT frames as the
// spectrogram, drawn as N time slices back-to-front with painter's-algorithm
// occlusion (guided by the SV Colour3DPlot bin math, layers audit §4). The
// earliest slice sits at the back (up-right), the latest at the front; ridge
// colour walks the Sunset palette with time.

import type { PlotGeo } from '../audioAnalysis';
import { sunsetCss } from './colourScale';
import { freqMapper } from './freqScale';
import type { ExaminerLayer, LayerData } from './types';

const RIDGES = 22;
const FLOOR_DB = -70;

export const Spectrogram3DLayer: ExaminerLayer = {
  id: 'spectrum3d',
  label: '3d spectrum',
  legendColour: () => sunsetCss(0.62),
  defaultVisible: false,
  defaultPlacement: 'row',
  stackLane: 'full',
  rowHeightWeight: 2,
  needsSpectrogram: true,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const sg = data.spectrogram;
    if (!sg || sg.frameCount < 2) return;

    const depthX = geo.w * 0.06;
    const depthY = geo.plotH * 0.42;
    const ridgeW = geo.w - depthX;
    const ridgeH = geo.plotH - depthY - 6;
    const { fMin, fMax } = freqMapper(data, geo);
    const lf0 = Math.log(fMin), lf1 = Math.log(fMax);
    const framesPerRidge = sg.frameCount / RIDGES;

    // Back (earliest, offset up-right) first; front (latest) last, occluding.
    for (let s = 0; s < RIDGES; s++) {
      const back = 1 - s / (RIDGES - 1);            // 1 = earliest/back, 0 = latest/front
      const ox = back * depthX;
      const base = geo.plotBottom - (1 - back) * depthY - 3;
      const fr0 = Math.floor(s * framesPerRidge);
      const fr1 = Math.max(fr0 + 1, Math.floor((s + 1) * framesPerRidge));

      ctx.beginPath();
      for (let x = 0; x < ridgeW; x++) {
        const f = Math.exp(lf0 + (x / ridgeW) * (lf1 - lf0));
        const bin = Math.max(0, Math.min(sg.bins - 1, Math.round((f * sg.fftSize) / sg.sampleRate)));
        // Max across this ridge's time span — the never-average invariant again.
        let m = 0;
        for (let fr = fr0; fr < fr1 && fr < sg.frameCount; fr++) {
          const v = sg.magnitudes[fr * sg.bins + bin];
          if (v > m) m = v;
        }
        const db = 20 * Math.log10(Math.max(m / sg.peak, 1e-6));
        const y = base - Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB)) * ridgeH;
        if (x === 0) ctx.moveTo(x + ox, y); else ctx.lineTo(x + ox, y);
      }
      // Close down to the baseline and fill with the ground colour → occlusion.
      ctx.lineTo(ridgeW - 1 + ox, base);
      ctx.lineTo(ox, base);
      ctx.closePath();
      ctx.fillStyle = '#0A0A0A';
      ctx.fill();
      ctx.strokeStyle = sunsetCss(0.25 + 0.6 * (1 - back));
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },
};
