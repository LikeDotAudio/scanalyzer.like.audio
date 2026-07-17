// Notes layer: the detected fundamental and its harmonic series as note markers
// on the frequency axis — pitch math per the audited SV NoteLayer
// (f = 440·2^((midi−69)/12); layers audit §7). Fundamental from the record's
// pitch_hz, falling back to the named root note.

import { noteToFreq, type PlotGeo } from '../audioAnalysis';
import { freqMapper, freqToNoteName } from './freqScale';
import type { ExaminerLayer, LayerData } from './types';

const NOTE_COLOUR = '#A78BFA';

export const NotesLayer: ExaminerLayer = {
  id: 'notes',
  label: 'notes',
  legendColour: () => NOTE_COLOUR,
  domain: 'frequency',
  defaultPlacement: 'off',
  rowHeightWeight: 0.7,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const f0 = Number(data.item?.musicality?.pitch_hz)
      || noteToFreq(data.item?.musicality?.root_note_name)
      || 0;
    if (!(f0 > 0)) return;
    const { xFor, fMin, fMax } = freqMapper(data, geo);

    ctx.font = '600 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let k = 1; k <= 16; k++) {
      const f = f0 * k;
      if (f < fMin) continue;
      if (f > fMax) break;
      const x = xFor(f);
      const strength = Math.pow(0.82, k - 1);
      // Harmonic line, fading up the series.
      ctx.strokeStyle = NOTE_COLOUR;
      ctx.globalAlpha = 0.15 + 0.55 * strength;
      ctx.setLineDash(k === 1 ? [] : [3, 4]);
      ctx.lineWidth = k === 1 ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(x, geo.plotTop); ctx.lineTo(x, geo.plotBottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Note-name chip, two staggered label rows so neighbours don't collide.
      if (k <= 10) {
        const name = freqToNoteName(f);
        const ly = geo.plotTop + 4 + (k % 2) * 12;
        const tw = ctx.measureText(name).width + 6;
        ctx.fillStyle = 'rgba(10,10,14,0.75)';
        ctx.fillRect(x - tw / 2, ly - 1, tw, 11);
        ctx.fillStyle = NOTE_COLOUR;
        ctx.fillText(name, x, ly);
      }
    }
    ctx.lineWidth = 1;
  },
};
