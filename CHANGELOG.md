# Changelog

All notable changes to scanalyzer.like.audio.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). There are
no version tags yet, so entries are grouped by date. The analyzer stamps every record
with an `analyzer_version` (a hash of the extractor sources *and* the UCS data), and any
change under **Analyzer** or **UCS data** below produces a new stamp — which invalidates
existing `.PEAK` sidecars and forces a re-scan. That is by design.

## [Unreleased]

### 2026-07-16 — auto-load on push & live scan batches

#### Added

- **Live batch loading during scans.** Instead of waiting for a full directory scan to complete before populating the UI, the native Rust scanner now buffers completed records and emits an `analyzer-batch` event every 1,000 files. The UI immediately normalizes and deduplicates these records, dynamically hydrating the 3D cloud and other views in real-time as the scan progresses.
- **Auto-load on push.** Pushing a file from the 3D cloud (or the global footer push buttons) to the Examiner or Extractor tab now automatically selects and loads the file in the target tab. This resolves the previous "half a push" behavior where the target tab would only filter the list to the pushed file but sit waiting for a manual click.


### 2026-07-16 — examiner layers: two-pane placement & footer menu

#### Added

- **The Layers menu is a two-pane placement grid.** Layers are grouped by domain —
  **FREQUENCY** (waterfall freq, 3d spectrum, spectrum, slices, notes, piano scale)
  normalled to the top pane, **TIME** (waveform, volume, phase, envelope, beat markers,
  extractor markers) normalled to the bottom pane — and each layer has three placement
  columns: **top / btm / row**. Clicking a column places the layer in the top pane, the
  bottom pane, or its own lane; clicking the active column again hides it — the columns
  *are* the show/hide control. A pane with no layers cedes its half, so a lone group
  gets the full height.
- **Rows are reorderable.** ▲▼ on every menu row moves a layer within its group; the
  order drives lane order (rows mode and own-row lanes) and paint order in the panes,
  and persists with the rest of the settings.
- **Beat markers and extractor markers are real layers.** The BPM grid and the scan-region
  colour bar moved out of the always-on chrome into the Layers menu (`BeatsLayer`,
  `RegionsLayer`), so they can be placed, re-ordered, given their own row, or hidden.
  In a short row lane the region bar grows to fill the lane. Chrome now draws only the
  time axis and sample name.
- **Scale badges.** Ruler/grid layers (piano scale, beat markers) carry a `scale` badge
  in the menu and stay out of the in-canvas legend.
- **Legend checkbox.** The in-canvas legend is now optional, toggled at the bottom of
  the Layers menu and persisted.

#### Changed

- **The 🎚 Layers button moved from the viewer canvas to the global footer**, between
  Copy Peak Data and ☆ Favorite (Examiner and Favorites tabs only); the menu opens
  upward. Settings now flow through a small shared store in `layers/registry.ts`
  (`useSyncExternalStore` on both sides), so the footer menu and the Examiner canvas
  stay in sync without prop-drilling across tabs.
- **Layer settings persist under a new `v2` key** (`scanalyzer_examiner_layers_v2`),
  with placement (`top`/`bottom`/`row`/`off`), per-group order and the legend flag.
  Saved v1 settings migrate: visible layers land on their domain's normalled pane,
  explicit rows stay rows.

### 2026-07-14 — music taxonomy explosion

#### Added

- **The music side of the UCS taxonomy exploded into 13 fine-grained top-level
  categories**, each with reasoned acoustic signatures (gates + priors) and a MISC
  abstention bucket — ~93 subcategories in all:
  **DRUMS, CYMBALS, PERCUSSION, MALLET, STRINGS, GUITAR, BRASS, WOODWIND, KEYBOARD,
  PIANO, SYNTH, VOCALS, LOOPS**. PIANO is split from KEYBOARD (piano *size* is not
  audible, so those stay name-only); SYNTH is organized by patch role
  (Bass/Lead/Pad/Pluck/Arp…), not synthesis type; LOOPS covers looped material
  (a one-shot classifies as its instrument).
- These custom, non-standard-UCS categories carry **`"version": "8.2.APK"`** so they
  are distinguishable from the stock UCS `8.2.1` categories.
- The full MUSICPROD producer file-name vocabulary (instrument phrases + abbreviations)
  was captured into the new categories' synonyms, plus the standard producer shorthand
  (BD, SD, Vln, EP, Sax, Xylo, Vox, Tops, MID…).

#### Changed

- **The Examiner / scope bar is UCS-only.** Top-level scope chips are the UCS
  categories the library contains; sub-chips are their UCS subcategories.

#### Removed

- **MUSICAL retired.** Its 21 subcategories are superseded by the new instrument
  categories; its `producer_synonyms.json` overlay was re-homed onto them.
