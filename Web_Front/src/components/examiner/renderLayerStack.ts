// The compositor: replaces the old monolithic renderPreview drawing. Two modes —
//   stacked : two panes — frequency-domain layers composite into the top pane,
//             time-domain layers into the bottom pane (each layer's placement
//             can override), row-placed layers get their own lanes below;
//   rows    : every visible layer gets its own lane, weight-scaled, sharing the
//             single time axis and playhead.
// Lane order and paint order follow the user's order (LayerSettings.order),
// frequency group first. Geometry is passed to every layer per call and never
// stored — the SV contract.

import type { PlotGeo } from './audioAnalysis';
import { ChromeLayer } from './layers/ChromeLayer';
import { orderedAllLayers } from './layers/registry';
import type { ExaminerLayer, LayerData, LayerSettings } from './layers/types';

const BG = '#0A0A0A';
const PAD_TOP = 26, PAD_BOTTOM = 18;

function laneGeo(w: number, h: number, top: number, bottom: number): PlotGeo {
  const plotH = Math.max(1, bottom - top);
  return { w, h, padTop: PAD_TOP, plotTop: top, plotBottom: bottom, plotH, mid: (top + bottom) / 2, halfH: plotH / 2 };
}

function visibleLayers(data: LayerData, settings: LayerSettings): ExaminerLayer[] {
  return orderedAllLayers(settings).filter(l => {
    if (settings.layers[l.id]?.placement === 'off') return false;
    if (l.needsStereo && !data.right) return false;
    return true;
  });
}

export function renderLayerStack(canvas: HTMLCanvasElement, data: LayerData, settings: LayerSettings) {
  const w = Math.max(1, Math.floor(canvas.clientWidth || 800));
  const h = Math.max(1, Math.floor(canvas.clientHeight || 320));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const master = laneGeo(w, h, PAD_TOP, h - PAD_BOTTOM);
  const visible = visibleLayers(data, settings);

  if (settings.mode === 'rows') {
    renderRows(ctx, master, data, visible);
  } else {
    renderStacked(ctx, master, data, settings, visible);
  }
}

// ---------- stacked (two-pane) mode ----------

function renderStacked(
  ctx: CanvasRenderingContext2D, master: PlotGeo, data: LayerData,
  settings: LayerSettings, visible: ExaminerLayer[],
) {
  const place = (l: ExaminerLayer) => settings.layers[l.id].placement;
  const topLayers = visible.filter(l => place(l) === 'top');
  const bottomLayers = visible.filter(l => place(l) === 'bottom');
  const rowed = visible.filter(l => place(l) === 'row');

  // Row lanes claim the bottom of the plot; the panes keep the rest.
  const rowWeight = rowed.reduce((a, l) => a + l.rowHeightWeight, 0);
  const rowsH = rowed.length ? Math.min(master.plotH * 0.45, 40 + rowWeight * 52) : 0;
  const main = laneGeo(master.w, master.h, master.plotTop, master.plotBottom - rowsH);

  // Two panes: frequency on top, time below. A pane with no layers cedes its
  // half, so a lone group always gets the full height.
  const both = topLayers.length > 0 && bottomLayers.length > 0;
  const mid = main.plotTop + main.plotH / 2;
  const topPane = both ? laneGeo(main.w, main.h, main.plotTop, mid) : main;
  const bottomPane = both ? laneGeo(main.w, main.h, mid, main.plotBottom) : main;

  // Background pass first (spectrum fill, heat maps), then foreground traces,
  // each layer in its own pane. Paint order = the user's row order.
  for (const l of topLayers) l.underDraw?.(ctx, topPane, data);
  for (const l of bottomLayers) l.underDraw?.(ctx, bottomPane, data);
  for (const l of topLayers) l.draw(ctx, topPane, data);
  for (const l of bottomLayers) l.draw(ctx, bottomPane, data);

  // Divider between the frequency pane and the time pane.
  if (both) {
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(main.w, mid + 0.5); ctx.stroke();
  }

  ChromeLayer.draw(ctx, main, data);
  if (settings.legend) drawLegend(ctx, main, data, [...topLayers, ...bottomLayers]);

  // Row lanes below the panes.
  let y = main.plotBottom + 2;
  for (const l of rowed) {
    const lh = (rowsH - 2) * (l.rowHeightWeight / rowWeight) - 3;
    drawRowLane(ctx, data, l, laneGeo(master.w, master.h, y + 2, y + lh - 2), y, lh, master.w);
    y += lh + 3;
  }
}

// ---------- rows mode ----------

function renderRows(ctx: CanvasRenderingContext2D, master: PlotGeo, data: LayerData, visible: ExaminerLayer[]) {
  if (!visible.length) { ChromeLayer.draw(ctx, master, data); return; }
  const weight = visible.reduce((a, l) => a + l.rowHeightWeight, 0) || 1;
  let y = master.plotTop;
  for (const l of visible) {
    const lh = master.plotH * (l.rowHeightWeight / weight) - 3;
    drawRowLane(ctx, data, l, laneGeo(master.w, master.h, y + 2, y + lh - 2), y, lh, master.w);
    y += lh + 3;
  }
  // Shared time axis + name on the master geometry.
  ChromeLayer.draw(ctx, master, data);
}

function drawRowLane(
  ctx: CanvasRenderingContext2D, data: LayerData, layer: ExaminerLayer,
  lane: PlotGeo, top: number, height: number, w: number,
) {
  layer.underDraw?.(ctx, lane, data);
  layer.draw(ctx, lane, data);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, top + 0.5, w - 1, Math.max(1, height - 1));
  ctx.font = '600 9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = layer.legendColour(data);
  ctx.fillText(layer.label.toUpperCase(), w - 5, top + 4);
}

// ---------- legend (stacked mode), generated from the visible layers ----------

function drawLegend(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData, layers: ExaminerLayer[]) {
  const entries = layers
    .filter(l => !l.isScale)           // rulers/grids are self-describing
    .map(l => ({ label: l.label, color: l.legendColour(data) }));
  if (!entries.length) return;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const rowH = 15, sw = 14, padX = 7, gap = 6;
  const boxW = padX * 2 + sw + gap + Math.max(...entries.map(e => ctx.measureText(e.label).width));
  const boxH = padX + entries.length * rowH;
  const bx = geo.w - boxW - 6, by = 4;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, 4); else ctx.rect(bx, by, boxW, boxH);
  ctx.fill();
  ctx.stroke();
  entries.forEach((e, i) => {
    const cy = by + padX / 2 + rowH / 2 + i * rowH;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(bx + padX, cy);
    ctx.lineTo(bx + padX + sw, cy);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(e.label, bx + padX + sw + gap, cy);
  });
  ctx.lineWidth = 1;
  ctx.textAlign = 'left';
}
