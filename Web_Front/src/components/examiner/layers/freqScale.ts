// Shared log-frequency ↔ x mapping for the frequency-domain layers (spectrum,
// piano, notes, slices, spectrograms), matched to the spectrum trace's own
// mapper so every frequency mark lands on the same x. Falls back to
// [20 Hz, Nyquist] when no averaged spectrum exists.

import type { PlotGeo } from '../audioAnalysis';
import type { LayerData } from './types';

export interface FreqMapper {
  fMin: number;
  fMax: number;
  xFor(f: number): number;
  fFor(x: number): number;
}

export function freqMapper(data: LayerData, geo: PlotGeo): FreqMapper {
  const fx = data.spectrum?.fx;
  const fMin = fx && fx.length ? fx[0] : 20;
  const fMax = fx && fx.length ? fx[fx.length - 1] : Math.max(1000, data.sampleRate / 2);
  const lf0 = Math.log(fMin);
  const lf1 = Math.log(fMax);
  return {
    fMin, fMax,
    xFor: (f: number) => ((Math.log(f) - lf0) / (lf1 - lf0)) * geo.w,
    fFor: (x: number) => Math.exp(lf0 + (x / geo.w) * (lf1 - lf0)),
  };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Nearest scientific-pitch note name for a frequency: f = 440·2^((midi−69)/12). */
export function freqToNoteName(f: number): string {
  if (!(f > 0)) return '';
  const midi = Math.round(69 + 12 * Math.log2(f / 440));
  if (midi < 0 || midi > 127) return '';
  return NOTE_NAMES[midi % 12] + String(Math.floor(midi / 12) - 1);
}

/** MIDI pitch → frequency (the audited SV NoteLayer equation). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
