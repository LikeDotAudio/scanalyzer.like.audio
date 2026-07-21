//! oa_graph_layout — the Sample Analyzer's 3D-cloud "math and placement" engine.
//!
//! Reads one JSON request on stdin and writes one JSON response on stdout:
//!   in : { axes:{x,y,z}, size, feature_labels, records }
//!   out: { groups, color_idx, x, y, z, sizes, size_label, size_legend }
//!
//! Each axis key is a feature name (e.g. "pitch", "length", "timbre") or null,
//! which means the hierarchical group / subgroup depth. This is the single
//! implementation of the depth levels, categorical indexing, numeric-feature
//! extraction, size scaling and tick generation — the Python GUI just draws
//! whatever comes back.
use std::collections::{BTreeMap, BTreeSet};
use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

type Rec = Map<String, Value>;

#[derive(Deserialize, Default)]
struct Axes {
    #[serde(default)]
    x: Option<String>,
    #[serde(default)]
    y: Option<String>,
    #[serde(default)]
    z: Option<String>,
}

#[derive(Deserialize, Default)]
struct Request {
    #[serde(default)]
    axes: Axes,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    feature_labels: BTreeMap<String, String>,
    #[serde(default)]
    records: Vec<Rec>,
}

#[derive(Serialize)]
struct Ticks {
    positions: Vec<f64>,
    names: Vec<String>,
}

#[derive(Serialize)]
struct Axis {
    vals: Vec<f64>,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    ticks: Option<Ticks>,
}

#[derive(Serialize)]
struct SizeRef {
    size: f64,
    label: String,
}

#[derive(Serialize)]
struct Response {
    groups: Vec<String>,
    color_idx: Vec<usize>,
    x: Axis,
    y: Axis,
    z: Axis,
    sizes: Vec<f64>,
    size_label: String,
    size_legend: Vec<SizeRef>,
}

// ---- record field access ------------------------------------------------

fn num(r: &Rec, key: &str) -> f64 {
    match r.get(key) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::Bool(b)) => if *b { 1.0 } else { 0.0 },
        _ => 0.0,
    }
}

