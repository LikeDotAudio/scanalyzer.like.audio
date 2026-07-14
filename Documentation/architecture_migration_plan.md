# Architecture Migration Audit & Plan

## 1. Background and Motivation
The previous architecture for the Sample Analyzer relied on a Python-based GUI (`main.py`) using Tkinter and Matplotlib for 3D visualization, which coordinated with a Rust binary (`oa_sample_analyzer`) for heavy DSP tasks. Recently, instability and crashes were encountered within the Python application (`main.py` and `support/__pycache__`). 

To address these stability issues and provide a more robust, performant, and modern user experience, the decision was made to transition the application entirely away from Python.

## 2. The New Architecture
The new architecture leverages **Tauri**, providing a lightweight, native desktop application:
- **Frontend**: The existing React-based `Web_Front` is being recycled. It provides a far superior UI/UX compared to Tkinter and uses modern web technologies (React, Three.js for 3D rendering).
- **Backend (Rust)**: Instead of compiling the analysis engine to WebAssembly (`wasm_analyzer`) and running it in the browser, the application now maps directly to native Rust. Tauri acts as the bridge, spawning the highly-optimized `oa_sample_analyzer` binary directly on the host machine.

## 3. Audit of Changes Completed
To achieve this transition, the following steps were executed in the `Web_Front` directory:

*   **Removal of WASM Dependencies**: 
    *   Deleted the `wasm_analyzer` directory.
    *   Removed `wasm_analyzer` from `package.json` dependencies.
*   **React Frontend Overhaul (`ScanalyzeTab.tsx`)**:
    *   Stripped out all `initWasm` and `analyze_audio_buffer` logic.
    *   Replaced the scanning loop with Tauri API calls. The UI now invokes the native Rust backend (`invoke('start_analysis')`) and listens for real-time `analyzer-progress` and `analyzer-finished` events.
    *   Merged and streamlined duplicate components (e.g., removing `TauriScan.tsx`).
*   **Tauri Backend Enhancements (`src-tauri/src/lib.rs`)**:
    *   Retained the `start_analysis` command, which orchestrates the `oa_sample_analyzer` binary and streams stdout to the frontend.
    *   Added a secure `read_peak_file` command. This ensures the React frontend can reliably read the generated `.PEAK` JSON data directly from the host filesystem without relying on restrictive browser-based file APIs or the `asset://` protocol.
*   **Codebase Cleanup**:
    *   Resolved TypeScript warnings and unused variables across components (`ExaminerTab.tsx`, `StatsTab.tsx`).
    *   Confirmed a successful, error-free React production build (`npm run build`).

## 4. Next Steps
To finalize the migration, the following actions are recommended:

1.  **Environment Setup**: Ensure all required GTK/Tauri development dependencies (e.g., `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`) are installed on the host Linux machine to allow `cargo build` and `npm run tauri dev` to compile the native app.
2.  **End-to-End Testing**: Run the Tauri desktop app, select a folder of `.wav` files, and verify that the 3D Cloud and 2D Stats tabs render the `.PEAK` data correctly and performantly.
3.  **Legacy Cleanup**: Once the Tauri app is confirmed fully operational, permanently delete the deprecated Python GUI files (`main.py`, `run.sh`, and the `support/` directory) to reduce repository clutter.
