# Codebase untangling audit — files over 200 lines

Scope: every source file over 200 lines across the whole repo (≈30 files, excluding the
`.claude/worktrees/` mirror) — Rust analyzer, Rust extractor/Tauri/graphing crates, the
React/TS front-end, and the Python calibration tooling. Audited in five parallel passes;
this document ranks what they found by leverage and gives a phased remediation plan.

**The headline:** there are almost no import cycles (one, in Rust) and the dependency
*direction* is mostly healthy. The rot is three recurring patterns:

1. **Generated data tables shipped as source code — and already drifted out of sync.** This
   is the only class of finding that is a *live correctness bug*, not just debt.
2. **The `.PEAK` record schema is duplicated as bare strings across four languages** with no
   single source, so every field name is a stringly-typed coupling maintained by hand.
3. **God-functions / god-components and copy-pasted primitives** — the same DSP math, decode
   pipeline, download helper, RMS track, and WAV muxer re-implemented 2–4 times, the copies
   quietly diverging.

---

## Part 1 — Cross-cutting tangles, ranked by leverage

### 1. Drifted generated tables (CORRECTNESS BUG — fix first)
The taxonomy is encoded **three times** in the front-end and **three more times** in Python,
each regenerated separately, and they have already diverged:

- `ucsIndex.ts:16-795` `UCS_BY_ID` (~778 entries) still maps `MUSC*`/`MUSP*` → `MUSICAL` /
  `MUSICPROD` — the coarse lumps that [[music-taxonomy-explosion]] **replaced** with 13
  instrument categories. Those 13 *are* present in `groupColors.ts:88-105 UCS_CATEGORIES` and
  `categoryEmoji.ts:6-101`, so `ucsIndex` has no ids for DRUMS/GUITAR/SYNTH/… while the other
  two tables do. Three tables that must agree, silently out of step.
- Python restates the same feature vocabulary three ways: `fsd50k_calibrate.py:32-45`
  `VOCABULARY`, `validate_signatures.py:27-51`, and the Rust `feature()` names — plus three
  divergent `LOG`/`MUST_BE_LOG` sets (`fsd50k:64-68`, `music_calibrate:46-52`,
  `validate_signatures:55-61`) that already disagree on `complexity`/`beats_per_minute`.

**Fix (one change, kills the bug and ~1,600 lines of "code"):** generate every taxonomy/
vocabulary table from **one** source into JSON, and have TS, Python, and Rust all read it.
`ucsById.json`, `ucsCategories.json`, `categoryEmoji.json`, `ucsVocabulary.json`. These files
are data wearing a `.ts`/`.py` costume; their headers already say "GENERATED — do not edit by
hand," yet they live where hands edit.

### 2. The `.PEAK` schema is stringly-typed across the whole stack
The record's field names are hardcoded as strings in at least four places with no shared
contract:

- `ucs.rs:215-300` `feature()` — a **60-arm** `match` mapping spec feature-names to `Peak`
  field paths. Adding a feature means editing this match + the `Peak` struct + `analyze.rs` in
  lockstep.
- `graphing_rs/src/main.rs:92-255` — `"group"`, `"timbre"`, `"complexity"`, `"length"`… bare
  literals scattered across four functions.
- Python `fsd50k_calibrate.py:103` / `music_calibrate.py:84` — the PEAK block tuple
  (`'metadata','envelope','spectral_features','musicality'`) hardcoded identically, plus the
  `onset_rate_per_second` derivation copied verbatim from `ucs.rs feature()` into both
  (`fsd50k:108-110`, `music:89-91`).
- Front-end: **three** parallel field-path registries over the same record —
  `SampleCloud.tsx:12-30` `CLOUD_FEATURES`, `StatsTab.tsx:16-31` `NUM_FEATURES`, and
  `ExaminerTab.tsx COLUMNS[].get`.

**Fix:** make `Peak` the single schema owner; generate a name→accessor table from it (Rust:
`phf`/derive so `feature()` becomes a pure getter, not a 60-arm match). Emit the field list to
JSON for Python and the graphing crate. Front-end: one `features.ts` (label → accessor +
categorical flag) feeding all three tabs.

### 3. Real module cycle + shared-mutable `Peak` (Rust)
`peak.rs:65` uses `crate::ucs::Alternative` while `ucs.rs:26` uses `crate::peak::Peak` — a true
cycle. Compounded by `Peak` being a default-then-mutate bag: `analyze.rs:338-345` writes seven
`p.ucs.*` fields in place, and region re-analysis pokes `peak.regions.regions.get_mut(i)`
(`analyze.rs:325`). **Fix:** move `Alternative`/`Verdict` DTOs into `peak.rs` (or a `model`
module) so taxonomy depends on the model, not vice-versa; have `classify()` **return** the
`Ucs` value and assemble `Peak` once via a constructor.

