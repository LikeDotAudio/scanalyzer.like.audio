# scanalyzer.like.audio

A self-contained audio-sample analyzer and file-management tool.

### The Elevator Pitch
At its core, **scanalyzer** is a smart, automated librarian for your audio files. If you have a massive, unorganized folder full of thousands of random audio samples, finding the exact sound you need can be a nightmare. This software "listens" to every single file, figures out what it actually sounds like, and visually organizes your entire collection so you can browse it instantly.

> Stop digging through endless folders named "Kick_Final_v3_really_final.wav". 🛑
> 
> **scanalyzer.like.audio** actually *listens* to your audio samples, figures out what they are, and organizes your entire library into an interactive 3D cloud. Find the perfect sound in seconds, not hours. 100% private, 100% local. 🚀🎧
> 
> Get your library in check. 👇 
> #MusicProduction #SoundDesign #BeatMaker #AudioEngineer #ProducerLife #MusicTech #SampleLibrary

It ships as **two front-ends over one shared Rust DSP core** — a Python desktop
GUI and a browser app — so the exact same analysis runs whether you launch the
native app or open the web page:

```
                    ┌─────────────────────────────┐
   Python desktop → │   Rust DSP core             │ ← Browser app (WebAssembly)
   (main.py + Tk)   │   sample_analyzer_rs         │   (Web_Front, React + Vite)
                    │   (one engine, both targets) │
                    └─────────────────────────────┘
```

- The **Python GUI** shells out to the native `oa_sample_analyzer` binary.
- The **browser app** runs the *same* core compiled to WebAssembly
  (`Web_Front/wasm_analyzer`, a thin `wasm-bindgen` wrapper around
  `oa-sample-analyzer`) — entirely client-side, nothing uploaded.
- Both read and write the identical **`.PEAK`** JSON format, so an analysis
  produced by one opens in the other.

```
Sample Analysis/
├── sample_analyzer_rs/    # ── THE CORE ── Rust DSP engine (shared by both front-ends)
│   └── target/release/oa_sample_analyzer     # native binary (desktop)
│
├── main.py                # Python desktop GUI shell (tabs live in support/)
├── support/               # one module per GUI tab + config, theme, shared inspector
├── graphing_rs/           # Rust 3D-cloud placement engine (desktop)
├── Sample_Conversion_rs/  # Rust sample-format conversion helper
├── run.sh                 # desktop launcher: builds the Rust crates, opens the GUI
│
└── Web_Front/             # Browser app (React + Vite) — 100% client-side
    ├── wasm_analyzer/      # the CORE compiled to WebAssembly (wasm-bindgen wrapper)
    └── src/                # React UI: Scanalize / 3D Cloud / Stats / Groups / Examiner / Rename
```

## Run — desktop (Python)

```bash
./run.sh          # or:  python3 main.py
```

Requires: Python 3 with `numpy` + `matplotlib` (Tk backend), a Rust toolchain
(`cargo`) for the first build, and an audio player for previews
(`paplay`/`aplay`/`ffplay` on Linux, built-in on macOS/Windows).

CLI (what the GUI runs for you):

```bash
oa_sample_analyzer <dir> [--out <path>] [--workers <n>] [--max-len <s>]
                         [--clusters <k>] [--no-per-file] [--force]
```

## Run — browser (Web_Front)

```bash
cd Web_Front
npm install
npm run dev       # local dev server;  npm run build  → static bundle in dist/
```

Requires: Node 18+. Rebuilding the WASM core needs a Rust toolchain plus
`wasm-pack` (`wasm-pack build Web_Front/wasm_analyzer --target web`); the
committed `wasm_analyzer/pkg` lets you run the app without that step.

The browser app is **fully client-side** — no server does any work, and no data
ever leaves the machine (see `Web_Front/src` and the `client-side-only` design
note). It reads local folders through the File System Access API, runs the
WASM DSP core in a Web Worker-free main pass, and never uploads anything.

---

## The pipeline

The Python GUI is only the front-end. All signal processing happens in the
Rust binary, which walks the chosen folder for WAV files and analyzes them in
parallel (default 30 worker threads), streaming one JSON line per file so the
3D cloud fills in live. Per file, the order is deliberate:

