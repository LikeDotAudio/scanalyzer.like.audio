/** Trimming a .PEAK record down to what the cloud database actually stores.
 *
 *  A full record is ~11 KB, and the overwhelming majority of it has no column
 *  to land in: the base64 waveform preview alone is 5.5 KB, and regions carry a
 *  complete nested analysis each. A 500-record POST of raw records is ~5.7 MB,
 *  which is over `post_max_size` on most shared hosts — and PHP discards an
 *  oversized body silently, handing the script an empty payload with no error.
 *  So the fix for "nothing is being added" is partly just: send less.
 *
 *  This is an explicit ALLOW-list, keyed to the columns in `init_db.php`, not a
 *  "strip anything that looks big" rule. The previous approach deleted every
 *  array in the record, which happened to delete `acoustic_types`,
 *  `instrument_family`, `classification.reason` and all of `ucs.alternatives` —
 *  six columns that have been NULL for every one of the 33,000 rows uploaded
 *  from the browser. An allow-list cannot drop a column by accident, and a new
 *  field added to the analyzer (`bioacoustic_syntax`, say) cannot silently
 *  inflate every upload.
 *
 *  Keep in sync with `Web_Front/public/api/upload_peak.php`.
 */

const METADATA_FIELDS = [
  'name', 'folder', 'path', 'analyzer_version', 'length_seconds', 'sample_rate',
  'bit_depth', 'channels', 'source_format', 'lossy_source', 'dc_offset',
] as const;

const CLASSIFICATION_FIELDS = [
  'group', 'subgroup', 'timbre', 'acoustic_types', 'instrument_family', 'reason',
] as const;

const SPECTRAL_FIELDS = [
  'root_mean_square_level', 'crest_factor', 'complexity', 'spectral_centroid_hz',
  'spectral_rolloff_hz', 'spectral_flatness', 'harmonicity',
  'total_harmonic_distortion', 'clipping_density',
] as const;

const MUSICALITY_FIELDS = [
  'pitch_hz', 'root_note_name', 'root_midi_note', 'root_cents_offset', 'beats_per_minute',
] as const;

const ENVELOPE_FIELDS = [
  'transient_count', 'attack_seconds', 'envelope_decay_seconds',
  'envelope_sustain_level', 'envelope_release_seconds',
  'envelope_temporal_centroid', 'envelope_shape',
] as const;

function pick(source: any, fields: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (!source || typeof source !== 'object') return out;
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
}

/** One record, reduced to the stored columns. Roughly 1/20th the bytes. */
export function slimForUpload(record: any): any {
  const ucs = record?.ucs ?? {};
  return {
    metadata: pick(record?.metadata, METADATA_FIELDS),
    classification: pick(record?.classification, CLASSIFICATION_FIELDS),
    // Only the top three alternatives are stored (alt_1..alt_3), and only their
    // category/subcategory — the scores and synonyms have no column.
    ucs: {
      category: ucs.category,
      subcategory: ucs.subcategory,
      alternatives: (Array.isArray(ucs.alternatives) ? ucs.alternatives : [])
        .slice(0, 3)
        .map((a: any) => ({ category: a?.category, subcategory: a?.subcategory })),
    },
    spectral_features: pick(record?.spectral_features, SPECTRAL_FIELDS),
    musicality: pick(record?.musicality, MUSICALITY_FIELDS),
    envelope: pick(record?.envelope, ENVELOPE_FIELDS),
  };
}

/** How many records to send per POST.
 *
 *  500 slimmed records is ~250 KB, comfortably inside any `post_max_size`. It is
 *  also small enough that the counter moves several times during a scan instead
 *  of once at the very end — the old threshold meant a scan of fewer than 500
 *  files uploaded nothing at all until it finished. */
export const UPLOAD_CHUNK_SIZE = 250;
