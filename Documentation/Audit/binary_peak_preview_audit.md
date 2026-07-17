# Audit — instant long-file previews: a binary peak map inside the `.PEAK`

**Ask:** really long files are painful to load. Before a long file is displayed there should be
a fast wasm/native analysis producing a **binary peak map** stored **in the `.PEAK` sidecar**,
so the UI can paint the waveform instantly and the analyzer "does not take a bunch of time to
really think about it." Research the best technique to read the peak file, append the binary
peak data, store it, and then load it for preview — and the best way to make reads fast and the
stored data small.

This is a research/design audit. Nothing here is built yet.

---

## 1. Where long files actually stall (measured in code)

Three separate chokepoints compound:

| # | Chokepoint | Where | Effect on a 1-hour file |
|---|---|---|---|
| 1 | **The analyzer skips long files entirely.** `if length > max_len { return None; }` with `max_len` hardcoded to **600 s** on both paths | `analyze.rs:38-40`, native `lib.rs:268`, wasm `wasm_analyzer/lib.rs:28` | no sidecar, no record, invisible to the library |
| 2 | **Full DSP is O(minutes) on long audio.** STFT + MFCC + pitch + envelope over the whole PCM — the very reason `max_len` exists ("to prevent hangs") | `analyze_core` (`analyze.rs`) | tens of seconds to minutes per file if the cap were lifted naively |
| 3 | **The display path decodes the whole file before one pixel.** Select → fetch bytes → `decodeAudioData` (whole file) → `toMono` → draw | `ExaminerTab.tsx` (loadSelected), `ExtractorTab.tsx` (setupAudioAndDetect), `AudioEye.tsx` | ~690 MB of Float32 PCM allocated and scanned just to draw a 1000-px waveform; seconds of freeze, decode-timeout fallbacks firing |

The key observation for #3: **playback never needed the decode** — the `<audio>` element
streams. The full decode exists only to *draw* (and, on the Extractor's web path, to detect
regions). A precomputed peak map removes the decode from the paint path entirely.

---

## 2. Prior art — how everyone else solved exactly this

| System | Storage | Encoding | Resolution | Lesson |
|---|---|---|---|---|
| **EBU Tech 3285 suppl. 3 — BWF `levl` Peak Envelope Chunk** | binary chunk inside the WAV | `formatVersion`, `pointsPerValue` (1 = max, 2 = **min+max**), `blockSize` (samples per point, default 256), `peakOfPeaks` | fixed samples-per-point | the broadcast-industry standard is *min/max pairs at a fixed block size, stored with the asset* |
| **BBC `audiowaveform` `.dat`** (consumed by Peaks.js) | sidecar binary file | little-endian **signed 8-bit or 16-bit min/max pairs**, header carries version + samples-per-pixel; **8-bit is the default** | fixed samples-per-pixel (256/512/…) | 8-bit min/max is the accepted fidelity for UI waveforms; the web's de-facto format |
| **Audacity `.aup3` summaries** | per-clip cache in the project DB | float summaries at **two mip levels: per-256 samples and per-65536 samples** | pyramid | deep zooming wants a second, finer level — but only deep zooming |
| **wavesurfer.js / SoundCloud** | precomputed peaks JSON served next to the stream | plain JSON number arrays | fixed column count | works, but JSON number arrays are the *bloatiest* possible encoding (§4) |

Convergent design across all of them: **interleaved min/max peak pairs, fixed
samples-per-bin, 8 bits per value, stored with the asset it describes.** That is the shape to
adopt.

---

## 3. Decision — where to store it: inside the `.PEAK`, as one base64 field

The question "read the peak file, append the binary data, store, then load" has three candidate
homes for the binary:

| Option | Reads per selection | Verdict |
|---|---|---|
| **A. Inside the `.PEAK` JSON** as a base64 field | **0 extra** — rides the sidecar read that already happens | ✓ **chosen** |
| B. A second binary sidecar (`.PEAKWAVE`) | +1 file open per selection; +40 k files in a big library; new FSA/Tauri/read paths; two files to keep atomic | ✗ |
| C. Inside the audio file (BWF `levl`) | 0 extra, but **writes into the user's audio**, WAV-only, and re-writes gigabyte files to add a chunk | ✗ rejected outright |

