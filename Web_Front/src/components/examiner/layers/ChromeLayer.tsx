// Chrome: the always-on frame furniture — beat grid, scan-region colour bar,
// time axis and sample name. Not in the Layers menu; always drawn last on the
// master geometry so axes stay put whatever the stack shows.

import { estimateBpm, type PlotGeo } from '../audioAnalysis';
import { drawAxesAndName, drawBeats } from '../drawEnvelope';
import type { ExaminerLayer, LayerData } from './types';

export const ChromeLayer: ExaminerLayer = {
  id: 'chrome',
  label: 'chrome',
  legendColour: () => '#9ca3af',
  defaultVisible: true,
  defaultPlacement: 'overlay',
  stackLane: 'full',
  rowHeightWeight: 0,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const { item, mono, duration, sampleRate } = data;

    // Beat grid: prefer the record's BPM; estimate in-browser for untagged loops.
    let bpm = Number(item?.musicality?.beats_per_minute) || 0;
    let bpmEst = false;
    if (!bpm && (item?.classification?.timbre === 'Loop' || item?.classification?.length_class === 'Loop')) {
      bpm = estimateBpm(mono, sampleRate);
      bpmEst = bpm > 0;
    }
    drawBeats(ctx, geo, duration, bpm, bpmEst);

    // Scan regions (silence-separated segments) — colour bar along the bottom edge.
    const regs = item?.regions?.regions as { start_seconds: number; end_seconds: number }[] | undefined;
    if (regs && regs.length && duration > 0) {
      const barH = 5;
      const y = geo.plotBottom - barH;
      regs.forEach((r, i) => {
        const x0 = (r.start_seconds / duration) * geo.w;
        const x1 = (r.end_seconds / duration) * geo.w;
        ctx.fillStyle = `hsl(${(i * 47) % 360} 75% 58%)`;
        ctx.fillRect(x0, y, Math.max(1, x1 - x0), barH);
      });
    }

    drawAxesAndName(ctx, item, duration, geo);
  },
};
