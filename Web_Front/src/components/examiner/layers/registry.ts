// The one list — the SV LayerFactory role. Paint order = array order (heat maps
// first as backgrounds, envelope last on top). The Layers menu, the legend, and
// the compositor all derive from this; nothing else enumerates layers.
// Frequency-domain layers group first and are normalled to the top pane; time
// layers follow, normalled to the bottom pane. The user's row order lives in
// LayerSettings.order, one sequence per domain group.

import type { ExaminerLayer, LayerPlacement, LayerSettings } from './types';
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
import { BeatsLayer } from './BeatsLayer';
import { RegionsLayer } from './RegionsLayer';

export const EXAMINER_LAYERS: ExaminerLayer[] = [
  // frequency domain
  SpectrogramLayer,
  Spectrogram3DLayer,
  SpectrumLayer,
  SlicesLayer,
  NotesLayer,
  PianoScaleLayer,
  // time domain
  WaveformLayer,
  LoudnessLayer,
  PhaseLayer,
  EnvelopeLayer,
  BeatsLayer,
  RegionsLayer,
];

const byId = new Map(EXAMINER_LAYERS.map(l => [l.id, l]));
export const layerById = (id: string) => byId.get(id);

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
  beats: 'linear-gradient(90deg, #EF4444, #9ca3af)',
  regions: 'linear-gradient(90deg, #e05c5c, #5ce08a, #5c9ae0)',
};

const LAYERS_KEY = 'scanalyzer_examiner_layers_v2';
const LEGACY_KEY = 'scanalyzer_examiner_layers_v1';
const PLACEMENTS: LayerPlacement[] = ['top', 'bottom', 'row', 'off'];

/** The ids of one domain group, in the user's saved order. */
export function orderedLayers(settings: LayerSettings, domain: 'frequency' | 'time'): ExaminerLayer[] {
  return settings.order
    .map(id => byId.get(id))
    .filter((l): l is ExaminerLayer => !!l && l.domain === domain);
}

/** All layers in display order: frequency group first, then time group. */
export function orderedAllLayers(settings: LayerSettings): ExaminerLayer[] {
  return [...orderedLayers(settings, 'frequency'), ...orderedLayers(settings, 'time')];
}

function defaultOrder(): string[] {
  return EXAMINER_LAYERS.map(l => l.id);
}

export function defaultLayerSettings(): LayerSettings {
  const layers: LayerSettings['layers'] = {};
  for (const l of EXAMINER_LAYERS) layers[l.id] = { placement: l.defaultPlacement };
  return { mode: 'stack', layers, order: defaultOrder(), legend: true };
}

/** Saved order, sanitized: drop unknown ids, append newly added layers. */
function mergeOrder(saved: unknown): string[] {
  const out = Array.isArray(saved) ? saved.filter(id => typeof id === 'string' && byId.has(id)) : [];
  for (const id of defaultOrder()) if (!out.includes(id)) out.push(id);
  return out;
}

export function loadLayerSettings(): LayerSettings {
  const defaults = defaultLayerSettings();
  try {
    const saved = localStorage.getItem(LAYERS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const layers = { ...defaults.layers };
      for (const id of Object.keys(layers)) {
        const p = parsed?.layers?.[id]?.placement;
        if (PLACEMENTS.includes(p)) layers[id] = { placement: p };
      }
      return {
        mode: parsed?.mode === 'rows' ? 'rows' : 'stack',
        layers,
        order: mergeOrder(parsed?.order),
        legend: parsed?.legend !== false,
      };
    }
    // Migrate the v1 shape ({visible, placement:'overlay'|'row'}): visible layers
    // land on their domain's normalled pane, explicit rows stay rows.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      const layers = { ...defaults.layers };
      for (const l of EXAMINER_LAYERS) {
        const s = parsed?.layers?.[l.id];
        if (!s || typeof s.visible !== 'boolean') continue;
        layers[l.id] = {
          placement: !s.visible ? 'off'
            : s.placement === 'row' ? 'row'
            : l.domain === 'frequency' ? 'top' : 'bottom',
        };
      }
      return { mode: parsed?.mode === 'rows' ? 'rows' : 'stack', layers, order: defaultOrder(), legend: true };
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export function saveLayerSettings(settings: LayerSettings) {
  try { localStorage.setItem(LAYERS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

// ---- shared settings store ----
// The 🎚 Layers menu lives in the global footer while the Examiner canvas
// consumes the settings, so they sync through this tiny external store
// (useSyncExternalStore on the React side) instead of prop-drilling across tabs.

let currentSettings: LayerSettings | null = null;
const settingsListeners = new Set<() => void>();

export function getLayerSettings(): LayerSettings {
  if (!currentSettings) currentSettings = loadLayerSettings();
  return currentSettings;
}

export function updateLayerSettings(next: LayerSettings) {
  currentSettings = next;
  saveLayerSettings(next);
  settingsListeners.forEach(l => l());
}

export function subscribeLayerSettings(cb: () => void): () => void {
  settingsListeners.add(cb);
  return () => { settingsListeners.delete(cb); };
}

/** Whether any visible layer needs the lazy STFT — computed only then (SV dormancy). */
export function settingsNeedSpectrogram(settings: LayerSettings): boolean {
  return EXAMINER_LAYERS.some(l => l.needsSpectrogram && settings.layers[l.id]?.placement !== 'off');
}
