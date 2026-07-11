import type { PlotGeo } from './audioAnalysis';

// ADSR envelope overlay: a white dashed attack→decay→sustain→release line with
// markers, positioned in time across the plot.
export function drawEnvelope(ctx: CanvasRenderingContext2D, item: any, duration: number, geo: PlotGeo) {
  const { w, mid, halfH } = geo;
  const att = Number(item?.envelope_attack_seconds ?? item?.attack_seconds ?? 0) || 0;
  const dec = Number(item?.envelope_decay_seconds ?? 0) || 0;
  const sus = Number(item?.envelope_sustain_level ?? 0) || 0;
  const rel = Number(item?.envelope_release_seconds ?? 0) || 0;
  if (duration <= 0 || !(att || dec || sus || rel)) return;

  const t1 = Math.min(duration, att);
  const t2 = Math.min(duration, t1 + dec);
  const t3 = Math.max(t2, duration - rel);
  const pts: [number, number][] = [[0, 0], [t1, 1], [t2, sus], [t3, sus], [duration, 0]];

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  pts.forEach(([t, v], i) => {
    const px = (t / duration) * w;
    const py = mid - v * halfH * 0.97;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  pts.forEach(([t, v]) => {
    const px = (t / duration) * w;
    const py = mid - v * halfH * 0.97;
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fill();
  });
}

// Bottom time axis (seconds) + the sample name at the top-left.
export function drawAxesAndName(ctx: CanvasRenderingContext2D, item: any, duration: number, geo: PlotGeo) {
  const { w, h, plotBottom, padTop } = geo;
  if (duration > 0) {
    const nTicks = 8;
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i <= nTicks; i++) {
      const X = (i / nTicks) * w;
      const t = (i / nTicks) * duration;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.moveTo(X, plotBottom);
      ctx.lineTo(X, plotBottom + 4);
      ctx.stroke();
      ctx.fillStyle = '#999';
      ctx.textAlign = i === 0 ? 'left' : i === nTicks ? 'right' : 'center';
      ctx.fillText(`${t.toFixed(1)}`, Math.max(2, Math.min(w - 2, X)), h - 2);
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#cddc39';
  ctx.fillText(String(item?.name || '').slice(0, 60), 4, padTop - 2);
}
