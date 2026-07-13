# Free Sound Dataset (FSD50K) — Technical Audit & Integration Potential

**Date:** July 2026  
**Subject:** Technical Audit of the FSD50K Dataset and Baseline SDK  
**Source Links:** 
- [Zenodo Repository (Data)](https://zenodo.org/records/4060432)
- [Freesound Annotator Portal](https://fsannotator.upf.edu/fsd/downloads/)
- [Baseline System SDK (GitHub)](https://github.com/edufonseca/FSD50K_baseline)
- [Research Paper (TASLP 2022)](https://arxiv.org/abs/2010.00475)

---

## 1. Executive Summary
The **FSD50K** (Freesound Dataset 50k) is currently one of the most robust, fully-open datasets of human-labeled sound events available. Developed by the Music Technology Group at Universitat Pompeu Fabra (UPF), it contains **51,197 audio clips** (over 108 hours) manually labeled across **200 sound classes** drawn directly from the Google AudioSet Ontology.

For the `scanalyzer.like.audio` engine, this dataset represents a pristine, pre-curated ground truth that can be used to benchmark, train, or stress-test our machine-learning and acoustic feature extraction pipelines.

## 2. Dataset Specifications & Structure

### Audio Format
* **Fidelity:** Uncompressed PCM 16-bit, 44.1 kHz, Mono.
* **Duration:** Variable clip length from 0.3 to 30 seconds.
* *Audit Note:* The standardized 44.1 kHz / 16-bit Mono format makes it incredibly easy to ingest into our existing Rust processing pipeline (`read_wav` expects similar standardized formats).

### Data Splits
The dataset enforces a strict uploader-split (clips from the same Freesound uploader do not cross between dev and eval sets to prevent microphone/room acoustic bleeding).
1. **Development (Dev) Set:** 
   - 40,966 clips (80.4 hours). Average duration: 7.1s.
   - 114,271 *smeared* labels (labels propagated up the ontology tree).
2. **Evaluation (Eval) Set:** 
   - 10,231 clips (27.9 hours). Average duration: 9.8s.
   - 38,596 labels. Exclusively exhaustively labeled (complete and strictly correct).

### Labeling & Metadata
* **Weak Labels:** Labels are clip-level (e.g., "This clip contains a dog bark"), not strongly timestamped (e.g., "Dog bark from 1.2s to 1.8s").
* **PP/PNP Ratings:** Includes sound predominance ratings (Present and Predominant vs. Present but Not Predominant).
* **The "Collection" Format:** Includes raw, unmerged annotations for tiny classes (over 350 classes total before they were merged into the official 200).

## 3. Licensing Restrictions
FSD50K is completely open, but it inherits the specific Creative Commons licenses attached to the original Freesound uploads.
* **Included Licenses:** CC0 (Public Domain), CC-BY (Attribution), CC-BY-NC (Non-Commercial), and CC Sampling+.
* **Commercial Warning:** If `scanalyzer.like.audio` utilizes this dataset to train a proprietary commercial product, you **must explicitly filter out** the 6,041 files licensed under CC-BY-NC (Non-Commercial). 
* The overarching dataset structure itself is licensed under **CC-BY**.

## 4. The SDK & Baseline System
The creators have provided a Python-based machine-learning baseline to help developers ingest and model the data immediately:
* **Repository:** [edufonseca/FSD50K_baseline](https://github.com/edufonseca/FSD50K_baseline)
* **Capabilities:** Provides out-of-the-box PyTorch/TensorFlow scripts for large-vocabulary multi-label sound event classification, serving as the benchmark against which the paper was evaluated.

## 5. Potential Integration with Scanalyzer

### A. Ground-Truth Benchmarking
Since `scanalyzer` aims to correctly categorize instruments and sounds (via `categorize.rs` and the UCS mappings), we can run the entire FSD50K eval set through the Rust engine and compare our output against the human-labeled ground truth to generate an exact **accuracy percentage** for our acoustic guesser.

### B. Weak-to-Strong Label Generation
FSD50K only tells us that a sound *exists* in a 30-second clip. By running these clips through our **Onset Envelope** and **Trailing Silence** detectors, `scanalyzer` could automatically generate exact timestamp data for these events, effectively upgrading FSD50K from a "weakly labeled" dataset to a "strongly labeled" dataset.

### C. ML Acoustic Training
If we ever decide to replace our heuristic fallback tree (`Inharmonic` + `Stochastic` = `Percussion`) with a deep neural network, FSD50K provides enough high-quality, pre-labeled data to train a highly accurate proprietary neural net from scratch.

---

## 6. Calibrating the UCS Acoustic Signatures (added July 2026)

The 753 UCS signatures in `UCS/categories/*.json` (see `ucs_signature_spec.md`) currently
carry **reasoned** priors, not **measured** ones. Every `mean` and `deviation` was
derived from physics and from the UCS explanation text — none of it from data.
FSD50K is the obvious ground truth to fix that. This section records what it can
and cannot honestly do, because the traps are not obvious and two of them would
silently corrupt the signatures.

### 6.1 The crosswalk problem — measured, not assumed

FSD50K labels come from the AudioSet ontology (200 merged classes, 354 raw
"collection" classes). UCS has 753 subcategories. **There is no official mapping,
and the naive one does not work.** Matching FSD50K class names against the UCS
`synonyms` lexicon by token overlap produces:

| | |
|---|---|
| UCS subcategories matched per FSD50K class | **median 3, mean 6.4, max 44** |
| FSD50K classes matching exactly one subcategory | 73 / 378 |
| FSD50K classes matching more than ten | 83 / 378 |

The failures are not near-misses, they are category errors: **`Siren` → CREATURES-AQUATIC**
(the *mythological* siren is in the synonym list), **`Fire` → ALARMS-BELL** (via
"fire alarm"), `Air_horn_and_truck_horn` → 44 subcategories spanning AIR, AIRCRAFT
and ALARMS. Any coverage percentage computed this way is fiction.

**Consequence:** the crosswalk must be hand-adjudicated, or lifted from prior work.
The 2026 UCS unification paper ([arXiv 2606.05571](https://arxiv.org/abs/2606.05571))
already did exactly this — a rule-based multi-stage pipeline with conflict
resolution — and published **EnvSound-UCS**, 58,057 UCS-labelled clips drawn from
AudioSet, FSD50K and ESC-50. *Check whether their mapping table is released before
rebuilding it by hand.* That is the single highest-leverage next action.

### 6.2 Features FSD50K MUST NOT calibrate

This is the important part. Three of our priors would be actively poisoned:

1. **`length_seconds` — do not calibrate.** It is our most-referenced feature
   (1,358 prior/gate references across the 753) and it is precisely the one FSD50K
   cannot speak to. Clip duration in FSD50K is an artifact of Freesound upload
   conventions, truncated to 0.3–30 s. That a "rain" clip is 12 s long tells us
   nothing about rain; it tells us about the uploader. Calibrating duration priors
   here would bake an upload artifact into the taxonomy and would specifically
   destroy the AMBIENCE/WEATHER signatures, whose real durations run to minutes.
2. **`lufs` / `root_mean_square_level` — do not calibrate.** Freesound uploads carry
   arbitrary, uploader-chosen normalization. Our MOVEMENT continuum
   (PRESENCE < CROWD < ACTIVITY) and the GUNS foley-vs-firing loudness gate both
   rest on absolute level, and both would be calibrated to noise.
3. **`stereo_width` — cannot calibrate at all.** FSD50K is **mono**. The feature is
   undefined here, and it is load-bearing for AMBIENCE (wide) vs FOLEY (narrow).

### 6.3 Features FSD50K CAN calibrate (domain-robust)

Shape-based, level-invariant, duration-invariant quantities transfer honestly:
`spectral_centroid_hz`, `spectral_flatness`, `spectral_rolloff_hz`,
`spectral_slope_db_per_octave`, `harmonicity`, `inharmonicity`, `partial_count`,
`crest_factor`, `zero_crossings_per_second`, `onset_rate_per_second`,
`onset_periodicity`, `stationarity`, `spectral_flux`, `voicing_ratio`, and the
envelope *ratios* (`envelope_temporal_centroid`, `envelope_sustain_level`,
skewness/kurtosis). These are the backbone of the morphology axis, so this is
still most of the value.

### 6.4 The higher-value use: falsify the separability tiers

Calibration is the obvious use. **Validation is the better one.** The tier
assignments — 110 `signal_separable`, 334 `signal_narrowable`, 284 `semantic_only` —
are currently an *argument*, not a result. FSD50K can test them:

> Train a simple classifier (not a deep net — a logistic regression or gradient
> boosting on the analyzer's own feature vector) to discriminate each pair of UCS
> siblings that FSD50K covers. If a pair we called `signal_separable` scores near
> chance, our claim was wrong. If a pair we called `semantic_only` scores well
> above chance, we were too pessimistic and left signal on the table.

That converts the honesty tiers from a defensible opinion into a measured property,
and it is the only way to know whether the 38% `semantic_only` verdict is right.

### 6.5 Preconditions before any of this runs

- **The audio is not downloaded.** `/home/anthony/Downloads/FSD50K.metadata` holds
  metadata only (~29 MB). The clips (`FSD50K.dev_audio`, ~24 GB) and the official
  200-class `FSD50K.ground_truth/` folder are separate Zenodo downloads and are
  both absent. Only the raw 354-class `collection/` labels are on disk.
- **Filter to predominant clips.** Labels are *weak* (clip-level), so a 30 s clip
  labelled "Dog" may be 28 s of room tone and one bark — whole-clip features would
  be measuring the room, not the dog. `pp_pnp_ratings_FSD50K.json` covers all 51,197
  clips and carries **98,549** "Present & Predominant" (1.0) ratings against 27,386
  "Present but Not Predominant" (0.5). **Calibrate on PP only.** This filter is not
  optional; without it the priors describe backgrounds.
- **Raise `max_len`.** The analyzer drops files over 10 s by default; FSD50K's dev
  set averages 7.1 s and the eval set 9.8 s, so a large slice would be silently
  skipped.
- **Domain shift is real.** FSD50K is *Freesound* — wild, amateur, variable mics and
  rooms. UCS libraries are clean, close-miked professional SFX. Priors calibrated on
  the former will sit slightly off for the latter, especially noise-floor-sensitive
  ones. Treat FSD50K numbers as a *prior on the prior*, and widen deviations rather
  than tightening them.
- **Licensing.** 6,041 clips are **CC-BY-NC**. Deriving summary statistics is low
  risk, but if these ever train a shipped model, filter them out first.

### 6.6 Coverage, honestly stated

Because the crosswalk is unreliable, no trustworthy coverage number can be quoted
yet. What *is* certain from the label counts: coverage is heavily skewed toward
**MUSICAL** (PLUCKED 4.5k clips, PERCUSSION 3.4k, WOODWIND 4.2k) — the corner of the
taxonomy the analyzer already handles best — and is absent by construction for
`provenance_only` categories (ARCHIVED, FOLEY), which no dataset can label because
they are workflow states, not sounds. Expect the real calibratable fraction to land
well below the naive estimate, and to help least exactly where UCS is hardest.

---

## 7. Results — the calibration actually ran (July 2026)

Everything above §7 was written before the data was on disk. This section is what
happened when it was. **Three of §6.5's five preconditions were already stale:** the
audio *is* downloaded (51,197 clips), the official `ground_truth/` *is* present, and
`max_len` already defaults to 600 s. The two that mattered — the crosswalk and the
PP-only filter — held up exactly as written.

### 7.1 The crosswalk: the paper is real, and it is not enough

`arXiv:2606.05571` exists — *Sound Effects Dataset Unification With the Universal
Category System*, Beck & Lerch (Georgia Tech, June 2026). They publish per-file UCS
labels for all 51,197 FSD50K clips under **CC-BY-SA 4.0**
(`github.com/JunWooBeck/fsd50k-ucs`). §6.1 was right to send us looking.

It was also right to be suspicious. Their pipeline's last resort is a *synonym
reverse lookup* — the very mechanism §6.1 showed produces category errors — and 75
of the 200 classes fall through to it. Audited against the taxonomy, their output
contains:

- `Tap` → **COMMUNICATIONS-MICROPHONE** (186 clips). A mic tap. This is the
  `Siren → CREATURES-AQUATIC` failure, in the flesh.
- `Squeak` → **FOLEY-SQUEAK**, *which is not a UCS pair*. FOLEY has five
  subcategories and SQUEAK is not one of them.
- `Cowbell` → ALARMS-BELL, though FSD50K files Cowbell under `Bell`.
- **38.7 % of files resolve to a category with no subcategory at all**
  (MUSICAL/–, FOLEY/–, VOICES/–), which is useless for calibrating a *subcategory*
  signature. FOLEY is `provenance_only` here and cannot be signal-scored regardless.

So the crosswalk in `UCS/fsd50k_crosswalk.json` is **hand-adjudicated**, with their
labels kept as a recorded second opinion and every disagreement noted in-entry. It
also sidesteps CC-BY-SA's ShareAlike, since it is not derived from their table.

The AudioSet hierarchy needed for "most specific label" was recovered from the data
itself — if every clip carrying `Snare_drum` also carries `Percussion`, then
`Percussion` is an ancestor — which is why no ontology file was needed.

**169 of 200 classes map to 114 distinct UCS subcategories.** The other 31 are
refused on the record: 22 are ontology ancestors too broad to mean one thing
(`Music`, `Vehicle`, `Domestic_sounds_and_home_sounds`), and 9 are genuinely
ambiguous (`Crack`, `Tearing`, `Squeak`, `Tap` — the material decides, and the label
does not name it). A refusal is a result, not a gap.

### 7.2 The clip funnel

| | clips |
|---|---|
| FSD50K total | 51,197 |
| dropped — more than one most-specific label | 8,463 |
| dropped — most-specific label maps to nothing | 5,567 |
| dropped — no PP/PNP rating at all | 7,721 |
| dropped — rated Present-but-Not-Predominant | 5,059 |
| **eligible for calibration** | **24,362** |

That is 47.6 % of the dataset, over **112 subcategories** — 97 of them with ≥50
clips. **So the honest coverage number §6.6 could not quote is ~15 % of the 753.**

### 7.3 What the data refused to calibrate — three traps, two of them new

§6.2 named three features FSD50K must not touch. It was right about all three, and
the run found **two more that it missed**:

4. **`band_limit_high_hz` — do not calibrate.** **56.7 %** of FSD50K clips are
   band-limited below 17 kHz, and 8 % sit exactly in the 15–16.5 kHz MP3 lowpass
   band. Freesound uploads are routinely lossy-origin, transcoded to WAV for
   release. This feature would measure *the uploader's codec*.
5. **`voicing_ratio` — do not calibrate.** The WebRTC VAD rates **AMBIENCE-TRAFFIC
   0.96 voiced** and CROWDS-APPLAUSE 0.79. Those are facts about the detector, not
   the sounds. Calibrating to them would enshrine a broken feature.

And one structural correction: the **envelope timings** (`envelope_attack_seconds`,
decay, release, sustain, ring time, `crest_factor`) are calibrated **only on
single-transient clips**. An FSD50K clip is room tone plus an event, so the
10 %→90 % "attack" of a glass clink spans the silence in front of it — the measured
p95 attack was **10.6 s for GLASS-IMPACT and 2.4 s for a computer keyboard**. A UCS
library one-shot is trimmed and attacks in milliseconds. Left unfiltered, this alone
would have wrecked every impact signature.

### 7.4 What was calibrated

**748 priors across 102 subcategories**, written back into `UCS/categories/*.json`.
Policy: the mean moves to the measured median (MAD-derived, so a few mislabelled
uploads cannot drag it); **the deviation may only widen, never tighten** — FSD50K is
a *prior on the prior*, not the truth. Every touched prior carries a `provenance`
block naming the dataset, the clip count, the contributing FSD50K classes, and the
reasoned value it replaced. Untouched priors are explicitly stamped
`{"source": "reasoned"}`, so no number in the taxonomy is now of unknown origin.

Full report: `UCS/fsd50k_calibration.json`.

### 7.5 The gate audit — 24 gates reject the very sounds they describe

A gate encodes impossibility, so a gate that kills genuine clips is a bug, and an
unrecoverable one: it zeroes the posterior. Scored against PP-rated ground truth:

| gate | kills |
|---|---|
| `RAIN` · onset_rate_per_second ≥ 2.0 | **84.6 %** of real rain |
| `WIND` · harmonicity ≤ 0.6 | **82.9 %** of real wind |
| `FIRE-CRACKLE` · harmonicity ≤ 0.55 | 56.9 % |
| `VOICES-WHISPER` · harmonicity ≤ 0.45 | 54.6 % |
| `FARTS-REAL` · spectral_centroid ≤ 4000 Hz | 41.2 % |
| `VOICES-MALE` · pitch_hz ∈ 55–350 | 37.8 % |

…24 in total. **These are not calibration errors. They point at a real defect in
`harmonicity`.**

### 7.6 `harmonicity` does not measure what its name claims

Run on synthetic signals, the analyzer reports:

| signal | harmonicity |
|---|---|
| white noise | 0.011 |
| **lowpass noise (a wind bed)** | **0.868** |
| pure 440 Hz sine | 0.998 |

Lowpass noise scores almost as "pitched" as a sine. `harmonicity` is an
autocorrelation peak, and *any* spectrally-correlated noise autocorrelates strongly
at short lags. It is measuring **spectral correlation, not pitchedness** — which is
why wind (0.86), thunder (0.78), fire and breath all read as harmonic, and why every
`harmonicity ≤ x` gate guillotines its own category.

This is reproducible on clean signals, so it is a property of the DSP and not of
FSD50K. That has two consequences, and they point in opposite directions:
the **measured priors are trustworthy** (a clean wind SFX will read 0.86 too), while
the **gates built on the old assumption are inverted and must be relaxed**. Fixing
`harmonicity` properly (normalize against flatness, or use a real pitch-salience
measure) would change the meaning of 514 priors and should be done deliberately.

### 7.7 The separability tiers were too pessimistic — measured, not argued

§6.4 asked for this and it is the most interesting result. A logistic probe on the
analyzer's own feature vector (5-fold CV, majority-class baseline) over **181 sibling
pairs**:

> **51 of 66 `semantic_only` pairs (77 %) separate well above chance.** Median lift
> across all 181 pairs: **+0.22**.

The spec's own flagship example of a thing DSP can never do —

- **VEHICLES-CAR vs VEHICLES-BUS: 0.86 accuracy** against a 0.51 baseline.
- ANIMALS-CAT vs ANIMALS-DOG: 0.88 against 0.56.
- COMMUNICATIONS-CELLPHONE vs TYPEWRITER: 0.99 against 0.53.

§7 of the signature spec says "signal features cannot tell a car from a bus". They
can, 86 % of the time. **The 38 % `semantic_only` verdict is wrong, and the tiers
should be re-derived from this table rather than argued.**

In the other direction the evidence is thin: only 6 `signal_separable` pairs show a
lift under 0.05, and every one of them is a heavily imbalanced pair whose baseline is
already ≥0.84 — where lift is a weak statistic. **No `signal_separable` claim is
falsified by this data.** The tiers err in one direction only: pessimism.

Full table: `UCS/fsd50k_separability.json`.

### 7.8 Licensing

Beck & Lerch's artifacts are **CC-BY-SA 4.0**, not the unresolved `NOASSERTION`
GitHub reports. Their per-file labels were consulted but not vendored, and the
crosswalk is independently adjudicated, so ShareAlike does not reach into
`UCS/categories/`. The 6,041 CC-BY-NC clips remain a filter to apply before any
shipped *model* is trained on this audio; summary statistics are not affected.
