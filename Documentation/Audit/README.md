# Audit

Retrospective examinations of the codebase, data, and dataset — findings, bug
investigations, and recommendations. Forward-looking design docs (specs, plans,
strategies) live one level up in [`../`](../README.md).

## Codebase & architecture

- [codebase_untangling_audit.md](codebase_untangling_audit.md) — every source file
  over 200 lines, across Rust/TS/Python. One live drift bug (generated taxonomy
  tables out of sync), stringly-typed `.PEAK` schema, god-functions, and copy-pasted
  primitives, with a phased remediation roadmap.
- [python_vs_web_audit.md](python_vs_web_audit.md) — feature deltas between the Python
  desktop GUI and the React/WASM web front-end (auto-guess, groups/CSV export, cloud
  presets, shared inspector). *(was `alignment.md`)*
- [day2_optimisations.md](day2_optimisations.md) — alignment between the native Rust
  (Tauri) and web (WASM) builds: PCA/clustering, multithreaded WASM via WebWorkers,
  taxonomy de-duplication, and File System Access sidecar caching.
- [frontend_rewrite_audit.md](frontend_rewrite_audit.md) — how the Python GUI wraps the
  decoupled Rust binaries, and framework options (Tauri / Egui / Flutter) for a rewrite.
  *Strategy-flavoured.*
- [typescript_web_audit.md](typescript_web_audit.md) — path to a pure-TypeScript web
  front-end: Web Audio API, local Rust server vs. Rust→WASM. *Strategy-flavoured.*

## Cloud / UI

- [cloud_group_filter_audit.md](cloud_group_filter_audit.md) — why cloud group
  filtering "still isn't working": two independent filter systems, and the real root
  cause (the AlphabetScrubber booting with a hidden A–E filter). Fixes applied inline.
  *(was `3d group filter.md`)*
- [favorites_tab_audit.md](favorites_tab_audit.md) — design audit for the Favorites
  tab: F-to-flag while listening, orange marking, a second Examiner mount filtered to
  favorites, and `favorites.json` written beside the manifest (user data, never touched
  by re-scans). Interactive visual: [favorites_tab_audit.html](favorites_tab_audit.html).

## Audio library & codecs

- [codec_audit_report.md](codec_audit_report.md) — audit of the Music Samples library;
  recommends FLAC for lossless archival, with a safe conversion procedure that protects
  the `.PEAK` analysis sidecars and sampler/loop chunks.
- [binary_peak_preview_audit.md](binary_peak_preview_audit.md) — research audit for
  instant long-file previews: an 8-bit min/max peak map (base64, ≤ ~43 KB) inside the
  `.PEAK`, a `preview_only` analysis tier replacing the silent 600-s skip, a Value-merge
  backfill pass, and a paint-from-preview display path. Interactive visual:
  [binary_peak_preview_audit.html](binary_peak_preview_audit.html).

## UCS taxonomy & datasets

- [fsd50k_audit.md](fsd50k_audit.md) — technical audit of the FSD50K dataset **and** what
  the calibration actually did once the data was on disk (crosswalk, clip funnel, the
  five features it must not calibrate, the `harmonicity` DSP defect, and the separability
  tiers proven too pessimistic). *(was `Free Sound Dataset - FSD50K Audit.md`)*
- [ucs_modernization_audit.md](ucs_modernization_audit.md) — how scanalyzer's DSP/ML can
  evolve UCS from a passive naming convention into a mathematically verifiable standard.
- [ucs_adjective_audit.md](ucs_adjective_audit.md) — synonym-lexicon audit flagging 140
  adjective/adverb tokens (e.g. "silly", "double") that risk hijacking unrelated file
  names, each with a keep/stopword verdict.