Option A wins on the project's own economics: **the expensive unit of IO in this app is the
file open, not the bytes.** A 40 k-file library already fights handle counts (the manifest
exists precisely to avoid 40 k sidecar reads at startup). The preview must not add a single
new open. And it doesn't have to — two facts make A free:

- **On selection, the full record is already fetched.** The Examiner upgrades a slim row to
  the complete `.PEAK` on select (`read_full_record` on desktop, the in-memory record on web).
  The preview rides that exact read.
- **The manifest stays slim.** `projectSlim()` (`manifest.ts`) simply does not copy the
  `preview` section, so startup cost is untouched — the preview costs bytes only where it is
  used.

JSON-embedding costs base64's +33 % on data measured in tens of kilobytes — noise next to a
second file-open per selection, and the record stays **one atomic unit**: schema-versioned,
migrated by `normalizePeakRecords` untouched (unknown sections pass through), copied/synced as
one file.

## 4. Decision — encoding: signed 8-bit interleaved min/max, base64

**Per-value width.** The waveform canvases are ≤ ~400 px tall, so each half-wave has ≤ ~200
addressable pixels; 8-bit signed gives 127 levels per side — beyond the visual threshold
(`audiowaveform`'s default for the same reason). 16-bit doubles every cost for zero visible
gain. **8-bit.**

**Pair shape.** Store `min, max` interleaved per bin (BWF `pointsPerValue = 2`), signed. Audio
is asymmetric; max-only halves the size but flattens DC-offset and envelope character the eye
actually uses.

**Text encoding inside JSON**, for 16 384 bins (32 768 values):

| Encoding | Bytes | Parse cost |
|---|---|---|
| JSON number array (`[-31,42,…]`) | ~120–190 KB | slowest — 32 k number tokens through `JSON.parse` |
| hex string | 65 KB | one pass, 2× size |
| **base64 string** | **~43 KB** | one `atob` + one typed-array fill — sub-millisecond |
| separate raw binary | 32 KB | needs option B's second file — rejected above |

**Compression: skip it.** Peak data is near-noise; deflate wins ~10–15 % on real material and
adds an inflate dependency plus a failure mode to every reader (three of them: web, desktop,
Python tooling). The whole field is ≤ 43 KB — not worth a dependency.

**Decode on the web** is `Uint8Array.from(atob(s), c => c.charCodeAt(0))` then a zero-copy
`Int8Array` view — microseconds. The dominant cost of reading a `.PEAK` remains `JSON.parse`
of the record itself, which selection already pays today.

## 5. Decision — resolution: adaptive samples-per-bin, capped bins

Fixed *bin count* wastes resolution on short files and starves long ones when zoomed; fixed
*samples-per-bin* explodes bin counts on hour-long files. The standard resolution policy:

```
samples_per_bin = smallest power of two such that bin_count = ceil(samples / samples_per_bin) ≤ 16384
                  (floor at 256)
```

| File @ 48 kHz | samples_per_bin | bins | raw | base64 |
|---|---|---|---|---|
| 5 s one-shot | 256 | 938 | 1.9 KB | 2.5 KB |
| 6 min song | 1 024 | 16 875→cap→2 048 | 8 KB* | 10.7 KB |
| 1 hour | 16 384 | 10 547 | 21 KB | 28 KB |
| 4 hours | 65 536 | 10 547 | 21 KB | 28 KB |

*\*after choosing the next power of two that fits the cap.*

Properties: every file costs **≤ ~43 KB** in its sidecar regardless of length; a 1000-px
overview always has ≥ 2 bins per pixel (anti-aliased min/max, not samples); and per-bin time
resolution stays useful (0.34 s/bin at one hour — the *overview* of an hour can't show less
anyway). **Pyramid (a second, finer level à la Audacity) is deliberately deferred**: the
Extractor's deep zoom swaps to real PCM once the background decode lands (§7), which is a
better fine level than any stored one. The schema's `preview_version` leaves the door open.

## 6. Decision — long files stop being skipped: tiered analysis depth

This is the "analyzer shouldn't really think about it" half. Replace the silent
`> 600 s → None` skip with two depths:

- **≤ 600 s — unchanged.** Full DSP, exactly today's pipeline, plus the preview computed in
  the same pass (the PCM is already in memory; min/max folding is one O(n) scan — measured
  noise next to the STFT).
- **> 600 s — `preview_only`.** A record with real `metadata` (name/path/length/format), the
  **preview**, and the cheap single-pass amplitude numbers (peak, RMS, crest) that fall out of
  the same fold. No STFT, no MFCC, no pitch, no UCS scoring — `classification` marks it
  unclassified and a new full-English field records the depth:

  ```json
  "metadata": { ..., "analysis_depth": "preview_only" }
  ```

  so a future "deep-analyze this file" action (or a raised cap) can find and upgrade them.
  Crucially the long file now **exists** — it lists, it plays, it draws instantly.

**Streaming, not slurping.** `analyze()` currently decodes the *entire* file into a mono
`Vec<f32>` before anything runs (`decode.rs`). For `preview_only` that allocation is the hang:
an hour of 48 kHz mono is 690 MB. The symphonia packet loop in `decode.rs` already visits
samples packet-by-packet — the preview fold consumes each packet and **never materializes the
PCM**: constant memory (one bin's running min/max + the bin array), single pass, IO-bound.
The wasm build gets the same fold over its buffer (cheap; wasm has the buffer in memory
anyway). Per the workflow rule: **edit both `analyze()` and `analyze_buffer()`, then rebuild
wasm-pack.**

## 7. The three paths: write, append (backfill), read

### Write — new scans
`analyze_core` computes the fold and attaches:

```json
"preview": {
  "preview_version": 1,
  "samples_per_bin": 16384,
  "bin_count": 10547,
  "bits_per_value": 8,
  "channel_mode": "mono_mixdown",
  "peak_data_base64": "…"
}
```

(Full-English field names, version-stamped — house rules. `channel_mode` names the mixdown so
a future stereo preview is a new mode, not a guess.)

### Append — backfilling an already-scanned library
"Read the peak file, append the binary peak data, store" — as a pass that never re-analyzes:

1. Walk the library's sidecars (the `build_manifest` walk already exists as the template).
2. Skip records that already carry a current `preview`.
3. Streaming-decode the *audio* once (the §6 fold — no DSP).
4. **Read the sidecar as `serde_json::Value`, not as the typed `Peak` struct** — a typed
   round-trip silently *drops any field this binary doesn't know*, which would eat data from
   sidecars written by newer analyzers. Value-merge sets `preview` and touches nothing else.
5. **Write temp-then-rename** (`.PEAK.tmp` → atomic rename). Never truncate-in-place: a crash
   mid-write must not destroy a record. This is also the right pattern for `favorites.json`-
   style small writes generally.
6. Refresh the manifest afterward (rebuildable cache — regenerating it is the designed move).

Exposed as a Tauri command (`backfill_previews(directory)`) with progress events like
`start_analysis`; on web, the same loop rides the existing worker scan machinery ("absorb +
upgrade" mode). Note the asymmetry: **backfill decodes audio but skips DSP**, so it runs at
IO speed — a 40 k library backfills in roughly the time a plain read of the audio takes.

### Read — the instant paint
On selection (any tab):

1. The record (already fetched today) carries `preview` → base64-decode to `Int8Array`
   (microseconds).
2. **Draw min/max columns directly.** The linear waveform (`drawWaveform`) computes per-column
   min/max *from raw samples* today — a `drawPeakMap` twin takes the bins as-is and maps bin
   range → column range. Same visual, zero PCM. The radial eye gets the same adapter (bins →
   ring spokes).
3. Playback starts immediately — the `<audio>` element streams; it never needed PCM.
4. The full decode **demotes to a background upgrade**: kick it off after first paint; when it
   lands, swap the waveform to live-PCM rendering (enables deep zoom, spectrogram layers,
   web-path region detect). Selection-generation guards already exist (`loadGenRef`) and apply
   unchanged.
5. No `preview` in the record (old sidecar, `preview_only` impossible)? Exactly today's path —
   decode-then-draw. The feature is purely additive; `normalizePeakRecords` needs no change
   beyond passing the section through (it already passes unknown sections).

Perceived result: selecting an hour-long file paints its waveform in the **next frame** and
audio starts streaming; today it freezes for the full decode (or times out into fallbacks).

---

## 8. The efficiency ledger (the "small data" answer, summarized)

| Cost | Today | With preview |
|---|---|---|
| Extra file opens | — | **zero** (rides existing sidecar reads) |
| Startup / manifest size | slim | **unchanged** (`projectSlim` excludes preview) |
| Sidecar size | ~15–40 KB typical | +2.5–43 KB, only proportionally large on tiny one-shots (where decode was never slow) — consider gating preview to files > ~30 s if sidecar bloat on one-shots matters |
| Paint after select (1 h file) | seconds (full decode) | **~1 frame** (µs base64 + ms draw) |
| Memory to draw (1 h file) | ~690 MB transient PCM | **≤ 32 KB** |
| Analyzer time on long files | skipped entirely | **IO-bound single pass**, constant memory |
| New failure modes | — | none on read (missing/foreign preview → today's path) |

The two principles doing all the work: **piggyback small data on reads you already pay for**
(never a new file open), and **store at the fidelity of the consumer** (8-bit min/max is what
a ≤ 400 px canvas can show — everything above that is decode-time, not information).

## 9. Implementation map

| Where | Change |
|---|---|
| `sample_analyzer_rs/src/Core/peak.rs` | `Preview` struct (`#[serde(default)]`, full-English fields) on `Peak` |
| `sample_analyzer_rs` (new `preview.rs`) | the streaming min/max fold: from packets (native) or a slice (wasm); base64 encode |
| `analyze.rs` — **both** `analyze()` and `analyze_buffer()` | attach preview in `analyze_core`; replace the `> max_len → None` skip with the `preview_only` tier |
| `wasm_analyzer` | rebuild (wasm-pack) after the above |
| `src-tauri/lib.rs` | `backfill_previews(directory)` command (walk + fold + Value-merge + temp-rename), progress events |
| `Web_Front/src/peakSchema.ts` | pass `preview` through normalization; type it |
| `Web_Front/src` (new `peakPreview.ts`) | base64 → `Int8Array` decode + bin-range → column mapping helpers |
| `drawWaveform.ts` / `drawRadialWaveform.ts` | bins-direct variants (`drawPeakMap`, ring adapter) |
| `ExaminerTab` / `ExtractorTab` / `AudioEye` | paint from preview first; demote full decode to a background upgrade behind the existing generation guards |
| `manifest.ts` / `manifest.rs` | explicitly *no* change (preview excluded from slim rows) — assert in review |

## 10. Verification plan (when built)

Synthesize a long WAV (e.g. 20 min of tone + noise bursts via `Sample_Conversion_rs` or a
script), scan it: sidecar gains `preview` with correct `bin_count`/`samples_per_bin`; record
exists despite > 600 s with `analysis_depth: "preview_only"`. Headless drive (per
`Web_Front/.claude/skills/verify/SKILL.md`): select the long file in Examiner — waveform pixels
present within one animation frame (screenshot diff before decode completes), audio plays,
no decode-timeout console warnings; Extractor draws the overview instantly. Backfill: strip
`preview` from a sidecar, run `backfill_previews`, confirm the field returns, all other fields
byte-identical (the Value-merge guarantee), and a mid-write kill leaves the original intact
(temp-rename guarantee). Fidelity: A/B screenshot 8-bit preview vs full-decode waveform at
canvas height — visually identical.

---

*Companion visual: `binary_peak_preview_audit.html` (this folder). Audit date 2026-07-16;
grounded in `analyze.rs`, `decode.rs`, `wasm_analyzer/lib.rs`, `src-tauri/lib.rs`,
`ExaminerTab.tsx`, `ExtractorTab.tsx`, `manifest.ts`, `peakSchema.ts` as of this date. Prior
art: EBU Tech 3285 supplement 3 (BWF peak envelope), BBC audiowaveform / Peaks.js, Audacity
summary caches.*
