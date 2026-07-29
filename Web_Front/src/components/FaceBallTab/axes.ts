//! The feature vocabulary the 4D ball can place samples by.
//!
//! The ball used to offer nine axes. A `.PEAK` record carries around seventy
//! numeric fields, so the view was showing a fraction of what it holds — and the
//! most interesting ones (spectral entropy, stationarity, voicing, the whole
//! bioacoustic-syntax group) were not reachable at all.
//!
//! Everything here is a plain number per record. Fields that can be `null` —
//! the peak-relative ADSR terms on a multi-event file, the morphology group on
//! anything too short to measure — read through `adsrNumber` or fall back, so a
//! missing value lands a sample at the centre of the axis rather than at one end.

import { adsrNumber } from '../../envelopeSlices';

export interface AxisGroup {
  label: string;
  axes: string[];
}

type Reader = (it: any) => number;

const num = (v: any): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
/** MFCC coefficient `i`; c0 is overall loudness so the useful ones start at 1. */
const mfcc = (i: number): Reader => (it) =>
  num(it?.spectral_features?.mel_frequency_cepstral_coefficients?.[i]);
/** Chroma bin — how much of the file sits on one pitch class. */
const chroma = (i: number): Reader => (it) => num(it?.musicality?.chromagram?.[i]);

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Every axis, by display name. Grouped below for the dropdown. */
export const AXES: Record<string, Reader> = {
  // ---- shape in time
  'Length': (it) => num(it?.metadata?.length_seconds),
  'Transients': (it) => num(it?.envelope?.transient_count),
  'Onset rate': (it) => num(it?.envelope?.onset_rate_per_second),
  'Onset periodicity': (it) => num(it?.envelope?.onset_periodicity),
  'Attack': (it) => adsrNumber(it, 'envelope_attack_seconds'),
  'Decay': (it) => adsrNumber(it, 'envelope_decay_seconds'),
  'Sustain': (it) => adsrNumber(it, 'envelope_sustain_level'),
  'Release': (it) => adsrNumber(it, 'envelope_release_seconds'),
  'Temporal centroid': (it) => adsrNumber(it, 'envelope_temporal_centroid'),
  'Envelope skew': (it) => adsrNumber(it, 'envelope_skewness'),
  'Envelope kurtosis': (it) => adsrNumber(it, 'envelope_kurtosis'),
  'Sustain ratio': (it) => num(it?.envelope?.sustain_ratio),
  'Decay to −60 dB': (it) => adsrNumber(it, 'decay_time_seconds_60db'),
  'Trailing silence': (it) => num(it?.metadata?.trailing_silence_ms),

  // ---- shape in frequency
  'Brightness': (it) => num(it?.spectral_features?.spectral_centroid_hz),
  'Brightness drift': (it) => num(it?.spectral_features?.spectral_centroid_slope_hz_per_second),
  'Brightness spread': (it) => num(it?.spectral_features?.spectral_centroid_deviation_hz),
  'Rolloff': (it) => num(it?.spectral_features?.spectral_rolloff_hz),
  'Flatness': (it) => num(it?.spectral_features?.spectral_flatness),
  'Spectral entropy': (it) => num(it?.spectral_features?.spectral_entropy),
  'Spectral tilt': (it) => num(it?.spectral_features?.spectral_slope_db_per_octave),
  'Band limit': (it) => num(it?.spectral_features?.band_limit_high_hz),
  'Complexity': (it) => num(it?.spectral_features?.complexity),
  'Spectral flux': (it) => num(it?.spectral_features?.spectral_flux),
  'Low band': (it) => num(it?.spectral_features?.low_band_energy),
  'Mid band': (it) => num(it?.spectral_features?.mid_band_energy),
  'High band': (it) => num(it?.spectral_features?.high_band_energy),
  'Zero crossings': (it) => num(it?.spectral_features?.zero_crossings_per_second),

  // ---- what is vibrating
  'Harmonicity': (it) => num(it?.spectral_features?.harmonicity),
  'Inharmonicity': (it) => num(it?.spectral_features?.inharmonicity),
  'Partial count': (it) => num(it?.spectral_features?.partial_count),
  'Stationarity': (it) => num(it?.spectral_features?.stationarity),
  'Voicing': (it) => num(it?.spectral_features?.voicing_ratio),
  'Syllabic energy': (it) => num(it?.spectral_features?.syllabic_modulation_energy),
  'Distortion (THD)': (it) => num(it?.spectral_features?.total_harmonic_distortion),
  'Clipping': (it) => num(it?.spectral_features?.clipping_density),

  // ---- level
  'RMS': (it) => num(it?.spectral_features?.root_mean_square_level),
  'LUFS': (it) => num(it?.spectral_features?.lufs),
  'Crest factor': (it) => num(it?.spectral_features?.crest_factor),
  // Side over mid: 0 is mono, higher is wider. Computed rather than stored.
  'Stereo width': (it) => {
    const mid = num(it?.spectral_features?.mid_rms);
    const side = num(it?.spectral_features?.side_rms);
    return mid > 0 ? side / mid : NaN;
  },
  'DC offset': (it) => Math.abs(num(it?.metadata?.dc_offset)),

  // ---- pitch
  'Pitch': (it) => num(it?.musicality?.pitch_hz),
  'Pitch drift': (it) => num(it?.musicality?.pitch_slope_semitones_per_second),
  'Root note': (it) => num(it?.musicality?.root_midi_note),
  'Detune (cents)': (it) => num(it?.musicality?.root_cents_offset),
  'Tempo': (it) => num(it?.musicality?.beats_per_minute),

  // ---- sequence (the bioacoustic-syntax group)
  'Slices': (it) => num(it?.bioacoustic_syntax?.slice_count),
  'Vocabulary size': (it) => num(it?.bioacoustic_syntax?.type_count),
  'Syntax information': (it) => num(it?.bioacoustic_syntax?.syntactic_information_bits),
  'Determinism': (it) => num(it?.bioacoustic_syntax?.determinism),
  'Repeat ratio': (it) => num(it?.bioacoustic_syntax?.repeat_ratio),
  'Gap regularity': (it) => num(it?.bioacoustic_syntax?.gap_regularity),
  'Bound ratio': (it) => num(it?.bioacoustic_syntax?.bound_ratio),
  'Type separation': (it) => num(it?.bioacoustic_syntax?.type_separation),
  'Regions': (it) => num(it?.regions?.count),

  // ---- provenance
  'UCS confidence': (it) => num(it?.ucs?.confidence),
  'Cluster': (it) => num(it?.unsupervised?.cluster),
  'Sample rate': (it) => num(it?.metadata?.sample_rate),
  'Bit depth': (it) => num(it?.metadata?.bit_depth),
  'Channels': (it) => num(it?.metadata?.channels),
};

