// Spectrogram layer — the waterfall frequency view. STFT heat map guided by the
// audited SV SpectrogramLayer (layers audit §3-4): frequency = bin·sr/fftSize,
// log-frequency y, peak-normalized dB through the ported colour chain with the
// reserved background index, and the renderer invariant that reductions
// max-aggregate — a transient is never averaged away at any zoom.

import type { PlotGeo } from '../audioAnalysis';
import { makeColourScale } from './colourScale';
import { freqMapper } from './freqScale';
import type { ExaminerLayer, LayerData } from './types';

const BG: [number, number, number] = [10, 10, 10];   // matches the canvas ground

export const SpectrogramLayer: ExaminerLayer = {
  id: 'spectrogram',
  label: 'waterfall freq',
  legendColour: () => '#E8964A',
  defaultVisible: false,
  defaultPlacement: 'overlay',
  stackLane: 'full',
  rowHeightWeight: 2,
  needsSpectrogram: true,

  // Background pass: the heat map sits behind every trace.
  underDraw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const sg = data.spectrogram;
    if (!sg) return;
    const w = Math.max(1, Math.floor(geo.w));
    const h = Math.max(1, Math.floor(geo.plotH));
    const scale = makeColourScale(sg.peak, -80);
    const { fMin, fMax } = freqMapper(data, geo);

    // Precompute column → frame span and row → bin (SV binforx / binfory).
    const frameFor = new Int32Array(w + 1);
    for (let x = 0; x <= w; x++) {
      frameFor[x] = Math.min(sg.frameCount, Math.floor((x / w) * sg.frameCount));
    }
    const binFor = new Int32Array(h);
    const lf0 = Math.log(fMin), lf1 = Math.log(fMax);
    for (let y = 0; y < h; y++) {
      // y=0 is the top of the lane → highest frequency.
      const f = Math.exp(lf1 - (y / h) * (lf1 - lf0));
      const bin = Math.round((f * sg.fftSize) / sg.sampleRate);
      binFor[y] = Math.max(0, Math.min(sg.bins - 1, bin));
    }

    const img = ctx.createImageData(w, h);
    const d = img.data;
    const t = scale.table;
    for (let x = 0; x < w; x++) {
      const f0 = frameFor[x];
      const f1 = Math.max(f0 + 1, frameFor[x + 1]);
      for (let y = 0; y < h; y++) {
        const bin = binFor[y];
        // Many frames per pixel → max-aggregate, never average.
        let m = 0;
        for (let fr = f0; fr < f1 && fr < sg.frameCount; fr++) {
          const v = sg.magnitudes[fr * sg.bins + bin];
          if (v > m) m = v;
        }
        const pix = scale.pixelFor(m);
        const i = (y * w + x) * 4;
        if (pix === 0) { d[i] = BG[0]; d[i + 1] = BG[1]; d[i + 2] = BG[2]; d[i + 3] = 255; }
        else {
          const p = pix * 4;
          d[i] = t[p]; d[i + 1] = t[p + 1]; d[i + 2] = t[p + 2]; d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, Math.round(geo.plotTop));
  },

  draw() { /* heat map is background-only; traces belong to other layers */ },
};
