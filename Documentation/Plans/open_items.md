# Open items

Verified-open engineering items (checked against the code on 2026-07-16). These
are the only surviving true parts of the retired `ucs_training_strategy.md` and
`architecture_migration_plan.md` — everything else in those plans had already been
done or reverted, so they were deleted.

## 1. `MAX_FRAMES = 3000` still truncates long-file analysis (latent bug)

`max_len` was raised to 600 s (`sample_analyzer_rs/src/Core/args.rs:28`), but the
STFT frame cap was **not** lifted:

```rust
// sample_analyzer_rs/src/Scananalyzers/Spectral/stft.rs:7
const MAX_FRAMES: usize = 3000;
```

At the default hop this caps spectral analysis at ~35 s regardless of `max_len`, so
ambience / weather / texture beds — the long material the `max_len` fix was meant to
admit — are still silently truncated. Raise `MAX_FRAMES` (or make it derive from
`max_len`) so the two limits agree.

## 2. No batch feature-dump mode (dir → CSV)

The analyzer only writes per-file `.PEAK` sidecars (`Encoders/sidecar.rs`); the CLI
(`Core/args.rs`) exposes only `--out / --workers / --max-len / --clusters / --stride
/ --force / --no-per-file`. There is no CSV/Parquet "one row of features per file"
export. That flat table is the natural interface for any future calibration /
validation pass, and it does not exist yet.