- **MUSICPROD retired as a user-facing axis.** The `music_production_category` field,
  the Examiner's "UCS Prod" column, and the production-role scope chips are gone — the
  new instrument categories are the sole music taxonomy.
- **`UCS/categories/MUSICPROD.json` removed from the UCS category set.** It was never a
  UCS category (name synonyms, not acoustic signatures); it now lives as a private
  analyzer asset at `sample_analyzer_rs/src/NameSorting/music_names.json`, still driving
  the internal `group`/`subgroup` that family, clustering and labels read — behaviour
  unchanged, but it is out of the UCS taxonomy and the build's category bundle.

### 2026-07-14 — examiner playback & analyzer

#### Added

- **`onset_rate_per_second` is a first-class metric.** Emitted on every record
  (`envelope.onset_rate_per_second` = `transient_count / length_seconds`, `None` only
  for a zero-length clip) so consumers read it off the record instead of re-deriving it;
  the UCS matcher now reads the stored field, falling back to the on-the-fly derivation
  for older sidecars.
- **Scroll-ahead audio buffering in the Examiner.** Selecting or scrolling pre-reads a
  window of ±10 rows around the viewport, biased toward the scroll direction, so the next
  plays are instant — a real win on desktop, where each play reads the file over IPC.
  Bounded cache with blob-URL eviction; the playing track is pinned. (`useAudioPrefetch.ts`)
- **Stereo waveforms.** The Examiner preview draws the left and right channels as separate
  top/bottom lanes (with an L/R divider) for stereo files; mono is unchanged.

#### Changed

- **k-means clustering standardizes with Z-score** (was min-max), matching PCA — so the
  cluster space and the PCA map share one geometry and a single outlier can no longer
  crush a feature's contribution. A shared `standardize()` is the single normalization
  both paths use.
- **Source modules regrouped into purpose folders** — `Clustering`, `Core`, `Pipeline`,
  and a `Scananalyzers` split into `Musical` / `Spectral` / `Temporal`. No behaviour change.

#### Fixed

- **The Examiner froze on fast arrow-key navigation (desktop).** Every ↓/↑ ran the full
  read → decode → play pipeline; holding the key piled up dozens of concurrent
  `decodeAudioData` calls and deadlocked WebKitGTK's WebAudio. The heavy work is now
  debounced (90 ms) behind the selection with a generation guard, so hammering the keys
  triggers a single load when you settle, not one per row.

### 2026-07-14

#### Added

- **UCS runner-ups are first-class.** `ucs.alternatives` now carries the three
  next-best candidates the matcher scored, each a parent of its parts:
  `{ category, subcategory, id, probability }`.
- **Examiner** shows each alternative as `Alt N Group` / `Alt N Sub` / `Alt N Prob`.
- **Alternatives feed the scope bar and the search box.** Scope to DOORS and you get
  everything the scorer *considered* a door, not only what it committed to. A row that
  is in scope only because a runner-up matched is **greyed** — it is a maybe, not a hit.
  On a 40-file test set this surfaced 18 categories that were previously unreachable.

#### Changed

- **`ucs.alternatives` is no longer a packed abbreviation.** It was a single string of
  the abbreviated id plus a number (`"DSGNMisc 0.003"`). Nothing on the record said
  which *category* that id belonged to, so the UI had to carry a generated 778-entry map
  just to fold a runner-up under its category, and no consumer could filter on one
  without re-parsing it. Field names in the `.PEAK` are spelled out in full; this one
  now is too. **This changes the data model** (see Migration).
- **The scope bars in 3D, 2D and the Examiner all scope by UCS category → subcategory**,
  discovered from the data.
- The 3D cloud defaults to colouring by UCS Category. Its saved preferences are
  versioned, so axis/colour picks reset once.

#### Fixed

- The Examiner crashed (`Objects are not valid as a React child`) when alternatives
  became objects — it was rendering the raw value into a cell.

### 2026-07-13

#### Added

- **MUSICPROD — the music-production role axis.** A new category in
  `UCS/categories/MUSICPROD.json`, carrying MUSICAL's 21 subcategories plus a new
  `IMPULSE RESPONSE`. It answers *what part does this play in a production*, where UCS
  answers *what is this sound*. Both ride on every record.
  It is marked `"matchable": false` and is **excluded from the UCS matcher index**:
  enrolling it would give every music sample a twin candidate with an identical
  signature, splitting the posterior and diluting the IDF of every music token.
- **Scanalyze: a folder survey before any work happens.** Picking a folder now lists
  what was found — file count, total size, how many already have `.PEAK` sidecars, how
  many need analysis, and the first 200 paths — and waits for a go-ahead. Sidecars are
  then absorbed in chunks, so the tab stays alive. A 41k-file library used to read every
  sidecar, one awaited call at a time, before drawing a single pixel.
