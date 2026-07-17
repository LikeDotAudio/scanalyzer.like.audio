// The Examiner layer contract — the Sonic Visualiser Layer::paint() contract in
// TypeScript (see Documentation/Audit/examiner_layer_overlays_audit.md §2).
// A layer never owns its canvas or geometry: both arrive on every draw call, so
// the same layer renders into the top pane, the bottom pane, or a private row
// lane unchanged.

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

// Which family a layer belongs to. Frequency-domain layers group at the top of
// the menu and are normalled to the top pane; time-domain layers group below
// and are normalled to the bottom pane.
export type LayerDomain = 'frequency' | 'time';

// Where a layer is placed — the three menu columns, plus hidden.
//   top    : composited into the top (frequency) pane
//   bottom : composited into the bottom (time) pane
//   row    : gets its own lane under the panes
//   off    : hidden
export type LayerPlacement = 'top' | 'bottom' | 'row' | 'off';

export interface ExaminerLayer {
  id: string;
  label: string;                       // dropdown + legend text
  legendColour(data: LayerData): string;
  domain: LayerDomain;
  isScale?: boolean;                   // rulers/grids (piano keys, beat grid) — kept out of the legend
  defaultPlacement: LayerPlacement;    // 'off' = hidden by default; panes follow the domain ("normalled")
  rowHeightWeight: number;             // relative lane height in row placement / rows mode
  needsStereo?: boolean;               // phase: auto-hidden for mono files
  needsSpectrogram?: boolean;          // first show triggers the lazy STFT
  // Optional background pass (spectrum fill, heat maps) — runs for every visible
  // layer before any foreground draw() so fills sit behind traces.
  underDraw?(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData): void;
  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData): void;
}

// Per-user placement settings + row order, persisted to localStorage.
export type StackMode = 'stack' | 'rows';
export interface LayerSetting { placement: LayerPlacement }
export interface LayerSettings {
  mode: StackMode;
  layers: Record<string, LayerSetting>;
  order: string[];                     // layer ids; each domain group keeps its own order
  legend: boolean;                     // draw the in-canvas legend (stacked mode)
}
