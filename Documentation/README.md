# Documentation

Design docs for the Sample Analysis toolchain, filed by type:

| Folder | Contents |
|---|---|
| [`Specs/`](#specifications) | Specifications — the exact grammar/math/design a component must follow |
| [`Plans/`](#plans) | Plans — verified-open engineering to-dos |
| [`Audit/`](Audit/README.md) | Audits — retrospective findings, bug investigations, dataset reviews |
| [`Fixes/`](#fixes) | One-shot migration / patch scripts (not documentation) |

## Specifications

- [Specs/ucs_signature_spec.md](Specs/ucs_signature_spec.md) — the UCS Acoustic
  Signature spec (v1): the morphology enum, closed feature vocabulary, the signature
  block grammar, and the exact scoring math for classifying a file against the 753 UCS
  subcategories.
- [Specs/sample_conversion_architecture.md](Specs/sample_conversion_architecture.md) —
  design for the `Sample_Conversion_rs` engine (WAV/FLAC, channel mixing, high-quality
  resampling) and its job-manifest IPC.

## Plans

- [Plans/open_items.md](Plans/open_items.md) — the two verified-open engineering items
  (the un-raised `MAX_FRAMES` cap, and the missing batch feature-dump mode).

> The `architecture_migration_plan.md` and `ucs_training_strategy.md` docs were deleted
> on 2026-07-16 after a code check found them stale/false — the migration was a hybrid
> (not native-only), and the UCS calibration/scorer described as "not yet done" had
> already shipped. Their only still-true items were extracted into `open_items.md` above.
> For current architecture see the root `README.md`/`CHANGELOG.md`; for UCS calibration
> results see [Audit/fsd50k_audit.md](Audit/fsd50k_audit.md).

## Audits

See [`Audit/`](Audit/README.md) for the ten audit reports (codebase untangling,
codec/library, cloud filtering, FSD50K, UCS modernization, and more).

## Fixes

One-shot scripts, kept for reference — **not** documentation:

- [Fixes/fix_voice.py](Fixes/fix_voice.py) — one-shot `.PEAK` migration renaming the
  `Vocal` group to `Voice` and syncing its timbre.
- [Fixes/patch_stats.py](Fixes/patch_stats.py) — single-shot codegen that string-patched
  `support/stats_tab.py`. Flagged for deletion after use in
  [Audit/codebase_untangling_audit.md](Audit/codebase_untangling_audit.md) (Part 2,
  Python tooling) — it fails silently on any source drift, so remove it once its output
  is committed.
