// Piano scale layer: a keyboard along the log-frequency axis, guided by the
// Sonic Visualiser PianoScale (layers audit §7): iterate MIDI pitches, place
// each key at f = 440·2^((midi−69)/12), black keys over white, middle C marked.
// Stacked mode: a thin strip under the A-octave note axis; rows mode: its own lane.

import type { PlotGeo } from '../audioAnalysis';
import { freqMapper, midiToFreq } from './freqScale';
import type { ExaminerLayer, LayerData } from './types';

const BLACK = new Set([1, 3, 6, 8, 10]);

export const PianoScaleLayer: ExaminerLayer = {
  id: 'piano',
  label: 'piano scale',
  legendColour: () => '#c9cdd6',
  domain: 'frequency',
  isScale: true,
  defaultPlacement: 'off',
  rowHeightWeight: 0.6,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const { xFor, fMin, fMax } = freqMapper(data, geo);
    const keyH = Math.min(Math.max(10, geo.plotH - 2), 26);
    const y0 = geo.plotTop + 1;

    for (let midi = 12; midi <= 127; midi++) {
      const f = midiToFreq(midi);
      if (f < fMin || f > fMax) continue;
      // Key spans the half-semitone either side of its centre frequency.
      const x0 = xFor(midiToFreq(midi - 0.5));
      const x1 = xFor(midiToFreq(midi + 0.5));
      if (x1 < 0 || x0 > geo.w) continue;
      const black = BLACK.has(midi % 12);
      if (midi === 60) ctx.fillStyle = 'rgba(244,144,44,0.95)';       // middle C
      else ctx.fillStyle = black ? 'rgba(12,14,18,0.95)' : 'rgba(201,205,214,0.85)';
      ctx.fillRect(x0, y0, Math.max(0.6, x1 - x0 - 0.4), black ? keyH * 0.62 : keyH);
    }
    // Baseline under the keys.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y0 + keyH + 0.5); ctx.lineTo(geo.w, y0 + keyH + 0.5); ctx.stroke();
  },
};
