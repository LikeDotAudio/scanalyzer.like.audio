use std::io::{BufRead, BufReader};
use std::sync::Mutex;
use std::process::Command;
use tauri::{AppHandle, Emitter};

/// Strip a streamed analyzer line down to what the progress UI actually reads.
///
/// The analyzer's `result` lines carry the WHOLE ~3.7 KB Peak record — deliberately,
/// so a GUI can build live records from the stream. This GUI does not: it reads only
/// done/total/thread_id, throws the record away, and re-reads the finished .PEAK from
/// disk. Forwarding the full record put ~3.7 KB through IPC and a JSON.parse + React
/// render per file — tens of megabytes and thousands of renders on a real library,
/// which starves the webview until it stops repainting and the scan looks hung.
///
/// So we forward a few fields instead. The CLI's stdout protocol is untouched.
fn slim_progress(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let o = v.as_object()?;
    let mut out = serde_json::Map::new();
    for key in ["type", "done", "total", "thread_id", "workers", "file", "name", "count"] {
        if let Some(val) = o.get(key) {
            out.insert(key.to_string(), val.clone());
        }
    }
    serde_json::to_string(&serde_json::Value::Object(out)).ok()
}

/// Exactly what the engine can decode — sample_analyzer_rs/src/decode.rs AUDIO_EXTENSIONS.
/// Keep the two in step, or the survey promises files the analyzer will refuse.
const AUDIO_EXTENSIONS: &[&str] = &[
    "wav", "wave", "mp3", "flac", "aif", "aiff", "aifc", "ogg", "oga", "m4a", "mp4", "aac",
];

fn is_audio(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| AUDIO_EXTENSIONS.iter().any(|a| e.eq_ignore_ascii_case(a)))
}

fn is_sidecar(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("peak"))
}

/// Every audio file under `root`, depth-first. A symlink loop would spin forever, so
/// we do not follow directory symlinks.
fn walk_audio(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(t) if t.is_dir() => walk_audio(&path, out),
            Ok(t) if t.is_file() && is_audio(&path) => out.push(path),
            _ => {}
        }
    }
}

/// What one listed file looks like to the survey screen.
#[derive(serde::Serialize)]
struct SurveyFile {
    path: String,
    has_sidecar: bool,
}

/// What the folder holds, WITHOUT reading a byte of audio.
///
/// The browser has always shown this before it starts work — how many samples, how
/// many already carry a .PEAK, which engine wrote them — and then let the user choose.
/// The desktop build went straight from the folder picker to a full re-analysis of a
/// library it may already have done. This is the same survey, and it is cheap: listing
/// a directory and stat-ing a sibling costs nothing next to decoding 37,000 files.
#[derive(serde::Serialize)]
struct Survey {
    audio_files: usize,
    total_bytes: u64,
    with_sidecar: usize,
    /// The version stamp on the sidecars already here, or None when they disagree —
    /// a folder scanned across two engine versions has no single answer, and saying
    /// so is better than picking one and lying about the other half.
    sidecar_engine: Option<String>,
    /// The first 200, for the user to eyeball. Never the whole list: a 37k-entry
    /// array through IPC is the same mistake open_peak_file was written to undo.
    sample: Vec<SurveyFile>,
}

/// How many sidecars to open just to name the engine that wrote them. Reading all
/// 37,000 to answer "which version?" is what made the browser survey hang.
const SIDECAR_PROBES: usize = 12;

#[tauri::command]
fn survey_directory(directory: String) -> Result<Survey, String> {
    let root = std::path::Path::new(&directory);
    if !root.is_dir() {
        return Err(format!("{directory} is not a folder"));
    }

    let mut files = Vec::new();
    walk_audio(root, &mut files);
    files.sort();

    let mut total_bytes = 0u64;
    let mut with_sidecar: Vec<&std::path::PathBuf> = Vec::new();
    let mut sample = Vec::new();

    for f in &files {
        total_bytes += std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
        let has = f.with_extension("PEAK").exists();
        if has {
            with_sidecar.push(f);
        }
        if sample.len() < 200 {
            sample.push(SurveyFile {
                path: f
                    .strip_prefix(root)
                    .unwrap_or(f)
                    .to_string_lossy()
                    .replace('\\', "/"),
                has_sidecar: has,
            });
        }
    }

    // Probe a spread of the sidecars, not all of them.
    let mut engines: Vec<String> = Vec::new();
    if !with_sidecar.is_empty() {
        let step = (with_sidecar.len() / SIDECAR_PROBES).max(1);
        for f in with_sidecar.iter().step_by(step).take(SIDECAR_PROBES) {
            let Ok(text) = std::fs::read_to_string(f.with_extension("PEAK")) else { continue };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
            if let Some(ver) = v
                .get("metadata")
                .and_then(|m| m.get("analyzer_version"))
                .and_then(|s| s.as_str())
            {
                engines.push(ver.to_string());
            }
        }
    }
    let sidecar_engine = match engines.first() {
        Some(first) if engines.iter().all(|e| e == first) => Some(first.clone()),
        _ => None,
    };

    Ok(Survey {
        audio_files: files.len(),
        total_bytes,
        with_sidecar: with_sidecar.len(),
        sidecar_engine,
        sample,
    })
}

