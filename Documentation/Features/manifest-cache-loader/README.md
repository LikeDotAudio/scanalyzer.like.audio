# Manifest Cache Loader

**Status:** shipped (v1) · **Landed:** 2026-07-16

A slim, rebuildable index that lets the app open a large analyzed library **without
loading every full `.PEAK` record into memory**. The per-file sidecars stay canonical and
untouched; the manifest is an additive cache written beside them as
`sample_cloud_manifest.json`. If it's missing, stale, or corrupt, the app falls back to
the sidecars and rebuilds it — correctness never depends on it.

> This document describes what was **built**. It supersedes the original proposal (which
> also planned per-folder manifests and a streaming Examiner — see *Not built / future
> work*). For the original audit numbers, see the git history of this file.

---

## Why

Every load path used to end in one in-memory array (`App.tsx` `analysisResult`) holding
every full record for the whole session — ~6.5 KB × 70k ≈ **~455 MB**, plus, on the web
path, one file read per record. A slim row keeps only the ~25 light fields the aggregate
views (grouping, 3D Cloud, 2D Stats, Examiner list) actually read:

| | per record | × 70,000 |
|---|---|---|
| Full sidecar (typical) | ~6.5 KB | ~455 MB |
| **Slim manifest row** | ~0.8 KB | **~53 MB** (gzip ~12 MB) |

Measured on the demo corpus: `sample_cloud_manifest.json` was **11.8 KB vs 52.6 KB** for
the same 8 records (~4.4× on long-named SFX; more on short-named one-shots).

---

## How it works (as built)

Two tiers. The full `.PEAK` sidecars are tier two; the manifest is tier one and folds the
"project index" into its own header rather than being a separate file.

```
<root>/sample_cloud_manifest.json          ← ONE file per scanned root
  ├─ header: manifest_version, analyzer_version, root, total_files,
  │          generated_unix, categories{ CAT: count }   ← the group-tree index
  └─ records: [ slim row, … ]                            ← one per file
                     │  lazy, on file OPEN only
<file>.PEAK  (unchanged, canonical)         ← full record: regions, MFCC,
                                              chromagram, PCA, spectral extras
```

### The slim row

A grouped-shape subset of a `.PEAK` — so the front-end's `normalizePeakRecords` ingests it
unchanged. Sections/fields kept:

- `metadata`: name, path, folder, length_seconds, analyzer_version, source_format
- `classification`: group, subgroup, timbre, length_class, music_production_category, reason[0]
- `envelope`: transient_count, attack_seconds, envelope_sustain_level
- `spectral_features`: spectral_centroid_hz, harmonicity, root_mean_square_level, zero_crossings_per_second, crest_factor, spectral_flatness, complexity
- `musicality`: pitch_hz, beats_per_minute, root_note_name
- `unsupervised`: cluster
- `ucs`: category, subcategory, id, confidence, alternatives[0..2]{category, subcategory, probability}
- `regions`: count only

Dropped (loaded from the full `.PEAK` on open): `regions.regions[]` (the nested per-region
`Peak` — the single heaviest payload), MFCC, chromagram, PCA, the ~20 `PropertyBars`
spectral extras, `ucs.synonyms`/`reason`, and the `classification` string arrays.

### Generation — three producers, one format

- **Desktop scan** — the analyzer writes the manifest at the end of every run
  (`sample_analyzer_rs/src/Pipeline/run.rs`, via `Encoders/manifest.rs`). Best-effort:
  a failure here never fails the scan. This includes **"analyze only what's missing"**
  (no `--force`): `run.rs` builds the manifest from *all* results — reused sidecars plus
  the newly analyzed ones — so an incremental scan always rebuilds the **full** manifest
  (verified: adding one file to a 3-file library re-ran only the new file yet grew the
  manifest to 4 records).
- **Reindex** — `build_manifest(directory)` (Tauri) walks the existing `.PEAK` sidecars and
  writes the manifest **without re-analyzing**, upgrading a library scanned before this
  feature existed.
- **Web scan** — after a browser scan, `ScanalyzeTab.tsx` writes the manifest via the File
  System Access API using the same slim projection (`Web_Front/src/manifest.ts`). Its
  incremental path threads the reused ("absorbed") records into the manifest build so the
  file always covers the whole folder, not just the newly analyzed delta; even a scan that
  finds nothing missing refreshes the index.

The Rust (`manifest.rs`) and TypeScript (`manifest.ts`) projectors are kept in lockstep and
were verified to produce **byte-identical** rows, so the two-language field lists can't
silently drift.

### Loading — manifest first, sidecars as fallback

