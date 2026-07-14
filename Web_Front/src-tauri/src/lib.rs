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

#[tauri::command]
fn start_analysis(app: AppHandle, directory: String, stride: Option<usize>) -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .manage(PeakCache::default())
        .invoke_handler(tauri::generate_handler![
            start_analysis,
            open_peak_file,
            read_peak_page,
            close_peak_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
