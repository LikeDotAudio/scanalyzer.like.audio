# Manifest Cache Loader — audit & plan

**Date:** 2026-07-16 · **Status:** IMPLEMENTED (v1) · **Scope:** how the app
loads an analyzed library, and a three-tier manifest that replaces "load all 70k full
records" with "load a slim index, lazy-load the rest."

## Implementation status (2026-07-16)

Built and verified. The per-file `.PEAK` sidecars remain canonical and untouched; the
manifest is an additive, rebuildable cache written beside them as
`sample_cloud_manifest.json`.

| Piece | Where | Verified |
|---|---|---|
| Slim projection + manifest writer | `sample_analyzer_rs/src/Encoders/manifest.rs`, wired in `Pipeline/run.rs` | ✅ built + **ran** on demo audio — manifest written, sidecars kept |
| Tauri `open_manifest` (fast load + version gate), `build_manifest` (reindex from sidecars), `read_full_record` (lazy detail) | `Web_Front/src-tauri/src/lib.rs` | ✅ `cargo check` |
| Desktop load prefers manifest, falls back to aggregate/sidecars | `TauriScan.tsx`, `App.tsx` | ✅ `tsc` + `vite build` |
| Examiner lazy-loads the full record on select (`detailItem`) | `ExaminerTab.tsx` | ✅ typecheck |
| Web read-manifest fast path (1-sidecar version probe) + write-manifest after scan | `App.tsx`, `ScanalyzeTab.tsx`, `manifest.ts`, `audioLinking.ts` | ✅ typecheck; TS↔Rust projectors **byte-identical** |
| Project-index histogram (categories) in the manifest header | both writers | ✅ verified in output |
| Staleness gate (`analyzer_version` + `manifest_version`) | `manifest::is_current`, `manifestIsCurrent` | ✅ |

**Known limitation (v1):** on the *web* manifest fast path, the Examiner detail panel
falls back to slim fields (no regions/MFCC/spectral extras) because the full sidecar
isn't re-read over FSA on select — the waveform still decodes from audio. Desktop has no
such limit (`read_full_record`). Wiring the web sidecar re-read is the one follow-up.
Phase 6 (columnar v2) intentionally deferred.

---

*Original proposal follows.*

Grounded in three code audits (load path, per-view field consumption, on-disk byte
measurements). Every "today" claim carries a `file:line`; everything under **Proposed**
is new work.

---

## 1. The problem (measured, not assumed)

Today **every** load path terminates in a single in-memory array and holds it for the
whole session:

- `App.tsx:33` — `const [analysisResult, setAnalysisResult] = useState<any[]>([])`. This
  is the single source of truth, passed by prop to every tab. `scopedData`/`filteredData`
  (`App.tsx:66-88`) are `useMemo` filters *over the full array* — they narrow what renders,
  never what is resident.
- **No virtualization or paging at the React level.** The chunking that exists is
  read-time only: Tauri pages `read_peak_page` at `PAGE = 2000` (`TauriScan.tsx:112`), the
  web path reads sidecars at `CHUNK = 250/300` (`ScanalyzeTab.tsx:143`, `App.tsx:216`). All
  of it bounds the IPC/parse *burst*; the instant loading finishes, the complete array is
  `setAnalysisResult`'d and stays in RAM.
- Desktop also materializes the whole set twice more: the Rust `PeakCache`
  (`Mutex<Vec<serde_json::Value>>`, `lib.rs:335`) holds every record until
  `close_peak_file`, and the aggregate `sample_cloud_data.PEAK` (`run.rs:122-126`,
  default `--out`, `args.rs:~46`) is one big JSON array of full `Peak` structs — the
  ~150 MB-through-IPC file the paging was invented to survive (`lib.rs:337-343`).

### What that costs, in numbers

Measured from real sidecars (`Web_Front/dist/SampleSamplesForSampling/`):

| | per record | **× 70,000** |
|---|---|---|
| Full sidecar on disk (pretty, typical) | ~6.5 KB (median 5.6 KB) | **~455 MB** |
| Full incl. region-heavy tail (mean) | ~9 KB | ~630 MB |
| **Slim record (compact, ~28 fields)** | **763–857 B** | **~53 MB** |
| Slim, gzipped (repetitive keys) | — | **~10–15 MB** |

