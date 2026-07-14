#!/usr/bin/env python3
"""Calibrate the MUSICAL (and MUSICPROD) acoustic signatures against a real music library.

    python3 UCS/music_calibrate.py measure   "<library>/"   # report only, writes nothing
    python3 UCS/music_calibrate.py calibrate "<library>/"   # measure, then rewrite the two files

Why a second calibrator, next to fsd50k_calibrate.py
----------------------------------------------------
FSD50K is amateur audio, out of domain, and its labels come from a crosswalk. That is
why that script may only ever WIDEN a deviation: "a measured number is a prior on the
prior, and a too-tight prior produces confident wrong answers."

A producer's sample library is the opposite on every count. It IS the domain MUSICAL
describes; it is clean, professional, deliberately recorded audio; and it is the corpus
the classifier will actually be pointed at. Here a measured number is not a hint about
the prior — it is the thing the prior is trying to describe. So this script may tighten
as well as widen, and it says so in the provenance it writes.

The ground truth
----------------
Not the UCS matcher's own verdict — calibrating a classifier on its own output teaches
it only to repeat itself. The label is `classification.music_production_category`, which
`music_prod.rs` derives from `categorize.rs`'s filename rule table plus the envelope:

    "Kick_01.wav"  -> group Kick  -> role PERCUSSION
    "Rhodes E3.wav"-> group Keyboards -> role KEYED

That path never reads a UCS signature, so it is independent evidence. And the 17 roles
are, by construction, MUSICAL's own subcategory names (MUSICPROD.json: "Subcategory
names and acoustic signatures are carried over from UCS MUSICAL") — so one label serves
both files.

Two labels are refused:
  * MISC              — the catch-all. Calibrating a bucket that means "we could not tell"
                        would fit a signature to the union of everything, which is exactly
                        the vague-but-always-plausible prior that makes MISC win.
  * IMPULSE RESPONSE  — a MUSICPROD role with no MUSICAL counterpart. It calibrates
                        MUSICPROD only, never MUSICAL.
"""
import sys, os, re, json, math, glob, copy, statistics, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATE = "2026-07"

MIN_CLIPS = 40          # below this a median is an anecdote
LOG = {                 # features read in log space; deviation is a MULTIPLICATIVE factor
    'length_seconds', 'pitch_hz', 'spectral_centroid_hz', 'spectral_centroid_mean_hz',
    'spectral_centroid_deviation_hz', 'spectral_rolloff_hz', 'zero_crossings_per_second',
    'crest_factor', 'envelope_attack_seconds', 'envelope_decay_seconds',
    'envelope_release_seconds', 'decay_time_seconds_60db', 'onset_rate_per_second',
    'partial_count', 'transient_count', 'beats_per_minute',
}

# Features that describe the FILE rather than the SOUND, on any corpus.
#
# Deliberately much shorter than fsd50k_calibrate's NEVER list. Most of that list exists
# because Freesound uploads are amateur and inconsistently normalized — length is
# truncated, loudness is arbitrary, the codec sets the band limit. None of that is true
# of a professional sample library, where length and loudness are FACTS about the sample
# (a one-shot IS short; a mastered kick IS loud), so they are calibrated here.
NEVER = {
    'sample_rate',      # a property of the encoding
    'bit_depth',
    'dc_offset',        # a recording defect
    'clipping_density', # a defect
    'voicing_ratio',    # the WebRTC VAD is telephony-tuned; it fires on guitar and rain
}


def load_records(corpus):
    """Every .PEAK under the library, flattened to scalars + its independent role label."""
    out = []
    for path in glob.iglob(os.path.join(corpus, '**', '*.PEAK'), recursive=True):
        try:
            d = json.load(open(path))
        except Exception:
            continue
        if not isinstance(d, dict):
            continue                       # legacy aggregate arrays
        role = (d.get('classification') or {}).get('music_production_category', '')
        if not role or role in ('MISC', ''):
            continue
        c = {}
        for blk in ('metadata', 'envelope', 'spectral_features', 'musicality'):
            for k, v in (d.get(blk) or {}).items():
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    continue
                c[k] = v
        # the scorer derives this on the fly; mirror it exactly (ucs.rs feature())
        if c.get('length_seconds', 0) > 0 and 'transient_count' in c:
            c['onset_rate_per_second'] = c['transient_count'] / c['length_seconds']
        c['_role'] = role
        c['_group'] = (d.get('classification') or {}).get('group', '')
        out.append(c)
    return out


def by_label(corpus, min_clips=MIN_CLIPS):
    recs = load_records(corpus)
    groups = collections.defaultdict(list)
    for c in recs:
        groups[c['_role']].append(c)
    kept = {k: v for k, v in groups.items() if len(v) >= min_clips}
    dropped = {k: len(v) for k, v in groups.items() if len(v) < min_clips}
    return kept, {'records': len(recs), 'labels': len(kept), 'too_few': dropped}


def values(clips, feat):
    v = [c[feat] for c in clips if feat in c and isinstance(c[feat], (int, float))]
    return [x for x in v if not (isinstance(x, float) and (math.isnan(x) or math.isinf(x)))]


