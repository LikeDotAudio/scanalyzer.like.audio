// The slim library manifest — the TypeScript mirror of
// `sample_analyzer_rs/src/Encoders/manifest.rs`. Both project the SAME slim row, so a
// manifest written by the desktop analyzer and one written by the browser are
// interchangeable. Keep the field lists here in step with that Rust module.
//
// A slim row is just a `.PEAK` with the heavy sections (regions/MFCC/chromagram/PCA/
// spectral extras) dropped — about an eighth of a record's bytes. The per-file `.PEAK`
// sidecars stay canonical; the manifest is a rebuildable cache.

export const MANIFEST_FILE = 'sample_cloud_manifest.json';
export const MANIFEST_VERSION = 1;

/** Copy only the present `fields` from `src`. Returns `{}` when `src` is absent. */
function pick(src: any, fields: string[]): any {
  const o: any = {};
  if (src && typeof src === 'object') {
    for (const f of fields) if (src[f] !== undefined) o[f] = src[f];
  }
  return o;
}

/** Project one full record down to a slim manifest row (grouped shape preserved so
 *  `normalizePeakRecords` ingests it unchanged). */
export function projectSlim(full: any): any {
  const row: any = {};
  const metadata = pick(full?.metadata, ['name', 'path', 'folder', 'length_seconds', 'analyzer_version', 'source_format']);
  if (Object.keys(metadata).length) row.metadata = metadata;

  const classification = pick(full?.classification, ['group', 'subgroup', 'timbre', 'length_class', 'music_production_category']);
  const reason0 = full?.classification?.reason?.[0];
  if (reason0 !== undefined) classification.reason = [reason0];
  if (Object.keys(classification).length) row.classification = classification;

  const envelope = pick(full?.envelope, ['transient_count', 'attack_seconds', 'envelope_sustain_level']);
  if (Object.keys(envelope).length) row.envelope = envelope;

  const spectral = pick(full?.spectral_features, ['spectral_centroid_hz', 'harmonicity', 'root_mean_square_level', 'zero_crossings_per_second', 'crest_factor', 'spectral_flatness', 'complexity']);
  if (Object.keys(spectral).length) row.spectral_features = spectral;

  const musicality = pick(full?.musicality, ['pitch_hz', 'beats_per_minute', 'root_note_name']);
  if (Object.keys(musicality).length) row.musicality = musicality;

  const unsupervised = pick(full?.unsupervised, ['cluster']);
  if (Object.keys(unsupervised).length) row.unsupervised = unsupervised;

  const ucs = pick(full?.ucs, ['category', 'subcategory', 'id', 'confidence']);
  if (Array.isArray(full?.ucs?.alternatives)) {
    ucs.alternatives = full.ucs.alternatives.slice(0, 3).map((a: any) =>
      a && typeof a === 'object' ? pick(a, ['category', 'subcategory', 'probability']) : a);
  }
  if (Object.keys(ucs).length) row.ucs = ucs;

  if (full?.regions?.count !== undefined) row.regions = { count: full.regions.count };
  return row;
}

/** Build the whole manifest object: header (version, engine, totals, category
 *  histogram for an instant group tree) plus the slim rows. */
export function buildManifest(root: string, records: any[], analyzerVersion: string): any {
  const rows = records.map(projectSlim);
  const categories: Record<string, number> = {};
  for (const r of rows) {
    const c = (r?.ucs?.category as string) || 'UNCLASSIFIED';
    categories[c] = (categories[c] || 0) + 1;
  }
  return {
    manifest_version: MANIFEST_VERSION,
    analyzer_version: analyzerVersion,
    root,
    total_files: rows.length,
    generated_unix: Math.floor(Date.now() / 1000),
    categories,
    records: rows,
  };
}

/** Was this manifest written by the given engine and at this row layout? A mismatch
 *  means "ignore the cache, fall back to the sidecars." Mirrors `manifest::is_current`. */
export function manifestIsCurrent(m: any, analyzerVersion: string): boolean {
  return !!m
    && m.manifest_version === MANIFEST_VERSION
    && typeof m.analyzer_version === 'string'
    && m.analyzer_version === analyzerVersion;
}
