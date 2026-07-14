//! Reading .PEAK files written by any analyzer version.
//!
//! Analyzer 0.1.0 wrote every field at the top level of the record. The current
//! analyzer groups them (`metadata`, `classification`, `envelope`, ...), and the
//! whole UI reads through those groups. A flat record therefore has no
//! `metadata` and blows up the first time anything touches `item.metadata.name`.
//!
//! `normalizePeakRecords` re-groups a flat record into the current shape. Fields
//! the old analyzer never computed (see `LEGACY_MIGRATION_GAPS`) stay absent, so
//! they read as undefined and render blank rather than as a plausible zero.

/** Read a grouped field by dotted path, e.g. `spectral_features.harmonicity`.
 *  Returns undefined for a field the record does not carry — a migrated record
 *  is missing whole features, and those must read as absent, not as zero. */
export function getField(item: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), item);
}

/** Where each field of a flat analyzer-0.1.0 record lives in the current schema. */
const LEGACY_GROUPS: Record<string, string[]> = {
  metadata: [
    'analyzer_version', 'name', 'folder', 'sub', 'path',
    'length_seconds', 'sample_rate', 'bit_depth', 'channels',
  ],
  classification: [
    'group', 'reason', 'timbre', 'length_class', 'subgroup', 'audit',
    'acoustic_types', 'sound_design_roles', 'instrument_family', 'god_category',
  ],
  envelope: [
    'transient_count', 'attack_seconds', 'sustain_ratio', 'sustained',
    'envelope_attack_seconds', 'envelope_decay_seconds', 'envelope_sustain_level',
    'envelope_release_seconds', 'envelope_temporal_centroid', 'envelope_skewness',
    'envelope_kurtosis', 'envelope_shape',
  ],
  spectral_features: [
    'root_mean_square_level', 'crest_factor', 'zero_crossings_per_second', 'complexity',
    'spectral_centroid_hz', 'spectral_rolloff_hz', 'spectral_flatness',
    'low_band_energy', 'mid_band_energy', 'high_band_energy', 'spectral_flux',
    'harmonicity', 'inharmonicity', 'partial_count',
    'mel_frequency_cepstral_coefficients', 'spectral_centroid_mean_hz',
    'spectral_centroid_deviation_hz', 'total_harmonic_distortion',
    'clipping_density', 'distortion',
  ],
  musicality: [
    'pitch_hz', 'root_note_name', 'root_frequency_hz', 'root_cents_offset',
    'beats_per_minute', 'root_midi_note',
  ],
  unsupervised: ['cluster', 'principal_components'],
  ucs: [],
};

/** What a migrated 0.1.0 record cannot supply, in the words the UI uses. */
export const LEGACY_MIGRATION_GAPS = [
  'UCS classification (category, subcategory, confidence)',
  'loudness (lufs, mid_rms, side_rms)',
  'source format (source_format, lossy_source, dc_offset, trailing_silence_ms)',
  'chromagram',
];

const isRecord = (r: unknown): r is Record<string, any> =>
  typeof r === 'object' && r !== null && !Array.isArray(r);

/** Current schema: the groups are already there. */
const isNested = (r: unknown) => isRecord(r) && isRecord(r.metadata);

/** Analyzer 0.1.0: no groups, but the metadata fields sit at the top level. */
const isLegacyFlat = (r: unknown) =>
  isRecord(r) && !('metadata' in r) && typeof r.name === 'string';

/** Re-group a pre-`metadata` record. Every group is present afterwards, so the
 *  UI's unguarded `item.metadata.*` / `item.ucs.*` reads are safe.
 *
 *  Grouping landed one struct at a time, so a record can be half-converted: the
 *  bundled sample .PEAK already nests `classification` (group, subgroup) while
 *  its other classification fields (timbre, reason, god_category, ...) are still
 *  top-level. Merge onto whatever group object is already there instead of
 *  rebuilding it, and let the nested value win — it is the newer placement. */
function migrateLegacyPeak(flat: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [group, fields] of Object.entries(LEGACY_GROUPS)) {
    const g: Record<string, any> = isRecord(flat[group]) ? { ...flat[group] } : {};
    for (const field of fields) {
      if (flat[field] !== undefined && g[field] === undefined) g[field] = flat[field];
    }
    out[group] = g;
  }
  out.metadata.migrated_from_analyzer_version = flat.analyzer_version ?? 'unknown';
  return out;
}

export interface NormalizeReport {
  records: any[];
  /** How many records were re-grouped from the flat 0.1.0 schema. */
  migrated: number;
  /** How many were neither shape and had to be dropped. */
  skipped: number;
}

/** Accept a parsed .PEAK file of any analyzer version; return records the UI can read. */
export function normalizePeakRecords(json: unknown): NormalizeReport {
  const report: NormalizeReport = { records: [], migrated: 0, skipped: 0 };
  if (!Array.isArray(json)) return report;

  for (const raw of json) {
    if (isNested(raw)) {
      report.records.push(raw);
    } else if (isLegacyFlat(raw)) {
      report.records.push(migrateLegacyPeak(raw));
      report.migrated++;
    } else {
      report.skipped++;
    }
  }
  return report;
}
