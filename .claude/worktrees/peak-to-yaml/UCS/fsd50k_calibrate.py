#!/usr/bin/env python3
"""Calibrate the UCS acoustic signatures against a scanned FSD50K corpus.

    python3 UCS/fsd50k_calibrate.py calibrate <FSD50K.dev_audio/>   # measure, then rewrite categories/*.json
    python3 UCS/fsd50k_calibrate.py evaluate  <FSD50K.dev_audio/>   # held-out 70/30, signal only, no writes

The corpus is a directory of `.PEAK` sidecars whose file names carry the human
FSD50K label chain (`Label-Label-..._[freesound_id].PEAK`). Those labels are joined
to UCS ids through `fsd50k_crosswalk.json`.

Policy (see README, "Calibrating the signatures against FSD50K"):
  * only `high`/`medium` crosswalk entries calibrate;
  * a clip is used only if every label it carries agrees on ONE subcategory;
  * location = median (geometric for log features), scale = MAD -> sigma;
  * deviations may only WIDEN, never tighten. FSD50K is amateur audio and a UCS
    library is clean professional SFX, so a measured number is a prior on the
    prior, and a too-tight prior produces confident wrong answers;
  * eleven features are never calibrated here at all (see NEVER) because on this
    corpus they measure the uploader rather than the sound.
"""
import sys, os, re, json, math, glob, copy, statistics, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATE = "2026-07"

# ---------------------------------------------------------------- the vocabulary

# ucs_signature_spec.md 4a + 4b. "`feature` must be one of these exact names ...
# Nothing outside this vocabulary is legal." Anything else on the record
# (bit_depth, channels, mid_rms, the legacy attack_seconds) is metadata or a
# dataset artifact, not a fact about the sound.
VOCABULARY = {
    'length_seconds', 'transient_count', 'root_mean_square_level', 'lufs', 'crest_factor',
    'zero_crossings_per_second', 'pitch_hz', 'harmonicity', 'inharmonicity', 'partial_count',
    'sustain_ratio', 'spectral_centroid_hz', 'spectral_centroid_mean_hz',
    'spectral_centroid_deviation_hz', 'spectral_rolloff_hz', 'spectral_flatness',
    'spectral_flux', 'complexity', 'low_band_energy', 'mid_band_energy', 'high_band_energy',
    'total_harmonic_distortion', 'clipping_density', 'envelope_attack_seconds',
    'envelope_decay_seconds', 'envelope_sustain_level', 'envelope_release_seconds',
    'envelope_temporal_centroid', 'envelope_skewness', 'envelope_kurtosis', 'dc_offset',
    'beats_per_minute', 'sample_rate', 'onset_rate_per_second', 'onset_periodicity',
    'stationarity', 'spectral_entropy', 'spectral_slope_db_per_octave', 'band_limit_high_hz',
    'spectral_centroid_slope_hz_per_second', 'pitch_slope_semitones_per_second',
    'syllabic_modulation_energy', 'decay_time_seconds_60db', 'voicing_ratio', 'stereo_width',
}

# Features whose value on THIS corpus is a property of the uploader, not the source.
NEVER = {
    'length_seconds',            # Freesound clips are truncated to 0.3-30 s
    'lufs',                      # arbitrary uploader normalization
    'root_mean_square_level',    # same
    'stereo_width',              # FSD50K is mono; the feature is undefined, not zero
    'sample_rate',               # a property of the encoding
    'beats_per_minute',          # not a target of this dataset
    'dc_offset',                 # a recording defect
    'clipping_density',          # a defect, and confounded by lossy-transcode overshoot
    'total_harmonic_distortion', # confounded by lossy-transcode artifacts
    'band_limit_high_hz',        # much of FSD50K is lossy-origin: measures the codec
    'voicing_ratio',             # the WebRTC VAD is telephony-tuned; fires on guitar and rain
}
CALIBRATABLE = sorted(VOCABULARY - NEVER)

# Compared on a log axis (spec 4a).
LOG = {'length_seconds', 'crest_factor', 'zero_crossings_per_second', 'pitch_hz',
       'spectral_centroid_hz', 'spectral_centroid_mean_hz', 'spectral_rolloff_hz',
       'envelope_attack_seconds', 'envelope_decay_seconds', 'envelope_release_seconds',
       'decay_time_seconds_60db', 'complexity', 'onset_rate_per_second', 'partial_count',
       'transient_count'}

