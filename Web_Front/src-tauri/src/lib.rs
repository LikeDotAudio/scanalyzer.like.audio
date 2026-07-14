use std::io::{BufRead, BufReader};
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn start_analysis(app: AppHandle, directory: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let mut child =
            match Command::new("../../sample_analyzer_rs/target/release/oa_sample_analyzer")
                .arg(&directory)
                .arg("--workers")
                .arg("30")
                .stdout(std::process::Stdio::piped())
                .spawn()
            {
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
                let _ = app.emit("analyzer-progress", l);
            }
        }

        let _ = child.wait();
        let _ = app.emit("analyzer-finished", ());
    });

    Ok(())
}

#[tauri::command]
fn read_peak_file(directory: String) -> Result<String, String> {
    let path = std::path::Path::new(&directory).join("sample_cloud_data.PEAK");
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .invoke_handler(tauri::generate_handler![start_analysis, read_peak_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