1. **Decode** the audio.
2. **Measure** everything from the samples alone (time, spectrum, envelope,
   pitch, partials, distortion).
3. **Classify blind** — acoustic types and sound-design roles from the
   measurements only.
4. **The file name is the LAST step** — only after all acoustic evidence is
   in does the path/name get consulted, to lay the curated taxonomy (group,
   subgroup, family, god category) on top. If the name is completely ambiguous
   ("Unclassified"), the system leans entirely on the computed acoustic instrument
   family to definitively assign a group (e.g., Idiophone → Percussion).
5. After all files: **K-Means clustering** and a **PCA embedding** over the
   whole set.
6. **Write** per-file `<sample>.PEAK` sidecars plus the aggregate
   `sample_cloud_data.PEAK` in the analyzed folder.

### Version-stamped skip (incremental re-analysis)

Every compile of the Rust crate hashes all of `src/*.rs` (FNV-1a, via
`build.rs`) into an `analyzer_version` such as `0.1.0+38d2883735817901`, and
every record carries it. Before analyzing a file the binary reads the existing
`<sample>.PEAK` sidecar: if it parses, its `analyzer_version` matches the
running binary, and it names the same file, the record is **reused and the DSP
skipped entirely** — identical code yields identical results by definition.
Any change to the extractor source produces a new hash and invalidates old
sidecars automatically. `--force` re-analyzes regardless. Sidecars are written
incrementally during the run, so a stopped/killed run resumes where it left
off. (Clustering and PCA are global, so they are always recomputed.)

---

## The measurements, and the math

### Decode (`wav.rs`)

The WAV is decoded to mono `f32`: integer PCM is divided by its full-scale
value (2⁷, 2¹⁵, 2²³, 2³¹), multi-channel frames are averaged down. Sample
rate, bit depth, and channel count are kept as metadata. Files longer than
`--max-len` (default 10 s) are skipped — this is a *sample* analyzer.

### Time-domain amplitude (`amplitude.rs`)

One pass over the samples `x[n]`, N total, at rate `sr`:

- **Root-mean-square level** — `RMS = √(Σ x²/N)` — overall loudness.
- **Crest factor** — `C = |x|max / RMS` — spiky one-shots score high (a pure
  sine is 1.41); sustained or dynamically squashed material scores low. This
  is also the first distortion metric: clipping chops the peaks off, so
  heavily distorted audio looks like a solid block and its crest collapses.
- **Attack seconds** — `argmax|x| / sr`, time to the loudest sample.
- **Zero crossings per second** — sign changes ÷ duration; noisy or bright
  content crosses often, smooth low tones rarely.

### Transient counting (`transients.rs`)

The signal is reduced to a ~16 ms RMS envelope, peak-normalized and smoothed
with a 3-tap mean. A **prominence** rule then counts attacks: each rise to a
local peak counts only if it climbs at least 0.18 (of full scale) above the
valley preceding it *and* reaches at least 0.12. So a re-attack in a loop
counts, but envelope ripple on a held note does not. A clean one-shot yields
1; a rhythmic loop yields many. `transient_count > 1` is one of the loop
signals.

### Sustain ratio (`sustain.rs`)

Fraction of ~16 ms envelope frames at or above 50 % of the envelope's peak:
≈1 for a drone or pad held the whole file, ≈0 for a hit that decays at once.

### ADSR envelope (`envelope.rs`)

How a sound behaves over time is as much of its identity as its pitch. A
recorded one-shot has no note-off, so the synthesizer ADSR is *estimated*
from a ~5 ms RMS envelope (3-tap smoothed, peak `P`). The segmentation is
anchored at the first frame reaching 95 % of `P` (the literal argmax of a
held tone is just ripple and can sit at the end of the file):

- **envelope_attack_seconds** — time from the first 10 %·P crossing to the
  first 90 %·P crossing (the rise).
- **envelope_sustain_level** — the plateau: the median envelope level over
  the middle (30–70 %) of the post-peak region, as a fraction of `P`.
- **envelope_decay_seconds** — time from the peak until the envelope first
  reaches the plateau (1.1 × sustain).
- **envelope_release_seconds** — the final fade: from the last frame at/above
  `max(0.7·sustain, 0.25)·P` to the last audible frame (≥ 5 %·P).
