# UCS Acoustic Signature Specification (v1)

How the scanalyzer scores an audio file against the 753 UCS subcategories.

Every subcategory object in `UCS/categories/*.json` carries an `acoustic_signature`
block. This document defines its grammar, the closed feature vocabulary it may
reference, and the exact scoring math. Nothing outside this vocabulary is legal.

---

## 1. The two-axis insight

UCS flattens two independent axes into one label:

- **CATEGORY** (AIR, METAL, VEHICLES, ANIMALS) ≈ **source / material identity.**
  Mostly *semantic*. A car and a bus are the same physics; only a human (or a
  learned embedding) knows which is which.
- **SUBCATEGORY** (IMPACT, MOVEMENT, FRICTION, BREAK, TONAL, WHOOSH, MISC) ≈
  **morphology.** Mostly *measurable*, and the same tokens repeat across dozens
  of categories.

So the classifier is not 753 models. It is a small set of morphology detectors
crossed with a material/timbre axis, gated by text evidence from `synonyms`.

## 2. Separability tiers — the honesty flag

Every subcategory declares what signal analysis can actually do for it.

| `separability` | Meaning | Scanalyzer's job |
|---|---|---|
| `signal_separable` | DSP alone can decide this. AIR-BURST vs AIR-HISS is impulsive vs sustained-HF-noise. | Classify. Trust the score. |
| `signal_narrowable` | DSP prunes the field but cannot finish. GUNS-PISTOL vs GUNS-RIFLE are the same morphology. | Rank a shortlist. Require text agreement to commit. |
| `semantic_only` | No DSP will ever decide this. VEHICLES-CAR vs VEHICLES-BUS. | Never assert from signal. Use the signature only to *rule out* (gates), and let `synonyms` text matching drive. |
| `provenance_only` | Defined by how it was recorded or why it exists, not by sound. All of FOLEY; most of ARCHIVED. | Excluded from signal scoring entirely. |

A `semantic_only` signature is still useful: its gates say "whatever this is, it
is not a 0.2 s impulse," which prunes hundreds of candidates.

## 3. Morphology enum (closed set)

    impulsive            single sharp transient, fast decay (an impact, a click)
    impulsive_with_tail  transient + long resonant ring (a bell, a gunshot in a room)
    burst                short, loud, broadband, not a clean single transient (an explosion)
    sustained_tonal      stable f0, harmonic (a horn, a drone, a motor whine)
    sustained_noise      stationary broadband, no f0 (air hiss, surf, room tone)
    texture              dense stochastic micro-events (rain, fire crackle, applause)
    rhythmic             periodic onset train (a clock, an engine idle, automatic fire)
    sweep                monotonic spectral/pitch trajectory (a riser, a whoosh, a siren)
    friction             sustained, unstable, high-centroid contact (a scrape, a creak)
    granular             dense, gritty, high-flux micro-texture (PaulStretch-like)
    voiced               formant structure, syllabic modulation (speech, cheering)
    complex              multi-event scene, no single morphology (an ambience, a battle)
    silence              near-null signal (room tone, an unrecorded gap)

## 4. Feature vocabulary (closed set)

`feature` must be one of these exact names. Names marked **proposed** are not yet
computed by the analyzer — a signature may reference them, and the scorer must
skip any prior whose feature is absent from the record (renormalizing weights),
so signatures stay valid while the features land incrementally.

### 4a. Available now — exact `Peak` struct field names