So the resident working set is **~8× larger than it needs to be** for everything except
opening a single file — and on the web path each of 70k records is also a separate
`File.text()`/`FileReader` round-trip, where the per-file handle cost dominates.

**The single biggest byte sink:** `regions.regions[]` embeds a *full nested copy of the
entire analysis* per region (~5.6 KB each). One-shots have 0–1 trivial regions; multi-region
files explode (a 47 KB record where regions are 54% of bytes). After regions,
`spectral_features` (MFCC[13] + ~30 scalars) is the dominant fixed cost. **Neither is read
by any aggregate view** (§3).

---

## 2. The idea — a three-tier cache

One record has three audiences with wildly different weight. Split the storage to match:

```
┌─ project.manifest.json ──────────────────────────────────────┐  ~KB
│  library-wide index: folders, per-folder counts + category    │  loads instantly
│  histogram, engine version, folder-manifest hashes            │  → group tree, totals
└───────────────────────────────────────────────────────────────┘
              │ lazy, on drill-in / on first aggregate view
┌─ <folder>/.manifest.json ────────────────────────────────────┐  ~53 MB total / 70k
│  one SLIM row per file: name, path, ucs cat/sub, ~20 scalar    │  streams; feeds
│  features, cluster, staleness stamp                            │  Examiner/Stats/Cloud
└───────────────────────────────────────────────────────────────┘
              │ lazy, on file SELECT only
┌─ <file>.PEAK  (unchanged) ───────────────────────────────────┐  ~6.5 KB each
│  the full record: regions, MFCC, chromagram, PCA, spectral    │  fetched per open,
│  extras, ucs alternatives/synonyms — the Examiner detail panel │  LRU-evictable
└───────────────────────────────────────────────────────────────┘
```

The bottom tier already exists — per-file `.PEAK` sidecars, co-located, `<basename>.PEAK`
(`sidecar.rs:9-15`). We are adding the two index tiers on top and rewiring the load path to
read *those* instead of slurping every full record.

---

## 3. The manifest schema (the slim row)

The audit of what each view actually reads settled the field set. **Grouping, the 3D cloud,
2D stats, and the Examiner list are ALL serviceable from light scalars** — nothing but the
Examiner *detail panel* ever touches a heavy section.

### 3a. Minimal slim row — the union of every aggregate view's needs

All full-English field paths (per [[full-english-data-models]]), all light scalars/short
strings:

| field | consumed by | evidence |
|---|---|---|
| `metadata.name` | every view (label/tooltip/sort) | `ExaminerTab COLUMNS`, cloud tooltip `SampleCloud.tsx:268` |
| `metadata.path` | audio linking on Examiner select | `handleSelect`/`prefetch.ensure` |
| `metadata.length_seconds` | cloud axis, stats, examiner col | `SampleCloud CLOUD_FEATURES`, `StatsTab NUM_FEATURES` |
| `metadata.analyzer_version` | **staleness** (§5) | `sidecar.rs:26` |
| `ucs.category`, `ucs.subcategory` | grouping + color + every view | `groupColors.ts:154`, `ucsColor/ucsSubColor` |
| `ucs.confidence` | Examiner sub-cell prob bar | `ExaminerTab.tsx:781` |
| `classification.group`, `.subgroup`, `.timbre` | cloud axes/shape, stats tooltip, examiner col | `CLOUD_FEATURES`, `getShapeFor` |
| `classification.length_class` | preview beat-grid (optional) | `renderPreview` |
| `classification.reason[0]` | Examiner "Reason" col (first element) | `ExaminerTab COLUMNS` |
| `classification.music_production_category` | cloud shape heuristic (may be absent) | `getShapeFor SampleCloud.tsx:96` |
| `envelope.transient_count`, `.attack_seconds`, `.envelope_sustain_level` | cloud/stats/examiner | `CLOUD_FEATURES`, `NUM_FEATURES` |
| `spectral_features.complexity`, `.spectral_centroid_hz`, `.harmonicity`, `.root_mean_square_level`, `.zero_crossings_per_second`, `.crest_factor`, `.spectral_flatness` | cloud axes + stats | `CLOUD_FEATURES`, `NUM_FEATURES` |
| `musicality.pitch_hz`, `.beats_per_minute`, `.root_note_name` | cloud/stats/examiner | ditto |
| `unsupervised.cluster` | cloud axis + stats | `CLOUD_FEATURES` |

