// The Examiner layer contract — the Sonic Visualiser Layer::paint() contract in
// TypeScript (see Documentation/Audit/examiner_layer_overlays_audit.md §2).
// A layer never owns its canvas or geometry: both arrive on every draw call, so
// the same layer renders into the stacked view or a private row lane unchanged.

import type { PlotGeo, Spectrum } from '../audioAnalysis';
import type { SpectrogramFrames } from './stft';

// Everything a layer may read, assembled once per decoded selection.
export interface LayerData {
  buffer: AudioBuffer;
  mono: Float32Array;
  left: Float32Array;
  right: Float32Array | null;          // null for mono files
  spectrum: Spectrum | null;           // whole-file averaged trace (computeSpectrum)
  spectrogram: SpectrogramFrames | null; // STFT frames — computed lazily, only when a
                                         // spectrogram-needing layer is visible (SV dormancy)
  item: any;                           // the full .PEAK record
  colours: { group: string; complement: string };
  duration: number;
  sampleRate: number;
}

// Where a layer sits in the stacked (overlay) view. Mirrors today's fixed panes:
// waveform in the top half, loudness/phase in the bottom half, spectrum/envelope
// spanning the full height, the piano keys in a thin strip under the note axis.
export type StackLane = 'full' | 'top' | 'bottom' | 'strip';

export interface ExaminerLayer {
  id: string;
  label: string;                       // dropdown + legend text
  legendColour(data: LayerData): string;
  defaultVisible: boolean;
  defaultPlacement: 'overlay' | 'row';
  stackLane: StackLane;
  rowHeightWeight: number;             // relative lane height in rows mode
  needsStereo?: boolean;               // phase: auto-hidden for mono files
  needsSpectrogram?: boolean;          // first show triggers the lazy STFT
  // Optional background pass (spectrum fill, heat maps) — runs for every visible
  // layer before any foreground draw() so fills sit behind traces.
  underDraw?(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData): void;
  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData): void;
}

// Per-user visibility/placement settings, persisted to localStorage.
export type StackMode = 'stack' | 'rows';
export interface LayerSetting { visible: boolean; placement: 'overlay' | 'row' }
export interface LayerSettings {
  mode: StackMode;
  layers: Record<string, LayerSetting>;
}