### 4. God-functions and god-components
| Site | Size | What it conflates |
|---|---|---|
| `analyze.rs:86-333` `analyze_core` | 248 lines, 13 positional args | ~25 DSP stages + 90-line `Peak` literal + recursive region analysis + 4 inline taxonomy rules |
| `ucs.rs:548-782` `classify` | ~230 lines | tokenize + score loop + normalize + rank + alternatives + verdict |
| `ExaminerTab.tsx` | 901 lines | list virtualization + column config + decode + `<audio>` graph + 146-line canvas renderer + transport + layout |
| `ExtractorTab.tsx` | 727 lines | decode + audio graph + region playback engine + detect + export + region table |
| `src-tauri/src/lib.rs` | 400 lines | fs survey + peak cache + audio serving + in-proc extractor + subprocess IPC |
| `fsd50k_calibrate.py:324-519` `cmd_calibrate` | 195 lines | load + gate audit + prior calibrate + evidence + archetypes + history merge + write + report |

**Fix pattern (same everywhere):** split each into named phases that return small values, and a
thin assembler/writer at the end. Details per file in Part 2.

### 5. Copy-pasted primitives (the copies have diverged)
- **Front-end decode pipeline** — `decodeAudioSafely` (fetch → `decodeAudioData` 150ms
  `Promise.race` → WAV/WASM fallback → `toMono`) exists twice: `ExaminerTab.tsx:600-631` and
  `ExtractorTab.tsx:227-267`; **Examiner's fallback is stubbed out** ("External decoding
  helpers removed") — the copies already disagree, and this is the fragile WebKitGTK
  workaround. *Highest-leverage front-end fix.*
- **Rust DSP math**: OLS fit twice (`morphology.rs:409-430` vs inline `envelope.rs:184-196`);
  normalized autocorrelation twice (`vad.rs:151-175` vs `advanced_stats.rs:92-116`); per-frame
  RMS in ≥3 places; Hann window hand-written in ≥2. → a `dsp` util module.