- **envelope_temporal_centroid** — the energy's center of mass in time,
  `Σ(t·e²) / Σe²` normalized to 0..1: ~0 = front-loaded hit, ~0.5 = held.
- **envelope_skewness / envelope_kurtosis** — the 3rd and 4th statistical
  moments of the envelope (`m₃/m₂^1.5` and `m₄/m₂² − 3`). A strongly
  positive-skewed envelope *is* a percussive sound — all the energy up front,
  a long near-zero tail. High kurtosis flags sharp isolated bursts.
- **envelope_shape** — a decision tree over the segments:
  `Multi` (transient_count > 1) → `Swell` (attack > max(0.1·length, 0.15 s))
  → `Sustained` (sustain > 0.5) → `Plucky` (sustain < 0.15 and decay <
  0.15 s) → else `Decaying`.

### Pitch & harmonicity (`pitch.rs`)

Autocorrelation over the middle half of the signal:
`r(τ) = Σ x[n]·x[n+τ]`, searching lags corresponding to 50–2000 Hz. The best
lag τ\* gives **pitch_hz** `= sr/τ*`; the normalized correlation
`r(τ*) / r(0)` gives **harmonicity** — 1.0 means the signal repeats itself
perfectly at that period (strongly pitched), 0 means noise.

### Whole-file spectrum (`spectrum.rs`)

One FFT over up to 262 144 samples from the middle of the file, magnitudes
`m(f)` per bin:

- **spectral_centroid_hz** — the magnitude-weighted mean frequency,
  `Σ f·m / Σ m` (brightness).
- **complexity** — the spectral *spread*, `√(Σ (f−centroid)²·m / Σ m)`:
  the standard deviation around the centroid (timbral richness).
- **spectral_rolloff_hz** — the frequency below which 85 % of Σm sits.
- **spectral_flatness** — geometric ÷ arithmetic mean of the magnitudes:
  1 for white noise, →0 for a pure tone.
- **low/mid/high_band_energy** — the fraction of Σm below 200 Hz, between
  200 Hz and 2 kHz, and above 2 kHz.

### Frame-based spectrum (`stft.rs`, `flux.rs`, `mfcc.rs`, `framestats.rs`)

A single whole-file FFT hides modulation, so a Hann-windowed short-time
Fourier transform (2048-sample frames, 512 hop) feeds three extractors:

- **spectral_flux** — each frame is L1-normalized (so loudness changes don't
  count, only changes in spectral *shape*), then consecutive frames are
  compared: `flux = mean over pairs of Σ max(0, mᵢ[k] − mᵢ₋₁[k])`. Near 0 for
  a steady oscillator, high for evolving or noisy material. It is a large
  part of how the ear identifies an instrument's onset character.
- **mel_frequency_cepstral_coefficients** — the standard compact timbral
  fingerprint, modeled on human hearing. Each frame's power spectrum is
  pooled through 26 triangular filters spaced evenly on the Mel scale
  `mel(f) = 2595·log₁₀(1 + f/700)`, log-compressed, and decorrelated with a
  DCT-II; the first 13 coefficients are kept and averaged over all frames.
  Two sounds with similar fingerprints have similar "texture".
- **spectral_centroid_mean_hz / spectral_centroid_deviation_hz** — the mean
  and standard deviation of the *per-frame* centroid. A wobbling filter sweep
  and a static tone can share the same average brightness; the frame-wise
  deviation separates them.

### Root note (`root.rs`, `acid.rs`)

If the WAV carries an **ACID chunk** (embedded loop metadata) its
`beats_per_minute` and `root_midi_note` are read directly and are
authoritative. Otherwise the root is detected: a Hann-windowed 65 536-point
FFT feeds a **Harmonic Product Spectrum** — the spectrum is multiplied by
copies of itself decimated by 2…5, so a bin only stays large when its
harmonics are present too, which locks onto the true fundamental and
suppresses octave errors. The search is restricted to a musical range
(30–1100 Hz), the winning bin is refined with parabolic interpolation
(sub-bin accuracy), and the frequency is mapped to equal temperament:
`midi = 69 + 12·log₂(f/440)`, with the fractional part × 100 as
**root_cents_offset** (−50..+50), e.g. `root_note_name = "A3"`.

