# Day 2 Optimizations & Architecture Audit

This document outlines key areas for optimization and alignment across the Native Rust (Tauri) and Web (WASM) implementations of the Sample Analyzer. 

---

## 1. The Discrepancy: PCA and Blind Clustering
**Current State:** 
The native Rust engine (`sample_analyzer_rs/src/run.rs`) performs a dataset-wide Principal Component Analysis (PCA) and K-Means clustering step *after* extracting the audio features. It embeds `embed_x`, `embed_y`, `embed_z`, and `cluster` into the final `.PEAK` data. 
However, the `wasm_analyzer` only processes files one-by-one via `analyze_audio_buffer`, meaning it skips the dataset-wide PCA step. Furthermore, the React frontend (`SampleCloud.tsx`) completely ignores these PCA fields anyway, favoring direct mapping of raw features (Pitch, Length, Complexity) to the X/Y/Z axes via user dropdowns.

**Optimization / Alignment Action:**
*   **Option A (Streamline):** Remove the PCA and Clustering modules from the Rust backend entirely. Since the frontend doesn't use them, removing them will speed up the final step of the native desktop scan and reduce binary size.
*   **Option B (Feature Parity):** Expose a dataset-wide PCA function to WASM. When the Web version finishes scanning, it can pass the array of features to this WASM function to compute embeddings. Then, we add "PCA Blind Embedding" as an option in the Graph X/Y/Z dropdown menus so users can visualize the AI clustering.

## 2. Unblocking the Web UI: Multithreaded WASM via WebWorkers
**Current State:** 
The native Tauri app utilizes Rust's `Rayon` to effortlessly process 30 files concurrently across all CPU cores. The Web version, however, loops over the `pendingWavFiles` array and calls the WASM engine sequentially on the main UI thread. While `await setTimeout(resolve, 0)` prevents total browser lockup, the heavy DSP work still chokes the main thread.

**Optimization / Alignment Action:**
*   Move the WASM initialization and the `analyze_audio_buffer` loop into a standard HTML5 **WebWorker** (or a pool of multiple WebWorkers). 
*   This will allow the Web version to analyze multiple files concurrently (just like Rayon does natively) and keep the React UI butter-smooth while the browser chews through hundreds of audio files in the background.

## 3. Taxonomy De-Duplication (Trusting Rust)
**Current State:** 
The Rust backend has highly sophisticated taxonomy logic (`categorize.rs`, `timbre.rs`, `god.rs`, `ucs.rs`) for classifying sounds based on names, paths, and DSP data. However, the React frontend (`audioAnalysis.ts`, `groupColors.ts`) still contains some duplicated, manual JS-based string-matching arrays to determine things like `God Category` or `Timbre`.

**Optimization / Alignment Action:**
*   Strip out the JS-side string classification. The `.PEAK` JSON emitted by both the Rust backend and the WASM engine already contains the definitive `group`, `subgroup`, `timbre`, `god_category`, and `ucs_category`. 
*   Relying 100% on the backend payload will reduce the React bundle size and guarantee that a file analyzed on the Web gets the exact same color and shape as a file analyzed on Desktop.

## 4. Web File System Access: Sidecar Caching
**Current State:** 
When running natively via Tauri, the engine writes `.PEAK` sidecar files right next to the original `.wav` files. This allows instant re-scans via caching. The Web version can *read* these sidecars (absorbing them to skip work), but it currently doesn't *write* new ones back to the local folder.

**Optimization / Alignment Action:**
*   In `App.tsx`, we can request `mode: 'readwrite'` permission from the File System Access API when the user picks a directory.
*   Once granted, the Web version can seamlessly write the `.PEAK` sidecars back to the user's hard drive as it analyzes them. This completely aligns the Web app's caching behavior with the Native app, meaning users who scan via the browser permanently speed up their folders for future sessions (or for the Desktop app).
