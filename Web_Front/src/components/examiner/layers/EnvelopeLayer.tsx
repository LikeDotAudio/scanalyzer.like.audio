// Envelope layer: the ADSR overlay — white dashed attack→decay→sustain→release
// polyline with point markers. Full height in stacked mode, per the existing view.

import type { PlotGeo } from '../audioAnalysis';
import { drawEnvelope } from '../drawEnvelope';
import type { ExaminerLayer, LayerData } from './types';

export const EnvelopeLayer: ExaminerLayer = {
  id: 'envelope',
  label: 'envelope',
  legendColour: () => '#e5e7eb',
  domain: 'time',
  defaultPlacement: 'bottom',
  rowHeightWeight: 0.7,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    drawEnvelope(ctx, data.item, data.duration, geo);
  },
};