### Partials & inharmonicity (`partials.rs`)

The strongest spectral peaks above the fundamental are picked (local maxima
≥ 5 % of the global max, between 1.5·f₀ and 16.5·f₀, minimum separation
f₀/2, parabolic-interpolated, 12 strongest kept, count in
**partial_count**). Each peak frequency `fp` is compared to the harmonic
series: its deviation is `|fp/f₀ − round(fp/f₀)|` — 0 when it sits exactly on
an integer multiple, 0.5 when it falls exactly between two harmonics. The
magnitude-weighted mean deviation × 2 is **inharmonicity** (0..1): voice,
flute, and guitar score near 0; bells, gongs, and cymbals — whose partials
fall *between* the harmonics — score high. That detuned-partial spectrum is
exactly what the ear calls "metallic".

### Distortion (`distortion.rs`)

If the envelope says *when* and the centroid says *where*, distortion says
*how hard the sound is being pushed*. Three metrics:

- **total_harmonic_distortion** —
  `THD = √(V₂² + V₃² + … + V₁₀²) / V₁`, where `V₁` is the strongest
  magnitude within ±4 % of the fundamental and `Vₖ` within ±4 % of each
  integer multiple. Clipping a tone generates artificial overtones, so
  squashed/fuzzed tonal material scores high. Reference points on this meter
  (harmonics 2–10, Hann window): pure sine ≈ 0, square wave ≈ 0.40,
  saw ≈ 0.7. A result above 3 means the fundamental estimate itself was
  wrong (swept or unpitched material) and is reported as 0 (unmeasurable)
  rather than poisoning the label and the clustering.
- **clipping_density** — the brute-force count: the fraction of samples
  sitting in runs of ≥ 4 consecutive samples within ~2 LSB (16-bit) of the
  file's own peak. A clean waveform only *grazes* its peak for a sample or
  two per cycle; hard-clipped audio sits pinned on the ceiling.
- **crest_factor** (from the amplitude pass) — dynamic squashing.

They conclude in a label, **distortion**:
`Clipped` if clipping_density ≥ 1 %; `Dirty` if clipping_density ≥ 0.1 % *or*
(THD ≥ 0.35 *and* crest < 3 — harmonic-dense **and** dynamically squashed,
the fuzz signature); else `Clean`. This gives the taxonomy its "clean vs
dirty" branch: a clean guitar and a fuzz guitar can share an identical
envelope, but THD + clipping pull them into different clusters.

### Advanced Analytics & Voice Detection (`advanced_stats.rs`, `vad.rs`)

The analyzer utilizes a suite of industry-standard measurements and machine learning models for deeper context:

- **Voice Activity Detection (VAD)** — an aggressive frame-by-frame scan using the highly optimized WebRTC VAD engine. If significant speech/vocal activity is found, the file is authoritatively classified into the `Vocal` top-level god category.
- **Stereo Field Analysis** — Mid/Side processing computes `mid_rms` (mono compatibility) and `side_rms` (spatial width, reverb presence). 
- **LUFS (ITU-R BS.1770)** — computes modern perceived loudness using K-Weighting and relative gating, providing a standardized `lufs` score.
- **Chromagram** — a 12-bucket Pitch Class Profile mapping FFT magnitudes to standard Western musical notes, revealing chord structures regardless of octave.
- **Algorithmic Rhythm** — extracts the raw `onset_envelope` tracking spectral flux (sudden bursts of high-frequency energy) to power tempograms.
- **QA Metrics** — scans for hardware faults like `dc_offset`, and wasteful dead space via `trailing_silence_ms`.

---

## Classification — how the labels are concluded

Timbre is multidimensional, so one sound can legitimately carry several
labels — a rimshot is both *Stochastic* and *Impulsive*; a plucky bassline is
both a *Pluck* and a *Bass*. Each record is classified along independent
dimensions that the GUI can group by and cross-check.

### Acoustic signal types (`tags.rs`) — what the spectrum IS (multi-label)

- **Harmonic** — harmonicity > 0.45 and inharmonicity < 0.2: clear pitch,
  overtones at integer multiples.
