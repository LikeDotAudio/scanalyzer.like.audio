# Music Samples Codec Audit & Recommendation Report

## 1. Current State Audit
Audit of the library at `/home/anthony/Documents/Music Samples`.

*   **File Formats**: Uncompressed **WAV** (PCM). Extensions are inconsistently cased — a mix
    of `.wav` and `.WAV`.
*   **Sample Rates & Bit Depths**: Sampled files are 16-bit PCM stereo at mixed sample rates
    (`44100 Hz` and `48000 Hz`).
*   **Embedded WAV metadata**: Two kinds, and they matter differently:
    *   **Tags** — RIFF `INFO`/`LIST` fields and (on some files) Broadcast-WAV `bext` (artist,
        copyright, description). These are text and portable.
    *   **Sampler chunks** — `smpl` (loop points/root key), `cue` (markers), and Acidized
        **`acid`** (tempo/beat/root). These are *not* tags; they are binary chunks a sampler
        or DAW reads to auto-map loops and time-stretch. **This project's own analyzer reads
        the `acid` chunk** (`sample_analyzer_rs/.../acid.rs`) to recover BPM and root note.
*   **`.PEAK` files — READ THIS BEFORE DELETING ANYTHING**: These are **not** DAW waveform
    caches. They are **this analyzer's own analysis sidecars** — one JSON record per audio
    file (`<sample>.PEAK` beside `<sample>.wav`), written by the Scanalyzer, containing the
    full DSP analysis: `metadata` (incl. `analyzer_version`, `source_format`, `lossy_source`),
    `classification`, `envelope`, `spectral_features`, `musicality`, `unsupervised`, `ucs`,
    and detected `regions`. **They do not regenerate silently** — recreating one means
    re-running the analyzer (a full DSP pass) on the file. Deleting them discards your
    analysis library, which is the entire point of this toolchain.

## 2. The Goal
Save space and normalize the file format **without altering the audio data** — essential for
production samples.

**Lossy codecs (MP3, AAC, Opus) must be avoided.** They discard high-frequency content and add
artifacts that are inaudible in a finished mix but become obvious once a sample is
pitch-shifted, time-stretched, or heavily compressed/distorted in a DAW. (This toolchain even
flags lossy files with a `lossy_source` bit and *relaxes its brightness/clipping gates* for
them, precisely because their spectra can't be trusted — see `ucs.rs LOSSY_UNRELIABLE`. Keeping
the library lossless keeps every measurement trustworthy.)

## 3. Recommendation: FLAC (Free Lossless Audio Codec)
FLAC is the right choice for archiving and standardizing a sample library, and it is fully
compatible with this analyzer.

### Lossless — bit-for-bit identical audio
FLAC is lossless compression (a ZIP tuned for audio): decoded, it reconstructs the **exact**
original PCM stream. Sample rate and bit depth are preserved. This analyzer decodes FLAC
natively (via symphonia) and records `source_format: "FLAC"` with **`lossy_source: false`**, so
FLAC files are analyzed with the same full confidence as WAV — no relaxed gates.

### Space savings (typically 30–50%)
Expect roughly 30–50% smaller files across a large library — less on dense, noisy, or
already-loud-mastered material, more on sparse one-shots and transient content. Use
`-compression_level 8` for the best ratio (decode speed is unaffected).

### Format normalization
Converting yields a single, consistent `.flac` extension, ending the `.wav`/`.WAV` casing mess.

### Metadata — good, with one real caveat
FLAC uses Vorbis comments, which are cleaner and easier to extend than WAV's RIFF `INFO` tags
(note: WAV tags are RIFF/BWF chunks, **not** ID3 — ID3 is an MP3 thing). Text tags (artist,
copyright, description) carry over with `-map_metadata 0`.

**Caveat that matters for a sample library:** the binary **sampler chunks** — `smpl` loop
points, `cue` markers, and the Acidized `acid` tempo chunk — are **not** tags and are **not**
carried across by a plain `ffmpeg` WAV→FLAC conversion. Losing them means samplers no longer
auto-find loop points, and **this analyzer's `acid`-chunk BPM/root path goes dark** for those
files (it falls back to estimated BPM). If your loops rely on embedded loop/tempo data, either
preserve it deliberately (see below) or accept that re-analysis will estimate it instead.

### Universal DAW compatibility
Ableton Live, FL Studio, Logic Pro, Reaper, and Bitwig all import FLAC natively and treat it
like WAV on the timeline.

## 4. Next Steps & Cleanup — the safe procedure
FLAC is the right target, but the conversion has to protect (a) the audio, (b) the `.PEAK`
analysis sidecars, and (c) the sampler/loop metadata. Do it in this order — **nothing is
deleted until it's verified.**

**Step 1 — Convert, keeping originals in place.** Batch `ffmpeg`, max compression, copy text
metadata:
```bash
find "/home/anthony/Documents/Music Samples" -type f -iname '*.wav' -print0 |
while IFS= read -r -d '' f; do
  ffmpeg -nostdin -v error -i "$f" -c:a flac -compression_level 8 \
         -map_metadata 0 "${f%.*}.flac"
done
```
*(Preserving loop/cue/`acid` chunks is not something `ffmpeg` does for FLAC. If those matter,
convert those files with a sampler-aware tool, or keep the WAV originals of your loops.)*

**Step 2 — Verify bit-exactness before trusting anything.** Compare the *decoded* PCM of each
pair; the MD5s must match:
```bash
diff <(ffmpeg -v error -i in.wav  -f md5 -) \
     <(ffmpeg -v error -i out.flac -f md5 -)   # identical → lossless, confirmed
```
Only files that pass this are safe to reclaim.

**Step 3 — Re-link the analysis. Do NOT bulk-delete `.PEAK` files.** Each existing sidecar
still records `name`/`path` ending in `.wav` and `source_format: "WAV"`, so after conversion it
points at a file that no longer exists — the analysis is *orphaned*, not wrong. Two options:
*   **Re-analyze the FLACs** (recommended). Because FLAC is lossless, the audio — and therefore
    the analysis — is identical, so re-running the Scanalyzer regenerates correct sidecars
    (`source_format: "FLAC"`, right names) with no loss of fidelity. The sidecar filename rule
    is `<basename>.PEAK`, which is unchanged by the extension swap, so old sidecars are simply
    overwritten in place.
*   **Or patch the sidecars** — rewrite `metadata.name`/`path` to `.flac` and `source_format`
    to `"FLAC"` — if you want to avoid a re-scan. (Re-analysis is safer and also refreshes any
    `acid`-derived BPM that the conversion dropped.)

**Step 4 — Reclaim space, last.** Only after Steps 2–3 pass, delete the verified WAV originals.
**Leave the `.PEAK` files** — they are your analysis library, they cost real compute to
rebuild, and nothing regenerates them for you.

---

*Correction note: an earlier draft described `.PEAK` files as disposable DAW waveform caches
that "regenerate silently" and recommended deleting them. That is incorrect for this
environment — they are this analyzer's analysis sidecars. This report supersedes that advice.*