| Feature | Unit | Notes |
|---|---|---|
| `length_seconds` | s | **log** scale |
| `transient_count` | count | onsets; >1 ⇒ not a one-shot |
| `root_mean_square_level` | linear 0..1 | |
| `lufs` | LUFS | integrated; −70 sentinel means unmeasurable |
| `crest_factor` | ratio | **log** scale. peak/RMS; high ⇒ spiky |
| `zero_crossings_per_second` | /s | **log** scale. high ⇒ noisy/bright |
| `pitch_hz` | Hz | **log** scale. valid only 50–2000 Hz |
| `harmonicity` | 0..1 | 0 = noise, 1 = strongly pitched |
| `inharmonicity` | 0..1 | 0 = harmonic, 1 = metallic/detuned |
| `partial_count` | count | |
| `sustain_ratio` | 0..1 | fraction held above 50% of peak |
| `spectral_centroid_hz` | Hz | **log** scale. brightness |
| `spectral_centroid_mean_hz` | Hz | **log** scale. frame-wise |
| `spectral_centroid_deviation_hz` | Hz | brightness modulation over time |
| `spectral_rolloff_hz` | Hz | **log** scale. 85% energy point |
| `spectral_flatness` | 0..1 | 0 = tonal, 1 = noise |
| `spectral_flux` | 0..~1 | 0 = static spectrum, high = churning |
| `complexity` | Hz | spectral spread around centroid |
| `low_band_energy` | 0..1 | fraction < 200 Hz |
| `mid_band_energy` | 0..1 | fraction 200 Hz – 2 kHz |
| `high_band_energy` | 0..1 | fraction > 2 kHz |
| `total_harmonic_distortion` | ratio | |
| `clipping_density` | 0..1 | |
| `envelope_attack_seconds` | s | **log** scale. 10%→90% rise |
| `envelope_decay_seconds` | s | **log** scale |
| `envelope_sustain_level` | 0..1 | plateau as fraction of peak |
| `envelope_release_seconds` | s | **log** scale |
| `envelope_temporal_centroid` | 0..1 | ~0 ⇒ front-loaded |
| `envelope_skewness` | — | high positive ⇒ percussive front-load |
| `envelope_kurtosis` | — | high ⇒ isolated bursts |
| `dc_offset` | linear | |
| `beats_per_minute` | BPM | 0 if none |
| `sample_rate` | Hz | |

### 4b. Proposed — needed for UCS, not yet computed

| Feature | Unit | Why UCS needs it | Cheap? |
|---|---|---|---|
| `onset_rate_per_second` | /s | separates DRIP (sparse) from FIZZ (dense); RHYTHMIC; GUNS-AUTOMATIC | trivial: `transient_count / length_seconds` |
| `onset_periodicity` | 0..1 | **rhythmic vs stochastic** — the single highest-value new feature. Clock tick vs rain. Peak of the normalized autocorrelation of the onset envelope. | cheap; `onset_envelope` already exists |
| `spectral_centroid_slope_hz_per_second` | Hz/s | the entire `sweep` morphology: DESIGNED-RISER (+), BASS DIVE (−), WHOOSH, SWOOSHES, sirens, doppler bys | cheap; linear regression on the existing per-frame centroid series |
| `pitch_slope_semitones_per_second` | st/s | same, in the tonal domain (LASERS, MAGIC, CARTOON-ZIP) | needs a frame-wise pitch track |
| `stationarity` | 0..1 | **texture vs event** — the second highest-value feature. 1 = unchanging bed (AMBIENCE, room tone, surf); 0 = eventful. `1 − normalized std of frame energy` | cheap; reuse STFT frames |
| `voicing_ratio` | 0..1 | VOICES vs CROWDS-APPLAUSE; CHEERING vs APPLAUSE is exactly this test | the `vad` module already computes it — just *store* it |
| `syllabic_modulation_energy` | 0..1 | speech-likeness: energy in the 3–8 Hz modulation band. Separates WALLA from a stationary crowd bed | modulation spectrum of the energy envelope |
| `spectral_slope_db_per_octave` | dB/oct | LTAS tilt. Material brightness (RAIN-METAL vs RAIN-VEGETATION); pink noise = −3 dB/oct exactly (ARCHIVED-TEST_TONE) | cheap |
| `decay_time_seconds_60db` | s | **ring time.** METAL-IMPACT (long) vs WOOD-IMPACT (short) — the material-impedance axis. Also detects ARCHIVED-IMPULSE_RESPONSE | moderate: fit exponential to post-peak envelope |
| `band_limit_high_hz` | Hz | VOICES-FUTZED (telephone ~3.4 kHz), WATER-UNDERWATER, VEHICLES-INTERIOR — all are LP-filtered signatures | cheap: highest bin above noise floor |
| `stereo_width` | 0..~1 | AMBIENCE (wide) vs FOLEY (mono/narrow). `side_rms / (mid_rms + ε)` | trivial: both terms already exist |
| `spectral_entropy` | 0..1 | tonal-vs-noise, more robust than flatness on sparse spectra | cheap |

## 5. The signature block