- **Inharmonic** — ≥ 3 partials, inharmonicity ≥ 0.2, flatness < 0.5:
  overtones present but detuned (metallic / bell-like).
- **Stochastic** — flatness > 0.2, or (harmonicity < 0.15 with < 3 partials):
  energy smeared across the spectrum, no discernible pitch.
- **Impulsive** — length < 0.6 s, envelope attack < 25 ms, sustain < 0.2,
  decay < 0.2 s: a burst that decays almost instantly.

Never empty: an ambiguous sound falls back to the closer pole
(harmonicity > 0.3 → Harmonic, else Stochastic).

### Sound-design roles (`tags.rs`) — how it behaves in a mix (multi-label)

Driven by the measured ADSR (`f₀` = detected root, else autocorrelation
pitch; one-shot = transient_count ≤ 1):

- **Pad** — one-shot, attack > 0.15 s, sustain > 0.4: slow fade-in, held —
  fills space.
- **Pluck** — one-shot, attack < 30 ms, sustain < 0.2, harmonicity > 0.3:
  instant peak that dies regardless of hold — rhythmic motion.
- **Lead** — one-shot, not a bass, attack ≤ 0.15 s, sustain > 0.5,
  harmonicity > 0.45, centroid > 1200 Hz, high band > 0.15: precise onset
  that sings and cuts through.
- **Bass** — low band > 0.5, 0 < f₀ < 200 Hz, harmonicity > 0.25: the anchor.

Drums and FX legitimately match no role (shown as "(no role)").

### Envelope god categories (`god.rs`) — the top level

The coarsest useful taxonomy, defined by fundamental ADSR shapes:

| God category | Envelope | Function |
| --- | --- | --- |
| **Percussive** | instant attack, fast decay, zero sustain | rhythmic anchors, impacts — all drums, cymbals and rides included |
| **Impulsive with Tail** | instant attack, long ringing decay/release | wash, spatial context |
| **Tonal** | variable attack, high sustain | melody, harmony, bass |
| **Complex** | multiple transients or looping | beds, textures, FX |

A loop is Complex regardless of name. A recognized name group maps directly
(Clap/Cymbal/Hi-Hat/Kick/Perc/Ride/Rim/Snare/Tom → Percussive; IR → Impulsive
with Tail; Bass/Guitar/Keyboards/Strings/Vocal → Sustained; DJ/FX/
Loops/Scratch → Complex). Files the name taxonomy could not place are decided
by their **measured** envelope shape: Multi → Complex; Sustained/Swell →
Sustained; Plucky → Percussive; Decaying → Impulsive with Tail when
decay + release > 0.5 s (a ringing wash), else Percussive.

### Hornbostel-Sachs family (`family.rs`) — what is physically vibrating

Expressed as a multi-tier array (e.g., `["Percussion", "Membranophone", "Struck Membranophone"]`),
this taxonomy covers Membranophones (stretched skins), Idiophones (the body itself),
Chordophones (strings), Aerophones (air columns), Electrophones (oscillators/circuits),
and Voice. It also captures physical excitation methods (Struck, Scraped, Shaken,
Friction, Plucked, Bowed).

A confident name match maps into these structures first (Kick/Snare/Tom → Struck Membranophone;
Cymbal/Hi-Hat/Ride/Rim/Clap and Perc's Cowbell/Block → Struck Idiophone;
Shaker → Shaken Idiophone; Cuica → Friction Membranophone; Guitar/Piano → Chordophone;
Synth → Electrophone).

**The Acoustic Fallback:** If the file name yields "Unclassified", the acoustic
tags are consulted directly: Inharmonic → Idiophone; Stochastic + Impulsive →
Membranophone; Harmonic + sustained + low spectral flux → Electrophone;
Harmonic + decaying → Chordophone.
Crucially, this acoustic guess is then fed *back* into the primary taxonomy to
rescue unclassified files (e.g., an unnamed Membranophone is instantly promoted
to the "Perc" group). Left empty when there is no honest basis for a guess.

### Name taxonomy (`categorize.rs`, `label.rs`) — deliberately LAST