**Optional add-on (still light):** `ucs.alternatives[0..2]` reduced to
`{category, subcategory, probability}` — needed only if we keep runner-up scope matching
(`groupColors.ts:164-179`) and the Examiner Alt columns in the fast path. Drop the legacy
packed-`id` strings.

**Explicitly NOT in the manifest** (Examiner-detail-only, load with the full `.PEAK`):
`regions.*` (the nested `Box<Peak>` — heaviest, never in the index), `spectral_features.mel_frequency_cepstral_coefficients`, `musicality.chromagram`,
`unsupervised.principal_components`, the ~20 spectral extras behind `PropertyBars`,
`ucs.synonyms`/`reason`, full `ucs.alternatives`, and the
`classification.{acoustic_types, sound_design_roles, instrument_family, audit}` arrays.
Note `classification.god_category` is **dead** — read by no current view — so it belongs in
neither tier.

### 3b. Folder manifest — example

```json
{
  "manifest_version": 1,
  "analyzer_version": "20260715.1849-a0573c3c46f...",
  "folder": "Drums/Kicks",
  "generated": "2026-07-16T...",
  "count": 342,
  "records": [
    { "metadata": { "name": "Kick 34.wav", "path": "Kick 34.wav",
                    "length_seconds": 0.62 },
      "ucs": { "category": "DRUMS", "subcategory": "KICK", "confidence": 0.88 },
      "classification": { "group": "Percussion", "subgroup": "Kick",
                          "timbre": "Punchy", "reason0": "transient + low-band" },
      "envelope": { "transient_count": 1, "attack_seconds": 0.004,
                    "envelope_sustain_level": 0.05 },
      "spectral_features": { "spectral_centroid_hz": 210, "harmonicity": 0.12,
                             "root_mean_square_level": 0.31, "crest_factor": 8.1,
                             "spectral_flatness": 0.22, "complexity": 140,
                             "zero_crossings_per_second": 900 },
      "musicality": { "pitch_hz": 55, "beats_per_minute": 0, "root_note_name": "A1" },
      "unsupervised": { "cluster": 3 },
      "stamp": { "mtime": 1721160000, "size": 5618 } }
  ]
}
```

Paths are **relative to the folder** (763 B/row vs 857 B absolute — and it makes the
library relocatable). The row mirrors the grouped `.PEAK` shape so
`normalizePeakRecords` (`peakSchema.ts`) can ingest it unchanged — a manifest row is just a
`.PEAK` with the heavy sections omitted, which the UI already tolerates (every field is
optional-accessed).

### 3c. Project manifest — example

```json
{
  "manifest_version": 1,
  "analyzer_version": "20260715.1849-a0573c3c46f...",
  "root": "/home/anthony/Documents/Music Samples",
  "total_files": 70379,
  "generated": "2026-07-16T...",
  "folders": [
    { "path": "Drums/Kicks", "count": 342,
      "manifest_hash": "sha1:…", "manifest_mtime": 1721160000,
      "categories": { "DRUMS": 342 } },
    { "path": "Ambience/City", "count": 1876,
      "categories": { "AMBIENCE": 1740, "VEHICLES": 136 } }
  ]
}
```

This tier is a few KB even for a huge library. It alone gives the **group tree + totals**
(the taxonomy is 95 categories × ~920 subcategories) with **zero** folder data loaded —
the scope bar, Groups tab counts, and category histogram render instantly.

---

## 4. Progressive reveal — Examiner → 2D → 3D

The user's instinct is right, and the audit confirms *why*: it is not that the tabs need
different *fields* (Stats and Cloud rows are just as light as Examiner rows) — it is that
they need a different *amount resident* before they are honest.

| view | needs before it's meaningful | can stream? | order |
|---|---|---|---|
| **Examiner** (list) | just the **visible page** of rows — it is a sortable/virtualizable table | **yes** — show rows as manifest pages arrive | **1st (lowest lift)** |
| **2D Stats** | *all* filtered rows' 14 numerics (it scatters/downsamples the whole set, `StatsTab.tsx:103`) | needs full slim manifest resident | 2nd |
| **3D Cloud** | *all* points + a WebGL buffer build + layout | full manifest + GPU upload | 3rd (heaviest render) |