fn sstr(r: &Rec, key: &str) -> String {
    match r.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn group_of(r: &Rec) -> String {
    let g = sstr(r, "group");
    if g.is_empty() { "Other".to_string() } else { g }
}

/// The record's subgroup when it's a *curated* level (Perc→Conga) rather than
/// the auto "group + length tier" one; "" when the subgroup just echoes the group.
fn deeper_sub(r: &Rec) -> String {
    let g = sstr(r, "group");
    let g = g.trim();
    let sg = sstr(r, "subgroup");
    let sg = sg.trim();
    let gl = g.to_lowercase();
    let sgl = sg.to_lowercase();
    if !sg.is_empty() && sgl != gl && !sgl.starts_with(&gl) && !gl.starts_with(&sgl) {
        sg.to_string()
    } else {
        String::new()
    }
}

// ---- axis value computation ---------------------------------------------

fn label_for(labels: &BTreeMap<String, String>, key: &str) -> String {
    labels.get(key).cloned().unwrap_or_else(|| key.to_string())
}

fn axis_values(recs: &[Rec], key: Option<&str>, labels: &BTreeMap<String, String>) -> Axis {
    match key {
        // Hierarchical depth: each group, with its curated subgroups one level deeper.
        None => {
            let mut per_group: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
            for r in recs {
                per_group.entry(group_of(r)).or_default().insert(deeper_sub(r));
            }
            let mut levels: Vec<(String, String)> = Vec::new();
            for (g, subs) in &per_group {
                if subs.contains("") {
                    levels.push((g.clone(), String::new())); // samples at the group level
                }
                for s in subs {
                    if !s.is_empty() {
                        levels.push((g.clone(), s.clone())); // a name group deeper
                    }
                }
            }
            let lidx: BTreeMap<(String, String), usize> =
                levels.iter().cloned().enumerate().map(|(i, lv)| (lv, i)).collect();
            let vals = recs
                .iter()
                .map(|r| *lidx.get(&(group_of(r), deeper_sub(r))).unwrap_or(&0) as f64)
                .collect();
            let names = levels
                .iter()
                .map(|(g, s)| if s.is_empty() { g.clone() } else { format!("  \u{21b3} {}", s) })
                .collect();
            let positions = (0..levels.len()).map(|i| i as f64).collect();
            Axis { vals, label: "Group / subgroup".to_string(), ticks: Some(Ticks { positions, names }) }
        }
        // Categorical index (timbre is the only categorical axis).
        Some("timbre") => {
            let cat = |r: &Rec| {
                let t = sstr(r, "timbre");
                if t.is_empty() { "?".to_string() } else { t }
            };
            let cats: Vec<String> = recs.iter().map(cat).collect::<BTreeSet<_>>().into_iter().collect();
            let cidx: BTreeMap<String, usize> =
                cats.iter().cloned().enumerate().map(|(i, c)| (c, i)).collect();
            let vals = recs.iter().map(|r| *cidx.get(&cat(r)).unwrap_or(&0) as f64).collect();
            let positions = (0..cats.len()).map(|i| i as f64).collect();
            Axis { vals, label: label_for(labels, "timbre"), ticks: Some(Ticks { positions, names: cats }) }
        }
        // Mono files dip below zero on the complexity axis (stereo stays +).
        Some("complexity") => {
            let vals = recs
                .iter()
                .map(|r| {
                    let ch = match r.get("channels") {
                        Some(Value::Number(n)) => {
                            let v = n.as_f64().unwrap_or(0.0);
                            if v == 0.0 { 2.0 } else { v }
                        }
                        _ => 2.0,
                    };
                    let sign = if ch == 1.0 { -1.0 } else { 1.0 };
                    sign * num(r, "complexity")
                })
                .collect();
            Axis { vals, label: "Complexity (mono = \u{2212})".to_string(), ticks: None }
        }
        // Plain numeric feature.
        Some(k) => {
            let vals = recs.iter().map(|r| num(r, k)).collect();
            Axis { vals, label: label_for(labels, k), ticks: None }
        }
    }
}

// ---- point sizes + size legend ------------------------------------------

fn fmt_num(v: f64) -> String {
    let a = v.abs();
    if a >= 100.0 {
        format!("{:.0}", v)
    } else if a >= 1.0 {
        format!("{:.2}", v)
    } else {
        format!("{:.3}", v)
    }
}

fn compute_sizes(
    recs: &[Rec],
    key: Option<&str>,
    labels: &BTreeMap<String, String>,
) -> (Vec<f64>, String, Vec<SizeRef>) {
    match key {
        // Categorical timbre → one discrete bubble size per timbre.
        Some("timbre") => {
            let cat = |r: &Rec| {
                let t = sstr(r, "timbre");
                if t.is_empty() { "?".to_string() } else { t }
            };
            let cats: Vec<String> = recs.iter().map(cat).collect::<BTreeSet<_>>().into_iter().collect();
            let cidx: BTreeMap<String, usize> =
                cats.iter().cloned().enumerate().map(|(i, c)| (c, i)).collect();
            let denom = cats.len().saturating_sub(1).max(1) as f64;
            let size_of = |i: usize| 25.0 + (i as f64 / denom) * 260.0;
            let sizes = recs.iter().map(|r| size_of(*cidx.get(&cat(r)).unwrap_or(&0))).collect();
            let legend = cats
                .iter()
                .enumerate()
                .map(|(i, c)| SizeRef { size: size_of(i), label: c.clone() })
                .collect();
            (sizes, label_for(labels, "timbre"), legend)
        }
        // Numeric feature (default length) → min…max scaled bubble area.
        _ => {
            let k = key.unwrap_or("length");
            let vals: Vec<f64> = recs
                .iter()
                .map(|r| {
                    let v = num(r, k);
                    if k == "length" && v == 0.0 { 0.1 } else { v }
                })
                .collect();
            if vals.is_empty() {
                return (Vec::new(), label_for(labels, k), Vec::new());
            }
            let lmin = vals.iter().cloned().fold(f64::INFINITY, f64::min);
            let lmax = vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let span = if (lmax - lmin).abs() < 1e-12 { 1.0 } else { lmax - lmin };
            let size_of = |v: f64| 25.0 + ((v - lmin) / span) * 260.0;
            let sizes = vals.iter().map(|&v| size_of(v)).collect();
            let mut legend = Vec::new();
            for v in [lmin, (lmin + lmax) / 2.0, lmax] {
                if !legend.iter().any(|r: &SizeRef| (r.size - size_of(v)).abs() < 1e-9) {
                    legend.push(SizeRef { size: size_of(v), label: fmt_num(v) });
                }
            }
            (sizes, label_for(labels, k), legend)
        }
    }
}

// ---- top level ----------------------------------------------------------

fn compute(req: &Request) -> Response {
    let recs = &req.records;
    let groups: Vec<String> =
        recs.iter().map(group_of).collect::<BTreeSet<_>>().into_iter().collect();
    let gpos: BTreeMap<String, usize> =
        groups.iter().cloned().enumerate().map(|(i, g)| (g, i)).collect();
    let color_idx = recs.iter().map(|r| *gpos.get(&group_of(r)).unwrap_or(&0)).collect();

    let x = axis_values(recs, req.axes.x.as_deref(), &req.feature_labels);
    let y = axis_values(recs, req.axes.y.as_deref(), &req.feature_labels);
    let z = axis_values(recs, req.axes.z.as_deref(), &req.feature_labels);
    let (sizes, size_label, size_legend) =
        compute_sizes(recs, req.size.as_deref(), &req.feature_labels);

    Response { groups, color_idx, x, y, z, sizes, size_label, size_legend }
}

fn main() {
    let mut input = String::new();
    if io::stdin().read_to_string(&mut input).is_err() {
        let _ = io::stdout().write_all(b"{}");
        return;
    }
    let req: Request = serde_json::from_str(&input).unwrap_or_default();
    let resp = compute(&req);
    let out = serde_json::to_string(&resp).unwrap_or_else(|_| "{}".to_string());
    let _ = io::stdout().write_all(out.as_bytes());
}