- **Cross-crate Rust**: RMS envelope (`extractor_engine lib.rs:114-129` vs
  `envelope.rs:48-63`), `Region` struct (`extractor_engine:22-36` vs `peak.rs:165-180`),
  `AUDIO_EXTENSIONS`/`is_audio` (`src-tauri:30-38` vs `decode.rs:56-64` — comment admits "keep
  the two in step"), WAV handling scattered across three crates.
- **Front-end helpers**: `download`/anchor-click in 3 places (`ExtractorTab:515-522`,
  `RenameTab:88-93`, `App:347-355`); path-stem regex copy-pasted 8×; paged-peak read
  (`open→read_page→close`) in 4 places; directional arrow-key nav 3×; playhead rAF loop 4×.
- **Python**: `robust()`, `signif()`, `load_clips`/`load_records`, `calibrate_prior` are
  ~70% identical between `fsd50k_calibrate.py` and `music_calibrate.py`.

### 6. Hidden mutable state / back-channels
- **The transport delegation added this session** (`App.tsx` `tabTransportRef` + `tabPlaying`/
  `tabDigging` + the register handshake, mirrored in `ExaminerTab:676-686` /
  `ExtractorTab:433-439`) is a bespoke pub/sub spread across five sites, and every audio-owning
  tab must re-implement the handshake. It works, but it's debt. **Fix:** a `TransportContext`
  provider — tabs `useTransport().register(...)`, the footer consumes it; deletes the ref-
  passing and the `onPlayingChange`/`onDiggingChange` prop drilling.
- **`src-tauri` global `Mutex` caches**: `PeakCache` has an untyped temporal protocol (must
  `open` before `read`; two openers race one slot); `ExtractorCache` is a **single slot** that
  three interleaved IPC paths thrash, re-decoding each call. → keyed LRU + an API that enforces
  open→read→close.
- **Calibration constants compiled into code**: `ucs.rs` scoring knobs (`KAPPA`, `IDF_UNIT`,
  `POSTERIOR_SHARPNESS`, `tier_exponents`, …) and `vad.rs`/`morphology.rs` thresholds are
  corpus-swept values ([[fsd50k-calibration]]) baked into `const`s; re-tuning needs a
  recompile. The module already loads its taxonomy from bundled JSON — the knobs belong there
  too.

---

## Part 2 — Per-subsystem detail

### Frontend components
- **ExaminerTab (901)** — extract: `renderPreview.ts` (the 146-line canvas routine, `361-507`);
  `decodeAudioSafely` (shared); `<SampleRow>` (the 74-line JSX IIFE at `754-828`, which also
  does an O(cols²) `.find` per cell — precompute a visible-key Set); `useMaxima` for the six
  near-identical reducers (`164-185`); consolidate the three fighting selection/scroll effects
  (`253-270`, `273-284`, `347-356`).
- **ExtractorTab (727)** — `setupAudioAndDetect` (`196-295`) splits into shared decode + local
  detect; `useRegionPlaybackEngine` for the ref-driven gain rAF (`166-194`); `<RegionTable>`
  for the inline `<table>`.
- **ScanalyzeTab (607) / TauriScan (381)** — extract `lib/scanPool.ts` (the hand-rolled worker
  pool, `264-337`) and a shared `<ScanSurvey>` presentational component (the near-duplicate
  survey screens, `424-530` vs `273-357`, whose version-compare logic has diverged). Note
  `ScanalyzeTab:61-72` returns `<TauriScan/>` **above** its hooks — a rules-of-hooks violation
  that's only safe because `isTauri()` is stable.
- **App (577)** — `TransportContext` (see §6); split `reopenFolder` (`164-238`) into
  `reopenTauri`/`reopenWeb`; `Promise.all` the `FileReader` counter in `loadPeakFiles`.
- **SampleCloud (459)** — `setCapacity` during render (`171-174`) is a React anti-pattern → move
  to a ref; collapse the shape→rotation/geometry switch written 3× into one `SHAPE_SPEC` table;
  data-drive `getShapeFor` (`96-130`).
- **RadialWaveform (214) / WavePlayer (202)** — both well-encapsulated; share the playhead-rAF
  and `useLatest` patterns. `WavePlayer:54` mutates an HSL string by `.replace('58%)', …)` —
  give `regionColor` an alpha parameter instead.

**Top shared extractions:** `decodeAudioSafely` · `useCanvasPlayhead(ref, getProgress)` ·
`useRegisterTransport`/`TransportContext` · `<ScanSurvey>` · `nearestInDirection` ·
`lib/download.ts` · `readPeakPaged` · `useVirtualRows` · one `features.ts` registry ·
`useLatest(fn)`.

### Frontend shared modules
- **groupColors.ts (256) — worst offender, 5 concerns:** color/hash math (`crc32` `14-29`,
  `hsv` `31-54`, `complementColor` `58-74`) + the load-bearing `UCS_CATEGORIES` order table
  (`88-105`) + scope-query logic (`taxonomyKeys`/`matchesScope`/`scopeSubgroups` `154-255`).
  Split into `colorMath.ts` (leaf), `taxonomy.ts` (scope/record logic), leave only the palette.
  Dead code: `ucsSubKey` (`138`, byte-identical to `subKey` `10`), `taxonomyMatch` (`244`,
  unused), the `_taxonomy` param threaded everywhere despite `Taxonomy` being the single literal
  `'UCS'`.
- **ucsIndex.ts (831)** — 90% is the stale `UCS_BY_ID` table (see §1). The 5 accessors are the
  only code; `hasAlt` (`829`) has no importers.
- **categoryEmoji.ts (228)** — clean logic, but two ~600-entry literal maps that should be JSON.
- **audioLinking.ts (273)** — split into `fsaStorage.ts` / `dirScan.ts` / `audioResolve.ts`;
  it imports Tauri both statically (`154`) and dynamically (`240`) — pick one.

### Rust analyzer core
- **analyze.rs / ucs.rs / peak.rs** — see §2, §3, §4.
- **morphology.rs (655)** — owns the OLS helpers envelope.rs duplicates; `Morphology` is a
  7-field bag mirrored 1:1 into `SpectralFeatures`/`Musicality`, so adding an axis touches 5
  files → a per-analyzer `Analyzer::features()` trait.
- **envelope.rs (301) / vad.rs (261)** — inline OLS and a second autocorrelator; both re-derive
  the RMS track envelope.rs already owns. `vad` already correctly *reuses*
  `morphology::syllabic_modulation` — that's the pattern the duplications should follow.
- **decode.rs (253) / peak.rs (207)** — cleanest; `read_audio`/`read_audio_buffer` share a
  WAV-fast-path worth a helper; `peak.rs` is a plain DTO whose only sins are the cycle and being
  poked in place.
- **Cross-module dedup → a `dsp` module:** `ols`, `normalized_autocorr`, `rms_track`/
  `frame_energy`, `window::hann`, one `UNMEASURABLE_LUFS` sentinel, single owner of
  envelope-shape semantics (thresholds live in both `envelope.rs:205-219` and
  `categorize.rs:141-155`).

### Rust engines / Tauri / graphing
- **extractor_engine (556)** — clean leaf crate; split the one file along its existing `//----`
  banners (`params`/`envelope`/`detect`/`refine`/`slice`/`wav`). It's the designated single
  source for detection (analyzer already delegates to it via `regions.rs:28-51`) — extend that
  pattern to the RMS envelope and `Region` struct it still forks.
- **src-tauri/lib.rs (400) — most tangled file:** split `survey`/`peak_cache`/`extractor`/
  `analysis_process`; fix the global `Mutex` caches (§6); `start_analysis:289` hardcodes a
  **relative** path to the compiled analyzer binary **while the same crate is linked as a
  library** — pick one mechanism (prefer in-process). Inconsistent panics: `.unwrap()` on a
  poisoned mutex (`216`), `child.stdout.take().unwrap()` (`309`), `unwrap_or_default()` silently
  dropping bad detect params (`236`).
- **graphing_rs (286)** — cleanest; minor: extract `categorical_index()` (built twice, `152-163`
  & `210-227`) and `const` the schema field strings.
- **Cross-crate dedup:** RMS envelope, `Region` struct, `AUDIO_EXTENSIONS`/`is_audio`
  (re-export from the analyzer — already a dependency), and WAV encode/decode/chunk-walk (three
  crates) → one shared `wav` module.

### Python calibration & tooling
- **`fsd50k_calibrate.py` (602) / `music_calibrate.py` (248) are ~70% the same code** with two
  genuine policy differences (widen-only vs allow-tighten; filename/crosswalk vs
  `music_production_category` labels). Extract `ucs_calib.py`: shared constants (generated from
  the Rust/spec side — see §1), `load_peaks(corpus, label_fn)`, `robust`/`signif`/`values`, and
  one `calibrate_prior(p, clips, *, allow_tighten, never, min_clips)` where the widen/tighten
  split is a flag (`fsd50k:237-239` vs `music:166`). Each script shrinks to its unique part.
- **`validate_signatures.py` (202)** — cleanest logic but built on module-global mutable
  accumulators mutated inside `check()` (`63-71`); the whole driver runs at import time. Wrap in
  a `Validator` object / move to `main()`.
- **`patch_stats.py` (359)** — not tooling: a top-level, single-shot codegen doing three
  `str.replace()` calls on huge embedded source strings that **fail silently** on any drift and
  write to `_new.py`. Run it once, commit the result, **delete it**.

---

## Part 3 — Remediation roadmap (do in this order)

**Phase 0 — stop the bleeding (correctness):**
1. Generate the taxonomy/vocabulary tables from one source → JSON consumed by TS/Python/Rust.
   Regenerate `UCS_BY_ID` so it carries the 13 instrument categories. *(Fixes the live drift
   bug; deletes ~1,600 data-lines-as-code.)*
2. Delete `patch_stats.py` after committing its output.

**Phase 1 — kill the highest-traffic duplications (cheap, high reach):**
3. `decodeAudioSafely` (front-end) — one copy of the WebKitGTK workaround.
4. `lib/download.ts`, `readPeakPaged`, `nearestInDirection`, `useLatest`, `useCanvasPlayhead`.
5. Rust `dsp` module (OLS, autocorr, RMS, Hann); re-export `AUDIO_EXTENSIONS` from the analyzer.

**Phase 2 — break the structural knots:**
6. `peak.rs` ↔ `ucs.rs` cycle: move verdict DTOs to a `model` module; `classify()` returns a value.
7. `TransportContext` replaces the `tabTransportRef` back-channel.
8. Make `ucs.rs feature()` a generated getter over a `Peak` that stores every derived field
   (kills the 60-arm match *and* the `onset_rate`/`stereo_width` re-derivations).

**Phase 3 — de-monolith (mechanical, do as you touch each area):**
9. Split `analyze_core`, `classify`, `src-tauri/lib.rs`, `ExaminerTab`, `ExtractorTab`,
   `cmd_calibrate`, and `groupColors.ts` along the seams named in Part 2.
10. Shared `ucs_calib.py`; `wav` module across the Rust crates; per-analyzer feature trait.

**Phase 4 — configuration:**
11. Move corpus-swept scoring/threshold constants (`ucs.rs`, `vad.rs`, `morphology.rs`) into the
    data bundle so re-tuning doesn't require a recompile.

---

*Method note: five parallel auditors, one per subsystem, each reading its files in full; line
references are their evidence pointers (a couple may be ±a few lines after later edits). No hard
import cycle exists in the front-end or Python — the front-end tangle is duplicated logic plus
the ref-based transport back-channel; the only true cycle is `peak.rs`↔`ucs.rs`.*
