// Waveform layer: min/max-per-column amplitude envelope in the sample's group
// colour. Owns the stereo L/R lane split that used to live inline in
// ExaminerTab.renderPreview. Stacked mode: the top pane; rows mode: its own lane.

import type { PlotGeo } from '../audioAnalysis';
import { drawWaveform } from '../drawWaveform';
import type { ExaminerLayer, LayerData } from './types';

export const WaveformLayer: ExaminerLayer = {
  id: 'waveform',
  label: 'waveform',
  legendColour: (data) => data.colours.group,
  domain: 'time',
  defaultPlacement: 'bottom',
  rowHeightWeight: 1.5,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const { buffer, mono, colours } = data;
    if (buffer.numberOfChannels >= 2) {
      // Stereo → two lanes (L top, R bottom) within this layer's band.
      const laneH = geo.plotH / 2;
      const amp = laneH / 2;
      const topMid = geo.plotTop + laneH / 2;
      const botMid = geo.plotTop + laneH * 1.5;
      drawWaveform(ctx, buffer.getChannelData(0), geo, colours.group, topMid, amp);
      drawWaveform(ctx, buffer.getChannelData(1), geo, colours.group, botMid, amp);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, geo.mid + 0.5); ctx.lineTo(geo.w, geo.mid + 0.5); ctx.stroke();
      ctx.fillStyle = colours.group + '99';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('L', 4, topMid - amp + 2);
      ctx.fillText('R', 4, botMid - amp + 2);
    } else {
      drawWaveform(ctx, mono, geo, colours.group);
    }
  },
};
