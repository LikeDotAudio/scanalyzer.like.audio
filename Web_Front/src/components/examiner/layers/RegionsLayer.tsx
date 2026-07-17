// Extractor markers layer — the scan regions (silence-separated segments) the
// Extractor found, as a colour bar. Used to be baked into the chrome; now a
// layer, so it can sit in either pane or take its own row. In a short row lane
// the bar grows to fill the lane so segments stay readable.

import type { PlotGeo } from '../audioAnalysis';
import type { ExaminerLayer, LayerData } from './types';

export const RegionsLayer: ExaminerLayer = {
  id: 'regions',
  label: 'extractor markers',
  legendColour: () => '#34D399',
  domain: 'time',
  defaultPlacement: 'bottom',
  rowHeightWeight: 0.4,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const { item, duration } = data;
    const regs = item?.regions?.regions as { start_seconds: number; end_seconds: number }[] | undefined;
    if (!regs || !regs.length || duration <= 0) return;
    const barH = geo.plotH <= 40 ? geo.plotH : 5;
    const y = geo.plotBottom - barH;
    regs.forEach((r, i) => {
      const x0 = (r.start_seconds / duration) * geo.w;
      const x1 = (r.end_seconds / duration) * geo.w;
      ctx.fillStyle = `hsl(${(i * 47) % 360} 75% 58%)`;
      ctx.fillRect(x0, y, Math.max(1, x1 - x0), barH);
    });
  },
};
