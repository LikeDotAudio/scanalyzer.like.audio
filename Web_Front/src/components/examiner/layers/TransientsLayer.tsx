// Transients layer: where the analyzer CUT the file, and what it measured in
// each piece.
//
// The ADSR is peak-relative, so it only means anything within a single event.
// The analyzer therefore cuts at every transient onset and measures one envelope
// per slice. This layer draws those cuts — the boundaries themselves, each
// slice's band, and its A/D/S/R — so the numbers in the record can be checked
// against the waveform they came from rather than taken on trust.
//
// Distinct from `regions` (silence-separated extractor markers, which can hold
// several transients each) and from `slices` (frequency-domain spectrum slices).

import type { PlotGeo } from '../audioAnalysis';
import { envelopeSlices, type EnvelopeSlice } from '../../../envelopeSlices';
import type { ExaminerLayer, LayerData } from './types';

const CUT = '#F59E0B';

/** ms with no decimals, s with two — an attack reads in ms, a ring in seconds. */
function ms(v: number): string {
  return v >= 1 ? `${v.toFixed(2)}s` : `${Math.round(v * 1000)}ms`;
}

function label(s: EnvelopeSlice): string {
  return `A ${ms(s.envelope_attack_seconds)} · D ${ms(s.envelope_decay_seconds)}` +
    ` · S ${(s.envelope_sustain_level * 100).toFixed(0)}% · R ${ms(s.envelope_release_seconds)}`;
}

export const TransientsLayer: ExaminerLayer = {
  id: 'transients',
  label: 'transient slices',
  legendColour: () => CUT,
  domain: 'time',
  defaultPlacement: 'bottom',
  rowHeightWeight: 0.5,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    const { item, duration } = data;
    if (duration <= 0) return;
    const slices = envelopeSlices(item);
    if (!slices.length) return;

    const { w, plotTop, plotBottom, plotH } = geo;
    const x = (t: number) => (t / duration) * w;

    ctx.save();

    // Alternating bands, so adjacent slices are visually separable even where a
    // cut lands mid-decay and the waveform gives no clue that one hit ended.
    slices.forEach((s, i) => {
      if (i % 2) return;
      const x0 = x(s.start_seconds);
      const x1 = x(Math.min(duration, s.end_seconds));
      ctx.fillStyle = 'rgba(245,158,11,0.055)';
      ctx.fillRect(x0, plotTop, Math.max(1, x1 - x0), plotH);
    });

    // The cut lines. The first slice starts at t=0 by construction (whatever
    // precedes the first attack is pre-roll and belongs to it), so that boundary
    // is not a detected transient and is not drawn as one.
    ctx.strokeStyle = CUT;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    slices.forEach((s) => {
      if (s.start_seconds <= 0) return;
      const px = Math.round(x(s.start_seconds)) + 0.5;
      ctx.moveTo(px, plotTop);
      ctx.lineTo(px, plotBottom);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // Per-slice chips: index + relative level always; the full ADSR when the
    // slice is wide enough to read it without overlapping the next one.
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    slices.forEach((s, i) => {
      const x0 = x(s.start_seconds);
      const width = x(Math.min(duration, s.end_seconds)) - x0;
      if (width < 14) return;

      const y = plotTop + 3;
      ctx.font = '600 9px ui-monospace, monospace';
      const head = `${i + 1}·${Math.round((s.relative_level ?? 0) * 100)}%`;
      ctx.fillStyle = CUT;
      ctx.fillText(head, x0 + 3, y);

      if (width > 190 && plotH > 18) {
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillStyle = 'rgba(245,158,11,0.75)';
        ctx.fillText(label(s), x0 + 3, y + 11);
        if (plotH > 30) {
          const rt = s.decay_time_seconds_60db;
          ctx.fillStyle = 'rgba(245,158,11,0.55)';
          ctx.fillText(
            `${s.envelope_shape}${rt != null ? ` · ring ${ms(rt)}` : ''}`,
            x0 + 3, y + 22,
          );
        }
      }
    });

    ctx.restore();
  },
};
