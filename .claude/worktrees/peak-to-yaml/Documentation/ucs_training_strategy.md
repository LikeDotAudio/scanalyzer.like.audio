# UCS Training & FSD50K Mapping — Strategy

**Date:** July 2026
**Subject:** How to turn the 753 reasoned UCS acoustic signatures into measured ones
**Companions:** `ucs_signature_spec.md` (the math), `Free Sound Dataset - FSD50K Audit.md` (the dataset)

---

## 1. Where we actually stand

The 753 signatures in `UCS/categories/*.json` are **reasoned, not measured**. Every
`mean` and `deviation` was derived from physics and from the UCS explanation text.
They are defensible, internally consistent, and completely uncalibrated. Nothing in
them has met a real audio file.

The goal is to fix that. The trap is doing it in a way that *feels* rigorous while
quietly baking in artifacts. This document is mostly about avoiding that.

## 2. The crosswalk: solved, but far smaller than advertised

There is now a public AudioSet/FSD50K → UCS mapping, from the 2026 unification paper
([arXiv 2606.05571](https://arxiv.org/abs/2606.05571)):

- `github.com/JunWooBeck/fsd50k-ucs` — per-clip UCS labels for all 51,197 clips
- `github.com/JunWooBeck/audioset-ucs`, `esc50-ucs`, `envsound-ucs` — the rest
- `github.com/JunWooBeck/ucs-sfx-tools` — the conversion code

**Use it. Do not rebuild it.** But audit it first, because the headline numbers do
not survive contact with the data.

### 2.1 What the mapping actually delivers

The paper reports a "100% automatic conversion rate" for FSD50K. That means every
clip received *a* label — not that the label is at subcategory granularity, and not
that it is correct. Measured against the real UCS v8.2.1 taxonomy:

| | |
|---|---|
| Clips mapped | 51,197 |
| Clips with **no SubCategory at all** (category-only) | **19,826 — 38.7%** |
| Clips landing on a **real** UCS subcategory | **29,001 — 56.6%** |
| Distinct UCS subcategories covered | **54 of 753 — 7%** |
| Clips the authors themselves flagged for ambiguity review | 5,439 — 13.3% of dev |

**7%, not 74%.** My earlier synonym-based coverage estimate was retracted for being
an artifact of promiscuous matching; this is the real number, and it is the single
most important fact in this document.

### 2.2 A defect in their mapping: seven invented subcategories

2,370 clips are labelled with `Category-SubCategory` pairs **that do not exist in UCS
v8.2.1**:

| Their label | Clips | What it should be |
|---|---|---|
| `FOLEY-COIN` | 516 | `OBJECTS-COIN` (FOLEY has only CLOTH/FEET/HANDS/MISC/PROP) |
| `GUNS-GUNSHOT` | 466 | GUNS has no GUNSHOT subcategory — PISTOL/RIFLE/SHOTGUN/… |
| `FOLEY-SQUEAK` | 411 | not a UCS subcategory |
| `FOLEY-ZIPPER` | 388 | `OBJECTS-ZIPPER` |
| `FOLEY-KEYS` | 233 | `OBJECTS-KEYS` |
| `TOOLS-HAMMER` | 224 | TOOLS has no HAMMER subcategory |
| `DOORS-DOORBELL` | 132 | `BELLS-DOOR` |

Note the pattern: their pipeline over-reaches into FOLEY, which is exactly the
`provenance_only` category that *cannot* be inferred from audio at all (see
`ucs_signature_spec.md` §2). These 2,370 clips must be remapped or dropped before
any calibration touches them.

### 2.3 What we are left with

After removing category-only rows and the invented pairs, and after filtering to
predominant clips (§4.2), expect a usable calibration set on the order of **15–20k
clips across ~50 subcategories**. That is a real asset. It is also 7% of the
taxonomy, and it is skewed toward MUSICAL — the corner the analyzer already handles
best.

| Our honesty tier | Covered by FSD50K |
|---|---|
| `signal_separable` | 14 / 110 (13%) |
| `signal_narrowable` | 24 / 334 (7%) |
| `semantic_only` | 14 / 284 (5%) |
| `provenance_only` | 2 / 25 — *should be 0; see §2.2* |

**Strategic consequence:** FSD50K cannot calibrate UCS. It can calibrate a *seed*,
and it can **falsify our reasoning** — which is worth more. Plan accordingly.

---

## 3. The strategy in one line

> **Do not calibrate 753 subcategories. Calibrate 12 morphologies and a material
> axis, validate the honesty tiers against data, and use the user's own UCS-named
> library — not Freesound — as the in-domain ground truth.**

The rest of this document is that sentence, expanded.

---

## 4. Phase 0 — Unblock the analyzer (do this first; nothing works without it)

**4.1 Raise `max_len`.** It defaults to **10 s** and silently drops longer files.
FSD50K dev averages 7.1 s and eval 9.8 s, so a large fraction of the corpus would be
discarded before it is ever measured. AMBIENCE and WEATHER are minutes long. Raise it
(30 s for FSD50K; higher for real libraries) and confirm `MAX_FRAMES = 3000` in
`stft.rs` is lifted with it, since it truncates analysis at ~35 s regardless.

**4.2 Implement the high-value proposed features.** The signatures reference 12
features that do not exist yet. Ranked by how many of the 753 depend on them:

| Feature | Signatures using it | Cost |
|---|---|---|
| `stationarity` | 330 | cheap — variance of frame energy over existing STFT frames |
| `onset_rate_per_second` | 274 | trivial — `transient_count / length_seconds` |
| `onset_periodicity` | 231 | cheap — autocorrelation peak of the onset envelope, reduced at analysis time and stored as a scalar |
| `decay_time_seconds_60db` | 201 | moderate — exponential fit to the post-peak envelope |
| `spectral_centroid_slope_hz_per_second` | — | cheap — linear regression on the existing per-frame centroid series |
| `voicing_ratio` | — | **free** — `vad.rs` already computes it and throws it away. Just store it. |

`stationarity` and `onset_periodicity` are the two that carry the taxonomy: they are
texture-vs-event and rhythmic-vs-stochastic respectively, and together they separate
more UCS subcategories than any other pair. Build those two first.

**4.3 Add a batch feature-dump mode.** A directory of WAVs in, one row of features
per file out (CSV/Parquet). This is the interface every later phase runs through.
It does not exist today; the analyzer writes `.PEAK` sidecars per file.

---

## 5. Phase 1 — Build an honest ground-truth set

1. Clone `fsd50k-ucs`. Join its per-clip labels to the audio by filename.
2. **Drop category-only rows** (38.7%). A clip labelled `AIRCRAFT` with no
   subcategory cannot calibrate a subcategory.
3. **Remap or drop the 7 invented pairs** (§2.2). Prefer remapping —
   `FOLEY-ZIPPER → OBJECTS-ZIPPER` recovers 388 clips for the one subcategory in
   OBJECTS we called `signal_separable`.
4. **Filter to Present-and-Predominant.** Labels are *weak* (clip-level). A 30 s clip
   tagged "Dog" may be 28 s of room tone and one bark; whole-clip features would then
   describe the room. `pp_pnp_ratings_FSD50K.json` covers all 51,197 clips and carries
   98,549 PP (`1.0`) ratings vs 27,386 PNP (`0.5`). **Keep PP only.** This filter is
   not optional — without it we would calibrate backgrounds and call it science.
5. **Set aside the 13.3% the authors flagged as ambiguous** — use them later as a
   test set for the abstention logic, not as calibration data.
6. **Filter CC-BY-NC (6,041 clips)** if anything trained here ships commercially.

---

## 6. Phase 2 — Calibrate, but only what transfers

**Never calibrate these three from FSD50K:**

- **`length_seconds`** — our most-referenced feature (1,358 uses) and the one FSD50K
  cannot speak to. Clip duration there is a *Freesound upload artifact*, truncated to
  0.3–30 s. That a rain clip is 12 s tells you about the uploader, not about rain.
  Calibrating it would bake an artifact into the taxonomy and destroy AMBIENCE.
- **`lufs` / `root_mean_square_level`** — Freesound normalization is arbitrary and
  uploader-chosen. The MOVEMENT continuum (PRESENCE < CROWD < ACTIVITY) and the GUNS
  foley-vs-firing loudness gate both rest on absolute level and would be calibrated
  to noise.
- **`stereo_width`** — FSD50K is **mono**. The feature is undefined, and it is
  load-bearing for AMBIENCE (wide) vs FOLEY (narrow).

Keep the reasoned values for those three. Say so in the data.

**Do calibrate** the shape-based, level- and duration-invariant features: centroid,
flatness, rolloff, spectral slope, harmonicity, inharmonicity, partial count, crest
factor, ZCR, onset rate, onset periodicity, stationarity, flux, voicing ratio, and
the envelope *ratios* (temporal centroid, sustain level, skew, kurtosis). That is the
whole morphology axis — most of the value.

**Method.** Use robust statistics, not mean and standard deviation — these
distributions have outliers and long tails:

- location: **median** (geometric median, i.e. median of `ln x`, for log features)
- scale: **MAD → σ**, then *widen*: `σ_final = max(1.2 × σ_measured, floor)`

The widening is deliberate. FSD50K is amateur Freesound audio; UCS libraries are
clean, close-miked professional SFX. That domain shift is real, and a prior that is
too tight is worse than one that is too loose — it produces confident wrong answers.
**Treat measured numbers as a prior on the prior, and err wide.**

**Record provenance per prior.** Add a field so a measured number is never confused
with a reasoned one:

```json
{"feature": "spectral_flatness", "mean": 0.62, "deviation": 0.14,
 "transform": "linear", "weight": 0.8,
 "calibration": {"source": "FSD50K-PP", "clips": 412, "date": "2026-07"}}
```

Absence of `calibration` means "reasoned, never measured." That distinction must
survive into the shipped data, or nobody will know which numbers to trust.

---

## 7. Phase 3 — Falsify the honesty tiers (the highest-value phase)

The tier split — 110 `signal_separable`, 334 `signal_narrowable`, 284 `semantic_only`
— is currently **an argument, not a result**. FSD50K can turn it into a measurement:

> For each pair of UCS siblings that FSD50K covers, train a plain classifier
> (logistic regression or gradient boosting on the analyzer's own feature vector —
> *not* a deep net; the point is to test the features we ship) and record pairwise
> accuracy against chance.

Then act on the result:

- A pair we called **`signal_separable` that scores near chance** → we were wrong.
  Demote it, and say so.
- A pair we called **`semantic_only` that beats chance decisively** → we were too
  pessimistic and left signal on the table. Promote it.

**Also measure gate false-kill rate.** Gates are unrecoverable: a gate that wrongly
excludes the true class zeroes the score and no amount of downstream cleverness gets
it back. For every gate, compute the fraction of *true-class* clips it rejects. Any
gate above ~1–2% false-kill is too tight and must be widened. This is the single
cheapest safety check in the whole program, and it needs only the covered 7%.

Output a real confusion matrix and feed it back into each signature's
`confusable_with`, replacing the hand-written guesses.

---

## 8. Phase 4 — Close the 93% gap

FSD50K covers 54 of 753. The other 699 need a different answer. Four routes, in
order of leverage:

**8.1 Calibrate morphologies, not subcategories — the central idea.**
UCS is two axes flattened into one: *category ≈ source/material identity*,
*subcategory ≈ morphology*, and the morphology tokens (IMPACT, FRICTION, MOVEMENT,
BREAK, TONAL, MISC…) repeat across dozens of categories. So do not chase 753
class-conditional distributions. Instead:

- calibrate the **12 morphology archetypes** from whatever FSD50K covers — there is
  ample data for *impulsive*, *sustained_tonal*, *texture*, *rhythmic*, *voiced*
- calibrate the **material axis** (the decay-time/centroid/inharmonicity ramp:
  metal 1.2 s → glass 0.45 → ceramics 0.18 → wood 0.12 → rocks 0.05 → paper 0.03 →
  cloth 0.025) from the categories that *are* covered
- **propagate**: an uncovered subcategory's priors = its morphology archetype,
  shifted by its material offset

This is how 54 measured subcategories become ~500 calibrated ones without inventing
data. It is only sound *because* of the two-axis factorization — which is the whole
reason that structure was worth finding.

**8.2 Add the sibling datasets.** `audioset-ucs` (+22,992 clips) and `esc50-ucs`
(+2,000) use the same mapping. Their merged EnvSound-UCS reaches **144 subcategories**
— roughly triple our current coverage, for the cost of a download. Note they excluded
MUSICAL entirely and cut VOICES to LAUGH/CRYING, so the gain is concentrated exactly
where FSD50K is weak. Take it.

**8.3 Use your own library — this is the real prize.**
Professionally-tagged UCS libraries encode the `CatID` *in the filename* (that is the
entire point of UCS). If you have such a library on disk, it is:
- **in-domain** (clean pro SFX, not amateur Freesound — no domain shift)
- **subcategory-precise** (no crosswalk needed, no 38.7% category-only rows)
- **stereo** (so `stereo_width` becomes calibratable, which FSD50K can never do)
- **untruncated** (so `length_seconds` becomes calibratable — the feature FSD50K
  structurally cannot provide, and our most-used one)

A UCS-named professional library beats FSD50K on every axis that matters here.
FSD50K's role is then reduced to what it is genuinely best at: an *independent*
held-out set for falsifying the tiers (§7), drawn from a different domain — which is
exactly what you want a test set to be. **If such a library exists, point me at it;
it changes the plan.**

**8.4 The 284 `semantic_only` need embeddings, not DSP.**
No amount of feature engineering separates a car from a bus. For that tier the answer
is a learned audio embedding (CLAP or similar) scored against text prompts built from
each subcategory's `explanation` + `synonyms` — both of which we already have in the
JSON. The architecture composes cleanly with what exists: **gates prune the candidate
set, the embedding picks within it, and the Gaussian score breaks ties.** Do this
last; it is the only part that needs a GPU, and 8.1–8.3 must land first or there is
nothing to prune with.

---

## 9. Phase 5 — Ship the classifier

Replace the `ucs.rs` stub (which currently hard-codes `category = "MUSICAL"` for
every file, ignoring the embedded 753-entry taxonomy) with the scorer from
`ucs_signature_spec.md` §6:

1. **Gates** — zero out the impossible.
2. **Weighted Gaussian likelihood** over the surviving features, skipping any not yet
   computed and renormalizing the weights.
3. **Text evidence** — keyword match against `synonyms`, weighted by tier (α/β table
   in the spec: signal drives `signal_separable`, text drives `semantic_only`).
4. **Abstain** to the category's `MISC` when the top two are close. ~70 of 82
   categories have a MISC bucket. Abstention is a correct answer.
5. **Explain** — report the gate that killed the runner-up. That explanation is why
   gates-and-priors beat an opaque embedding for a librarian who has to trust the
   call, and it is the reason to keep this architecture even after adding CLAP.

---

## 10. Order of operations

| # | Action | Blocks | Effort |
|---|---|---|---|
| 1 | Raise `max_len` + `MAX_FRAMES` | everything | trivial |
| 2 | Store `voicing_ratio` (already computed, discarded) | VOICES/CROWDS | trivial |
| 3 | Implement `stationarity` + `onset_periodicity` + `onset_rate` | 330/231/274 signatures | small |
| 4 | Batch feature-dump mode (dir → CSV) | all calibration | small |
| 5 | Clone `fsd50k-ucs`, drop category-only, fix the 7 invented pairs, filter to PP | ground truth | small |
| 6 | **Falsify the tiers + measure gate false-kill** | trustworthiness | medium |
| 7 | Calibrate the 12 morphologies + material axis; propagate | 93% of taxonomy | medium |
| 8 | Point the pipeline at your own UCS-named library | *supersedes much of the above* | depends on you |
| 9 | Wire up `ucs.rs` | shipping | medium |
| 10 | CLAP embeddings for the `semantic_only` 284 | the hard half | large |

Step 6 comes before step 7 deliberately. There is no point calibrating numbers for a
tier assignment that data says is wrong.
