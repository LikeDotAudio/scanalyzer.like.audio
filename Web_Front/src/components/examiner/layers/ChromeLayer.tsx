// Chrome: the always-on frame furniture — time axis and sample name. Not in the
// Layers menu; always drawn last on the master geometry so axes stay put
// whatever the stack shows. (Beat grid and extractor regions used to live here;
// they are real layers now — BeatsLayer / RegionsLayer.)

import type { PlotGeo } from '../audioAnalysis';
import { drawAxesAndName } from '../drawEnvelope';
import type { ExaminerLayer, LayerData } from './types';

export const ChromeLayer: ExaminerLayer = {
  id: 'chrome',
  label: 'chrome',
  legendColour: () => '#9ca3af',
  domain: 'time',
  defaultPlacement: 'bottom',
  rowHeightWeight: 0,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    drawAxesAndName(ctx, data.item, data.duration, geo);
  },
};