```json
"acoustic_signature": {
  "morphology": "impulsive",
  "separability": "signal_separable",
  "gates": [
    {"feature": "length_seconds", "max": 1.5},
    {"feature": "crest_factor", "min": 6.0}
  ],
  "priors": [
    {"feature": "envelope_attack_seconds", "mean": 0.004, "deviation": 0.003,
     "transform": "log", "weight": 1.0},
    {"feature": "spectral_flatness", "mean": 0.55, "deviation": 0.15,
     "transform": "linear", "weight": 0.7}
  ],
  "discriminators": [
    "Sharper attack and higher crest factor than AIR-BLOW; far shorter than AIR-HISS."
  ],
  "confusable_with": ["AIRBlow", "AIRSuct"]
}
```

- `gates` — **hard constraints.** Any violation sets the score to zero. A gate
  encodes a physical impossibility ("an explosion is not 40 ms long"), never a
  mere tendency. Use `min`, `max`, or both. Be generous: a wrong gate is
  unrecoverable, a wrong prior is only a nudge.
- `priors` — soft Gaussian expectations. `transform: "log"` compares
  `ln(x)` against `ln(mean)` — mandatory for durations, frequencies, and ratios,
  which are log-normal, never Gaussian. `weight` ∈ (0, 1] is how diagnostic this
  feature is *for this subcategory*.
- `discriminators` — prose stating the boundary against the siblings it is most
  confused with. Many are lifted straight from the UCS `explanation` text, which
  is full of hand-written disambiguation rules ("Bigger and sharper than a
  SPLASH"). These are the ground truth; mine them.
- `confusable_with` — `category_id`s. Builds the confusion graph.

## 6. Scoring math

For a file with feature vector **x**, and a subcategory *c*:

**1. Gates.** If any gate on *c* is violated, `P(c | x) = 0`. Done.

**2. Weighted Gaussian log-likelihood.** For each prior term *i*, with
`u = ln` if `transform == "log"` else identity:

```
z_i = ( u(x_i) − u(μ_i) ) / u'(σ_i)
z_i = clamp(z_i, −4, +4)              # one wild feature must not veto everything
```

Normalize by total weight so subcategories with more prior terms are not
penalized:

```
                Σ_i w_i · (−½ · z_i²)
    L(c | x) = ───────────────────────        ∈ (−8, 0]
                      Σ_i w_i
```

Skip any term whose feature is missing from the record (a *proposed* feature not
yet implemented) and drop it from `Σ w_i`. A signature with zero usable terms
scores `L = 0` (uninformative), not `−∞`.

**3. Signal likelihood.**  `S(c | x) = exp( L(c | x) ) ∈ (0, 1]`

**4. Text evidence.** Match the filename and any embedded metadata against the
`synonyms` array (case-folded, word-boundary). With *h* hits:

```
    T(c | name) = 1 + κ · h          κ ≈ 2.0
```

**5. Posterior.** Fuse, with the tier deciding how much the signal is allowed to
assert:

```
    P(c | x, name) ∝ S(c | x)^α(c) · T(c | name)^β(c)
```

| tier | α (signal) | β (text) |
|---|---|---|
| `signal_separable` | 1.0 | 1.0 |
| `signal_narrowable` | 0.6 | 1.5 |
| `semantic_only` | 0.15 | 3.0 |
| `provenance_only` | 0.0 | 3.0 |

Normalize over all non-zero *c*. Report the top *k* with their scores, and the
gate that killed the runner-up — that is the *explanation*, and it is why gates
and priors beat an opaque embedding for a librarian who has to trust the call.

**6. Abstain.** If the top posterior is below threshold, or the top two are
within a hair of each other, emit the category's `MISC` subcategory (~70 of 82
categories have one). Abstention is a correct answer, not a failure.

## 7. What this cannot do

Signal features cannot tell a car from a bus, a cat from a wild cat, or an
office from a hospital. Roughly half the 753 are `semantic_only`. For those, the
real classifier is text — and if you want audio to decide them, the answer is a
learned embedding (CLAP or similar), scored against text prompts built from each
subcategory's `explanation` + `synonyms`, not more DSP. This spec is designed to
compose with that: the gates prune the candidate set, and the embedding picks
within it.

Note the analyzer's current `max_len` default of **10 s** silently drops longer
files. AMBIENCE (47 subcategories), WEATHER, and most textures are minutes long.
UCS work requires raising that.