/// Load every existing sidecar into the page cache WITHOUT analyzing anything.
///
/// "Just open what I already have." Re-analysis is expensive and the numbers already
/// on disk are usually the ones you want to look at. Records come back through
/// read_peak_page like any other, so the webview never sees the whole array at once.
#[tauri::command]
fn open_sidecars(directory: String, cache: tauri::State<'_, PeakCache>) -> Result<usize, String> {
    let root = std::path::Path::new(&directory);
    let mut files = Vec::new();
    walk_audio(root, &mut files);
    files.sort();

    let mut records: Vec<serde_json::Value> = Vec::new();
    for f in &files {
        let side = f.with_extension("PEAK");
        if !is_sidecar(&side) || !side.exists() {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&side) else { continue };
        // An unreadable sidecar is skipped, not fatal: one bad file must not deny the
        // user the other 36,999.
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if v.is_object() {
                records.push(v);
            }
        }
    }

    let n = records.len();
    *cache.0.lock().map_err(|e| e.to_string())? = records;
    Ok(n)
}

/// Read an audio file's raw bytes for playback.
///
/// The asset protocol (convertFileSrc) is the "proper" way to stream a local file into
/// an <audio> element, but on Linux WebKitGTK it depends on the scope glob matching the
/// absolute path AND on GStreamer having a decoder for the container — two things that
/// silently fail and leave playback dead with no error. Handing the bytes straight to
/// the webview and letting it build a blob: URL sidesteps both: it is the same path the
/// browser build already uses, and it works for any file the user picked.
///
/// One file at a time, a few MB — returned as a raw IPC Response, not a JSON number
/// array, so the bytes are not stringified on the way across.
#[tauri::command]
fn read_audio_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---- In-process extractor ----------------------------------------------------------
// The desktop Extractor calls these instead of the WASM worker. They run the SAME
// `extractor_engine` code, so cuts are identical to the web build. Decoding is done here
// with symphonia (native), and the last-decoded file is cached so re-detecting on a
// slider drag or analyzing every chunk decodes the file once, not once per call.

#[derive(Default)]
struct ExtractorCache(Mutex<Option<(String, oa_sample_analyzer::decode::Decoded)>>);

/// Mono PCM + sample rate for `path`, reusing the cached decode when the path is unchanged.
fn extractor_pcm(cache: &ExtractorCache, path: &str) -> Result<(Vec<f32>, u32), String> {
    let mut guard = cache.0.lock().unwrap();
    if let Some((p, d)) = guard.as_ref() {
        if p == path {
            return Ok((d.mono.clone(), d.sample_rate));
        }
    }
    let decoded = oa_sample_analyzer::decode::read_audio(std::path::Path::new(path))
        .ok_or_else(|| format!("could not decode {path}"))?;
    let out = (decoded.mono.clone(), decoded.sample_rate);
    *guard = Some((path.to_string(), decoded));
    Ok(out)
}

#[tauri::command]
fn extractor_detect(
    cache: tauri::State<ExtractorCache>,
    path: String,
    params_json: String,
) -> Result<String, String> {
    let (mono, sr) = extractor_pcm(&cache, &path)?;
    let params: extractor_engine::DetectParams = serde_json::from_str(&params_json).unwrap_or_default();
    let regions = extractor_engine::detect_regions_from_samples(&mono, sr, &params);
    serde_json::to_string(&regions).map_err(|e| e.to_string())
}