So the reveal is:

1. **Project manifest** (KB) → group tree, counts, scope bar. Instant.
2. **Stream folder manifests** → the **Examiner list fills progressively**, first page in
   well under a second. This is the lowest-lift win and the first thing to build (it needs
   ~15 light fields + `metadata.path`, all already in the slim row).
3. **Full slim manifest resident** (~53 MB, or ~12 MB gzipped over one fetch) → **2D Stats**
   becomes accurate (it needs the whole distribution).
4. **Cloud** builds its point buffer last, from the same resident manifest — no extra load,
   just the GPU/layout cost deferred until the user opens the tab.
5. **Full `.PEAK`** fetched only when a row/point is **selected** — waveform decode, regions,
   MFCC/chromagram/PCA, the full field dump. LRU-evict so the resident set stays flat.

Critically, **one slim manifest feeds all three tabs** — we are not building three caches.
Examiner is "first" because it is the only view usable from a *partial* manifest.

---

## 5. Staleness & invalidation

The manifest must answer "is this still true?" without re-reading every full record. The
codebase already has the exact test — batch it:

- **Version stamp:** `metadata.analyzer_version` = build-date + **hash of `src/*.rs`**
  (`version.rs`). Same sources ⇒ same version ⇒ interchangeable results; any code change ⇒
  new version ⇒ forced re-analysis. `read_sidecar` reuses a sidecar only if
  `analyzer_version == ANALYZER_VERSION` **and** the stored name matches
  (`sidecar.rs:26-30`); `survey_directory` probes just 12 spread sidecars and reports one
  `sidecar_engine` or `null` if they disagree (`lib.rs:~93`).
- **Manifest rule:** a folder manifest is valid iff its `analyzer_version` equals the current
  binary's, and each row's `stamp.mtime/size` matches the file on disk. A project manifest is
  valid iff every folder's `manifest_hash/mtime` matches. Any mismatch ⇒ that folder (not the
  whole library) is re-indexed; a version bump invalidates everything, exactly as today —
  just resolved from the manifest instead of a directory walk.
- This makes the manifest a **cache, never a source of truth**: if it is missing, stale, or
  corrupt, fall back to reading sidecars (the current path) and rebuild it. Correctness never
  depends on it.

---

## 6. Where it's generated / consumed (respecting client-side-only)

Per [[client-side-only]] there is no server; generation happens in the local Rust binary
(desktop) or in the browser during sidecar absorption (web). Two producers, one format.

**Produce — Rust (desktop, authoritative):**
- In `run.rs`, after analysis, project each `Peak` to a slim row and write
  `<folder>/.manifest.json` + update `project.manifest.json`. Cheap — the data is already in
  hand. (This can also retire the monolithic `sample_cloud_data.PEAK` from the load path.)
- Add a **`reindex` command / Tauri `build_manifest(directory)`** that walks *existing*
  sidecars and emits manifests without re-analyzing — reuse the `open_sidecars` walk
  (`lib.rs:160`). This upgrades a library scanned before manifests existed.
- Add **`read_manifest(directory)`** returning the project manifest, and reuse the paged
  `read_peak_page` machinery to stream folder-manifest rows (project only the slim fields
  from the cached `Vec<Value>` — no new parse).

**Produce — web (browser fallback):** the absorption loop already reads every sidecar in
chunks (`ScanalyzeTab.tsx:182`). Project the slim fields there and write `.manifest.json`
back via the File System Access API (`mode:'readwrite'`, already requested for sidecar
writes). No new I/O — piggyback on the pass already happening.

**Consume — `App.tsx`:** replace the "load full array" path with:
1. `read_manifest` → project index → group tree/counts (new lightweight state).
2. Stream folder manifests into a resident **slim** array that becomes the new
   `analysisResult` for the aggregate tabs (same shape, ~8× smaller).
3. On Examiner/Extractor select, fetch the full `.PEAK` for that one file
   (`open_peak_file`/`read_sidecar` already exist per-file) into an LRU detail cache.

---

## 7. Project level vs folder level — the answer

**Both, hierarchically — that is the point.**

