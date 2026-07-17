// Spectrum layer: the whole-file averaged spectral trace in the group colour's
// complement — filled area behind everything (underDraw), trace + A-octave note
// axis + root marker on top (draw). Extracted from drawSpectrum.ts usage.

import type { PlotGeo } from '../audioAnalysis';
import { drawSpectrumFill, drawSpectrumTrace } from '../drawSpectrum';
import type { ExaminerLayer, LayerData } from './types';

export const SpectrumLayer: ExaminerLayer = {
  id: 'spectrum',
  label: 'spectrum',
  legendColour: (data) => data.colours.complement,
  defaultVisible: true,
  defaultPlacement: 'overlay',
  stackLane: 'full',
  rowHeightWeight: 1,

  underDraw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    if (data.spectrum) drawSpectrumFill(ctx, data.spectrum, geo, data.colours.complement);
  },

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    if (data.spectrum) drawSpectrumTrace(ctx, data.spectrum, geo, data.colours.complement, data.item);
  },
};