#[tauri::command]
fn extractor_slice_wav(
    cache: tauri::State<ExtractorCache>,
    path: String,
    region_json: String,
) -> Result<tauri::ipc::Response, String> {
    let (mono, sr) = extractor_pcm(&cache, &path)?;
    let region: extractor_engine::Region = serde_json::from_str(&region_json).map_err(|e| e.to_string())?;
    let slice = extractor_engine::slice_region(&mono, sr, &region, extractor_engine::FadeCurve::Linear);
    Ok(tauri::ipc::Response::new(extractor_engine::encode_wav_pcm16(&slice, sr)))
}

#[tauri::command]
fn extractor_analyze_chunk(
    cache: tauri::State<ExtractorCache>,
    path: String,
    region_json: String,
    name: String,
    folder: String,
) -> Result<String, String> {
    let (mono, sr) = extractor_pcm(&cache, &path)?;
    let region: extractor_engine::Region = serde_json::from_str(&region_json).map_err(|e| e.to_string())?;
    let slice = extractor_engine::slice_region(&mono, sr, &region, extractor_engine::FadeCurve::Linear);
    if slice.len() < 2 {
        return Ok("{\"status\":\"too_short\"}".to_string());
    }
    let wav = extractor_engine::encode_wav_pcm16(&slice, sr);
    match oa_sample_analyzer::analyze::analyze_buffer(&wav, &name, &folder, 600.0) {
        Some(peak) => serde_json::to_string(&peak).map_err(|e| e.to_string()),
        None => Ok("{\"status\":\"too_short\"}".to_string()),
    }
}

#[tauri::command]
fn start_analysis(
    app: AppHandle,
    directory: String,
    stride: Option<usize>,
    force: Option<bool>,
) -> Result<(), String> {
    std::thread::spawn(move || {
        // One worker per core. This used to be hardcoded to 30, which oversubscribed
        // every machine with fewer cores — 30 threads doing FFT/decode work on 12
        // cores pegs the box and makes the desktop (not just this app) unresponsive.
        let workers = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);

        let mut cmd = Command::new("../../sample_analyzer_rs/target/release/oa_sample_analyzer");
        cmd.arg(&directory)
            .arg("--workers")
            .arg(workers.to_string());
        if let Some(s) = stride {
            cmd.arg("--stride").arg(s.to_string());
        }
        // "Rescan all": ignore every sidecar, even one this exact engine wrote.
        // Without it the CLI reuses a matching sidecar and the rescan is a no-op.
        if force.unwrap_or(false) {
            cmd.arg("--force");
        }
        let mut child = match cmd.stdout(std::process::Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("analyzer-error", format!("Failed to start analyzer: {}", e));
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                match slim_progress(&l) {
                    Some(slim) => {
                        let _ = app.emit("analyzer-progress", slim);
                    }
                    // Not JSON we understand — pass it through rather than drop it.
                    None => {
                        let _ = app.emit("analyzer-progress", l);
                    }
                }
            }
        }

        let _ = child.wait();
        let _ = app.emit("analyzer-finished", ());
    });

    Ok(())
}

/// The aggregate .PEAK of the last finished scan, parsed once and held here so the
/// webview can pull it in pages.
#[derive(Default)]
struct PeakCache(Mutex<Vec<serde_json::Value>>);

/// Parse the aggregate .PEAK and report how many records it holds.
///
/// This used to be `read_peak_file`, which returned the whole file as one String.
/// On a real library that is enormous — FSD50K's dev split is ~41k records, about
/// 150 MB of JSON — and pushing it through IPC in one message, then JSON.parse-ing
/// it in the webview, simply killed the app. Parsing natively and paging the result
/// keeps the peak memory in Rust, where it is affordable.
#[tauri::command]
fn open_peak_file(directory: String, cache: tauri::State<'_, PeakCache>) -> Result<usize, String> {
    let path = std::path::Path::new(&directory).join("sample_cloud_data.PEAK");
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let records: Vec<serde_json::Value> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let n = records.len();
    *cache.0.lock().map_err(|e| e.to_string())? = records;
    Ok(n)
}

/// One page of the parsed records, as a JSON array.
#[tauri::command]
fn read_peak_page(
    offset: usize,
    limit: usize,
    cache: tauri::State<'_, PeakCache>,
) -> Result<String, String> {
    let records = cache.0.lock().map_err(|e| e.to_string())?;
    let end = offset.saturating_add(limit).min(records.len());
    let page = if offset >= records.len() {
        &[][..]
    } else {
        &records[offset..end]
    };
    serde_json::to_string(page).map_err(|e| e.to_string())
}

