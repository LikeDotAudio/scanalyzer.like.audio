#!/usr/bin/env python3
"""Validate every acoustic_signature in UCS/categories/*.json against the spec.

The spec is Documentation/ucs_signature_spec.md. This enforces the parts of it a
machine can check: closed vocabularies, well-formed gates and priors, numeric
sanity, and a resolvable confusion graph. Exits non-zero on any error.
"""
import json
import pathlib
import sys
from collections import Counter

HERE = pathlib.Path(__file__).parent
CATEGORIES = HERE / "categories"

MORPHOLOGY = {
    "impulsive", "impulsive_with_tail", "burst", "sustained_tonal",
    "sustained_noise", "texture", "rhythmic", "sweep", "friction",
    "granular", "voiced", "complex", "silence",
}

SEPARABILITY = {
    "signal_separable", "signal_narrowable", "semantic_only", "provenance_only",
}

# Section 4a of the spec — computed today, exact Peak field names.
FEATURES_AVAILABLE = {
    "length_seconds", "transient_count", "root_mean_square_level", "lufs",
    "crest_factor", "zero_crossings_per_second", "pitch_hz", "harmonicity",
    "inharmonicity", "partial_count", "sustain_ratio", "spectral_centroid_hz",
    "spectral_centroid_mean_hz", "spectral_centroid_deviation_hz",
    "spectral_rolloff_hz", "spectral_flatness", "spectral_flux", "complexity",
    "low_band_energy", "mid_band_energy", "high_band_energy",
    "total_harmonic_distortion", "clipping_density", "envelope_attack_seconds",
    "envelope_decay_seconds", "envelope_sustain_level",
    "envelope_release_seconds", "envelope_temporal_centroid",
    "envelope_skewness", "envelope_kurtosis", "dc_offset", "beats_per_minute",
    "sample_rate",
}

# Section 4b — referenced by signatures, not yet computed. The scorer must skip
# these until they land, renormalizing the surviving weights.
FEATURES_PROPOSED = {
    "onset_rate_per_second", "onset_periodicity",
    "spectral_centroid_slope_hz_per_second", "pitch_slope_semitones_per_second",
    "stationarity", "voicing_ratio", "syllabic_modulation_energy",
    "spectral_slope_db_per_octave", "decay_time_seconds_60db",
    "band_limit_high_hz", "stereo_width", "spectral_entropy",
}

FEATURES = FEATURES_AVAILABLE | FEATURES_PROPOSED

# Features that are strictly positive, so a log transform is defined. The spec
# mandates log for these — they are log-normal, not Gaussian.
MUST_BE_LOG = {
    "length_seconds", "crest_factor", "zero_crossings_per_second", "pitch_hz",
    "spectral_centroid_hz", "spectral_centroid_mean_hz", "spectral_rolloff_hz",
    "envelope_attack_seconds", "envelope_decay_seconds",
    "envelope_release_seconds", "decay_time_seconds_60db",
    "onset_rate_per_second", "band_limit_high_hz",
}

errors, warnings = [], []
tiers, morphs = Counter(), Counter()
feature_use = Counter()
all_ids, referenced_ids = set(), set()
signed = total = 0