// Timbral fingerprint and pitch-class content, added programmatically so the
// list above stays readable.
for (let i = 1; i <= 6; i++) AXES[`MFCC ${i}`] = mfcc(i);
for (let i = 0; i < 12; i++) AXES[`Chroma ${NOTE[i]}`] = chroma(i);

/** Dropdown grouping, so sixty options stay navigable. */
export const AXIS_GROUPS: AxisGroup[] = [
  { label: 'Time', axes: ['Length', 'Transients', 'Onset rate', 'Onset periodicity', 'Attack', 'Decay', 'Sustain', 'Release', 'Temporal centroid', 'Envelope skew', 'Envelope kurtosis', 'Sustain ratio', 'Decay to −60 dB', 'Trailing silence'] },
  { label: 'Frequency', axes: ['Brightness', 'Brightness drift', 'Brightness spread', 'Rolloff', 'Flatness', 'Spectral entropy', 'Spectral tilt', 'Band limit', 'Complexity', 'Spectral flux', 'Low band', 'Mid band', 'High band', 'Zero crossings'] },
  { label: 'Material', axes: ['Harmonicity', 'Inharmonicity', 'Partial count', 'Stationarity', 'Voicing', 'Syllabic energy', 'Distortion (THD)', 'Clipping'] },
  { label: 'Level', axes: ['RMS', 'LUFS', 'Crest factor', 'Stereo width', 'DC offset'] },
  { label: 'Pitch', axes: ['Pitch', 'Pitch drift', 'Root note', 'Detune (cents)', 'Tempo'] },
  { label: 'Sequence', axes: ['Slices', 'Vocabulary size', 'Syntax information', 'Determinism', 'Repeat ratio', 'Gap regularity', 'Bound ratio', 'Type separation', 'Regions'] },
  { label: 'Timbre (MFCC)', axes: ['MFCC 1', 'MFCC 2', 'MFCC 3', 'MFCC 4', 'MFCC 5', 'MFCC 6'] },
  { label: 'Pitch class', axes: NOTE.map((n) => `Chroma ${n}`) },
  { label: 'Provenance', axes: ['UCS confidence', 'Cluster', 'Sample rate', 'Bit depth', 'Channels'] },
];