- **Folder-level** manifests are the workhorse: they co-locate with the audio and sidecars
  (matching the flat `<file>.wav`/`<file>.PEAK` layout the audit found), so they move/rename/
  delete atomically with their folder, invalidate independently, and let a user open one
  sub-folder without touching the rest of the library.
- **Project-level** manifest is a thin index *of* the folder manifests — counts, category
  histogram, and each folder's hash/mtime. It gives instant library-wide structure (the group
  tree, totals, staleness overview) without loading any folder, and it is what turns "open a
  70k library" into "read a few KB, then stream what you look at."

Folder-only would force a full walk to know library totals; project-only would couple the
whole library into one file that any single re-scan invalidates. The two-tier split is what
makes both "show me everything's shape instantly" and "re-index just this folder" cheap.

---

## 8. Phased plan (lowest lift first)

| # | Phase | Delivers | Effort | Risk |
|---|---|---|---|---|
| 1 | **Slim projection + folder manifest writer (Rust)** in `run.rs`; `build_manifest` reindex command | manifests exist for scanned/existing libraries | S–M | low (pure add; sidecars unchanged) |
| 2 | **Examiner from a streaming manifest** — `read_manifest` + paged rows → virtualized Examiner list; full `.PEAK` on select | the first, lowest-lift, most-visible win | M | low–med (Examiner already lazy-loads detail on select) |
| 3 | **Project manifest + group tree/counts** wired to scope bar & Groups tab | instant structure, no folder load | S | low |
| 4 | **Point all aggregate tabs at the slim array** (Stats, then Cloud); make full-record fetch LRU | ~8× smaller resident set, session-wide | M | med (touches `App.tsx:33` source-of-truth; keep sidecar fallback) |
| 5 | **Staleness batching** — validate manifests by `analyzer_version` + mtime; re-index only stale folders | fast reopen, correct invalidation | S–M | low (mirrors `read_sidecar`) |
| 6 | *(optional)* **Columnar manifest v2** — struct-of-arrays for typed-array cloud buffers + better gzip | faster Cloud upload, smaller manifest | M | low; do only if profiling asks |

Phase 1+2 alone deliver the headline: open a huge library and get a usable Examiner in under
a second, with full records loaded only for the files actually opened.

---

## 9. Benefits, concretely

- **~455 MB → ~53 MB** resident (or ~12 MB gzipped over the wire) for the aggregate views;
  the ~150 MB single-IPC aggregate (`lib.rs:337`) leaves the load path entirely.
- **70k file opens → a handful of manifest reads.** On web, where per-`File` handle cost
  dominates, this is the larger real-world win.
- **Sub-second time-to-Examiner** on any library size (streaming, first page early).
- **Instant library structure** — group tree + counts from a few-KB project index.
- **Flat resident memory** — full records are per-selection and LRU-evicted, not accumulated.
- **Targeted invalidation** — a re-scan of one folder re-indexes one folder; a version bump
  invalidates all, resolved from stamps not a walk.
- **No new source of truth** — the manifest is a rebuildable cache; sidecars remain canonical,
  so nothing is lost if it's deleted.

---

## 10. Open decisions

1. **Row vs columnar** for v1 — recommend **row-oriented** (mirrors `.PEAK`, ingests through
   `normalizePeakRecords` unchanged); revisit columnar (§8 phase 6) only if Cloud upload or
   manifest size profiles badly.
2. **Keep `ucs.alternatives[0..2]` in the slim row?** Yes if the Examiner Alt columns and
   runner-up scope matching stay on the fast path; it is the one "medium" field.
3. **Retire `sample_cloud_data.PEAK`?** Once the manifest is the load path, the monolithic
   aggregate is redundant for loading (keep it only if something exports/consumes it directly).
4. **One `.manifest.json` per folder vs one project file with embedded rows?** Per-folder
   (recommended) for independent invalidation and partial open; embedded only for tiny
   libraries.
5. **Gzip the manifest on disk?** ~4× smaller (~12 MB), trivial to `DecompressionStream` in
   the browser and `flate2` in Rust — recommended for the folder manifests.

---

*Method: three parallel read-only audits — load path, per-view field consumption, on-disk
byte measurements. Numbers are from real sidecars in `Web_Front/dist/SampleSamplesForSampling/`
(a 60-file demo corpus; the 70k library is external), projected linearly. `file:line`
references are evidence pointers and may drift ±a few lines after later edits.*
