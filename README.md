# Sample Analysis

A self-contained audio-sample analyzer and file-management tool.

```
Sample Analysis/
├── run.sh                 # launcher: builds the Rust core if needed, opens the GUI
├── main.py                # Python GUI shell (tabs live in support/)
├── support/               # one module per GUI tab + config
└── sample_analyzer_rs/    # Rust DSP core (fast, parallel)
    └── target/release/oa_sample_analyzer   # built binary
```

## Run

```bash
./run.sh
```

or directly:

```bash
python3 main.py
```

Requires: Python 3 with `numpy` + `matplotlib` (Tk backend), a Rust toolchain
(`cargo`) for the first build, and an audio player for previews
(`paplay`/`aplay`/`ffplay` on Linux, built-in on macOS/Windows).

## How it analyzes sound

The Python GUI is only the front-end. All signal processing happens in the
Rust binary (`sample_analyzer_rs/`), which walks the chosen folder for WAV
files and analyzes them in parallel (default 30 worker threads), streaming
JSON progress back to the GUI so the 3D cloud fills in live.

### 1. Decode

Each WAV is decoded to mono `f32` samples (multi-channel files are averaged
down), keeping the original sample rate, bit depth, and channel count as
metadata. Files longer than the configured maximum are skipped — the tool is
aimed at samples, not full songs.

### 2. Feature extraction

Every file gets a fixed set of acoustic measurements:

**Time domain** (`amplitude.rs`, `transients.rs`, `sustain.rs`)
- **RMS** — overall loudness.
- **Crest factor** — peak ÷ RMS; high for spiky percussive hits, low for
  sustained material.
- **Attack time** — seconds from the start of the file to its loudest sample.
- **Zero-crossing rate** — sign changes per second; high for bright/noisy
  content.
- **Transient count** — peak-picking on a smoothed ~16 ms RMS envelope: each
  rise that climbs far enough above its preceding valley counts as one attack.
  A clean one-shot yields 1; a rhythmic loop yields many.
- **Sustain ratio** — the fraction of the file whose short-time RMS stays
  above 50 % of the peak level (≈1 for a drone/pad, near 0 for a decaying hit).

**ADSR envelope** (`envelope.rs`) — the way a sound evolves over time is as
much a part of its identity as its pitch or tone. Since a recorded one-shot
has no note-off, the classic synthesizer ADSR is estimated from ~5 ms RMS
envelope frames:
- **Attack** — rise time from 10 % to 90 % of the peak level.
- **Decay** — time from the peak down to the sustain plateau.
- **Sustain** — the plateau level after the decay, as a fraction of peak.
- **Release** — the final fade from the plateau down to silence.
- **Temporal centroid** — where the energy sits in time (~0 = front-loaded
  hit, ~0.5 = held evenly).
- **Envelope moments** — statistical skewness and kurtosis of the envelope
  (a strongly positive-skewed envelope *is* a percussive sound: all the
  energy up front, a long near-zero tail).
- A categorical **shape**: Swell / Sustained / Plucky / Decaying / Multi.

**Pitch** (`pitch.rs`)
- **Pitch** and **harmonicity** come from autocorrelation over the middle half
  of the signal, searching lags corresponding to 50–2000 Hz. The best lag gives
  the pitch; the normalized correlation at that lag gives harmonicity
  (0 = noise … 1 = strongly pitched).

**Spectrum** (`spectrum.rs`) — a single FFT over up to 256 K samples from the
middle of the file:
- **Spectral centroid** — the magnitude-weighted mean frequency (brightness).
- **Spectral spread** ("complexity") — standard deviation around the centroid
  (timbral richness).
- **85 % roll-off** — the frequency below which 85 % of the energy sits.
- **Spectral flatness** — geometric ÷ arithmetic mean of the magnitudes
  (0 = tonal, 1 = noise-like).
- **Band energy** — the fraction of energy below 200 Hz (low), 200 Hz–2 kHz
  (mid), and above 2 kHz (high).