def robust(vals, feat, force_log=None):
    """median + MAD->sigma, in the space the caller will read it back in."""
    n = len(vals)
    if n < 8:
        return None
    log = (feat in LOG) if force_log is None else force_log
    x = [math.log(v) for v in vals if v > 0] if log else list(vals)
    if len(x) < 8:
        return None
    med = statistics.median(x)
    mad = statistics.median([abs(v - med) for v in x])
    sigma = 1.4826 * mad
    if sigma <= 0:
        s = sorted(x)
        sigma = (s[int(.84 * (len(s) - 1))] - s[int(.16 * (len(s) - 1))]) / 2.0
    return med, sigma, len(x)


def signif(x, digits=5):
    if x is None or x == 0:
        return 0.0 if x == 0 else None
    return round(x, max(0, digits - 1 - int(math.floor(math.log10(abs(x))))))


def calibrate_prior(p, clips):
    """Move the mean to the measured median and the deviation to the measured spread.

    Unlike the FSD50K path this may TIGHTEN. The corpus is in-domain, clean and large,
    so a narrow measured spread is a fact about the sound, not an artifact of the
    recording — and refusing to tighten would leave MUSICAL with the very vagueness that
    lets other categories outrank it on files that are plainly musical.
    """
    feat = p['feature']
    if feat in NEVER:
        return None
    v = values(clips, feat)
    if len(v) < MIN_CLIPS:
        return None
    log = p.get('transform') == 'log'
    st = robust(v, feat, force_log=log)
    if not st:
        return None
    med, sigma, n = st

    prov = p.get('provenance', {})
    old_mean = prov.get('reasoned_mean_before_calibration', p['mean'])
    old_dev = prov.get('reasoned_deviation_before_calibration', p['deviation'])

    new_mean = math.exp(med) if log else med
    if log:
        # a multiplicative factor: must stay > 1 or the scorer divides by ln(<=1)
        new_dev = max(math.exp(1.2 * sigma), 1.15)
    else:
        new_dev = max(1.2 * sigma, 1e-6)
    return signif(new_mean), signif(new_dev), n, old_mean, old_dev, log


def load_targets():
    """The two files this script owns. Nothing else is touched."""
    out = {}
    for name in ('MUSICAL', 'MUSICPROD'):
        path = os.path.join(HERE, 'categories', f'{name}.json')
        out[name] = (path, json.load(open(path)))
    return out


def run(corpus, write):
    kept, stats = by_label(corpus)
    print(f"corpus: {corpus}")
    print(f"  records with an independent role label : {stats['records']}")
    print(f"  labels with >= {MIN_CLIPS} samples          : {stats['labels']}")
    if stats['too_few']:
        print(f"  too few to calibrate (left alone)      : {stats['too_few']}")
    print()

    targets = load_targets()
    changes = 0
    for name, (path, doc) in targets.items():
        print(f"=== {name}.json")
        for sub in doc['subcategories']:
            label = sub['subcategory']
            clips = kept.get(label)
            if not clips:
                continue
            if label == 'MISC':
                continue
            sig = sub.get('acoustic_signature') or {}
            priors = sig.get('priors') or []
            if not priors:
                continue
            lines = []
            for p in priors:
                res = calibrate_prior(p, clips)
                if not res:
                    continue
                new_mean, new_dev, n, old_mean, old_dev, log = res
                moved = (old_mean == 0 and new_mean != 0) or (
                    old_mean != 0 and abs(new_mean - old_mean) / abs(old_mean) > 0.05)
                tighter = new_dev < old_dev
                lines.append(f"      {p['feature']:38} mean {old_mean:>10.4g} -> {new_mean:<10.4g}"
                             f" dev {old_dev:>8.4g} -> {new_dev:<8.4g} "
                             f"{'TIGHTER' if tighter else 'wider  '} n={n}")
                if write:
                    prov = p.setdefault('provenance', {})
                    prov.setdefault('reasoned_mean_before_calibration', p['mean'])
                    prov.setdefault('reasoned_deviation_before_calibration', p['deviation'])
                    prov['calibrated_against'] = 'music production library'
                    prov['calibrated_on'] = DATE
                    prov['samples'] = n
                    prov['policy'] = ('in-domain corpus: the measured median and spread are '
                                      'authoritative, so the deviation may tighten as well as widen')
                    p['mean'] = new_mean
                    p['deviation'] = new_dev
                    changes += 1
                _ = moved
            if lines:
                print(f"  {label}  ({len(clips)} samples)")
                print('\n'.join(lines))
        if write:
            with open(path, 'w') as f:
                json.dump(doc, f, indent=2, ensure_ascii=False)
                f.write('\n')
    print()
    if write:
        print(f"wrote {changes} priors across MUSICAL.json and MUSICPROD.json")
        print("rebuild the engine: the revision hash covers the category data, so every")
        print("existing .PEAK sidecar is now stale and will be re-analyzed on the next scan.")
    else:
        print("measure only — nothing written. Re-run with `calibrate` to apply.")


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('measure', 'calibrate'):
        print(__doc__)
        sys.exit(2)
    run(sys.argv[2], write=(sys.argv[1] == 'calibrate'))