The full relative path (folders included) is normalized (lower-cased,
letter↔digit boundaries split, so `Tom2` → `tom 2`) and matched against a
curated rule table tolerant of drum-sample naming conventions: phrases match
as substrings, abbreviations only as whole tokens (`bd` hits `BD_01`, not
`bird`). Kick before Bass so "bass drum" → Kick; `cym` anywhere wins Cymbal;
808 is deliberately NOT a bass keyword. Toms are ONE instrument at different
pitches: a single **Tom** group with **Hi / Mid / Lo** subgroups. Curated
subgroups also exist under Perc (Conga, Bongo, Cowbell, Clave, Shaker,
Block) and Keyboards (Piano, Electric Piano, Organ, Clav, Synth).

Loop detection combines signals: an ACID BPM tag is authoritative; a name
saying loop/groove/beat counts; otherwise multiple transients imply a loop
only when the name gives NO drum/instrument hint — so a snare roll named
`Snr_roll.wav` stays a one-shot. A generic "drum" tag with no specific
instrument is flagged (`audit: true`) for acoustic review instead of being
trusted.

### The reason field

Every record explains its membership from all three evidence sources:

```
1) path matched "kick"  2) envelope Sustained (attack 0 ms, sustain 87%, 1 transient)  3) Harmonic · low-band 76% · root A1
```

---

## Statistics over the whole library

### The feature vector (`feature_vec.rs`)

Clustering and the PCA map use a ~21-dimensional, name-independent acoustic
vector per file: ln(1+length), RMS, zero-crossing rate, spectral centroid,
harmonicity, low & high band energy, crest factor, attack, envelope sustain,
envelope skewness, spectral flux, inharmonicity, centroid deviation, THD,
clipping density, and MFCC c₁…c₅ (c₀ is loudness, which RMS already covers).

### K-Means++ clustering (`kmeans.rs`, `cluster.rs`)

Each feature column is min-max normalized so no dimension dominates, then
K-Means++ seeding (deterministic xorshift PRNG — same library in, same
clusters out) picks k spread-out initial centers, and Lloyd's algorithm
iterates assign-to-nearest / recompute-means until stable (≤ 40 rounds).
Loops and one-shots are clustered separately (loop cluster ids offset by k)
— they are different animals. The result groups files that *sound alike*
regardless of naming.

### PCA embedding (`pca.rs`)