# Defined against THE single loudest peak of the file. On a multi-event clip they
# describe the uploader's edit, not the sound: attack tracks clip length at r=+0.72,
# and a computer keypress reads 10 ms one-shot vs 3.0 s multi-event. Calibrate from
# one-shot clips only.
SINGLE_EVENT_ONLY = {'envelope_attack_seconds', 'envelope_decay_seconds',
                     'envelope_sustain_level', 'envelope_release_seconds',
                     'envelope_temporal_centroid', 'envelope_skewness', 'envelope_kurtosis',
                     'sustain_ratio', 'decay_time_seconds_60db', 'crest_factor'}

# Clamped 0..1 by the extractor, so the MAD collapses when the mass sits on a bound.
CENSORED = {'stationarity': (0.0, 1.0)}
BOUNDED_0_1 = {'harmonicity', 'inharmonicity', 'spectral_flatness', 'spectral_entropy',
               'sustain_ratio', 'envelope_sustain_level', 'envelope_temporal_centroid',
               'low_band_energy', 'mid_band_energy', 'high_band_energy', 'stationarity',
               'onset_periodicity', 'voicing_ratio', 'syllabic_modulation_energy',
               'spectral_flux', 'clipping_density'}

MIN_CLIPS = 30

# ---------------------------------------------------------------- loading

def load_clips(corpus):
    """Every .PEAK in the corpus, flattened to its scalar features + its human labels."""
    out = []
    for p in sorted(glob.glob(os.path.join(corpus, '*.PEAK'))):
        m = re.match(r'^(.*)_\[(\d+)\]$', os.path.basename(p)[:-5])
        if not m:
            continue
        try:
            d = json.load(open(p))
        except Exception:
            continue
        c = {}
        for blk in ('metadata', 'envelope', 'spectral_features', 'musicality'):
            for k, v in d.get(blk, {}).items():
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    continue
                c[k] = v
        # the scorer derives this on the fly; mirror it exactly (ucs.rs feature())
        if c.get('length_seconds', 0) > 0 and 'transient_count' in c:
            c['onset_rate_per_second'] = c['transient_count'] / c['length_seconds']
        c['_labels'] = m.group(1).split('-')
        c['_id'] = m.group(2)
        out.append(c)
    return out

def load_clean(corpus, min_clips=MIN_CLIPS):
    """Clips whose labels agree on exactly one UCS subcategory, grouped by that id."""
    cw = json.load(open(os.path.join(HERE, 'fsd50k_crosswalk.json')))
    xmap = {e['fsd50k_class']: e['ucs_id']
            for e in cw['entries'] if e['confidence'] in ('high', 'medium')}
    clean = collections.defaultdict(list)
    total = ambiguous = unmapped = 0
    for c in load_clips(corpus):
        total += 1
        ids = {xmap[l] for l in c['_labels'] if l in xmap}
        if not ids:
            unmapped += 1
            continue
        if len(ids) > 1:            # a bird over a car engine describes neither
            ambiguous += 1
            continue
        c['_classes'] = [l for l in c['_labels'] if l in xmap]
        clean[ids.pop()].append(c)
    kept = {k: v for k, v in clean.items() if len(v) >= min_clips}
    stats = {'total': total, 'ambiguous': ambiguous, 'unmapped': unmapped,
             'used': sum(len(v) for v in kept.values()), 'subcategories': len(kept)}
    return kept, stats

def load_signatures():
    """ucs_id -> (path, subcategory object). The category files are the source of truth."""
    sigs, docs = {}, {}
    for f in sorted(glob.glob(os.path.join(HERE, 'categories', '*.json'))):
        if f.endswith('index.json'):
            continue
        d = json.load(open(f))
        docs[f] = d
        for s in d['subcategories']:
            sigs[s['category_id']] = (f, s)
    return sigs, docs

# ---------------------------------------------------------------- statistics

def is_one_shot(c):
    return c.get('transient_count', 99) <= 1