**Frame-based spectrum** (`stft.rs`, `flux.rs`, `mfcc.rs`, `framestats.rs`) —
a single whole-file FFT hides modulation, so a Hann-windowed STFT (2048-sample
frames, 512 hop) feeds three more extractors:
- **Spectral flux** — how fast the spectral *shape* changes frame-to-frame
  (each frame is normalized first so loudness changes don't count). Near 0 for
  a steady oscillator, high for evolving or noisy material.
- **MFCCs** — a 13-coefficient Mel-Frequency Cepstral Coefficient fingerprint
  (26 triangular mel filters → log → DCT-II, averaged over frames): the
  standard compact descriptor of timbral "texture", modeled on human hearing.
- **Centroid statistics** — mean and standard deviation of the per-frame
  spectral centroid: a wobbling filter sweep and a static tone can share the
  same average brightness; the frame-wise variance separates them.

**Partials / inharmonicity** (`partials.rs`) — the strongest spectral peaks
above the fundamental are picked (parabolic-interpolated for sub-bin accuracy)
and compared against integer multiples of the fundamental. Harmonic sounds
(voice, flute, guitar) score near 0; metallic, bell-like sounds whose partials
fall *between* the harmonics (cymbals, gongs, chimes) score high.

**Distortion** (`distortion.rs`, plus the crest factor from `amplitude.rs`) —
how hard the sound is being pushed:
- **THD** (Total Harmonic Distortion) — the power of the overtones at integer
  multiples of the fundamental vs the fundamental itself. On this meter a
  square wave measures ≈0.40 and a saw ≈0.7; results are gated to 0 when the
  fundamental estimate is unreliable (swept or unpitched material).
- **Clipping density** — the brute-force count: the fraction of samples pinned
  at the waveform ceiling in flat-top runs of 4+. A clean waveform only grazes
  its peak for a sample or two per cycle; hard-clipped audio sits there.
- A categorical label — **Clean / Dirty / Clipped** — so a clean electric
  guitar and a fuzz guitar with the identical envelope end up in different
  branches of the taxonomy (and different K-Means clusters).

**Root note** (`root.rs`, `acid.rs`)
- If the WAV carries an **ACID chunk** (embedded loop metadata), its BPM and
  root note are read directly and treated as authoritative.
- Otherwise the root is detected from a Hann-windowed FFT via a **Harmonic
  Product Spectrum**: the spectrum is multiplied by decimated copies of itself
  so a bin only stays large when its harmonics are present too, which locks
  onto the true fundamental and suppresses octave errors. Parabolic
  interpolation refines the peak to sub-bin accuracy, and the result is mapped
  to an equal-tempered note name (e.g. `A3`) with its cents deviation.

### 3. Classification

Timbre is multidimensional, so one sound can legitimately carry several
labels at once — a rimshot is both *Stochastic* and *Impulsive*; a synth bass
is both *Harmonic* and a *Bass*. Each file is classified along several
independent dimensions, so the views can be cross-checked against each other.

**The file name is deliberately the last step**: every measurement and blind
classification above happens from the audio alone; only then is the path/name
consulted, to lay the curated taxonomy on top of the acoustic evidence.

1. **By name** (`categorize.rs`) — the full relative path (folders included)
   is matched against a curated rule table tolerant of the many drum-sample
   naming conventions (`BD` → Kick, `snr` → Snare, `OH` → HiHat, …), with
   curated instrument subgroups (Conga under Perc, Rhodes under Keyboards,
   and Hi / Mid / Lo under a single **Tom** group — toms are one instrument at
   different pitches). Every record stores the *reason* it matched.
2. **By timbre** (`timbre.rs`) — a blind, name-independent decision tree over
   the extracted features: multiple transients → Loop; slow attack + low
   crest → Pad; harmonic + bass-heavy → Bass; harmonic → Tonal; high-band
   dominant → Bright; spiky or instant attack → Percussive; else Noise.
3. **Acoustic signal types** (`tags.rs`) — multi-label tags for what the
   spectrum *is*: **Harmonic** (clear pitch, integer overtones), **Inharmonic**
   (overtones detuned from the harmonic series — metallic/bell-like),
   **Stochastic** (energy smeared across the spectrum, no discernible pitch),
   **Impulsive** (a short burst that decays almost instantly).
4. **Sound-design roles** (`tags.rs`) — multi-label tags for how the envelope
   and spectrum *behave* in a mix, driven by the measured ADSR: **Pad** (slow
   attack, high sustain — fills space), **Pluck** (instant attack, fast decay,
   no sustain, tonal — rhythmic motion), **Lead** (fast attack but held,
   bright enough to cut through), **Bass** (pitched, energy below ~200 Hz —
   the anchor). Drums and FX legitimately get no role.
5. **Envelope "god categories"** (`god.rs`) — the coarsest useful taxonomy,
   based on fundamental ADSR shapes: **Transient / Percussive** (instant
   attack, fast decay, zero sustain), **Impulsive with Tail** (instant attack,
   long ringing decay — cymbals, IRs), **Sustained / Tonal** (high sustain —
   melody, harmony, bass foundations), **Complex / Continuous** (multiple
   transients or looping — beds, FX). Recognized name groups map directly
   (Kick → Transient, Ride → Impulsive with Tail, Guitar → Sustained, …);
   unrecognized files are placed by their measured envelope.
6. **Hornbostel-Sachs family** (`family.rs`) — a best-effort guess at what is
   physically vibrating: Membranophone (stretched skin), Idiophone (the body
   itself), Chordophone (strings), Aerophone (air column), Electrophone
   (oscillators), or Voice. A confident name match decides first, then the
   acoustic tags (inharmonic ⇒ Idiophone, stochastic + impulsive ⇒
   Membranophone, …); left blank when there is no honest basis for a guess.
7. **By clustering** (`cluster.rs`, `kmeans.rs`) — deterministic **K-Means++**
   over a ~19-dimensional feature vector (log-length, RMS, zero-crossing rate,
   centroid, harmonicity, low/high band energy, crest, attack, envelope
   sustain + skewness, spectral flux, inharmonicity, centroid modulation, and
   MFCC c1–c5), min-max normalized so no dimension dominates. This groups
   files that *sound alike* regardless of naming. Loops and one-shots are
   clustered separately.
8. **PCA embedding** (`pca.rs`) — the same feature space is compressed to its
   3 principal components (z-scored, deterministic power iteration), so every
   sample gets stable 2D/3D map coordinates where statistically similar
   samples land close together.

Loop detection combines the signals: an ACID BPM tag is authoritative; a name
containing "loop/groove/beat" counts; otherwise multiple transients imply a
loop only when the name gives no drum/instrument hint (so a snare roll named
`Snr_roll.wav` stays a one-shot). Files with only a generic "drum" tag are
flagged for an acoustic audit rather than trusting the vague name.

### 4. Output

All measurements and labels are written as JSON to `sample_cloud_data.PEAK`
**in the analyzed folder**, beside the samples, plus optional per-file sidecars
written incrementally so they survive an interrupted run.

## Tabs

- **3D Cloud** — live interactive cloud (pitch × name-group depth × complexity,
  size = length). Scroll to zoom, Top/Front/Side/Iso views, drag to orbit.
  Show/hide any group; isolate a single group to remap its Y axis to any feature.
  Click a point to inspect its full record and play the sample.
- **Groups / CSV** — every group along any dimension (God category / Name group /
  Timbre / Env shape / Acoustic / Sound design / Family / Distortion / Cluster,
  two levels deep) with each file and the reason it's in the group; export to
  CSV. Selecting a file opens the same full-JSON inspector + waveform player
  as the PEAK Examiner.
- **PEAK Examiner** — open any `.PEAK` file, filter/search records, view full
  JSON and play the sample.
- **Auto-Guess** — fingerprints each named group's acoustics and guesses the
  group of Unclassified/mismatched one-shots, with the same inspector/player.
- **Flatten / Rename** — batch-rename by folding the folder path into the file
  name (`A/B/C/D.wav` → `A-B-C-D.wav`), optionally flattening into one folder.
