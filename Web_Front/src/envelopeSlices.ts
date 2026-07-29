//! Reading the per-slice ADSR array off a record.
//!
//! The ADSR is peak-relative: attack is 10 %→90 % of THE peak, sustain is a
//! fraction of THE peak. A file with more than one transient has no such peak —
//! its loudest sample is wherever the person recording happened to hit hardest.
//! Measuring against it reports the distance to that hit as an "attack" (a 3 s
//! recording of typing read 2.5 s).
//!
//! So the analyzer cuts the file at its transient onsets and measures one ADSR
//! per slice, each against its own peak. `envelope.slices` is that array, and
//! the file-level `envelope_*` scalars are **null** whenever there is more than
//! one slice. Null means "not measurable at file level" — never zero. Anything
//! that renders a number must therefore decide explicitly what to show, which is
//! what these helpers are for.

export interface EnvelopeSlice {
  index: number;
  start_seconds: number;
  end_seconds: number;
  /** This slice's peak as a fraction of the file's loudest frame (0..1). */
  relative_level: number;
  envelope_attack_seconds: number;
  envelope_decay_seconds: number;
  envelope_sustain_level: number;
  envelope_release_seconds: number;
  envelope_temporal_centroid: number;
  envelope_skewness: number;
  envelope_kurtosis: number;
  envelope_shape: string;
  decay_time_seconds_60db: number | null;
}

/** Every measured slice, in time order. Empty for a record with no slice array
 *  (a legacy .PEAK, or a preview-only record). */
export function envelopeSlices(item: any): EnvelopeSlice[] {
  const s = item?.envelope?.slices;
  return Array.isArray(s) ? s : [];
}

/** True when the file holds more than one event, i.e. when the file-level ADSR
 *  scalars are null by design rather than merely missing. */
export function isMultiEvent(item: any): boolean {
  return envelopeSlices(item).length > 1;
}

/** The loudest slice — the best single-event evidence in the file. */
export function representativeSlice(item: any): EnvelopeSlice | undefined {
  const slices = envelopeSlices(item);
  if (!slices.length) return undefined;
  return slices.reduce((best, s) =>
    (s.relative_level ?? 0) > (best.relative_level ?? 0) ? s : best);
}

/**
 * An ADSR number for display or plotting, and whether it describes the file.
 *
 * `field` is a bare name like `envelope_sustain_level`. Prefers the file-level
 * value; on a multi-event file that is null, so it falls back to the loudest
 * slice — an honest measurement of one real event, which is a far better answer
 * than 0 (0 would pile every loop into the "no sustain" corner of a scatter plot
 * and cluster them by their nullness instead of by their sound).
 *
 * `perFile` says which one you got, so a caller can mark it in the UI.
 */
export function adsrValue(
  item: any,
  field: string,
): { value: number | undefined; perFile: boolean } {
  const fileLevel = item?.envelope?.[field];
  if (typeof fileLevel === 'number' && Number.isFinite(fileLevel)) {
    return { value: fileLevel, perFile: true };
  }
  const rep = representativeSlice(item) as any;
  const v = rep?.[field];
  if (typeof v === 'number' && Number.isFinite(v)) {
    return { value: v, perFile: false };
  }
  return { value: undefined, perFile: false };
}

/** `adsrValue` reduced to a plain number for numeric axes that cannot take
 *  undefined. `fallback` is used only when the record carries no measurement at
 *  all (legacy or preview-only), never merely because the file is multi-event. */
export function adsrNumber(item: any, field: string, fallback = 0): number {
  return adsrValue(item, field).value ?? fallback;
}
