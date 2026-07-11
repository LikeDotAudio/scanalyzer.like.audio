use rayon::prelude::*;
use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::process::Command;

#[derive(Deserialize, Debug)]
struct Job {
    source_path: String,
    target_path: String,
    target_format: String,
    target_channels: String,
    target_sample_rate: String,
    #[serde(default)]
    metadata: HashMap<String, String>,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: sample_conversion <manifest.json>");
        std::process::exit(1);
    }

    let manifest_path = &args[1];
    let manifest_data = match fs::read_to_string(manifest_path) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Failed to read manifest: {}", e);
            std::process::exit(1);
        }
    };

    let jobs: Vec<Job> = match serde_json::from_str(&manifest_data) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("Failed to parse JSON: {}", e);
            std::process::exit(1);
        }
    };

    println!("Starting {} conversion jobs...", jobs.len());

    // Process all jobs in parallel using all available CPU cores
    jobs.par_iter().for_each(|job| {
        let mut cmd = Command::new("ffmpeg");
        cmd.arg("-y").arg("-hide_banner").arg("-loglevel").arg("error");
        cmd.arg("-i").arg(&job.source_path);

        // Handle Channel Matrixing
        if job.target_channels == "Mono" {
            cmd.arg("-ac").arg("1");
        } else if job.target_channels == "Stereo" {
            cmd.arg("-ac").arg("2");
        }

        // Handle Sample Rate Resampling (using high-quality soxr)
        if job.target_sample_rate != "Preserve" {
            cmd.arg("-ar").arg(&job.target_sample_rate);
            cmd.arg("-af").arg("aresample=resampler=soxr"); // Pristine Sinc interpolation
        }

        // Handle Format Encoding
        if job.target_format == "FLAC" {
            cmd.arg("-c:a").arg("flac");
        } else {
            // Default to 24-bit WAV
            cmd.arg("-c:a").arg("pcm_s24le");
        }
        
        if job.target_format == "FLAC" {
            for (k, v) in &job.metadata {
                cmd.arg("-metadata").arg(format!("{}={}", k, v));
            }
        }

        cmd.arg(&job.target_path);

        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    // Send a JSON status message back to Python UI
                    println!(
                        "{{\"status\": \"success\", \"file\": \"{}\"}}",
                        job.target_path
                    );
                } else {
                    let err_msg = String::from_utf8_lossy(&output.stderr);
                    println!(
                        "{{\"status\": \"error\", \"file\": \"{}\", \"error\": \"{}\"}}",
                        job.target_path, err_msg.replace('\"', "\\\"").replace('\n', " ")
                    );
                }
            }
            Err(e) => {
                println!(
                    "{{\"status\": \"error\", \"file\": \"{}\", \"error\": \"Failed to launch ffmpeg: {}\"}}",
                    job.target_path, e
                );
            }
        }
    });

    println!("{{\"status\": \"complete\"}}");
}