- **Desktop** (`TauriScan.tsx`, `App.tsx` reopen): try `open_manifest` → page the slim rows
  → `analysisResult`; on a miss/stale-version, fall back to the full aggregate
  (`open_peak_file`) or a sidecar walk (`open_sidecars`), and seed a manifest in the
  background so next time is fast.
- **Web** (`App.tsx` reopen): read `sample_cloud_manifest.json` from the directory handle,
  confirm it with a **one-sidecar version probe**, and use it — else read the sidecars as
  before.

### Examiner — lazy full record

The Examiner list, 2D Stats, 3D Cloud, and Groups all render from the slim rows. When a file
is **selected**, `ExaminerTab.tsx` keeps the slim row as the selection identity and fetches
the full record into a separate `detailItem` (desktop: `read_full_record`; web: falls back
to the slim row) so the detail panels (`FieldValueTable`, `PropertyBars`) and the waveform
preview show everything. Row highlight / arrow-key nav are unaffected because the selection
object identity never changes.

### Staleness

A manifest is trusted only when `manifest_version` matches this layout **and**
`analyzer_version` matches the current engine (a hash of the analyzer's own source) — the
same test `sidecar::read_sidecar` already applies, mirrored in `manifest::is_current`
(Rust) and `manifestIsCurrent` (TS). A version bump invalidates the cache and the app falls
back to the sidecars.

---

## Files

| File | Role |
|---|---|
| `sample_analyzer_rs/src/Encoders/manifest.rs` | slim projection, `build_manifest`, `write_manifest`, `is_current`; `MANIFEST_NAME = sample_cloud_manifest.json` |
| `sample_analyzer_rs/src/Pipeline/run.rs` | writes the manifest at the end of a scan |
| `sample_analyzer_rs/src/lib.rs` | registers the `manifest` module |
| `Web_Front/src-tauri/src/lib.rs` | Tauri commands `open_manifest`, `build_manifest`, `read_full_record` |
| `Web_Front/src/manifest.ts` | TS mirror of the projector (`projectSlim`, `buildManifest`, `manifestIsCurrent`) |
| `Web_Front/src/audioLinking.ts` | FSA `readRootFile` / `writeRootFile` helpers |
| `Web_Front/src/App.tsx` | desktop + web reopen prefer the manifest |
| `Web_Front/src/components/ScanalyzeTab/TauriScan.tsx` | desktop load + reindex-on-fallback |
| `Web_Front/src/components/ScanalyzeTab/ScanalyzeTab.tsx` | web scan writes the manifest |
| `Web_Front/src/components/ExaminerTab/ExaminerTab.tsx` | lazy full-record detail (`detailItem`, `fetchFull`) |

### Tauri API

| Command | Signature | Purpose |
|---|---|---|
| `open_manifest` | `(directory) -> usize` | load the slim manifest into the page cache (version-gated); `Err` ⇒ caller falls back |
| `build_manifest` | `(directory) -> usize` | (re)build the manifest from existing sidecars, no re-analysis |
| `read_full_record` | `(path) -> String` | read one file's full `.PEAK` for the Examiner detail panel |

Slim rows page out through the existing `read_peak_page` / `close_peak_file`, so no new
paging machinery was added.

---

## Verification

- Analyzer: `cargo build --release` + **run on real demo audio** — manifest written, all
  sidecars kept, header/histogram/slim-rows correct, zero heavy sections.
- Tauri crate: `cargo check` clean.
- Web: `tsc --noEmit` clean + `vite build` clean.
- **Projector parity:** ran both projectors over the same records and diffed — 0
  mismatches (byte-identical rows).
- Analyzer tests: 49/50 pass. The one failure (`ucs::tests::specific_synonyms_outrank_generic_ones`)
  is pre-existing UCS IDF-scoring math, unrelated to this feature (`ucs.rs` not modified).

---

## Not built / future work

- **Per-folder manifests + streaming Examiner.** The proposal's three-tier design (a thin
  project index pointing at per-folder manifests, streamed so the Examiner fills
  progressively) was **not** built. v1 ships a single root manifest whose header histogram
  serves the project-index role. Per-folder manifests would add independent invalidation and
  partial-folder open.
- **Web Examiner full detail.** On the web manifest fast path, the Examiner detail panel
  falls back to slim fields (no regions/MFCC/spectral extras); the waveform still decodes
  from audio. Desktop has full detail via `read_full_record`. The fix is to re-read the
  sidecar over FSA on select.
- **Columnar manifest (v2).** Struct-of-arrays for typed-array cloud buffers / smaller gzip —
  deferred; revisit only if profiling asks.