def check(sig, where):
    global signed
    if not isinstance(sig, dict):
        errors.append(f"{where}: acoustic_signature is not an object")
        return
    signed += 1

    morph = sig.get("morphology")
    if morph not in MORPHOLOGY:
        errors.append(f"{where}: morphology {morph!r} not in the enum")
    else:
        morphs[morph] += 1

    tier = sig.get("separability")
    if tier not in SEPARABILITY:
        errors.append(f"{where}: separability {tier!r} not in the enum")
    else:
        tiers[tier] += 1

    for g in sig.get("gates", []):
        f = g.get("feature")
        if f not in FEATURES:
            errors.append(f"{where}: gate on unknown feature {f!r}")
            continue
        feature_use[f] += 1
        if "min" not in g and "max" not in g:
            errors.append(f"{where}: gate on {f} has neither min nor max")
        if "min" in g and "max" in g and g["min"] >= g["max"]:
            errors.append(f"{where}: gate on {f} has min >= max")

    for p in sig.get("priors", []):
        f = p.get("feature")
        if f not in FEATURES:
            errors.append(f"{where}: prior on unknown feature {f!r}")
            continue
        feature_use[f] += 1

        for key in ("mean", "deviation", "weight"):
            if not isinstance(p.get(key), (int, float)):
                errors.append(f"{where}: prior on {f} missing numeric {key!r}")

        dev, w, mean = p.get("deviation"), p.get("weight"), p.get("mean")
        if isinstance(dev, (int, float)) and dev <= 0:
            errors.append(f"{where}: prior on {f} has deviation <= 0")
        if isinstance(w, (int, float)) and not (0 < w <= 1):
            errors.append(f"{where}: prior on {f} has weight {w} outside (0, 1]")

        tf = p.get("transform")
        if tf not in ("log", "linear"):
            errors.append(f"{where}: prior on {f} has transform {tf!r}")
        if tf == "log":
            if isinstance(mean, (int, float)) and mean <= 0:
                errors.append(f"{where}: prior on {f} is log with mean <= 0")
            if isinstance(dev, (int, float)) and dev <= 1.0:
                # a log-domain sigma is a MULTIPLICATIVE factor; <= 1 is nonsense
                errors.append(
                    f"{where}: prior on {f} is log but deviation {dev} <= 1.0 — "
                    "a log deviation is a multiplicative factor, e.g. 1.5 or 2.0"
                )
        if f in MUST_BE_LOG and tf == "linear":
            warnings.append(f"{where}: {f} is log-normal but uses transform 'linear'")

    tier_ = sig.get("separability")
    if tier_ == "provenance_only" and sig.get("priors"):
        warnings.append(f"{where}: provenance_only but carries priors — signal must not assert this")
    if tier_ in ("signal_separable", "signal_narrowable") and not sig.get("priors"):
        errors.append(f"{where}: {tier_} but has no priors — nothing to score")

    for cid in sig.get("confusable_with", []):
        referenced_ids.add(cid)


for path in sorted(CATEGORIES.glob("*.json")):
    if path.name == "index.json":
        continue
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"{path.name}: INVALID JSON — {e}")
        continue

    for sub in data.get("subcategories", []):
        total += 1
        cid = sub.get("category_id", "?")
        all_ids.add(cid)
        where = f"{path.stem}/{cid}"

        for key in ("subcategory", "category_id", "explanation", "synonyms"):
            if key not in sub:
                errors.append(f"{where}: lost original key {key!r}")

        if "acoustic_signature" not in sub:
            errors.append(f"{where}: NO acoustic_signature")
        else:
            check(sub["acoustic_signature"], where)

dangling = referenced_ids - all_ids
for cid in sorted(dangling):
    warnings.append(f"confusable_with references unknown category_id {cid!r}")

print(f"subcategories:        {total}")
print(f"signed:               {signed}")
print(f"\nseparability tiers:")
for tier, n in tiers.most_common():
    print(f"  {tier:20s} {n:4d}  ({100*n/max(total,1):.0f}%)")
print(f"\nmorphology:")
for m, n in morphs.most_common():
    print(f"  {m:20s} {n:4d}")
print(f"\ntop features referenced:")
for f, n in feature_use.most_common(15):
    tag = "" if f in FEATURES_AVAILABLE else "  [PROPOSED — not yet computed]"
    print(f"  {f:40s} {n:4d}{tag}")

unused = FEATURES_PROPOSED - set(feature_use)
if unused:
    print(f"\nproposed features nothing actually uses (drop them?): {sorted(unused)}")

if warnings:
    print(f"\n{len(warnings)} warning(s):")
    for w in warnings[:25]:
        print(f"  ! {w}")
    if len(warnings) > 25:
        print(f"  ... and {len(warnings)-25} more")

if errors:
    print(f"\n{len(errors)} ERROR(s):")
    for e in errors[:40]:
        print(f"  x {e}")
    if len(errors) > 40:
        print(f"  ... and {len(errors)-40} more")
    sys.exit(1)

print("\nOK — every signature conforms to the spec.")