/// Drop the parsed records once the webview has them.
#[tauri::command]
fn close_peak_file(cache: tauri::State<'_, PeakCache>) -> Result<(), String> {
    cache.0.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

// ---- Slim manifest --------------------------------------------------------------------
// A compact index over the full .PEAK sidecars (see oa_sample_analyzer::manifest). The
// sidecars stay canonical; the manifest is a rebuildable cache that lets the UI load a
// huge library fast and lazy-load a full record only when a file is opened.

/// Load the slim manifest into the page cache — the fast path. Its rows come back through
/// `read_peak_page` like any other record. Returns the count, or Err when the manifest is
/// absent or was written by a different analyzer version, so the caller can fall back to
/// `open_sidecars` / a rescan rather than trust a stale index.
#[tauri::command]
fn open_manifest(directory: String, cache: tauri::State<'_, PeakCache>) -> Result<usize, String> {
    let path = std::path::Path::new(&directory).join(oa_sample_analyzer::manifest::MANIFEST_NAME);
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if !oa_sample_analyzer::manifest::is_current(&manifest) {
        return Err("manifest was written by a different analyzer version".into());
    }
    let records = manifest
        .get("records")
        .and_then(|r| r.as_array())
        .ok_or("manifest has no records array")?
        .clone();
    let n = records.len();
    *cache.0.lock().map_err(|e| e.to_string())? = records;
    Ok(n)
}

// ---- Root text files (favorites.json etc.) ---------------------------------------------
// Small named text files at the library root, SIBLINGS of the manifest. Unlike the manifest
// (a rebuildable cache) these carry user data — favorites.json — so scans never touch them.
// `file_name` must be a bare name: no separators, no `..` — never a path escape.

fn root_file_path(directory: &str, file_name: &str) -> Result<std::path::PathBuf, String> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
    {
        return Err(format!("invalid root file name: {file_name}"));
    }
    let root = std::path::Path::new(directory);
    if !root.is_dir() {
        return Err(format!("{directory} is not a folder"));
    }
    Ok(root.join(file_name))
}

/// Read a named text file at the library root (e.g. favorites.json). Err when absent.
#[tauri::command]
fn read_root_text(directory: String, file_name: String) -> Result<String, String> {
    let path = root_file_path(&directory, &file_name)?;
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write a named text file at the library root (e.g. favorites.json).
#[tauri::command]
fn write_root_text(directory: String, file_name: String, text: String) -> Result<(), String> {
    let path = root_file_path(&directory, &file_name)?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

/// Build (or rebuild) the slim manifest from the `.PEAK` sidecars already on disk, WITHOUT
/// re-analyzing. Upgrades a library that was scanned before manifests existed, and refreshes
/// one whose sidecars changed. Returns how many records went into the manifest.
#[tauri::command]
fn build_manifest(directory: String) -> Result<usize, String> {
    let root = std::path::Path::new(&directory);
    if !root.is_dir() {
        return Err(format!("{directory} is not a folder"));
    }
    let mut files = Vec::new();
    walk_audio(root, &mut files);
    files.sort();

    let mut records: Vec<serde_json::Value> = Vec::new();
    for f in &files {
        let side = f.with_extension("PEAK");
        if !side.exists() {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&side) else { continue };
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if v.is_object() {
                records.push(v);
            }
        }
    }
    if !oa_sample_analyzer::manifest::write_manifest(root, &records) {
        return Err("could not write manifest.json".into());
    }
    Ok(records.len())
}

/// Read one file's full `.PEAK` sidecar — the Examiner detail panel's lazy load. The
/// manifest holds only slim rows, so opening a file fetches its complete record here.
/// `path` is the audio file's path; the sidecar sits beside it as `<basename>.PEAK`.
#[tauri::command]
fn read_full_record(path: String) -> Result<String, String> {
    let side = std::path::Path::new(&path).with_extension("PEAK");
    std::fs::read_to_string(&side).map_err(|e| format!("{}: {e}", side.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .manage(PeakCache::default())
        .manage(ExtractorCache::default())
        .invoke_handler(tauri::generate_handler![
            survey_directory,
            open_sidecars,
            read_audio_bytes,
            start_analysis,
            open_peak_file,
            read_peak_page,
            close_peak_file,
            open_manifest,
            build_manifest,
            read_root_text,
            write_root_text,
            read_full_record,
            extractor_detect,
            extractor_slice_wav,
            extractor_analyze_chunk
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