def eligible(clips, feat):
    return [c for c in clips if is_one_shot(c)] if feat in SINGLE_EVENT_ONLY else clips

def values(clips, feat):
    """A feature's values, with the known artifacts of this corpus removed."""
    out = []
    for c in clips:
        v = c.get(feat)
        if v is None or isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        if math.isnan(v) or math.isinf(v):
            continue
        # a "decay" that runs to the end of the file is the file ending, not a ring
        if feat == 'decay_time_seconds_60db':
            L = c.get('length_seconds', 0)
            if L and v >= 0.9 * L:
                continue
        if feat == 'pitch_hz' and not (50 <= v <= 2000):   # spec: valid only 50-2000 Hz
            continue
        if feat in LOG and v <= 0:
            continue
        out.append(float(v))
    return out

def robust(vals, feat, force_log=None):
    """median + MAD->sigma, in the space the caller will read it back in."""
    n = len(vals)
    if n < 8:
        return None
    log = (feat in LOG) if force_log is None else force_log
    x = [math.log(v) for v in vals] if log else list(vals)
    med = statistics.median(x)
    mad = statistics.median([abs(v - med) for v in x])
    sigma = 1.4826 * mad
    if sigma <= 0:      # MAD collapsed (censored or degenerate) -> percentile spread
        s = sorted(x)
        sigma = (s[int(.84 * (n - 1))] - s[int(.16 * (n - 1))]) / 2.0
    return med, sigma, n

def pcts(vals):
    s = sorted(vals)
    q = lambda f: s[int(f * (len(s) - 1))]
    return q(.05), q(.5), q(.95)

def signif(x, digits=5):
    """Round to N significant figures — the format already in categories/*.json."""
    if x is None:
        return None
    if x == 0:
        return 0.0
    return round(x, max(0, digits - 1 - int(math.floor(math.log10(abs(x))))))

sig5 = signif   # means keep 5 significant figures

# ---------------------------------------------------------------- the policy

def calibrate_prior(p, clips):
    """Move the mean to the measured median; widen the deviation, never tighten it."""
    feat = p['feature']
    if feat in NEVER:
        return None
    v = values(eligible(clips, feat), feat)
    if len(v) < MIN_CLIPS:
        return None
    # The prior's DECLARED transform is the authority: it is what the scorer reads the
    # deviation as. Writing a geometric factor into a "linear" prior silently
    # reinterprets it as an additive sigma.
    log = p.get('transform') == 'log'
    st = robust(v, feat, force_log=log)
    if not st:
        return None
    med, sigma, n = st
    # Idempotent: on a re-run, the reasoned value is the one recorded the first time,
    # not the calibrated mean now sitting in the file. Losing it would erase the only
    # record of what was reasoned rather than measured.
    prov = p.get('provenance', {})
    old_mean = prov.get('reasoned_mean_before_calibration', p['mean'])
    old_dev = p['deviation']
    new_mean = math.exp(med) if log else med
    if log:
        # under transform:"log" the deviation is a MULTIPLICATIVE factor and must be > 1
        new_dev = max(old_dev, max(math.exp(1.2 * sigma), 1.15))
    else:
        new_dev = max(old_dev, 1.2 * sigma)
        if feat in CENSORED and sum(1 for x in v if x <= CENSORED[feat][0]) / n > 0.15:
            new_dev = max(new_dev, 0.25)   # mass on the clamp cannot support a tight prior
    return new_mean, new_dev, n, old_mean, old_dev, log

def widen_gate(g, feat, vals):
    """Widen a gate to the measured p01/p99. None => it can rule nothing out, and a
    vacuous gate is worse than no gate: it reads as a constraint that was tested."""
    s = sorted(vals)
    n = len(s)
    p01, p99 = s[int(.01 * (n - 1))], s[int(.99 * (n - 1))]
    ng, changed = dict(g), []
    if 'max' in g:
        new = min(1.0, p99 + 0.02) if feat in BOUNDED_0_1 else p99 * 1.05
        if new > g['max']:
            if feat in BOUNDED_0_1 and new >= 0.999:
                return None, 'removed', f"widening to the measured p99 ({p99:.2f}) reaches the feature's ceiling of 1.0 — it excludes nothing"
            ng['max'] = signif(new, 4)
            changed.append(f"max {g['max']} -> {ng['max']}")
    if 'min' in g:
        new = max(0.0, p01 - 0.02) if feat in BOUNDED_0_1 else p01 * 0.95
        if new < g['min']:
            if new <= 1e-6:
                return None, 'removed', f"widening to the measured p01 ({p01:.4g}) reaches the feature's floor of 0 — it excludes nothing"
            ng['min'] = signif(new, 4)
            changed.append(f"min {g['min']} -> {ng['min']}")
    if not changed:
        return g, 'kept', ''
    return ng, 'widened', '; '.join(changed)

