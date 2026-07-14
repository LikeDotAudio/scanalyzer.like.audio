//! Deterministic K-Means++ over a subset of the analyzed samples. Writes the
//! chosen cluster id (offset by `offset`) back into each `Peak`.
use crate::feature_vec::feature_vec;
use crate::peak::Peak;
use crate::sqdist::sqdist;

pub fn kmeans_assign(results: &mut [Peak], idx: &[usize], k: usize, offset: i32) {
    let n = idx.len();
    if n == 0 {
        return;
    }
    let k = k.max(1).min(n);

    // Min-max normalize each feature column so no dimension dominates.
    let feats: Vec<Vec<f64>> = idx.iter().map(|&i| feature_vec(&results[i])).collect();
    let d = feats[0].len();
    let mut mn = vec![f64::INFINITY; d];
    let mut mx = vec![f64::NEG_INFINITY; d];
    for f in &feats {
        for j in 0..d {
            mn[j] = mn[j].min(f[j]);
            mx[j] = mx[j].max(f[j]);
        }
    }
    let norm: Vec<Vec<f64>> = feats
        .iter()
        .map(|f| {
            (0..d)
                .map(|j| {
                    let r = mx[j] - mn[j];
                    if r > 1e-12 {
                        (f[j] - mn[j]) / r
                    } else {
                        0.0
                    }
                })
                .collect()
        })
        .collect();

    // Deterministic PRNG (xorshift) for K-Means++ seeding.
    let mut seed = 0x9E3779B97F4A7C15u64;
    let mut rnd = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed >> 11) as f64 / ((1u64 << 53) as f64)
    };

    // K-Means++ init.
    let mut centers: Vec<Vec<f64>> = Vec::with_capacity(k);
    centers.push(norm[(rnd() * n as f64) as usize % n].clone());
    while centers.len() < k {
        let dists: Vec<f64> = norm
            .iter()
            .map(|x| centers.iter().map(|c| sqdist(x, c)).fold(f64::INFINITY, f64::min))
            .collect();
        let sum: f64 = dists.iter().sum();
        if sum <= 0.0 {
            centers.push(norm[centers.len() % n].clone());
            continue;
        }
        let mut target = rnd() * sum;
        let mut pick = 0;
        for (i, dd) in dists.iter().enumerate() {
            target -= dd;
            pick = i;
            if target <= 0.0 {
                break;
            }
        }
        centers.push(norm[pick].clone());
    }

    // Lloyd's iterations.
    let mut assign = vec![0usize; n];
    for _ in 0..40 {
        let mut changed = false;
        for (i, x) in norm.iter().enumerate() {
            let mut best = 0;
            let mut bd = f64::INFINITY;
            for (ci, c) in centers.iter().enumerate() {
                let dd = sqdist(x, c);
                if dd < bd {
                    bd = dd;
                    best = ci;
                }
            }
            if assign[i] != best {
                assign[i] = best;
                changed = true;
            }
        }
        let mut sums = vec![vec![0.0f64; d]; k];
        let mut cnt = vec![0usize; k];
        for (i, x) in norm.iter().enumerate() {
            let a = assign[i];
            for j in 0..d {
                sums[a][j] += x[j];
            }
            cnt[a] += 1;
        }
        for ci in 0..k {
            if cnt[ci] > 0 {
                for j in 0..d {
                    centers[ci][j] = sums[ci][j] / cnt[ci] as f64;
                }
            }
        }
        if !changed {
            break;
        }
    }

    for (m, &i) in idx.iter().enumerate() {
        results[i].unsupervised.cluster = offset + assign[m] as i32;
    }
}