export const AXIS_NAMES = Object.keys(AXES);

/**
 * Which features weight a face's CORNERS.
 *
 * A pentagon has five corners and a hexagon six, and a sample has far more than
 * the three numbers the spatial axes can spend. Weight each corner by a feature
 * and place the sample at the weighted average of the corners it scores highest
 * on, and its position within the face becomes readable: a sample pinned at one
 * corner is dominated by that quality, one in the middle is balanced across all
 * of them. Six more dimensions, at no cost in screen space.
 *
 * Each scheme lists six features in corner order. A pentagon uses the first
 * five, which is why the sixth in each list is the most expendable.
 */
export const CORNER_SCHEMES: Record<string, string[]> = {
  'Off': [],
  'Spectral balance': ['Low band', 'Mid band', 'High band', 'Flatness', 'Brightness', 'Rolloff'],
  'Envelope': ['Attack', 'Decay', 'Sustain', 'Release', 'Temporal centroid', 'Transients'],
  'Timbre (MFCC)': ['MFCC 1', 'MFCC 2', 'MFCC 3', 'MFCC 4', 'MFCC 5', 'MFCC 6'],
  'Material': ['Harmonicity', 'Inharmonicity', 'Stationarity', 'Voicing', 'Distortion (THD)', 'Flatness'],
  'Sequence': ['Slices', 'Vocabulary size', 'Determinism', 'Repeat ratio', 'Gap regularity', 'Bound ratio'],
  'Pitch class': ['Chroma C', 'Chroma D', 'Chroma E', 'Chroma G', 'Chroma A', 'Chroma B'],
};

export const CORNER_SCHEME_NAMES = Object.keys(CORNER_SCHEMES);

/**
 * Normalize a feature across the loaded set to [-1, 1].
 *
 * Robust to outliers on purpose: a single 20 kHz band-limit or a −70 LUFS silent
 * file would otherwise compress every other sample into a sliver at one end, so
 * the range is taken from the 2nd/98th percentile and values beyond it clamp.
 *
 * `sign` of -1 flips the axis. A feature only has a direction by convention —
 * "bright at the top" is a choice, not a fact — and being able to invert one is
 * how you get a scatter to open up instead of piling into a corner.
 *
 * An unmeasurable value reads as 0, the centre: absent is not "lowest".
 */
export function normalizer(data: any[], name: string, sign: 1 | -1 = 1): (it: any) => number {
  const get = AXES[name] ?? (() => NaN);
  const values: number[] = [];
  for (const it of data) {
    const v = get(it);
    if (Number.isFinite(v)) values.push(v);
  }
  if (values.length < 2) return () => 0;
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * q)))];
  let lo = at(0.02);
  let hi = at(0.98);
  if (!(hi > lo)) { lo = values[0]; hi = values[values.length - 1]; }
  const range = hi - lo || 1;
  return (it) => {
    const v = get(it);
    if (!Number.isFinite(v)) return 0;
    const t = ((v - lo) / range) * 2 - 1;
    return sign * Math.max(-1, Math.min(1, t));
  };
}
