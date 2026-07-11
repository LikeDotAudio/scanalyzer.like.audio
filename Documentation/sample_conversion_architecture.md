# Architecture: `Sample_Conversion_rs` Integration

This document outlines the components and architecture required to integrate a high-performance audio conversion engine (written in Rust) into the existing Python "Rename / Flatten" tab. The engine will handle format conversion (WAV/FLAC), channel mixing (Mono/Stereo/Preserve), and high-quality sample rate conversion.

## 1. Python Frontend Updates (`support/rename_tab.py`)

The existing flattening and renaming logic will act as the "Job Builder". 

**UI Additions:**
*   **Format Options:** `[Radio Buttons] WAV | FLAC`
*   **Channel Options:** `[Radio Buttons] Preserve | Mono (Mixdown) | Stereo`
*   **Sample Rate Options:** `[Dropdown] Preserve | 44,100 Hz | 48,000 Hz | 88,200 Hz | 96,000 Hz`

**Job Execution:**
Instead of copying files sequentially using Python's `shutil.copy2`, the Python app will construct a batch job payload. Once the user clicks "Execute", Python will generate a temporary file (e.g., `job_manifest.json`) containing an array of conversion tasks:
```json
[
  {
    "source_path": "/path/to/original/01 Ibo 01.wav",
    "target_path": "/path/to/flattened/destination/01 Ibo 01.flac",
    "target_format": "FLAC",
    "target_channels": "Mono",
    "target_sample_rate": 44100
  }
]
```

## 2. IPC (Inter-Process Communication)

Python will spawn the Rust executable as a subprocess:
```python
process = subprocess.Popen(
    ["./Sample_Conversion_rs/target/release/sample_conversion", "job_manifest.json"],
    stdout=subprocess.PIPE,
    text=True
)
```
The Rust application will print structural JSON messages to `stdout` as it processes files. Python will read these lines in a background thread and update a `ttk.Progressbar` and status label in real-time without freezing the UI.

## 3. Rust Backend (`Sample_Conversion_rs`)

A completely independent Rust application dedicated to heavy DSP (Digital Signal Processing).

### Required Crates (Dependencies)
*   **`serde` / `serde_json`**: To parse the job manifest provided by Python.
*   **`rayon`**: For lightning-fast multithreading. It will allow the engine to process multiple audio files simultaneously across all CPU cores.
*   **`symphonia`**: A pure Rust audio decoding library. It will cleanly read the incoming WAV files, handling different bit depths (16-bit, 24-bit, 32-bit float) and extracting the raw PCM samples.
*   **`rubato`**: A state-of-the-art asynchronous resampler. If the user requests a sample rate conversion (e.g., 48kHz to 44.1kHz), `rubato` provides high-quality Sinc interpolation to prevent aliasing and frequency artifacts.
*   **`hound`**: To encode and write the final output if the user selects WAV.
*   **`flacenc`** (or `flac-sys`): To encode and write the final output if the user selects FLAC, natively handling the FLAC framing and Vorbis comment metadata injection.

### The DSP Pipeline (Per File)
1.  **Read**: `symphonia` decodes the source file into a vector of floating-point audio samples.
2.  **Channel Matrixing**: 
    *   If `Stereo -> Mono`: Average the left and right channels `(L + R) / 2.0`.
    *   If `Mono -> Stereo`: Duplicate the mono channel to both L and R.
3.  **Resampling**: If the source sample rate does not match the target, pass the sample buffer through `rubato`.
4.  **Write**: Encode the processed floating-point buffer back into integers (16-bit or 24-bit) and write to disk using `hound` (WAV) or `flacenc` (FLAC).

## 4. Why Rust for this?
Writing this in Rust rather than Python has massive benefits for your use case:
*   **Speed**: Resampling audio in Python using `scipy` or `librosa` is extremely slow and single-threaded by default. Rust with `rayon` will rip through thousands of samples in seconds.
*   **Quality**: Relying on external tools like `sox` or basic Python resamplers can introduce aliasing. `rubato` is highly regarded in the DSP community for maintaining pristine audio quality.
*   **Safety**: Rust eliminates the risk of memory leaks or hanging threads during massive batch processing jobs.
