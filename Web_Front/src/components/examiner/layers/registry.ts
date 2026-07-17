// The one list — the SV LayerFactory role. Paint order = array order (heat maps
// first as backgrounds, envelope last on top). The Layers menu, the legend, and
// the compositor all derive from this; nothing else enumerates layers.

import type { ExaminerLayer, LayerSettings } from './types';
import { SpectrogramLayer } from './SpectrogramLayer';
import { Spectrogram3DLayer } from './Spectrogram3DLayer';
import { WaveformLayer } from './WaveformLayer';
import { SpectrumLayer } from './SpectrumLayer';
import { LoudnessLayer } from './LoudnessLayer';
import { PhaseLayer } from './PhaseLayer';
import { SlicesLayer } from './SlicesLayer';
import { NotesLayer } from './NotesLayer';
import { PianoScaleLayer } from './PianoScaleLayer';
import { EnvelopeLayer } from './EnvelopeLayer';

export const EXAMINER_LAYERS: ExaminerLayer[] = [
  SpectrogramLayer,
  Spectrogram3DLayer,
  WaveformLayer,
  SpectrumLayer,
  LoudnessLayer,
  PhaseLayer,
  SlicesLayer,
  NotesLayer,
  PianoScaleLayer,
  EnvelopeLayer,
];

// Static swatch colours for the menu (legend colours can depend on the sample's
// group colour, which the menu doesn't have).
export const MENU_SWATCHES: Record<string, string> = {
  spectrogram: 'linear-gradient(90deg, #31114d, #e05c1a, #ffd97a)',
  spectrum3d: 'linear-gradient(90deg, #7a2b12, #ffb35c)',
  waveform: '#6fa8d6',
  spectrum: '#7fd6e2',
  loudness: '#FCD34D',
  phase: '#FB7185',
  slices: '#34D399',
  notes: '#A78BFA',
  piano: '#c9cdd6',
  envelope: '#e5e7eb',
};

const LAYERS_KEY = 'scanalyzer_examiner_layers_v1';

export function defaultLayerSettings(): LayerSettings {
  const layers: LayerSettings['layers'] = {};
  for (const l of EXAMINER_LAYERS) {
    layers[l.id] = { visible: l.defaultVisible, placement: l.defaultPlacement };
  }
  return { mode: 'stack', layers };
}

export function loadLayerSettings(): LayerSettings {
  const defaults = defaultLayerSettings();
  try {
    const saved = localStorage.getItem(LAYERS_KEY);
    if (!saved) return defaults;
    const parsed = JSON.parse(saved);
    // Merge over defaults so newly added layers appear with their defaults.
    const layers = { ...defaults.layers };
    for (const id of Object.keys(layers)) {
      const s = parsed?.layers?.[id];
      if (s && typeof s.visible === 'boolean') {
        layers[id] = { visible: s.visible, placement: s.placement === 'row' ? 'row' : 'overlay' };
      }
    }
    return { mode: parsed?.mode === 'rows' ? 'rows' : 'stack', layers };
  } catch {
    return defaults;
  }
}

export function saveLayerSettings(settings: LayerSettings) {
  try { localStorage.setItem(LAYERS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

/** Whether any visible layer needs the lazy STFT — computed only then (SV dormancy). */
export function settingsNeedSpectrogram(settings: LayerSettings): boolean {
  return EXAMINER_LAYERS.some(l => l.needsSpectrogram && settings.layers[l.id]?.visible);
}
