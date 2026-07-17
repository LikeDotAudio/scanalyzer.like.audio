// Beat markers layer — the BPM grid that used to be baked into the chrome.
// Prefers the record's BPM; estimates in-browser for untagged loops. A scale
// (grid) layer: it rides whichever pane it's placed in and stays out of the legend.

import { estimateBpm, type PlotGeo } from '../audioAnalysis';
import { drawBeats } from '../drawEnvelope';
import type { ExaminerLayer, LayerData } from './types';

export const BeatsLayer: ExaminerLayer = {
  id: 'beats',
  label: 'beat markers',
  legendColour: () => '#EF4444',
  domain: 'time',
  isScale: true,
  defaultPlacement: 'bottom',
  rowHeightWeight: 0.5,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const { item, mono, duration, sampleRate } = data;
    let bpm = Number(item?.musicality?.beats_per_minute) || 0;
    let bpmEst = false;
    if (!bpm && (item?.classification?.timbre === 'Loop' || item?.classification?.length_class === 'Loop')) {
      bpm = estimateBpm(mono, sampleRate);
      bpmEst = bpm > 0;
    }
    drawBeats(ctx, geo, duration, bpm, bpmEst);
  },
};