The same features are z-score standardized (`(x−μ)/σ`, so Hz-scaled features
don't drown the 0..1 ones), the covariance matrix `C = XᵀX/(n−1)` is built,
and the top 3 eigenvectors are found by deterministic power iteration with
deflation (`v ← Cv/‖Cv‖`; after convergence `C ← C − λvvᵀ`). Each sample's
projection onto those axes is stored in **principal_components** — 3
coordinates on which statistically similar samples land close together, the
axes of greatest variance of the whole library.

### Universal Category System (UCS) (`ucs.rs`)

The **Universal Category System (UCS)** is the de facto standardized taxonomy in audio post-production (e.g., `CatID-SubCatID_Vendor_...`). The analyzer seamlessly weaves this standard into its output by mapping its deep acoustic and heuristic findings directly to official UCS v8.2 IDs. This allows independent creators and game/film studios to cleanly ingest your processed library into professional tools like Soundminer without manual categorization. It maps terms intelligently under the `MUSICAL` and `DESIGNED` hierarchies, outputting `ucs_category`, `ucs_subcategory`, and `ucs_id`.

---

## The .PEAK data model

Field names are spelled out in full — nothing abbreviated or implied. One
JSON object per file (per-file sidecars; the aggregate file is an array).

| Field | Type | Meaning |
| --- | --- | --- |
| `analyzer_version` | string | crate version + source hash that produced this record; if it matches the running binary the record is reused instead of re-analyzed |
| `name` / `folder` / `path` | string | file name, folder relative to the scanned root, absolute path (`sub` = legacy alias of `folder`) |
| `group` / `subgroup` | string | name-derived category (Kick, Tom, Keyboards, … Loops/Patterns) and curated instrument level (Tom→Hi/Mid/Lo, Perc→Conga, …) |
| `reason` | string | the three-part evidence: 1) name 2) envelope 3) spectrum |
| `timbre` | string | quick feature-derived class (Percussive/Tonal/Noise/Bass/Bright/Loop/Pad) |
| `length_class` | string | Short (<0.5 s) / Medium (<2 s) / Long / Loop |
| `audit` | bool | generic "drum" tag with no specific instrument — flagged for acoustic review |
| `length_seconds` | number | duration |
| `transient_count` | int | detected attacks; >1 ⇒ multi-hit |
| `attack_seconds` | number | time to the loudest sample |
| `root_mean_square_level` | number | loudness, linear RMS |
| `crest_factor` | number | peak ÷ RMS (spiky high, squashed low) |
| `zero_crossings_per_second` | number | noisiness/brightness |
| `pitch_hz` | number | autocorrelation pitch estimate |
| `harmonicity` | number | 0 noise … 1 strongly pitched |
| `sustain_ratio` | number | fraction of file held ≥ 50 % of peak |
| `sustained` | bool | one note held the whole file |
| `complexity` | number | spectral spread around the centroid (Hz) |
| `spectral_centroid_hz` | number | brightness (whole-file) |
| `spectral_rolloff_hz` | number | 85 %-energy roll-off |
| `spectral_flatness` | number | 0 tonal … 1 noise-like |
| `low/mid/high_band_energy` | number | energy fraction <200 Hz / 200 Hz–2 kHz / >2 kHz |
| `spectral_flux` | number | frame-to-frame spectral change, 0 static … ~1 churning |
| `inharmonicity` | number | partial detune from the harmonic series, 0 harmonic … 1 metallic |
| `partial_count` | int | detected spectral peaks above the fundamental |
| `mel_frequency_cepstral_coefficients` | number[13] | timbral fingerprint (mean over frames) |
| `spectral_centroid_mean_hz` / `spectral_centroid_deviation_hz` | number | frame-wise brightness mean / modulation |
| `total_harmonic_distortion` | number | harmonic power ÷ fundamental (0 = pure; 0 when unmeasurable) |
| `clipping_density` | number | fraction of samples pinned at the ceiling in flat-top runs |
| `distortion` | string | Clean / Dirty / Clipped |
| `envelope_attack_seconds` | number | 10 %→90 % rise |
| `envelope_decay_seconds` | number | peak → sustain plateau |
| `envelope_sustain_level` | number | plateau, fraction of peak |
| `envelope_release_seconds` | number | final fade to silence |
| `envelope_temporal_centroid` | number | energy center in time, 0..1 |
| `envelope_skewness` / `envelope_kurtosis` | number | 3rd / 4th moments of the envelope |
| `envelope_shape` | string | Swell / Sustained / Plucky / Decaying / Multi / Silent |
| `acoustic_types` | string[] | Harmonic / Inharmonic / Stochastic / Impulsive (multi) |
| `sound_design_roles` | string[] | Pad / Pluck / Lead / Bass (multi; may be empty) |
| `instrument_family` | string | Hornbostel-Sachs guess ("" unknown) |
| `god_category` | string | top-level envelope category |
| `sample_rate` / `bit_depth` / `channels` | int | raw file attributes |
| `root_note_name` / `root_frequency_hz` / `root_cents_offset` | string/number | musical root, e.g. "A3", its Hz, cents off equal temperament |
| `beats_per_minute` / `root_midi_note` | number/int | from the embedded ACID chunk (0 / −1 when absent) |
| `cluster` | int | K-Means cluster id (−1 until clustered) |
| `principal_components` | number[3] | PCA map coordinates |
| `mid_rms` / `side_rms` | number | Stereo field energy (mono compatibility vs spatial width) |
| `lufs` | number | ITU-R BS.1770 perceived loudness |
| `chromagram` | number[12] | 12-bucket pitch class profile mapping FFT energy to musical notes |
| `onset_envelope` | number[] | Rhythmic spectral flux tracking attacks over time |
| `dc_offset` | number | Average waveform offset from zero (quality assurance) |
| `trailing_silence_ms` | number | Milliseconds of dead space at the end of the file |
| `ucs_category` / `ucs_subcategory` / `ucs_id` | string | Standardized Universal Category System metadata (e.g. `MUSICAL`, `PERCUSSION`, `MUSCPerc`) |

---

## The GUI

Near-black theme with bright text throughout. **Start Analysis** becomes
**■ Stop Analysis** during a run — stopping keeps the sidecars written so
far, which the version-skip reuses next run.

