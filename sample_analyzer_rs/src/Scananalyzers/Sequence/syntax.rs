//! Bioacoustic syntax — the grammar of a multi-slice file.
//!
//! Every other extractor answers "what does this sound like". This one answers
//! "in what ORDER, and what sits in between". A field recording of a bird, a
//! spoken take, a drum loop, a machine cycling — none of them are one sound.
//! They are a sequence of sounds drawn from a small vocabulary, and the
//! information is as much in the sequence as in any single event.
//!
//! The pipeline already does the hard part twice over:
//!   * `regions::detect_regions` segments the file into sounding stretches
//!     (the "slices"/syllables), and
//!   * `analyze_core` re-runs the WHOLE analysis on each slice, so every slice
//!     arrives here with its own MFCCs, centroid, harmonicity and envelope.
//!
//! What was missing is everything downstream of that. This module adds it:
//!
//! 1. **Vocabulary.** Cluster the slices by their own acoustic features into
//!    *types* (A, B, C…) — the discrete neighborhoods of a syllable map. Deep
//!    bioacoustics work (Best 2023; Morales 2022) learns this embedding with a
//!    convolutional auto-encoder; here the embedding is the MFCC + envelope +
//!    spectral vector the analyzer already computes, standardized within the
//!    file. The clustering is agglomerative with an automatic cut, because the
//!    repertoire size is exactly the thing we do not know in advance.
//!
//! 2. **A 2-D layout.** The same vectors are projected through the analyzer's
//!    own PCA so the record carries an (x, y) per slice. That is the node
//!    layout of a grammar map — the analog of the UMAP scatter, computed with
//!    the deterministic linear projection this codebase already trusts.
//!
//! 3. **Syntax.** First-order transition probabilities between types, and the
//!    information-theoretic verdict on whether the ordering carries any
//!    information at all: mutual information between consecutive slices, in
//!    bits. Zero means the order is random and there is no grammar to find.
//!
//! 4. **The junctions — what is BETWEEN the slices.** The gap between two
//!    slices is not nothing. It has a level, a spectrum, and a slope, and its
//!    shape says whether the two slices are separate utterances or one gesture:
//!    a decaying tail means the first sound is still ringing into the second, a
//!    rising gap is a breath or a wind-up before the next onset, a flat gap well
//!    above the noise floor is a continuous bed that never stops. TweetyNet
//!    (Cohen 2022) makes the same move by giving its network an explicit
//!    "background" class rather than treating the quiet as absence. Every
//!    junction is measured and classified here, and carries the surprisal of
//!    the transition it spans.
//!
//! Cost: arithmetic over the STFT frames, the RMS envelope and the per-region
//! analyses that already exist. No new transform, and it only runs for files
//! that actually have more than one slice.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::peak::Regions;

// ---------------------------------------------------------------- tunables

/// Ceiling on the repertoire. A "vocabulary" where nearly every slice is its own
/// word is not a vocabulary, it is a failure to cluster; and a grammar map with
/// more than a dozen node colors stops being readable. Birdsong repertoires in
/// the literature sit comfortably inside this.
const MAX_SLICE_TYPES: usize = 12;

/// Mean silhouette a candidate split must reach before the file is credited with
/// more than one syllable type. 0.5 is Kaufman & Rousseeuw's "reasonable
/// structure" line, and the bar exists because the alternative — cutting the
/// dendrogram at its biggest jump and taking whatever falls out — invents a
/// repertoire out of nothing: standardizing within one file rescales even
/// microscopic differences to unit variance, so six recordings of the SAME
/// syllable produce a tidy-looking five-way split. Requiring the clusters to be
/// genuinely tighter than the gaps between them is what makes "this file has one
/// word" an available answer.
const MINIMUM_SILHOUETTE: f64 = 0.5;

/// How far apart two type centroids must sit, in just-noticeable differences
/// (see `SLICE_FEATURE_FLOORS`), before they count as different words. Two
/// syllables that differ by less than two JNDs summed across twenty features
/// are the same syllable sung twice.
const MINIMUM_TYPE_SEPARATION: f64 = 2.0;

/// A gap whose level sits within this many dB of the preceding slice's peak was
/// never really a silence — the gate dipped, the sound did not stop.
const BOUND_WITHIN_DECIBELS: f64 = 12.0;

/// Total level change ACROSS the gap (slope × duration) that counts as a real
/// decay or a real rise. Expressed as a total rather than a rate because a
/// −3 dB/s slope over a 150 ms gap is 0.45 dB — indistinguishable from noise,
/// while the same slope over two seconds is a plain audible fade.
const JUNCTION_CHANGE_DECIBELS: f64 = 3.0;

/// Below this level, measured at the END of the gap, nothing has survived to
/// meet the next slice and the junction is a silence whatever shape the residue
/// had on the way down. Absolute (dBFS), not relative to the file's own floor,
/// because in a digitally-silent edit that floor is zero and *everything* would
/// read as "above" it. −60 dBFS puts editing dither and quantization residue on
/// the silent side and a real room tone on the sounding side.
const AUDIBLE_AT_ONSET_DECIBELS_FULL_SCALE: f64 = -60.0;

/// The share of the gap, at its end, read as "what is still present when the
/// next slice begins".
const ONSET_APPROACH_FRACTION: f64 = 0.25;

/// An envelope level at or below this (≈−120 dBFS) is a hard-edited zero, not a
/// quiet noise floor. Anything measured *relative* to it is undefined.
const DIGITAL_SILENCE: f64 = 1e-6;

/// Longest phrase the motif search will look for, in slices.
const MAXIMUM_MOTIF_LENGTH: usize = 16;

/// Below this many transitions per possible type-pair, the transition table is
/// too sparse for its entropy to mean much, and the record says so.
const ADEQUATE_TRANSITIONS_PER_PAIR: f64 = 2.0;

// ---------------------------------------------------------------- the record

/// One slice, placed. The node of the grammar map: which type it belongs to and
/// where it sits in the file's own acoustic embedding.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct SliceNode {
    pub region_index: usize,
    pub type_label: String,
    pub start_seconds: f64,
    pub duration_seconds: f64,
    /// Position in the file's 2-D acoustic projection — the layout coordinates
    /// for drawing the map. Arbitrary units, centered near zero.
    pub embedding_x: f64,
    pub embedding_y: f64,
}

/// One entry in the vocabulary — a cluster of acoustically similar slices.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct SliceType {
    /// "A", "B", "C"… assigned by descending frequency, so "A" is always the
    /// most-used syllable and sequences read consistently across files.
    pub label: String,
    /// A plain-language read of the medoid: length, brightness, tonality.
    pub descriptor: String,
    pub occurrences: usize,
    /// Share of all slices, 0..1.
    pub share: f64,
    /// The region index of the medoid — the most typical member, the one to
    /// audition or draw as this type's exemplar.
    pub exemplar_region_index: usize,
    pub mean_duration_seconds: f64,
    pub mean_spectral_centroid_hz: f64,
    pub mean_harmonicity: f64,
}

/// One edge of the grammar map: how likely `from` is followed by `to`.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct Transition {
    pub from_label: String,
    pub to_label: String,
    pub count: usize,
    /// P(to | from) — row-normalized, so the edges leaving one node sum to 1.
    pub probability: f64,
    pub mean_gap_seconds: f64,
    pub mean_inter_onset_seconds: f64,
}