- **Legacy `.PEAK` migration** (`Web_Front/src/peakSchema.ts`). Records written before
  the grouped schema are re-grouped on load. Fields the old analyzer never computed
  (the whole `ucs` block, `lufs`, mid/side RMS) are left **absent**, so a missing feature
  reads as absent rather than as a plausible zero.

#### Changed

- **The "god categories" are gone**, replaced by the music-production role
  (`classification.god_category` → `classification.music_production_category`).
  The old map only ever looked at the name *group*, so every bell, cowbell, gong, chime,
  kalimba and shaker collapsed into one bucket, a synth was indistinguishable from a
  piano, and its `Vocal` match arm was dead — the analyzer emits `Voice`, so it had never
  once fired. The new mapper reads the subgroup too. Because roles now separate tuned
  from untuned percussion, a bell or kalimba keeps its root note instead of having it
  suppressed as a "percussive hit".
- The desktop app scans with **one worker per core**. It was hardcoded to 30, which
  oversubscribed any smaller machine and made the whole desktop unresponsive.
- The desktop scan's progress events carry only progress. Each one used to ship the
  entire ~3.7 KB analysis record, which the UI parsed, re-rendered on, and then threw
  away — ~18 MB of IPC on a 10k library, for nothing. **32× less IPC.**
- README retargeted at the Tauri desktop app and the web deployment; the Python
  front-end is gone (`support/` and `run.sh` no longer existed).

#### Fixed

- **The app white-screened on load.** It auto-loaded a bundled sample `.PEAK` that
  predated the grouped schema, so `item.metadata` was undefined and React unmounted the
  whole tree — before any user action. The sample dataset has been removed entirely; the
  app now opens empty.
- **Sidecars were never being reused.** The version gate read `analyzer_version` at the
  top level of the sidecar while the writer had moved it under `metadata`, so every
  sidecar was judged stale and **every file was re-analyzed on every scan**.
- Loading a large `.PEAK` in the desktop app crashed it: the whole file was read into one
  string and pushed through IPC (~150 MB for FSD50K.dev). Rust now parses it once and
  pages it to the webview.
- A moved or deleted audio folder left a permanently poisoned directory handle that threw
  on every page load, and "Load Sounds" silently did nothing. The handle is now forgotten.
- Desktop playback was dead for browser-scanned libraries: the web scanner records
  *relative* paths and Tauri's asset protocol needs absolute ones. "Link Audio Folder"
  now supplies the root they resolve against.
- The scan progress UI never showed progress: the listeners were re-subscribed whenever
  state changed, so the `start` event — the only one carrying the file total — landed in
  the gap and was lost.
- Stats, Groups, Rename and the Examiner were still reading the pre-grouping flat record
  in a dozen places. None of them threw; they silently produced wrong output (every
  sample "Unclassified", search matching nothing, blank columns).

### 2026-07-12

#### Added

- **UCS acoustic-signature engine** — every file is scored against all 82 UCS categories
  (756 subcategories) rather than mapped by a hardcoded table.
- **UCS as a first-class taxonomy** in both 3D clouds, and surfaced in the inspector.
- MP3 and AIFF decoding.

#### Changed

- **The signatures are calibrated against FSD50K.** They began as *reasoned* numbers —
  derived from physics and the UCS explanation text, never once compared to real audio.
  651 priors now move to the measured median, each stamped with a `provenance` block
  naming the dataset and the value it replaced; 32 gates were fixed (20 widened, 12
  retired as vacuous), cutting the rate at which gates rejected their own true clips from
  14.3% to 8.0%. See `UCS/fsd50k_calibration.json` and the README.
  - **Deviations may only widen, never tighten.** FSD50K is amateur Freesound audio; a
    UCS library is clean professional SFX. A prior that is too tight is worse than one
    that is too loose — it produces confident wrong answers.
  - **Eleven features are never calibrated from this corpus**, because there they measure
    the uploader rather than the sound (`length_seconds`, `lufs`, `stereo_width`,
    `voicing_ratio`, …). They keep their reasoned values, and `not_calibrated` says so.
- **The `.PEAK` record is grouped** into `metadata` / `classification` / `envelope` /
  `spectral_features` / `musicality` / `unsupervised` / `ucs`. **This changes the data
  model** (see Migration).

## Migration

**Re-scan your libraries.** The analyzer version has changed, so existing sidecars are
invalid and will be recomputed automatically.

Old `.PEAK` files still load — the web app migrates them — but with gaps:

| Written by | Loads? | Caveat |
| --- | --- | --- |
| Pre-grouping (flat) | yes | No UCS block, no LUFS, no mid/side RMS. Those columns are blank until re-scanned. |
| Pre-MUSICPROD | yes | No `music_production_category`; the role is derived from the name group where possible. |
| Pre-structured alternatives | yes | Alternatives resolve through a back-compat shim (`Web_Front/src/ucsIndex.ts`) rather than carrying their own names. |

`classification.god_category` has been removed. Anything reading it should read
`classification.music_production_category`.
