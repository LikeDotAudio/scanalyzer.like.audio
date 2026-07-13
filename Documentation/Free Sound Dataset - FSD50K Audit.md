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