def gate_false_kill(g, feat, clips):
    """The fraction of this subcategory's OWN true clips the gate rejects. Gates are
    unrecoverable — a violation zeroes the score, and nothing downstream recovers it."""
    v = values(eligible(clips, feat), feat)
    if len(v) < MIN_CLIPS:
        return None, v
    killed = sum(1 for x in v
                 if ('min' in g and x < g['min']) or ('max' in g and x > g['max']))
    return 100.0 * killed / len(v), v

# ---------------------------------------------------------------- scoring (spec 6)

def score(sig, c, rule='spec'):
    """Signal only — gates, then the weighted Gaussian. No filename, no text evidence.

    rule='spec'   : L = sum(w*-0.5z^2) / sum(w), as ucs.rs implements today.
    rule='loglik' : a true Gaussian log-likelihood, summed, keeping the per-term
                    normalizer -ln(sigma). See the README: the spec's division by
                    sum(w) rewards a signature for being vague."""
    for g in sig.get('gates', []):
        x = c.get(g['feature'])
        if x is None:
            continue
        if ('min' in g and x < g['min']) or ('max' in g and x > g['max']):
            return -1e9
    num = den = 0.0
    terms = 0
    for p in sig.get('priors', []):
        x = c.get(p['feature'])
        if x is None:
            continue
        if p.get('transform') == 'log':
            if x <= 0 or p['mean'] <= 0 or p['deviation'] <= 1:
                continue
            s = math.log(p['deviation'])
            z = (math.log(x) - math.log(p['mean'])) / s
        else:
            if p['deviation'] <= 0:
                continue
            s = p['deviation']
            z = (x - p['mean']) / s
        z = max(-4.0, min(4.0, z))          # one wild feature must not veto everything
        w = p.get('weight', 1.0)
        terms += 1
        if rule == 'loglik':
            num += w * (-0.5 * z * z - math.log(s))
        else:
            num += w * (-0.5 * z * z)
            den += w
    if terms == 0:
        return 0.0 if rule == 'spec' else -1e9
    return num / den if rule == 'spec' else num

# ---------------------------------------------------------------- commands