/// The measured, classified space BETWEEN two consecutive slices.
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct Junction {
    pub index: usize,
    pub from_region_index: usize,
    pub to_region_index: usize,
    pub from_label: String,
    pub to_label: String,
    /// End of the previous slice to the start of the next.
    pub gap_seconds: f64,
    /// Onset to onset — the interval bioacoustics actually reports, because it
    /// is the one that survives a disagreement about where a syllable ends.
    pub inter_onset_seconds: f64,
    pub gap_root_mean_square_level: f64,
    /// How far the gap sits below the preceding slice's peak. Small means the
    /// sound never really stopped.
    pub gap_level_below_previous_peak_decibels: f64,
    /// How far the gap sits above the file's own quietest moment. `None` when
    /// the file has been edited to digital silence and so HAS no noise floor —
    /// dividing by that zero produced readings like "+119 dB above the floor",
    /// which is not a measurement of anything.
    pub gap_level_above_noise_floor_decibels: Option<f64>,
    /// Negative = falling (a tail ringing out), positive = rising (a breath or
    /// wind-up into the next onset), ~0 = a steady bed.
    pub gap_slope_decibels_per_second: f64,
    pub gap_spectral_centroid_hz: f64,
    pub gap_spectral_flatness: f64,
    /// Silence / Noise Bed / Resonant Tail / Breath / Continuous.
    pub junction_class: String,
    /// P(to | from) for the transition this junction spans.
    pub transition_probability: f64,
    /// −log2(probability): how surprising this particular move was, in bits. A
    /// rare transition in an otherwise rigid song is where the interesting
    /// behavior lives.
    pub surprisal_bits: f64,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct JunctionCount {
    pub junction_class: String,
    pub count: usize,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(default)]
pub struct BioacousticSyntax {
    pub slice_count: usize,
    pub type_count: usize,
    /// The whole file as one string, one letter per slice: "ABABACAB".
    pub sequence: String,
    pub slices: Vec<SliceNode>,
    pub slice_types: Vec<SliceType>,
    /// How far apart the two closest types sit, in just-noticeable differences.
    /// The confidence behind `type_count`: a big number means the vocabulary is
    /// obvious, a number near the cut-off means the split is arguable. 0 when
    /// the file has a single type.
    pub type_separation: f64,
    pub transitions: Vec<Transition>,
    pub junctions: Vec<Junction>,
    pub junction_profile: Vec<JunctionCount>,
    pub dominant_junction_class: String,

    /// Shannon entropy of the type distribution, in bits — how evenly the
    /// repertoire is used. 0 = one type only.
    pub repertoire_entropy_bits: f64,
    /// The same, over its own maximum (log2 of the type count), 0..1.
    pub repertoire_entropy_normalized: f64,
    /// H(next | current): the average uncertainty remaining about the next
    /// slice once the current one is known.
    pub transition_entropy_bits: f64,
    /// H(next) − H(next | current): the mutual information between consecutive
    /// slices. THE number. Zero bits means the order carries no information —
    /// the sequence is a bag of sounds, not a grammar.
    pub syntactic_information_bits: f64,
    /// Syntactic information over H(next), 0..1. 0 = order is random,
    /// 1 = each slice fully determines the next.
    pub determinism: f64,
    /// Fraction of transitions that stay on the same type (A→A).
    pub repeat_ratio: f64,
    pub distinct_bigrams: usize,
    /// Distinct bigrams over the type_count² possible ones. A low coverage with
    /// plenty of transitions is a strict grammar: most moves are never made.
    pub bigram_coverage: f64,
    /// The longest slice phrase that occurs more than once, and how often.
    pub dominant_motif: String,
    pub dominant_motif_occurrences: usize,

    pub median_gap_seconds: f64,
    /// 1 − coefficient of variation of the inter-onset intervals, 0..1. Near 1
    /// is metronomic delivery (a trill, a loop, a machine); near 0 is free.
    pub gap_regularity: f64,
    /// Fraction of junctions where the two slices are acoustically bound
    /// (a tail or no real break) rather than genuinely separated.
    pub bound_ratio: f64,

    /// The verdict: Isolated / Repetition / Isochronous Repetition /
    /// Alternation / Structured / Variable / Stochastic.
    pub syntax_class: String,
    /// Transitions per possible type-pair — the sample adequacy behind the
    /// entropy figures. Below ~2 the table is sparse and the numbers are
    /// suggestive rather than measured.
    pub transitions_per_type_pair: f64,
    pub reason: Vec<String>,
}

// ---------------------------------------------------------------- entry point

/// Build the syntax record for one file.
///
/// `regions` must be the top-level regions with their per-region `analysis`
/// filled in (that is what carries each slice's own features). `frames` is the
/// shared STFT the rest of the pipeline uses, `envelope` the RMS amplitude
/// track at `envelope_rate_hz`. Returns `None` for anything with fewer than two
/// slices — one slice is a sound, not a sequence.
#[allow(clippy::too_many_arguments)]
pub fn bioacoustic_syntax(
    regions: &Regions,
    frames: &[Vec<f32>],
    sr_f: f64,
    n_fft: usize,
    hop: usize,
    envelope: &[f64],
    envelope_rate_hz: f64,
) -> Option<BioacousticSyntax> {
    // Chronological order is the whole premise — sort defensively rather than
    // trusting the detector's ordering.
    let mut order: Vec<usize> = (0..regions.regions.len()).collect();
    order.sort_by(|&a, &b| {
        regions.regions[a]
            .start_seconds
            .partial_cmp(&regions.regions[b].start_seconds)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if order.len() < 2 {
        return None;
    }

    // ---- vocabulary: embed, cluster, label.
    let vectors: Vec<Option<Vec<f64>>> =
        order.iter().map(|&i| slice_vector(&regions.regions[i])).collect();
    let measured: Vec<usize> = (0..order.len()).filter(|&k| vectors[k].is_some()).collect();

    // One scaled matrix, used by the clustering, the medoid search AND the 2-D
    // layout, so the map the UI draws is the same space the types were decided
    // in. `scaled[k]` is None for a slice with no analysis to read.
    let mut scaled: Vec<Option<Vec<f64>>> = vec![None; order.len()];
    let (assignment, embedding, type_separation) = if measured.len() >= 2 {
        let feats: Vec<Vec<f64>> =
            measured.iter().map(|&k| vectors[k].clone().unwrap()).collect();
        let rows = scale_slices(&feats);
        let clusters = cluster_slices(&rows);
        let separation = closest_type_separation(&clusters, &rows);
        let projected = crate::pca::project(&rows, 2);
        for (slot, &k) in measured.iter().enumerate() {
            scaled[k] = Some(rows[slot].clone());
        }

        // Lift the per-measured-slice results back onto every slice. A slice
        // without an analysis (an older record, or one too short to measure)
        // still belongs to the sequence — it just cannot be typed, so it gets
        // its own catch-all cluster rather than being silently dropped.
        let unmeasured_cluster = clusters.iter().copied().max().map_or(0, |m| m + 1);
        let mut assignment = vec![unmeasured_cluster; order.len()];
        let mut embedding = vec![(0.0, 0.0); order.len()];
        for (slot, &k) in measured.iter().enumerate() {
            assignment[k] = clusters[slot];
            embedding[k] = (
                projected[slot].first().copied().unwrap_or(0.0),
                projected[slot].get(1).copied().unwrap_or(0.0),
            );
        }
        (assignment, embedding, separation)
    } else {
        (vec![0usize; order.len()], vec![(0.0, 0.0); order.len()], 0.0)
    };

    // Relabel by descending frequency so "A" is always the commonest syllable.
    let cluster_count = assignment.iter().copied().max().unwrap_or(0) + 1;
    let mut counts = vec![0usize; cluster_count];
    for &c in &assignment {
        counts[c] += 1;
    }
    let mut ranking: Vec<usize> = (0..cluster_count).filter(|&c| counts[c] > 0).collect();
    // Ties broken by first appearance, so the labelling is deterministic.
    let first_seen: Vec<usize> = (0..cluster_count)
        .map(|c| assignment.iter().position(|&a| a == c).unwrap_or(usize::MAX))
        .collect();
    ranking.sort_by(|&a, &b| counts[b].cmp(&counts[a]).then(first_seen[a].cmp(&first_seen[b])));
    let mut rank_of = vec![0usize; cluster_count];
    for (rank, &c) in ranking.iter().enumerate() {
        rank_of[c] = rank;
    }
    let type_count = ranking.len();
    let types: Vec<usize> = assignment.iter().map(|&c| rank_of[c]).collect();
    let labels: Vec<String> = types.iter().map(|&t| type_label(t)).collect();
    let sequence: String = labels.concat();

    // ---- the vocabulary entries themselves.
    let slice_types = build_slice_types(regions, &order, &types, type_count, &scaled);

    // ---- the nodes.
    let slices: Vec<SliceNode> = order
        .iter()
        .enumerate()
        .map(|(k, &i)| SliceNode {
            region_index: regions.regions[i].index,
            type_label: labels[k].clone(),
            start_seconds: regions.regions[i].start_seconds,
            duration_seconds: regions.regions[i].duration_seconds,
            embedding_x: embedding[k].0,
            embedding_y: embedding[k].1,
        })
        .collect();

    // ---- transitions.
    let mut bigrams: HashMap<(usize, usize), BigramStats> = HashMap::new();
    let mut from_totals = vec![0usize; type_count];
    let mut to_totals = vec![0usize; type_count];
    for k in 0..order.len() - 1 {
        let (a, b) = (types[k], types[k + 1]);
        let previous = &regions.regions[order[k]];
        let next = &regions.regions[order[k + 1]];
        let entry = bigrams.entry((a, b)).or_default();
        entry.count += 1;
        entry.gap_total += (next.start_seconds - previous.end_seconds).max(0.0);
        entry.inter_onset_total += (next.start_seconds - previous.start_seconds).max(0.0);
        from_totals[a] += 1;
        to_totals[b] += 1;
    }
    let transition_total = (order.len() - 1) as f64;

    let mut transitions: Vec<Transition> = bigrams
        .iter()
        .map(|(&(a, b), s)| Transition {
            from_label: type_label(a),
            to_label: type_label(b),
            count: s.count,
            probability: s.count as f64 / from_totals[a].max(1) as f64,
            mean_gap_seconds: s.gap_total / s.count as f64,
            mean_inter_onset_seconds: s.inter_onset_total / s.count as f64,
        })
        .collect();
    transitions.sort_by(|x, y| {
        y.count
            .cmp(&x.count)
            .then(x.from_label.cmp(&y.from_label))
            .then(x.to_label.cmp(&y.to_label))
    });

    // ---- information.
    let repertoire_entropy_bits = entropy(&counts.iter().copied().filter(|&c| c > 0).collect::<Vec<_>>());
    let repertoire_entropy_normalized = if type_count > 1 {
        repertoire_entropy_bits / (type_count as f64).log2()
    } else {
        0.0
    };
    // H(next | current), averaged over the from-states by how often each occurs.
    let mut transition_entropy_bits = 0.0;
    for a in 0..type_count {
        if from_totals[a] == 0 {
            continue;
        }
        let row: Vec<usize> = (0..type_count)
            .filter_map(|b| bigrams.get(&(a, b)).map(|s| s.count))
            .collect();
        transition_entropy_bits += (from_totals[a] as f64 / transition_total) * entropy(&row);
    }
    // Measured against H(next) — the destination marginal — so the difference is
    // a true mutual information and can never come out negative.
    let destination_entropy_bits = entropy(&to_totals);
    let syntactic_information_bits = (destination_entropy_bits - transition_entropy_bits).max(0.0);
    let determinism = if destination_entropy_bits > 1e-9 {
        (syntactic_information_bits / destination_entropy_bits).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let repeat_count = bigrams.iter().filter(|(&(a, b), _)| a == b).map(|(_, s)| s.count).sum::<usize>();
    let repeat_ratio = repeat_count as f64 / transition_total;
    let distinct_bigrams = bigrams.len();
    let bigram_coverage = distinct_bigrams as f64 / (type_count * type_count).max(1) as f64;
    let transitions_per_type_pair = transition_total / (type_count * type_count).max(1) as f64;
    let (dominant_motif, dominant_motif_occurrences) = longest_repeated_motif(&sequence);

    // ---- the junctions: measure and classify what sits between the slices.
    let noise_floor = percentile(envelope, 0.05);
    let junctions: Vec<Junction> = (0..order.len() - 1)
        .map(|k| {
            let previous = &regions.regions[order[k]];
            let next = &regions.regions[order[k + 1]];
            let probability = bigrams
                .get(&(types[k], types[k + 1]))
                .map(|s| s.count as f64 / from_totals[types[k]].max(1) as f64)
                .unwrap_or(0.0);
            measure_junction(
                k,
                previous,
                next,
                &labels[k],
                &labels[k + 1],
                probability,
                noise_floor,
                frames,
                sr_f,
                n_fft,
                hop,
                envelope,
                envelope_rate_hz,
            )
        })
        .collect();

    let mut profile: HashMap<&str, usize> = HashMap::new();
    for j in &junctions {
        *profile.entry(j.junction_class.as_str()).or_insert(0) += 1;
    }
    let mut junction_profile: Vec<JunctionCount> = profile
        .iter()
        .map(|(&class, &count)| JunctionCount { junction_class: class.to_string(), count })
        .collect();
    junction_profile.sort_by(|x, y| {
        y.count.cmp(&x.count).then(x.junction_class.cmp(&y.junction_class))
    });
    let dominant_junction_class = junction_profile
        .first()
        .map(|c| c.junction_class.clone())
        .unwrap_or_default();
    let bound_ratio = junctions
        .iter()
        .filter(|j| j.junction_class == CONTINUOUS || j.junction_class == RESONANT_TAIL)
        .count() as f64
        / junctions.len().max(1) as f64;

    let mut gaps: Vec<f64> = junctions.iter().map(|j| j.gap_seconds).collect();
    gaps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median_gap_seconds = gaps[gaps.len() / 2];
    let inter_onsets: Vec<f64> = junctions.iter().map(|j| j.inter_onset_seconds).collect();
    let gap_regularity = regularity(&inter_onsets);

    // ---- the verdict.
    let alternation_ratio = 1.0 - repeat_ratio;
    let syntax_class = if order.len() < 3 {
        "Isolated"
    } else if type_count == 1 {
        if gap_regularity >= 0.8 { "Isochronous Repetition" } else { "Repetition" }
    } else if type_count == 2 && alternation_ratio >= 0.8 {
        "Alternation"
    } else if determinism >= 0.35 {
        "Structured"
    } else if determinism < 0.15 {
        "Stochastic"
    } else {
        "Variable"
    }
    .to_string();

    let adequacy = if transitions_per_type_pair >= ADEQUATE_TRANSITIONS_PER_PAIR {
        String::new()
    } else {
        format!(
            " (sparse: {:.1} transitions per type-pair — suggestive, not measured)",
            transitions_per_type_pair
        )
    };
    let motif_part = if dominant_motif_occurrences > 1 {
        format!(" · motif \"{}\" ×{}", dominant_motif, dominant_motif_occurrences)
    } else {
        String::new()
    };
    let reason = vec![
        format!(
            "1) {} slices over {} type{} ({}) — sequence {}{}",
            order.len(),
            type_count,
            if type_count == 1 { "" } else { "s" },
            if type_count > 1 {
                format!("separated by {:.1} JND", type_separation)
            } else {
                "one continuum, no vocabulary".to_string()
            },
            truncate_sequence(&sequence),
            motif_part
        ),
        format!(
            "2) {:.2} bits of syntactic information (determinism {:.0}%, H(next|current) {:.2} bits){}",
            syntactic_information_bits,
            determinism * 100.0,
            transition_entropy_bits,
            adequacy
        ),
        format!(
            "3) junctions mostly {} · median gap {:.0} ms · regularity {:.0}% · {:.0}% bound",
            if dominant_junction_class.is_empty() { "unmeasured" } else { &dominant_junction_class },
            median_gap_seconds * 1000.0,
            gap_regularity * 100.0,
            bound_ratio * 100.0
        ),
    ];

    Some(BioacousticSyntax {
        slice_count: order.len(),
        type_count,
        sequence,
        slices,
        slice_types,
        type_separation,
        transitions,
        junctions,
        junction_profile,
        dominant_junction_class,
        repertoire_entropy_bits,
        repertoire_entropy_normalized,
        transition_entropy_bits,
        syntactic_information_bits,
        determinism,
        repeat_ratio,
        distinct_bigrams,
        bigram_coverage,
        dominant_motif,
        dominant_motif_occurrences,
        median_gap_seconds,
        gap_regularity,
        bound_ratio,
        syntax_class,
        transitions_per_type_pair,
        reason,
    })
}

#[derive(Default)]
struct BigramStats {
    count: usize,
    gap_total: f64,
    inter_onset_total: f64,
}

// ---------------------------------------------------------------- the embedding

/// How many MFCC coefficients join the slice vector.
const MFCC_IN_SLICE_VECTOR: usize = 5;

/// The smallest difference in each feature that means anything — one
/// just-noticeable difference, in that feature's own units and in the same order
/// as `slice_vector` builds them.
///
/// These exist because plain z-scoring is actively wrong here. Standardizing by
/// the within-file spread divides by whatever variation happens to be present,
/// so when a file holds eight copies of ONE sound the only variation left is the
/// segmenter's frame quantization — region edges land on envelope frames, so
/// durations come out in discrete steps — and z-scoring blows that up to unit
/// variance and hands the clusterer two beautifully tight, entirely fictional
/// groups. (It did exactly that: eight identical snares read as "AAABBAAB".)
///
/// Scaling by `max(observed spread, floor)` instead means a feature that barely
/// varies stays barely varied. Nothing is manufactured, and a file whose slices
/// really are all the same lands in one cluster, which is the truth.
const SLICE_FEATURE_FLOORS: [f64; 15 + MFCC_IN_SLICE_VECTOR] = [
    0.10, // ln duration — ~10 % longer or shorter
    0.10, // ln spectral centroid — ~10 % brighter
    0.10, // ln rolloff
    0.10, // ln zero-crossing rate
    0.05, // spectral flatness (0..1)
    0.05, // harmonicity (0..1)
    // Inharmonicity is coarser than the rest and its floor has to say so: it
    // rides on discrete partial peak-picking, so a region edge landing one frame
    // over flips a partial in or out and the value jumps. Measured on bit-
    // identical copies of one chirp segmented at slightly different offsets it
    // moved by 0.10 — so anything under that is the peak-picker twitching, not a
    // difference in the sound. At the old 0.05 it single-handedly supplied 84 %
    // of the distance that split those identical copies into two "types".
    0.15, // inharmonicity (0..1)
    0.03, // low-band energy share
    0.03, // mid-band energy share
    0.03, // high-band energy share
    0.10, // ln pitch — well under a semitone (0.058)
    0.05, // envelope temporal centroid (0..1)
    0.02, // ln attack — ≈20 ms, the audible edge between "plucked" and "bowed"
    0.05, // envelope sustain level (0..1)
    0.50, // crest factor (1..~20)
    0.75, 0.75, 0.75, 0.75, 0.75, // MFCC 1..5 — a perceptible timbre step
];

/// Center each column and divide by the larger of its spread and its
/// just-noticeable difference. The same geometry feeds the clustering, the
/// medoid search and the 2-D layout, so the map the UI draws is the space the
/// types were decided in.
fn scale_slices(feats: &[Vec<f64>]) -> Vec<Vec<f64>> {
    if feats.is_empty() {
        return Vec::new();
    }
    let n = feats.len() as f64;
    let d = feats[0].len();
    let mean: Vec<f64> = (0..d).map(|j| feats.iter().map(|f| f[j]).sum::<f64>() / n).collect();
    let scale: Vec<f64> = (0..d)
        .map(|j| {
            let variance =
                feats.iter().map(|f| (f[j] - mean[j]).powi(2)).sum::<f64>() / n;
            variance.sqrt().max(SLICE_FEATURE_FLOORS.get(j).copied().unwrap_or(1.0))
        })
        .collect();
    feats
        .iter()
        .map(|f| (0..d).map(|j| (f[j] - mean[j]) / scale[j]).collect())
        .collect()
}

/// The acoustic vector for one slice, read off the full analysis the pipeline
/// already ran on that slice. This is deliberately NOT `feature_vec::feature_vec`:
/// that vector is tuned to separate whole files across a library (it leans on
/// loudness and length), while this one has to separate syllables inside ONE
/// recording, where absolute level is a property of the microphone distance and
/// says nothing about which syllable was sung. Timbre and shape carry it.
fn slice_vector(region: &crate::peak::Region) -> Option<Vec<f64>> {
    let p = region.analysis.as_ref()?;
    let s = &p.spectral_features;
    let e = &p.envelope;
    // The ADSR terms are peak-relative and so are null at file level whenever a
    // slice happens to hold more than one transient. Fall back to that slice's
    // loudest event, the same reading `feature_vec` takes: a real measurement of
    // one event beats a 0.0 that would herd every multi-event slice into the
    // same corner of the space and cluster them by their nullness.
    let event = e.representative_slice();
    let temporal_centroid = e
        .envelope_temporal_centroid
        .or_else(|| event.map(|x| x.envelope_temporal_centroid))
        .unwrap_or(0.0);
    let attack_seconds = e
        .envelope_attack_seconds
        .or_else(|| event.map(|x| x.envelope_attack_seconds))
        .unwrap_or(0.0);
    let sustain_level = e
        .envelope_sustain_level
        .or_else(|| event.map(|x| x.envelope_sustain_level))
        .unwrap_or(0.0);
    let mut v = vec![
        (1.0 + p.metadata.length_seconds).ln(),
        (1.0 + s.spectral_centroid_hz).ln(),
        (1.0 + s.spectral_rolloff_hz).ln(),
        (1.0 + s.zero_crossings_per_second).ln(),
        s.spectral_flatness,
        s.harmonicity,
        s.inharmonicity,
        s.low_band_energy,
        s.mid_band_energy,
        s.high_band_energy,
        (1.0 + p.musicality.pitch_hz).ln(),
        temporal_centroid,
        (1.0 + attack_seconds).ln(),
        sustain_level,
        s.crest_factor,
    ];
    // MFCC 1..5 — the timbral fingerprint, and the closest thing this pipeline
    // has to the learned embedding an auto-encoder would produce. c0 is skipped
    // for the same reason level is: it is loudness.
    for j in 1..=MFCC_IN_SLICE_VECTOR {
        v.push(s.mel_frequency_cepstral_coefficients.get(j).copied().unwrap_or(0.0));
    }
    debug_assert_eq!(v.len(), SLICE_FEATURE_FLOORS.len(), "floors must cover every feature");
    if v.iter().any(|x| !x.is_finite()) {
        return None;
    }
    Some(v)
}

// ---------------------------------------------------------------- clustering

/// Complete-linkage agglomerative clustering, cut where the split is best
/// SUPPORTED rather than merely largest.
///
/// K-means is the wrong tool here: it needs `k` up front, and the repertoire
/// size is precisely the unknown. Agglomerative merging builds the whole
/// dendrogram instead, and every level of it is then scored by mean silhouette —
/// how much tighter each cluster is than its distance to the nearest other one.
/// The best-scoring level wins, and only if it clears `MINIMUM_SILHOUETTE`;
/// otherwise the slices are one continuum and the file has a single type. That
/// outcome is a real answer, not a failure, and it has to be reachable — a
/// repeated call sung six times is one word, not six.
///
/// Complete linkage (cluster distance = the FARTHEST pair) rather than single
/// linkage, because single linkage chains: one intermediate slice would fuse two
/// genuinely distinct syllable types into a smear.
///
/// Returns a cluster index per input row.
fn cluster_slices(x: &[Vec<f64>]) -> Vec<usize> {
    let n = x.len();
    if n < 2 {
        return vec![0; n];
    }
    // Pairwise distances. `d` is consumed by the merge loop (complete linkage
    // rewrites it in place); `d0` is kept pristine for scoring the cuts.
    let mut d = vec![vec![0.0f64; n]; n];
    for i in 0..n {
        for j in (i + 1)..n {
            let dist = x[i]
                .iter()
                .zip(&x[j])
                .map(|(a, b)| (a - b) * (a - b))
                .sum::<f64>()
                .sqrt();
            d[i][j] = dist;
            d[j][i] = dist;
        }
    }
    let d0 = d.clone();

    let mut active: Vec<bool> = vec![true; n];
    let mut members: Vec<Vec<usize>> = (0..n).map(|i| vec![i]).collect();
    // One entry per level of the dendrogram: the partition standing BEFORE that
    // step's merge collapsed it. `levels[m]` therefore holds `n - m` clusters.
    let mut levels: Vec<Vec<usize>> = Vec::with_capacity(n - 1);
    let mut assignment: Vec<usize> = (0..n).collect();

    for _ in 0..(n - 1) {
        let (mut nearest, mut pair) = (f64::INFINITY, (0usize, 0usize));
        for i in 0..n {
            if !active[i] {
                continue;
            }
            for j in (i + 1)..n {
                if active[j] && d[i][j] < nearest {
                    nearest = d[i][j];
                    pair = (i, j);
                }
            }
        }
        levels.push(assignment.clone());

        let (i, j) = pair;
        let absorbed = std::mem::take(&mut members[j]);
        for &m in &absorbed {
            assignment[m] = i;
        }
        members[i].extend(absorbed);
        active[j] = false;
        for k in 0..n {
            if active[k] && k != i {
                let far = d[i][k].max(d[j][k]);
                d[i][k] = far;
                d[k][i] = far;
            }
        }
    }

    // Score every level and keep the best-supported one, provided it clears the
    // bar. Nothing clearing it means the slices are one continuum: one type.
    let mut best_score = f64::NEG_INFINITY;
    let mut cut: Option<usize> = None;
    for (m, partition) in levels.iter().enumerate() {
        let clusters = n - m;
        if !(2..=MAX_SLICE_TYPES).contains(&clusters) {
            continue;
        }
        let score = silhouette(&compact(partition), &d0);
        if score > best_score {
            best_score = score;
            cut = Some(m);
        }
    }

    match cut {
        // Both bars, because each catches what the other misses: silhouette
        // rejects a split into overlapping smears, separation rejects a split
        // into two crisp blobs that are nonetheless a hair apart.
        Some(m)
            if best_score >= MINIMUM_SILHOUETTE
                && closest_type_separation(&compact(&levels[m]), x)
                    >= MINIMUM_TYPE_SEPARATION =>
        {
            compact(&levels[m])
        }
        _ => vec![0; n],
    }
}

/// Distance between the two closest type centroids, in just-noticeable
/// differences (the units `scale_slices` leaves behind).
///
/// Silhouette is scale-invariant — it asks only whether the clusters are tight
/// RELATIVE to the space between them, so two blobs of pure quantization noise
/// score as well as a snare and a flute. This is the absolute companion: how far
/// apart the types actually are. Zero for a single type.
fn closest_type_separation(assignment: &[usize], rows: &[Vec<f64>]) -> f64 {
    let k = assignment.iter().copied().max().map_or(0, |m| m + 1);
    if k < 2 || rows.is_empty() {
        return 0.0;
    }
    let d = rows[0].len();
    let mut sums = vec![vec![0.0f64; d]; k];
    let mut sizes = vec![0usize; k];
    for (i, row) in rows.iter().enumerate() {
        for j in 0..d {
            sums[assignment[i]][j] += row[j];
        }
        sizes[assignment[i]] += 1;
    }
    let centroids: Vec<Vec<f64>> = (0..k)
        .map(|c| sums[c].iter().map(|v| v / sizes[c].max(1) as f64).collect())
        .collect();
    let mut closest = f64::INFINITY;
    for a in 0..k {
        for b in (a + 1)..k {
            let dist = centroids[a]
                .iter()
                .zip(&centroids[b])
                .map(|(p, q)| (p - q) * (p - q))
                .sum::<f64>()
                .sqrt();
            closest = closest.min(dist);
        }
    }
    if closest.is_finite() {
        closest
    } else {
        0.0
    }
}

/// Mean silhouette of a partition: for each slice, how much closer it sits to
/// its own cluster than to the nearest other one, on a −1..1 scale. Singleton
/// clusters score 0 by convention — a cluster of one has no internal scatter to
/// compare against, and scoring it 1 would reward shattering the set into
/// one-word-per-slice, which is the exact failure this bar exists to catch.
fn silhouette(assignment: &[usize], d: &[Vec<f64>]) -> f64 {
    let n = assignment.len();
    let k = assignment.iter().copied().max().map_or(0, |m| m + 1);
    if k < 2 || n < 2 {
        return -1.0;
    }
    let mut sizes = vec![0usize; k];
    for &c in assignment {
        sizes[c] += 1;
    }

    let mut total = 0.0;
    for i in 0..n {
        // Total distance from i to each cluster, its own included.
        let mut sums = vec![0.0f64; k];
        for j in 0..n {
            if i != j {
                sums[assignment[j]] += d[i][j];
            }
        }
        let own = assignment[i];
        if sizes[own] < 2 {
            continue; // singleton: scores 0
        }
        let a = sums[own] / (sizes[own] - 1) as f64;
        let b = (0..k)
            .filter(|&c| c != own && sizes[c] > 0)
            .map(|c| sums[c] / sizes[c] as f64)
            .fold(f64::INFINITY, f64::min);
        let scale = a.max(b);
        if b.is_finite() && scale > 1e-12 {
            total += (b - a) / scale;
        }
    }
    total / n as f64
}

/// Renumber arbitrary group ids to a dense 0..k range.
fn compact(assignment: &[usize]) -> Vec<usize> {
    let mut map: HashMap<usize, usize> = HashMap::new();
    assignment
        .iter()
        .map(|&a| {
            let next = map.len();
            *map.entry(a).or_insert(next)
        })
        .collect()
}

/// "A".."Z" then "a".."z"; beyond that, a number. `MAX_SLICE_TYPES` keeps us in
/// the first stretch, but the fallback means no input can produce a collision.
fn type_label(index: usize) -> String {
    if index < 26 {
        ((b'A' + index as u8) as char).to_string()
    } else if index < 52 {
        ((b'a' + (index - 26) as u8) as char).to_string()
    } else {
        format!("#{}", index)
    }
}

fn build_slice_types(
    regions: &Regions,
    order: &[usize],
    types: &[usize],
    type_count: usize,
    standardized: &[Option<Vec<f64>>],
) -> Vec<SliceType> {
    (0..type_count)
        .map(|t| {
            let slots: Vec<usize> = (0..order.len()).filter(|&k| types[k] == t).collect();
            let mut duration = 0.0;
            let mut centroid = 0.0;
            let mut harmonicity = 0.0;
            let mut measured = 0.0;
            for &k in &slots {
                let region = &regions.regions[order[k]];
                duration += region.duration_seconds;
                if let Some(p) = region.analysis.as_ref() {
                    centroid += p.spectral_features.spectral_centroid_hz;
                    harmonicity += p.spectral_features.harmonicity;
                    measured += 1.0;
                }
            }
            let n = slots.len().max(1) as f64;
            let exemplar = medoid(&slots, standardized).unwrap_or(slots[0]);
            let mean_centroid = if measured > 0.0 { centroid / measured } else { 0.0 };
            let mean_harmonicity = if measured > 0.0 { harmonicity / measured } else { 0.0 };
            SliceType {
                label: type_label(t),
                descriptor: descriptor(duration / n, mean_centroid, mean_harmonicity),
                occurrences: slots.len(),
                share: slots.len() as f64 / order.len() as f64,
                exemplar_region_index: regions.regions[order[exemplar]].index,
                mean_duration_seconds: duration / n,
                mean_spectral_centroid_hz: mean_centroid,
                mean_harmonicity,
            }
        })
        .collect()
}

/// The member with the smallest total distance to its siblings — the most
/// typical example of the type, and a better exemplar than the centroid because
/// it is an actual slice you can audition.
fn medoid(slots: &[usize], standardized: &[Option<Vec<f64>>]) -> Option<usize> {
    let usable: Vec<usize> = slots.iter().copied().filter(|&k| standardized[k].is_some()).collect();
    if usable.is_empty() {
        return None;
    }
    usable
        .iter()
        .map(|&k| {
            let a = standardized[k].as_ref().unwrap();
            let total: f64 = usable
                .iter()
                .map(|&m| {
                    let b = standardized[m].as_ref().unwrap();
                    a.iter().zip(b).map(|(p, q)| (p - q) * (p - q)).sum::<f64>().sqrt()
                })
                .sum();
            (k, total)
        })
        .min_by(|x, y| x.1.partial_cmp(&y.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(k, _)| k)
}

/// A plain-language read of a type, from its own measurements only.
fn descriptor(duration_seconds: f64, centroid_hz: f64, harmonicity: f64) -> String {
    let length = if duration_seconds < 0.15 {
        "click"
    } else if duration_seconds < 0.5 {
        "short"
    } else if duration_seconds < 1.5 {
        "medium"
    } else {
        "long"
    };
    let brightness = if centroid_hz <= 0.0 {
        "unmeasured"
    } else if centroid_hz < 500.0 {
        "dark"
    } else if centroid_hz < 2000.0 {
        "warm"
    } else if centroid_hz < 6000.0 {
        "bright"
    } else {
        "airy"
    };
    let tonality = if harmonicity > 0.7 {
        "tonal"
    } else if harmonicity > 0.4 {
        "mixed"
    } else {
        "noisy"
    };
    format!("{} {} {}", length, brightness, tonality)
}

// ---------------------------------------------------------------- junctions

pub const SILENCE: &str = "Silence";
pub const NOISE_BED: &str = "Noise Bed";
pub const RESONANT_TAIL: &str = "Resonant Tail";
pub const BREATH: &str = "Breath";
pub const CONTINUOUS: &str = "Continuous";

#[allow(clippy::too_many_arguments)]
fn measure_junction(
    index: usize,
    previous: &crate::peak::Region,
    next: &crate::peak::Region,
    from_label: &str,
    to_label: &str,
    transition_probability: f64,
    noise_floor: f64,
    frames: &[Vec<f32>],
    sr_f: f64,
    n_fft: usize,
    hop: usize,
    envelope: &[f64],
    envelope_rate_hz: f64,
) -> Junction {
    let gap_start = previous.end_seconds;
    let gap_end = next.start_seconds;
    let gap_seconds = (gap_end - gap_start).max(0.0);
    let inter_onset_seconds = (next.start_seconds - previous.start_seconds).max(0.0);

    // Level and slope come off the RMS envelope (~200 fps) — fine enough to see
    // a tail fall inside a 150 ms gap, which the 86 fps STFT is not.
    let first = (gap_start * envelope_rate_hz).round().max(0.0) as usize;
    let last = ((gap_end * envelope_rate_hz).round().max(0.0) as usize).min(envelope.len());
    let window = if last > first { &envelope[first..last] } else { &[][..] };

    let level = if window.is_empty() {
        0.0
    } else {
        (window.iter().map(|v| v * v).sum::<f64>() / window.len() as f64).sqrt()
    };
    let slope = decibel_slope(window, envelope_rate_hz);
    let below_previous_peak = ratio_decibels(level, previous.peak_amplitude);
    let above_noise_floor = if noise_floor > DIGITAL_SILENCE {
        Some(ratio_decibels(level, noise_floor))
    } else {
        None
    };

    // Spectrum of the residue: is the quiet bright hiss, low rumble, or a tone?
    let (centroid, flatness) = gap_spectrum(frames, gap_start, gap_end, sr_f, n_fft, hop);

    // What is still sounding as the next slice arrives. This, not the gap's
    // average, is what decides whether the two slices are joined by anything: a
    // release that has fallen to nothing long before the next onset binds them
    // no more tightly than a hard edit does, and treating it as a tail would
    // stamp "Resonant Tail" on every ordinary one-shot library.
    let approach_level = if window.is_empty() {
        0.0
    } else {
        let take = ((window.len() as f64 * ONSET_APPROACH_FRACTION).ceil() as usize).max(1);
        let approach = &window[window.len() - take.min(window.len())..];
        (approach.iter().map(|v| v * v).sum::<f64>() / approach.len() as f64).sqrt()
    };
    let sounding_at_onset =
        20.0 * approach_level.max(1e-9).log10() >= AUDIBLE_AT_ONSET_DECIBELS_FULL_SCALE;

    // Classify. Order matters: "the sound never stopped" outranks everything,
    // then "nothing reaches the next onset", and only what is left gets read for
    // its shape.
    let change_decibels = slope * gap_seconds;
    let junction_class = if window.is_empty() {
        SILENCE
    } else if below_previous_peak > -BOUND_WITHIN_DECIBELS {
        CONTINUOUS
    } else if !sounding_at_onset {
        SILENCE
    } else if change_decibels <= -JUNCTION_CHANGE_DECIBELS {
        RESONANT_TAIL
    } else if change_decibels >= JUNCTION_CHANGE_DECIBELS {
        BREATH
    } else {
        NOISE_BED
    };

    Junction {
        index,
        from_region_index: previous.index,
        to_region_index: next.index,
        from_label: from_label.to_string(),
        to_label: to_label.to_string(),
        gap_seconds,
        inter_onset_seconds,
        gap_root_mean_square_level: level,
        gap_level_below_previous_peak_decibels: below_previous_peak,
        gap_level_above_noise_floor_decibels: above_noise_floor,
        gap_slope_decibels_per_second: slope,
        gap_spectral_centroid_hz: centroid,
        gap_spectral_flatness: flatness,
        junction_class: junction_class.to_string(),
        transition_probability,
        // `max(0.0)` rather than plain negation: a certain transition has
        // probability 1, and −log2(1) is −0.0, which serializes as "-0.0".
        surprisal_bits: if transition_probability > 0.0 {
            (-transition_probability.log2()).max(0.0)
        } else {
            0.0
        },
    }
}

/// Least-squares slope of the envelope in dB against time in seconds. The dB
/// floor is set well under any real noise floor so a digitally silent frame
/// contributes a finite value instead of −∞ dragging the fit to nonsense.
fn decibel_slope(window: &[f64], rate_hz: f64) -> f64 {
    if window.len() < 3 || rate_hz <= 0.0 {
        return 0.0;
    }
    let decibels: Vec<f64> = window.iter().map(|&v| 20.0 * (v.max(1e-9)).log10()).collect();
    let n = decibels.len() as f64;
    let mean_t = (n - 1.0) / 2.0 / rate_hz;
    let mean_d = decibels.iter().sum::<f64>() / n;
    let mut numerator = 0.0;
    let mut denominator = 0.0;
    for (i, &d) in decibels.iter().enumerate() {
        let t = i as f64 / rate_hz - mean_t;
        numerator += t * (d - mean_d);
        denominator += t * t;
    }
    if denominator <= 1e-12 {
        0.0
    } else {
        numerator / denominator
    }
}

/// Centroid and flatness of whatever is sounding inside the gap, averaged over
/// the STFT frames whose centers fall in it. Reuses the pipeline's own STFT —
/// no second transform.
fn gap_spectrum(
    frames: &[Vec<f32>],
    gap_start: f64,
    gap_end: f64,
    sr_f: f64,
    n_fft: usize,
    hop: usize,
) -> (f64, f64) {
    if frames.is_empty() || hop == 0 || sr_f <= 0.0 || n_fft < 2 {
        return (0.0, 0.0);
    }
    let bin_hz = sr_f / n_fft as f64;

    // Prefer frames whose whole ANALYSIS WINDOW lies inside the gap. An STFT
    // window is 46 ms at 44.1 kHz, so a frame merely *centered* just inside the
    // gap still has the previous slice's tail in it, and the "spectrum of the
    // silence" would really be a smeared copy of the sound before it. Gaps are
    // at least 150 ms by construction, so containment normally holds; the
    // center-based pass is the fallback for the rare gap too short to fit one.
    let contained = |f: usize| {
        let start = (f * hop) as f64 / sr_f;
        let end = ((f * hop + n_fft) as f64) / sr_f;
        start >= gap_start && end <= gap_end
    };
    let centered = |f: usize| {
        let t = ((f * hop) as f64 + n_fft as f64 / 2.0) / sr_f;
        t >= gap_start && t <= gap_end
    };

    let mut sum = vec![0.0f64; frames[0].len()];
    let mut used = 0usize;
    for (f, frame) in frames.iter().enumerate() {
        if !contained(f) {
            continue;
        }
        for (b, &m) in frame.iter().enumerate() {
            sum[b] += m as f64;
        }
        used += 1;
    }
    if used == 0 {
        for (f, frame) in frames.iter().enumerate() {
            if !centered(f) {
                continue;
            }
            for (b, &m) in frame.iter().enumerate() {
                sum[b] += m as f64;
            }
            used += 1;
        }
    }
    if used == 0 {
        return (0.0, 0.0);
    }
    let magnitudes: Vec<f64> = sum.iter().map(|v| v / used as f64).collect();
    let total: f64 = magnitudes.iter().sum();
    if total <= 1e-12 {
        return (0.0, 0.0);
    }
    let centroid = magnitudes
        .iter()
        .enumerate()
        .map(|(b, m)| b as f64 * bin_hz * m)
        .sum::<f64>()
        / total;
    // Flatness = geometric mean / arithmetic mean. 1 is white noise, →0 a tone.
    let n = magnitudes.len() as f64;
    let log_sum: f64 = magnitudes.iter().map(|m| m.max(1e-12).ln()).sum();
    let flatness = (log_sum / n).exp() / (total / n);
    (centroid, flatness.clamp(0.0, 1.0))
}

// ---------------------------------------------------------------- small math

/// Shannon entropy of a count vector, in bits.
fn entropy(counts: &[usize]) -> f64 {
    let total: usize = counts.iter().sum();
    if total == 0 {
        return 0.0;
    }
    let total = total as f64;
    -counts
        .iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = c as f64 / total;
            p * p.log2()
        })
        .sum::<f64>()
}

/// `1 − coefficient of variation`, clamped to 0..1 — 1 is perfectly even.
fn regularity(values: &[f64]) -> f64 {
    if values.len() < 2 {
        return 0.0;
    }
    let n = values.len() as f64;
    let mean = values.iter().sum::<f64>() / n;
    if mean <= 1e-9 {
        return 0.0;
    }
    let variance = values.iter().map(|v| (v - mean) * (v - mean)).sum::<f64>() / n;
    (1.0 - variance.sqrt() / mean).clamp(0.0, 1.0)
}

/// `q`-quantile of an unsorted slice; the file's noise floor is read at q=0.05.
fn percentile(values: &[f64], q: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut v: Vec<f64> = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let i = ((v.len() - 1) as f64 * q.clamp(0.0, 1.0)).round() as usize;
    v[i]
}

/// 20·log10(a/b), floored so a silent numerator or denominator stays finite.
fn ratio_decibels(a: f64, b: f64) -> f64 {
    20.0 * (a.max(1e-9) / b.max(1e-9)).log10()
}

/// The longest phrase that occurs more than once, and how many times. Searched
/// from long to short so the first hit is the answer; capped at
/// `MAXIMUM_MOTIF_LENGTH` because a "motif" the length of the song is just the
/// song. Occurrences may overlap — a stutter (AAAA) is a real repetition of AA.
fn longest_repeated_motif(sequence: &str) -> (String, usize) {
    let letters: Vec<char> = sequence.chars().collect();
    let n = letters.len();
    let longest = MAXIMUM_MOTIF_LENGTH.min(n / 2);
    for length in (2..=longest).rev() {
        let mut seen: HashMap<&[char], usize> = HashMap::new();
        for start in 0..=(n - length) {
            *seen.entry(&letters[start..start + length]).or_insert(0) += 1;
        }
        if let Some((phrase, count)) = seen
            .iter()
            .filter(|(_, &c)| c > 1)
            .max_by(|x, y| x.1.cmp(y.1).then(y.0.cmp(x.0)))
        {
            return (phrase.iter().collect(), *count);
        }
    }
    (String::new(), 0)
}

/// The sequence is written in full into its own field; the reason line only
/// needs enough of it to recognize the shape.
fn truncate_sequence(sequence: &str) -> String {
    const SHOWN: usize = 32;
    if sequence.chars().count() <= SHOWN {
        sequence.to_string()
    } else {
        format!("{}…", sequence.chars().take(SHOWN).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::peak::{Region, Regions};

    /// A region carrying just enough analysis for the vector: the fields
    /// `slice_vector` reads. `kind` picks one of two very different timbres.
    fn region(index: usize, start: f64, duration: f64, kind: usize) -> Region {
        let mut p = crate::peak::Peak {
            metadata: crate::peak::Metadata {
                analyzer_version: String::new(),
                name: String::new(),
                folder: String::new(),
                sub: String::new(),
                path: String::new(),
                length_seconds: duration,
                sample_rate: 44100,
                bit_depth: 16,
                channels: 1,
                source_format: String::new(),
                lossy_source: false,
                dc_offset: 0.0,
                trailing_silence_ms: 0.0,
                analysis_depth: "full".to_string(),
            },
            classification: Default::default(),
            envelope: Default::default(),
            spectral_features: Default::default(),
            musicality: Default::default(),
            unsupervised: Default::default(),
            ucs: Default::default(),
            regions: Default::default(),
            preview: Default::default(),
            bioacoustic_syntax: None,
        };
        // Two well-separated timbres so the clustering has something real to find.
        let (centroid, harmonicity, mfcc) = if kind == 0 {
            (400.0, 0.9, vec![0.0, 5.0, -3.0, 1.0, 0.5, 0.2])
        } else {
            (6000.0, 0.1, vec![0.0, -6.0, 4.0, -2.0, -1.0, 0.8])
        };
        p.spectral_features.spectral_centroid_hz = centroid;
        p.spectral_features.spectral_rolloff_hz = centroid * 2.0;
        p.spectral_features.harmonicity = harmonicity;
        p.spectral_features.spectral_flatness = 1.0 - harmonicity;
        p.spectral_features.mel_frequency_cepstral_coefficients = mfcc;
        p.envelope.envelope_temporal_centroid = Some(0.3 + 0.2 * kind as f64);
        Region {
            index,
            start_seconds: start,
            end_seconds: start + duration,
            duration_seconds: duration,
            peak_amplitude: 0.8,
            name: String::new(),
            analysis: Some(Box::new(p)),
        }
    }

    /// Regions laid out on a fixed period, alternating between `kinds`.
    fn sequence_of(kinds: &[usize], duration: f64, gap: f64) -> Regions {
        let regions: Vec<Region> = kinds
            .iter()
            .enumerate()
            .map(|(i, &k)| region(i, i as f64 * (duration + gap), duration, k))
            .collect();
        Regions { count: regions.len(), regions, ..Default::default() }
    }

    /// A flat, quiet envelope covering `seconds` at 200 fps, with the regions
    /// themselves loud — enough for the junction measurements to run.
    fn envelope_for(regions: &Regions, seconds: f64) -> (Vec<f64>, f64) {
        let rate = 200.0;
        let frames = (seconds * rate).ceil() as usize;
        let mut v = vec![0.0005; frames];
        for r in &regions.regions {
            let a = (r.start_seconds * rate) as usize;
            let b = ((r.end_seconds * rate) as usize).min(frames);
            for x in v.iter_mut().take(b).skip(a) {
                *x = 0.8;
            }
        }
        (v, rate)
    }

    fn analyze(regions: &Regions, seconds: f64) -> BioacousticSyntax {
        let (env, rate) = envelope_for(regions, seconds);
        bioacoustic_syntax(regions, &[], 44100.0, 2048, 512, &env, rate).expect("syntax")
    }

    #[test]
    fn one_slice_has_no_syntax() {
        let r = sequence_of(&[0], 0.2, 0.3);
        let (env, rate) = envelope_for(&r, 1.0);
        assert!(bioacoustic_syntax(&r, &[], 44100.0, 2048, 512, &env, rate).is_none());
    }

    #[test]
    fn a_repeated_syllable_is_one_type() {
        let r = sequence_of(&[0, 0, 0, 0, 0, 0], 0.2, 0.3);
        let s = analyze(&r, 3.5);
        assert_eq!(s.type_count, 1, "one timbre repeated is one word: {}", s.sequence);
        assert_eq!(s.sequence, "AAAAAA");
        // Even spacing, so the delivery reads as metronomic.
        assert!(s.gap_regularity > 0.9, "regularity {}", s.gap_regularity);
        assert_eq!(s.syntax_class, "Isochronous Repetition");
        // One word carries no choice, so no information rides on the order.
        assert!(s.syntactic_information_bits < 1e-9);
    }

    /// The same syllable, measured six times with the small wobble a segmenter
    /// introduces: region edges snap to envelope frames, so durations quantize
    /// and the discrete features (inharmonicity above all) twitch. Standardizing
    /// by the within-file spread turns exactly this into a tidy fake vocabulary,
    /// so it has to stay one type.
    #[test]
    fn segmenter_wobble_does_not_invent_a_vocabulary() {
        let mut regions = Vec::new();
        for i in 0..6 {
            let mut r = region(i, i as f64 * 0.5, 0.2, 0);
            let p = r.analysis.as_mut().unwrap();
            // Bimodal jitter — the worst case, and the shape frame quantization
            // actually produces: two crisp little blobs a hair apart.
            let wobble = if i % 2 == 0 { 1.0 } else { -1.0 };
            p.metadata.length_seconds += 0.002 * wobble;
            p.spectral_features.inharmonicity += 0.05 * wobble;
            p.spectral_features.spectral_centroid_hz += 6.0 * wobble;
            p.spectral_features.mel_frequency_cepstral_coefficients[1] += 0.3 * wobble;
            regions.push(r);
        }
        let regions = Regions { count: regions.len(), regions, ..Default::default() };
        let s = analyze(&regions, 3.2);
        assert_eq!(s.type_count, 1, "wobble became a vocabulary: {}", s.sequence);
        assert_eq!(s.type_separation, 0.0);
        assert_eq!(s.syntax_class, "Isochronous Repetition");
    }

    #[test]
    fn a_sounding_flat_gap_reads_as_a_noise_bed() {
        let r = sequence_of(&[0, 0], 0.2, 0.4);
        // The two slices sit at 0..0.2 s and 0.6..0.8 s (frames 0..40 and
        // 120..160 at 200 fps). Between them, a steady −50 dBFS bed: audible
        // when the next slice arrives, and going neither up nor down.
        let env: Vec<f64> = (0..200)
            .map(|i| if i < 40 || (120..160).contains(&i) { 0.8 } else { 0.003 })
            .collect();
        let s = bioacoustic_syntax(&r, &[], 44100.0, 2048, 512, &env, 200.0).expect("syntax");
        assert_eq!(s.junctions[0].junction_class, NOISE_BED);
        // A bed is not a bond — the two slices are still separate events.
        assert_eq!(s.bound_ratio, 0.0);
    }

    #[test]
    fn two_timbres_split_into_two_types() {
        let r = sequence_of(&[0, 1, 0, 1, 0, 1, 0, 1], 0.2, 0.3);
        let s = analyze(&r, 4.5);
        assert_eq!(s.type_count, 2, "two distinct timbres: {}", s.sequence);
        assert_eq!(s.slice_types.len(), 2);
        // Strict alternation: knowing the current slice fully determines the next.
        assert!(s.determinism > 0.99, "determinism {}", s.determinism);
        assert_eq!(s.syntax_class, "Alternation");
        assert_eq!(s.repeat_ratio, 0.0);
        assert_eq!(s.distinct_bigrams, 2);
    }

    #[test]
    fn an_alternating_song_has_a_motif() {
        let r = sequence_of(&[0, 1, 0, 1, 0, 1], 0.2, 0.3);
        let s = analyze(&r, 3.5);
        assert!(s.dominant_motif_occurrences > 1, "no repeated motif in {}", s.sequence);
        assert!(s.dominant_motif.len() >= 2);
    }

    #[test]
    fn every_gap_becomes_one_classified_junction() {
        let r = sequence_of(&[0, 1, 0, 1], 0.2, 0.3);
        let s = analyze(&r, 2.5);
        assert_eq!(s.junctions.len(), 3, "one junction per gap");
        for j in &s.junctions {
            assert!((j.gap_seconds - 0.3).abs() < 0.02, "gap {}", j.gap_seconds);
            assert!((j.inter_onset_seconds - 0.5).abs() < 0.02);
            assert!(!j.junction_class.is_empty());
        }
        assert_eq!(s.junction_profile.iter().map(|c| c.count).sum::<usize>(), 3);
    }

    #[test]
    fn a_quiet_flat_gap_reads_as_silence_not_as_a_bed() {
        let r = sequence_of(&[0, 0], 0.2, 0.4);
        let s = analyze(&r, 1.0);
        assert_eq!(s.junctions[0].junction_class, SILENCE);
        assert!(s.junctions[0].gap_level_below_previous_peak_decibels < -50.0);
    }

    #[test]
    fn a_falling_gap_reads_as_a_resonant_tail() {
        let mut r = sequence_of(&[0, 0], 0.2, 0.6);
        r.regions[1].start_seconds = 0.8;
        r.regions[1].end_seconds = 1.0;
        let rate = 200.0;
        let mut env = vec![0.0005; 220];
        for x in env.iter_mut().take(40) {
            *x = 0.8;
        }
        // The gap starts loud and fades — the first sound ringing out.
        for (i, x) in env.iter_mut().enumerate().take(160).skip(40) {
            *x = 0.4 * (0.02f64).powf((i - 40) as f64 / 120.0);
        }
        for x in env.iter_mut().take(200).skip(160) {
            *x = 0.8;
        }
        let s = bioacoustic_syntax(&r, &[], 44100.0, 2048, 512, &env, rate).expect("syntax");
        assert_eq!(s.junctions[0].junction_class, RESONANT_TAIL);
        assert!(s.junctions[0].gap_slope_decibels_per_second < 0.0);
        assert!(s.bound_ratio > 0.0);
    }

    #[test]
    fn a_rising_gap_reads_as_a_breath() {
        let mut r = sequence_of(&[0, 0], 0.2, 0.6);
        r.regions[1].start_seconds = 0.8;
        r.regions[1].end_seconds = 1.0;
        let rate = 200.0;
        let mut env = vec![0.0005; 220];
        for x in env.iter_mut().take(40) {
            *x = 0.8;
        }
        // Level climbs through the gap — an inhale, or a wind-up into the onset.
        for (i, x) in env.iter_mut().enumerate().take(160).skip(40) {
            *x = 0.0002 * (50.0f64).powf((i - 40) as f64 / 120.0);
        }
        for x in env.iter_mut().take(200).skip(160) {
            *x = 0.8;
        }
        let s = bioacoustic_syntax(&r, &[], 44100.0, 2048, 512, &env, rate).expect("syntax");
        assert_eq!(s.junctions[0].junction_class, BREATH);
        assert!(s.junctions[0].gap_slope_decibels_per_second > 0.0);
    }

    #[test]
    fn a_gap_that_never_drops_reads_as_continuous() {
        let r = sequence_of(&[0, 0], 0.2, 0.4);
        let rate = 200.0;
        // The gate dipped, the sound did not stop: the "gap" is 6 dB down.
        let env = vec![0.4; 200];
        let s = bioacoustic_syntax(&r, &[], 44100.0, 2048, 512, &env, rate).expect("syntax");
        assert_eq!(s.junctions[0].junction_class, CONTINUOUS);
        assert_eq!(s.bound_ratio, 1.0);
    }

    #[test]
    fn surprisal_marks_the_rare_move() {
        // Seven A→A repeats and one departure to B: the departure is the news.
        let r = sequence_of(&[0, 0, 0, 0, 0, 0, 0, 0, 1], 0.2, 0.3);
        let s = analyze(&r, 5.0);
        assert_eq!(s.type_count, 2);
        let rare = s.junctions.last().expect("a junction");
        let common = &s.junctions[0];
        assert!(
            rare.surprisal_bits > common.surprisal_bits,
            "rare {} vs common {}",
            rare.surprisal_bits,
            common.surprisal_bits
        );
    }

    #[test]
    fn labels_are_assigned_by_frequency() {
        // Kind 1 appears once, kind 0 five times — so kind 0 must be "A".
        let r = sequence_of(&[1, 0, 0, 0, 0, 0], 0.2, 0.3);
        let s = analyze(&r, 3.5);
        assert_eq!(s.type_count, 2);
        assert_eq!(s.sequence, "BAAAAA");
        assert_eq!(s.slice_types[0].label, "A");
        assert_eq!(s.slice_types[0].occurrences, 5);
    }

    #[test]
    fn entropy_of_a_fair_coin_is_one_bit() {
        assert!((entropy(&[4, 4]) - 1.0).abs() < 1e-12);
        assert_eq!(entropy(&[7]), 0.0);
        assert_eq!(entropy(&[]), 0.0);
    }

    #[test]
    fn regularity_is_one_for_an_even_series() {
        assert!((regularity(&[0.5, 0.5, 0.5]) - 1.0).abs() < 1e-12);
        assert!(regularity(&[0.1, 2.0, 0.1]) < 0.5);
    }

    #[test]
    fn motif_search_finds_the_longest_repeat() {
        assert_eq!(longest_repeated_motif("ABCABC"), ("ABC".to_string(), 2));
        assert_eq!(longest_repeated_motif("ABCD"), (String::new(), 0));
        let (phrase, count) = longest_repeated_motif("AAAA");
        assert_eq!(count, 3, "overlapping repeats of {} count", phrase);
    }
}