**One colour system everywhere**: each god category owns a hue (Percussive =
red-orange, Impulsive with Tail = gold, Tonal =
green, Complex = violet, Unassigned = grey); every group is a
distinct shade of its category's hue and every curated subgroup a further
nudge of that shade (`support/config.py: group_color()`). The 3D cloud's
points, its legend and sidebar tree, the 2D-stats buttons and scatter, and
the Groups/Examiner table rows all share the exact same colours.

- **3D Cloud** — live interactive cloud with free X / Y / Z / Size axis
  pickers and ten one-click presets (**A–J**: classic, brightness, envelope
  space, tonal-vs-noisy, musicality, percussive, noise, texture, tempo,
  dynamics — the axis labels follow). Scroll to zoom, Top/Front/Side/Iso
  views, drag to orbit. The god-category → group → subgroup tree in the
  sidebar shows/hides any slice. Click a point to inspect and play it.
- **2D Stats** — right beside the cloud: per-group scatter of any two
  measures, click a point to inspect/play.
- **Groups / CSV** — group along any dimension (God category / Name group /
  Timbre / Env shape / Acoustic / Sound design / Family / Distortion /
  Cluster), two levels deep; defaults to god categories with name groups
  nested. Full CSV export of every field. Selecting a file opens the shared
  inspector: complete record JSON + waveform preview + Play.
- **PEAK Examiner** — open any `.PEAK`, filter/search, same inspector.
- **Auto-Guess** — fingerprints each named group's acoustics (mean normalized
  feature vector) and guesses the group of Unclassified/mismatched one-shots
  by nearest fingerprint, with a confidence from the margin between the two
  nearest. Same inspector.
- **Flatten / Rename** — a token-based name builder: three reorderable
  checkbox tables (each row has ▲/▼) compose the result. **Destination
  subfolders** — every checked label (God category, Group, Subgroup, Timbre,
  Family, Distortion, Envelope shape, Length tier, Cluster) becomes one
  folder level, in order. **Prepend** and **Append** tables build the file
  name around the original: `[prepend parts] - <original> - [append parts]`,
  with the flattened folder path available as a prepend token and ROOT note /
  BPM / tiers as append tokens. Options strip the detected group/subgroup
  words out of the original name (`Kick_01.wav` → `Kick - 01.wav`, not
  `Kick - Kick_01.wav`) and collapse repeated words. Copy or move; name
  clashes auto-number. Same inspector in the footer.

---

## The browser app (Web_Front)

The web front-end mirrors the desktop tabs — **Scanalize, 3D Cloud, Stats,
Groups, Examiner, Flatten/Rename** — running the same Rust DSP core as
WebAssembly, and sharing the one god-category → group → subgroup colour system.
It is **100% client-side**: no server performs any computation and nothing is
uploaded. What differs from the desktop build:

- **Scan** — pick a folder; the WASM core analyzes every WAV locally, streaming
  progress (`# of #`), then **auto-downloads one `.PEAK`** (`Scanalyzer.like.audio
  - File Audit <timestamp>.peak`). Load a prior `.PEAK` from the header (or drag
  it onto the page).
- **Load Sounds** — links a folder via the File System Access API so samples can
  play in real time; audio is resolved back to each `.PEAK` record by relative
  path (basename fallback). Header status text and pulsing buttons walk you
  through getting "online".
- **Examiner** — a virtualized list (handles 30k+ rows), sortable columns,
  group/subgroup scope filters + text filter, a draggable sash, arrow-key
  navigation, a **DIG** crate-digging auto-advance, and a static waveform +
  averaged-FFT preview (group colour for the wave, its complement for the
  spectrum, note-frequency axis on top, root-note marker, ADSR overlay).
- **3D Cloud** — instanced-point cloud with click / arrow-key selection and
  playback, a nested show/hide legend with per-group and per-subgroup counts.
- **Flatten/Rename** — since a browser can't move files, it **generates a rename
  script** (Bash / PowerShell / Python) that recreates the destination tree and
  copies/moves each file, with an optional **ffmpeg resample** (sample rate +
  bit depth) baked in. Run it yourself, on your own machine.
