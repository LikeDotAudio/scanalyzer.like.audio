import { noteToFreq, type PlotGeo, type Spectrum } from './audioAnalysis';

// Log-frequency ↔ x and dB ↔ y mappers for a given spectrum + plot geometry.
function mappers(spec: Spectrum, geo: PlotGeo) {
  const { fx } = spec;
  const lf0 = Math.log(fx[0]);
  const lf1 = Math.log(fx[fx.length - 1]);
  const xFreq = (f: number) => ((Math.log(f) - lf0) / (lf1 - lf0)) * geo.w;
  const yDb = (db: number) => geo.plotBottom - Math.max(0, Math.min(1, (db + 90) / 90)) * geo.plotH;
  return { xFreq, yDb };
}

// The filled area under the spectral trace, drawn behind the waveform.
export function drawSpectrumFill(ctx: CanvasRenderingContext2D, spec: Spectrum, geo: PlotGeo, color: string) {
  const { xFreq, yDb } = mappers(spec, geo);
  const { fx, fy } = spec;
  ctx.beginPath();
  ctx.moveTo(xFreq(fx[0]), geo.plotBottom);
  for (let i = 0; i < fx.length; i++) ctx.lineTo(xFreq(fx[i]), yDb(fy[i]));
  ctx.lineTo(xFreq(fx[fx.length - 1]), geo.plotBottom);
  ctx.closePath();
  ctx.fillStyle = color + '2E';
  ctx.fill();
}

// The spectral trace line, A-octave note axis (top), "spectrum" label, and the
// root-note fundamental marker — drawn on top of the waveform.
export function drawSpectrumTrace(ctx: CanvasRenderingContext2D, spec: Spectrum, geo: PlotGeo, color: string, item: any) {
  const { xFreq, yDb } = mappers(spec, geo);
  const { fx, fy } = spec;
  const { w, plotTop, plotBottom } = geo;

  ctx.beginPath();
  for (let i = 0; i < fx.length; i++) {
    const X = xFreq(fx[i]), Y = yDb(fy[i]);
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  }
  ctx.strokeStyle = color + 'F2';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Top axis: A-octave note series (A4 = 440 Hz), note above / frequency below.
  const f0 = fx[0], f1 = fx[fx.length - 1];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '9px sans-serif';
  for (let oct = 0; oct < 10; oct++) {
    const f = 27.5 * Math.pow(2, oct);
    if (f < f0 || f > f1) continue;
    const X = xFreq(f);
    if (oct % 2 === 0) {
      ctx.strokeStyle = 'rgba(211,211,211,0.10)';
      ctx.beginPath();
      ctx.moveTo(X, plotTop);
      ctx.lineTo(X, plotBottom);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(127,214,226,0.5)';
    ctx.beginPath();
    ctx.moveTo(X, plotTop);
    ctx.lineTo(X, plotTop - 4);
    ctx.stroke();
    const flabel = f >= 1000 ? `${+(f / 1000).toPrecision(3)}k` : `${Math.round(f)}`;
    ctx.fillStyle = '#7fd6e2';
    ctx.fillText(`A${oct}`, X, 2);
    ctx.fillStyle = 'rgba(127,214,226,0.7)';
    ctx.fillText(flabel, X, 12);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = color;
  ctx.fillText('spectrum', w - 4, 2);

  // Root-note fundamental as a vertical marker on the frequency axis.
  const rf = noteToFreq(item?.root_note_name);
  if (rf && rf >= f0 && rf <= f1) {
    const X = xFreq(rf);
    ctx.strokeStyle = 'rgba(168,85,247,0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(X, plotTop);
    ctx.lineTo(X, plotBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(196,150,255,0.95)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(`root ${item.musicality.root_note_name}`, Math.min(X + 3, w - 62), plotTop + 3);
  }
}