def cmd_calibrate(corpus):
    clean, stats = load_clean(corpus)
    sigs, docs = load_signatures()
    analyzer = 'unknown'
    for clips in clean.values():
        break
    peaks = glob.glob(os.path.join(corpus, '*.PEAK'))
    if peaks:
        analyzer = json.load(open(peaks[0]))['metadata']['analyzer_version']

    calibrated, disagreements, gate_changes, gate_kills = [], [], [], []
    evidence = {}

    for uid, clips in clean.items():
        if uid not in sigs:
            continue
        sig = sigs[uid][1]['acoustic_signature']

        # --- gates: audit, then widen or retire
        keep = []
        for g in sig.get('gates', []):
            feat = g['feature']
            if feat in NEVER:
                keep.append(g)
                continue
            rate, v = gate_false_kill(g, feat, clips)
            if rate is None or rate <= 2.0:
                keep.append(g)
                continue
            p05, p50, p95 = pcts(v)
            gate_kills.append({'ucs_id': uid, 'feature': feat,
                               'gate': {k: g[k] for k in ('min', 'max') if k in g},
                               'clips': len(v),
                               'judged_on': 'one_shot_clips' if feat in SINGLE_EVENT_ONLY else 'all_clips',
                               'percent_of_true_clips_killed': round(rate, 1),
                               'measured_p05': sig5(p05), 'measured_median': sig5(p50),
                               'measured_p95': sig5(p95)})
            ng, action, detail = widen_gate(g, feat, v)
            rec = {'ucs_id': uid, 'feature': feat,
                   'was': {k: g[k] for k in ('min', 'max') if k in g},
                   'action': action, 'percent_of_true_clips_killed': round(rate, 1),
                   'clips': len(v), 'detail': detail}
            if action == 'kept':
                keep.append(ng)
                continue
            if ng is not None:
                ng['provenance'] = {
                    'source': 'fsd50k_measured', 'action': action, 'clips': len(v),
                    'was': {k: g[k] for k in ('min', 'max') if k in g},
                    'reason': f"the reasoned gate rejected {rate:.0f}% of this subcategory's own true clips",
                    'date': DATE}
                keep.append(ng)
                rec['now'] = {k: ng[k] for k in ('min', 'max') if k in ng}
            gate_changes.append(rec)
        sig['gates'] = keep

        # --- priors
        for p in sig.get('priors', []):
            r = calibrate_prior(p, clips)
            if not r:
                continue
            new_mean, new_dev, n, old_mean, old_dev, log = r
            if log and old_mean > 0:
                off = abs(math.log(new_mean) - math.log(old_mean)) / max(math.log(new_dev), 1e-9)
            else:
                off = abs(new_mean - old_mean) / max(new_dev, 1e-9)
            if off > 2.0:
                disagreements.append({'ucs_id': uid, 'feature': p['feature'], 'clips': n,
                                      'reasoned_mean': old_mean, 'measured_mean': sig5(new_mean),
                                      'spreads_apart': round(off, 1)})
            p['mean'] = sig5(new_mean)
            p['deviation'] = signif(new_dev, 4)
            p['provenance'] = {
                'source': 'fsd50k_measured', 'dataset': 'FSD50K.dev', 'clips': n,
                'analyzer_version': analyzer, 'date': DATE,
                'measured_on': 'one_shot_clips_only' if p['feature'] in SINGLE_EVENT_ONLY else 'all_unambiguous_clips',
                'reasoned_mean_before_calibration': old_mean}
            calibrated.append({'ucs_id': uid, 'feature': p['feature'], 'clips': n})

        # --- the facts, whether or not a prior happens to reference them
        obs = {}
        for feat in CALIBRATABLE:
            v = values(eligible(clips, feat), feat)
            if len(v) < 20:
                continue
            st = robust(v, feat)
            if not st:
                continue
            p05, p50, p95 = pcts(v)
            e = {'clips': st[2], 'percentile_05': sig5(p05), 'median': sig5(p50),
                 'percentile_95': sig5(p95)}
            if feat in SINGLE_EVENT_ONLY:
                e['measured_on'] = 'one_shot_clips_only'
            if feat in CENSORED:
                at = sum(1 for x in v if x <= CENSORED[feat][0]) / len(v)
                if at > 0.15:
                    e['censored_at_floor_fraction'] = round(at, 3)
            obs[feat] = e
        classes = dict(collections.Counter(c for cl in clips for c in cl['_classes']))
        evidence[uid] = {'clips': len(clips), 'classes': classes, 'observations': obs}
        sig['measured_evidence'] = {
            'dataset': f'FSD50K.dev — {stats["total"]:,} human-labelled Freesound clips',
            'analyzer_version': analyzer, 'date': DATE, 'clip_count': len(clips),
            'selection': 'clips whose FSD50K labels map unambiguously to this one subcategory (high/medium crosswalk confidence only)',
            'contributing_fsd50k_classes': classes,
            'feature_observations': obs,
            'features_not_measurable_here': {f: 'left reasoned — see not_calibrated in fsd50k_calibration.json'
                                             for f in sorted(NEVER)},
            'caveat': 'Amateur Freesound audio, mono, arbitrary normalization. Treat as a prior on the prior, not as truth. Duration, level, stereo width and band limit are NOT measurable here and are left reasoned.'}

    # --- morphology archetypes: the lever for the ~690 subcategories FSD50K cannot reach
    morph = collections.defaultdict(list)
    for uid, clips in clean.items():
        if uid not in sigs:
            continue
        mo = sigs[uid][1]['acoustic_signature'].get('morphology')
        if mo:
            morph[mo].extend(clips)
    arch = {}
    for mo, clips in sorted(morph.items()):
        if len(clips) < 50:
            continue
        fo = {}
        for feat in CALIBRATABLE:
            v = values(eligible(clips, feat), feat)
            if len(v) < 50:
                continue
            st = robust(v, feat)
            if not st:
                continue
            med, sigma, n = st
            p05, p50, p95 = pcts(v)
            log = feat in LOG
            fo[feat] = {'clips': n,
                        'center': sig5(math.exp(med) if log else med),
                        'deviation': signif(math.exp(1.2 * sigma) if log else 1.2 * sigma, 4),
                        'transform': 'log' if log else 'linear',
                        'percentile_05': sig5(p05), 'median': sig5(p50), 'percentile_95': sig5(p95)}
        arch[mo] = {'clips': len(clips),
                    'subcategories_contributing': sorted(
                        u for u in clean if u in sigs
                        and sigs[u][1]['acoustic_signature'].get('morphology') == mo),
                    'feature_observations': fo}

    for f, d in docs.items():
        json.dump(d, open(f, 'w'), indent=1, ensure_ascii=False)
    prev = json.load(open(os.path.join(HERE, 'fsd50k_calibration.json')))

    # A gate this run leaves alone is a gate a PREVIOUS run already fixed — it no longer
    # kills its own clips, so it is not re-derived. Carry those records forward, or a
    # re-run would silently erase the history of every widened and retired gate (and a
    # retired gate leaves no other trace).
    def merge(new, old, key):
        # OLD wins on conflict: these records are the history of what the reasoned
        # signature looked like and what was done to it. A later run re-auditing an
        # already-widened gate must not overwrite the record of why it was widened.
        seen = {key(r) for r in old}
        return old + [r for r in new if key(r) not in seen]
    gk = lambda r: (r['ucs_id'], r['feature'])
    gate_changes = merge(gate_changes, prev.get('gate_changes', []), gk)
    gate_kills = merge(gate_kills, prev.get('gate_false_kills', []), gk)
    json.dump({
        'schema': 'fsd50k-calibration/2', 'dataset': 'FSD50K.dev',
        'analyzer_version': analyzer, 'date': DATE,
        'clips_scanned': stats['total'], 'clips_used': stats['used'],
        'clips_dropped_ambiguous': stats['ambiguous'], 'clips_dropped_unmapped': stats['unmapped'],
        'selection': f'unambiguous single-subcategory clips, high/medium crosswalk confidence, >={MIN_CLIPS} clips per subcategory',
        'policy': {
            'location': 'median (geometric for log features)',
            'scale': 'MAD->sigma, widened 1.2x, and never tightened below the reasoned deviation',
            'never_calibrated': sorted(NEVER),
            'single_event_only': sorted(SINGLE_EVENT_ONLY),
            'artifacts_excluded': [
                "envelope ADSR, sustain_ratio, decay time and crest factor calibrated from one-shot clips only: on multi-event clips they measure the uploader's arrangement, not the sound (attack tracks clip length at r=+0.72; a keypress reads 10 ms one-shot vs 3.0 s multi-event)",
                'decay_time_seconds_60db >= 0.9x clip length (truncation, not ring)',
                'pitch_hz outside 50-2000 Hz',
                'stationarity mass on the 0.0 clamp widens rather than tightens'],
        },
        'morphology_archetypes': arch,
        'calibrated': calibrated,
        'gate_false_kills': sorted(gate_kills, key=lambda x: -x['percent_of_true_clips_killed']),
        'gate_changes': gate_changes,
        'disagreements': sorted(disagreements, key=lambda x: -x['spreads_apart']),
        'per_subcategory': {k: {'clips': v['clips'], 'classes': v['classes']}
                            for k, v in evidence.items()},
        'not_calibrated': prev.get('not_calibrated', {}),
    }, open(os.path.join(HERE, 'fsd50k_calibration.json'), 'w'), indent=1, ensure_ascii=False)

    print(f"clips {stats['total']}  used {stats['used']}  "
          f"(dropped {stats['ambiguous']} ambiguous, {stats['unmapped']} unmapped)")
    print(f"calibrated {len(calibrated)} priors across {stats['subcategories']} subcategories")
    print(f"gates: {sum(1 for g in gate_changes if g['action']=='widened')} widened, "
          f"{sum(1 for g in gate_changes if g['action']=='removed')} retired as vacuous")
    print(f"morphology archetypes: {len(arch)}")
    print(f"reasoning falsified: {len(disagreements)} priors >2 spreads from the measurement")
    print("wrote categories/*.json + fsd50k_calibration.json")


