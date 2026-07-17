// Loudness ("volume") layer: windowed-RMS level curve in dBFS over time,
// floor −60 dB. Stacked mode: the bottom pane, as today.

import type { PlotGeo } from '../audioAnalysis';
import { drawLoudness } from '../drawOverlays';
import type { ExaminerLayer, LayerData } from './types';

export const LOUDNESS_COLOUR = '#FCD34D';

export const LoudnessLayer: ExaminerLayer = {
  id: 'loudness',
  label: 'volume',
  legendColour: () => LOUDNESS_COLOUR,
  defaultVisible: true,
  defaultPlacement: 'overlay',
  stackLane: 'bottom',
  rowHeightWeight: 1,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    drawLoudness(ctx, data.mono, geo, LOUDNESS_COLOUR);
  },
};
