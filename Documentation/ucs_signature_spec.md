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

`feature` must be one of these exact names. The scorer skips any prior whose
feature is absent from the record (renormalizing the weights), so a signature
stays valid even when a feature could not be measured for a given file.

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

### 4b. The morphology axis — computed by `morphology.rs` (July 2026)

These were the spec's "proposed" set. They are now measured and on the record.
Until they landed, `ucs::feature()` had no field to read them from and returned
None for every one — which silently dropped **~900 prior and gate terms** across
the 753 signatures, including the single most heavily-weighted term in many of
them. The signatures were being scored against a fraction of the evidence they
were written for.

Each is nullable, and `null` means **unmeasurable, not zero** — the distinction
is load-bearing. A drone has no ring time; reporting `0.0` would assert that it
is maximally damped, the exact opposite of the truth. Per §6, the scorer skips a
null term and renormalizes its weight away.

| Feature | Unit | What it decides | How it is measured |
|---|---|---|---|
| `onset_rate_per_second` | /s | DRIP (sparse) vs FIZZ (dense); GUNS-AUTOMATIC | `transient_count / length_seconds` |
| `onset_periodicity` | 0..1 | **rhythmic vs stochastic.** Clock tick vs rain | peak of the normalized autocorrelation of the onset envelope |
| `stationarity` | 0..1 | **texture vs event.** 1 = unchanging bed (AMBIENCE, surf, room tone); 0 = eventful | `1 − std/mean` of the per-frame RMS **amplitude**, clamped 0..1 — see the note below |
| `spectral_entropy` | 0..1 | tonal vs noise, more robust than flatness on sparse spectra | mean per-frame Shannon entropy of the power spectrum ÷ ln(bins) |
| `spectral_slope_db_per_octave` | dB/oct | material brightness (RAIN-METAL vs RAIN-VEGETATION); pink noise = −3.0 exactly | OLS of third-octave band level against log2(f), 50 Hz → min(0.9·Nyquist, 16 kHz) |
| `band_limit_high_hz` | Hz | VOICES-FUTZED (telephone ≈3.4 kHz), WATER-UNDERWATER, VEHICLES-INTERIOR | highest LTAS bin within 50 dB of the loudest, median-smoothed, scanned from the top |
| `spectral_centroid_slope_hz_per_second` | Hz/s | the `sweep` morphology: DESIGNED-RISER (+), BASS DIVE (−), WHOOSH, doppler bys | OLS of the per-frame centroid against time |
| `pitch_slope_semitones_per_second` | st/s | the same, tonally (LASERS, MAGIC, CARTOON-ZIP) | OLS over a **dominant-partial** track; abstains unless residual scatter ≤ 2 semitones |
| `syllabic_modulation_energy` | 0..1 | speech-likeness. Separates WALLA from a stationary crowd bed | fraction of the envelope's 0.5–30 Hz modulation spectrum falling in 3–8 Hz |
| `decay_time_seconds_60db` | s | **ring time.** METAL-IMPACT (long) vs WOOD-IMPACT (short) — the material-impedance axis | T20-style fit: OLS of dB against time over the −5 → −25 dB window below the peak, extrapolated to 60 dB. Requires an observed fall of ≥15 dB |
| `voicing_ratio` | 0..1 | VOICES vs CROWDS-APPLAUSE; CHEERING vs APPLAUSE | fraction of 20 ms frames the WebRTC VAD calls voiced |
| `stereo_width` | 0..~1 | AMBIENCE (wide) vs FOLEY (mono/narrow) | `side_rms / (mid_rms + ε)`, derived at scoring time |

**Two of these do not behave the way the spec assumed. Both were caught by
measuring, not by reasoning:**

1. **`stationarity` is defined over amplitude, not energy.** The original wording
   said "normalized std of frame *energy*". Energy is quadratic, so its
   coefficient of variation runs well past 1 on anything with dynamics and the
   0..1 clamp then flattens it. Measured against labelled FSD50K clips, the energy
   form returned a median of **0.000 for steady beds** (rain, wind, surf, frying)
   *and* **0.000 for impacts** (gunshots, knocks, slams) — literally no
   discriminative power. The amplitude form separates those same two groups
   **0.47 to 0.00**. The fix is a square root.

2. **`voicing_ratio` is much blunter than the spec hoped.** The WebRTC VAD is
   telephony-tuned and fires on any harmonic energy: on FSD50K it scores speech at
   0.94 but *guitar, piano, bell and rain* at 0.76. It is therefore **not** the
   clean CHEERING-vs-APPLAUSE test §4b claimed, and the 148 priors resting on it
   should be treated as weak evidence until a real voicing detector (autocorrelation
   periodicity + formant structure) replaces the VAD. Calibration will report its
   true separation rather than assume one.

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
    {"feature": "envelope_attack_seconds", "mean": 0.004, "deviation": 2.5,
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

  **Under `transform: "log"`, `deviation` is a MULTIPLICATIVE (geometric) factor,
  not an additive sigma.** `{"mean": 60.0, "deviation": 3.0, "transform": "log"}`
  means "about 60, within ×3 / ÷3" — i.e. 20 to 180 at one sigma. It follows that
  a log `deviation` must always be **> 1.0**; a value of 1.0 means zero tolerance
  and anything below it is nonsense. Under `transform: "linear"`, `deviation` is
  an ordinary additive sigma in the feature's own unit. The validator enforces
  both rules.
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

~~Note the analyzer's current `max_len` default of **10 s** silently drops longer
files.~~ Fixed: `max_len` now defaults to **600 s** (`args.rs`). The old 10 s
default was a drum-sample-pack assumption that silently discarded every ambience,
weather bed and texture — the categories UCS cares most about.