def cmd_evaluate(corpus):
    """Held-out 70/30, signal only. Reproduces the numbers quoted in the README."""
    clean, stats = load_clean(corpus)
    sigs, _ = load_signatures()
    tiers = {u: sigs[u][1]['acoustic_signature'].get('separability') for u in clean if u in sigs}

    train = {u: [c for c in cl if int(c['_id']) % 10 >= 3] for u, cl in clean.items()}
    test = {u: [c for c in cl if int(c['_id']) % 10 < 3] for u, cl in clean.items()}
    cands = sorted(u for u in clean if u in sigs)

    reasoned = {u: copy.deepcopy(sigs[u][1]['acoustic_signature']) for u in cands}
    # NOTE: if categories/*.json have already been calibrated, `reasoned` is the
    # calibrated state. Run `git stash` first to compare against the reasoned original.
    cal = copy.deepcopy(reasoned)
    for uid, clips in train.items():
        if uid not in cal:
            continue
        sig = cal[uid]
        keep = []
        for g in sig.get('gates', []):
            feat = g['feature']
            if feat in NEVER:
                keep.append(g)
                continue
            rate, v = gate_false_kill(g, feat, clips)
            if rate is None or rate <= 2.0:
                keep.append(g)
                continue
            ng, _, _ = widen_gate(g, feat, v)
            if ng is not None:
                keep.append(ng)
        sig['gates'] = keep
        for p in sig.get('priors', []):
            r = calibrate_prior(p, clips)
            if r:
                p['mean'], p['deviation'] = r[0], r[1]

    def ev(S, rule, name):
        by = collections.defaultdict(lambda: [0, 0])
        t1 = tot = killed = 0
        for uid, clips in test.items():
            t = tiers.get(uid, '?')
            for c in clips:
                tot += 1
                sc = {u: score(S[u], c, rule) for u in cands}
                if sc.get(uid, -1e9) <= -1e9:
                    killed += 1
                best = max(sc.values())
                win = [u for u, v in sc.items() if v == best]
                hit = uid in win and len(win) == 1
                t1 += hit
                by[t][0] += hit
                by[t][1] += 1
        line = f"  {name:38} {100*t1/tot:5.1f}%  gate-kills-own {100*killed/tot:4.1f}%  |"
        for t in ('signal_separable', 'signal_narrowable', 'semantic_only'):
            h, n = by[t]
            line += f"  {t.split('_')[-1][:4]} {100*h/n if n else 0:5.1f}%"
        print(line)

    print(f"held-out: {sum(len(v) for v in test.values())} test / "
          f"{sum(len(v) for v in train.values())} train, {len(cands)} candidate subcategories")
    print(f"  {'':38} {'top-1':>5}                     |  per separability tier")
    print(f"  {'chance':38} {100/len(cands):5.1f}%")
    ev(reasoned, 'spec',   'as-loaded, spec 6 rule (sum w / sum w)')
    ev(cal,      'spec',   'calibrated, spec 6 rule')
    ev(cal,      'loglik', 'calibrated, true Gaussian log-likelihood')
    ev(reasoned, 'loglik', 'as-loaded, true Gaussian log-likelihood')
    print("\nThe spec 6 rule divides by total weight, so a signature with fewer priors has")
    print("fewer chances to be penalized. The MISC abstention buckets win, and the tiers")
    print("inverted: semantic_only outscores signal_separable. The log-likelihood restores")
    print("the per-term normalizer and the ordering. See the README.")


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('calibrate', 'evaluate'):
        print(__doc__)
        sys.exit(2)
    corpus = sys.argv[2]
    if not os.path.isdir(corpus):
        sys.exit(f"not a directory: {corpus}")
    (cmd_calibrate if sys.argv[1] == 'calibrate' else cmd_evaluate)(corpus)
