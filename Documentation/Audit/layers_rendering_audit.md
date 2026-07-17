# Layers Rendering Audit — Overlays, Plots, and Their Math

**Date:** 2026-07-16
**Visual companion:** [`layers_rendering_audit.html`](layers_rendering_audit.html) (local, self-contained — live formula-driven plot miniatures)
**Scope:** `Documentation/layers/` — 75 C++/Qt files (~1.1 MB), the layer rendering stack vendored from Sonic Visualiser (`svgui/layer`, Chris Cannam / Centre for Digital Music, QMUL). This audit describes what each plot/overlay looks like, where it gets its sound data, and the exact math that maps samples to pixels and colours.

---

## 1. The Big Picture — how a layer gets sound and puts it on screen

Every visual overlay is a subclass of `Layer` (`Layer.h:76`). The pipeline is:

```
Audio / analysis data          Rendering contract              Screen
─────────────────────          ──────────────────              ──────
Model (ModelId handle)  ──►  Layer::paint(LayerGeometryProvider*, QPainter&, QRect)  ──►  pixels
        │                          │
   ModelById registry         View supplies geometry per call:
   (models resolved by             getXForFrame / getFrameForX   (time ↔ x)
    opaque id, never               getYForFrequency / inverse    (freq ↔ y)
    raw pointers)                  zoom level (frames-per-pixel)
```

Key contract points:

- **A layer never stores its view.** The `LayerGeometryProvider` is passed on every `paint()` call because one layer can be displayed in several views with different sizes and zooms (`Layer.h:138-160`).
- **Time→pixel math is owned by the view**, not the layer: `getXForFrame(frame)` / `getFrameForX(x)`. The zoom level is a *frames-per-pixel* quantity (`ZoomLevel`), with a distinct pixels-per-frame regime when zoomed past 1:1. Layers are explicitly forbidden from doing this mapping themselves from the zoom level (`LayerGeometryProvider.h:171-181`).
- **Models are bound by type.** `LayerFactory` (`LayerFactory.cpp:140-201`) maps model classes to the layers that can display them:

| Model type | Layers offered |
|---|---|
| `RangeSummarisableTimeValueModel` (audio + peak caches) | Waveform |
| `DenseTimeValueModel` (raw audio) | Spectrogram (3 variants), Spectrum |
| `DenseThreeDimensionalModel` (time × bin × value grid) | Colour3DPlot, Slice |
| `SparseOneDimensionalModel` (time points) | TimeInstants |
| `SparseTimeValueModel` (time + value points) | TimeValues |
| `NoteModel` | Notes / FlexiNotes |
| `RegionModel` | Regions |
| `BoxModel` (time span × value span) | Boxes |
| `TextModel`, `ImageModel` | Text, Image |
| any model | TimeRuler (time axis only) |

- **Class hierarchy:**

```
Layer (abstract: model binding, paint, measurement, XML, dormancy)
 ├── SingleColourLayer          ← one user colour from ColourDatabase
 │     ├── WaveformLayer, TimeInstantLayer, TimeValueLayer,
 │     ├── NoteLayer ── FlexiNoteLayer, RegionLayer, BoxLayer, TextLayer
 │     └── SliceLayer ── SpectrumLayer
 └── SliceableLayer             ← exposes a model a SliceLayer can cut through
       └── VerticalBinLayer     ← Y axis is *bin number* (getYForBin/getBinForY)
             ├── SpectrogramLayer
             └── Colour3DPlotLayer
```

- **Two disjoint colour systems.** Single-colour layers (waveform, notes, regions…) pick a named colour from `ColourDatabase` — a palette with a `darkbg` flag per colour so bright colours are chosen on dark canvases. Heat-map layers (spectrogram, colour-3D-plot) map *values* through `ColourScale` → `ColourMapper` (15 colour maps: Green, Sunset, White-on-Black, Ice, Cividis, Magma, …). The two never mix.

- **Incremental painting is time-budgeted.** `RenderTimer` gives a paint pass a 0.1 s soft / 0.2 s hard budget, never bails before 15% done, and pushes through past the soft limit if ≥65% complete (`RenderTimer.h:70-94`). Layers left dormant (hidden) may drop their caches (`Layer.cpp:150-165`).

---

## 2. WaveformLayer — the amplitude envelope

**What it looks like.** Per pixel column, a vertical stroke from the minimum to the maximum sample in that column's time span, joined through the midpoints — the classic waveform silhouette. On top of that: a lighter *mean band* (the average-magnitude region), clipping marks in a contrasting colour where |sample| ≥ 1.0, a horizontal centre axis per channel, and individual sample dots once zoomed past one pixel per sample. Channel modes: **Separate** (stacked bands), **Mean** (mixed to one), **Butterfly** (channel 0 up, channel 1 down around a shared axis).

**Where the sound comes from.** Not raw samples — a `RangeSummarisableTimeValueModel`, which serves pre-computed `Range{min, max, absmean}` summaries at power-of-two block sizes (a peak cache / mipmap). Each pixel asks for the summary covering its frame span, block-aligned so the same pixel always shows the same data regardless of scroll (`WaveformLayer.cpp:522-550`). Zoomed in past 1:1, it switches to `WaveformOversampler` interpolated samples.

**The math.**

- Band geometry: for each channel, half-height `m = (h/channels)/2`, centre `my` (`WaveformLayer.cpp:912-927`).
- **Linear scale:** `y = my − value·gain·m` — amplitude maps linearly into the band.
- **dB scale** (`WaveformLayer.cpp:452-460`), with floor `m_dBMin = −80 dB`:

  ```
  dB = voltage_to_dB(|sample|)
  dB < −80 → 0 ;  dB > 0 → m ;  else  pixels = (dB − (−80)) · m / 80
  ```

  i.e. linear interpolation *in the dB domain* across the band.
- **Meter scale:** `voltage_to_fader(sample, m, Scale::Preview)` — the IEC-style non-linear fader curve.
- **Gain** is stored as a voltage multiplier but edited in dB (`dB_to_voltage(value)`, ±50 dB). **Auto-normalize** computes `gain = 1 / max(|min|, |max|)` over the visible range (`WaveformLayer.cpp:552-595`).
- Butterfly combine: `max = |ch0.max|`, `min = −|ch1.max|` — each channel forced to its own side (`WaveformLayer.cpp:1011-1039`).

---

## 3. SpectrogramLayer — time × frequency heat map

**What it looks like.** The dense heat image: x = time, y = frequency, colour = magnitude (or phase). Three factory presets: plain spectrogram, **Melodic Range** (log frequency axis), **Peak Frequencies** (sharp traces at reassigned peak frequencies instead of smeared bins). Optional piano keyboard on the vertical scale.

**Where the sound comes from.** The layer holds a `DenseTimeValueModel` (raw audio) and derives an `FFTModel` from it (`SpectrogramLayer.cpp:1563-1568`) with:

- Window size (default 1024, Hanning), hop = `windowSize·3/4` at 25% overlap or `windowSize / 2^(level−1)` for 50–93.75% (`SpectrogramLayer.h:343-347`).
- **Oversampling** = zero-padding: `fftSize = windowSize × oversampling` (1×–8×), which interpolates the frequency axis without adding information.
- Two `Dense3DModelPeakCache` mipmaps (divisors 1 and 8) so zoomed-out rendering reads pre-reduced columns.

**The math.**

- **Bin ↔ frequency ↔ y:**

  ```
  frequency = bin · sampleRate / fftSize                (SpectrogramLayer.cpp:1319)
  y         = view.getYForFrequency(frequency, minF, maxF, mapping)   mapping ∈ {Linear, Mel, Log}
  ```

- **Magnitude scaling:** raw FFT magnitude is divided by `fftSize/2` (equivalently ×`2/windowSize`) to voltage; skipped in Phase and Hybrid-normalization modes (`SpectrogramLayer.cpp:1724-1727`).
- **Colour scale options** map onto the shared `ColourScale` machinery: Linear, Meter, **dB** (log map), **dB²** (log map with post-multiple 2 — `log(x²) = 2·log(x)`, a power spectrum), Phase.
- **Phase mode:** the raw phase in [−π, π] maps linearly to colour index `pixel = 1 + (value·127)/π + 127`, gain and threshold deliberately bypassed (`ColourScale.cpp:108-113`).
- **Peak Frequencies mode:** only bins that pass `isOverThreshold` *and* `isLocalPeak` survive; each is drawn at the y of its *instantaneous frequency* estimated by `FFTModel` from the phase advance between hops (the classic phase-vocoder reassignment `f = binF + princarg(Δφ − expected)/(2π·hop)·sr` — the estimator body lives in `FFTModel`, outside this file set).
- **Normalization** (four UI options): none; **Col** = each column scaled so its own peak is 1 (`ColumnOp::normalize` Max1); **View** = min/max of the *visible* area fed into the colour scale, re-rendered when the observed range drifts; **Hybrid** = column-shape normalized but rescaled by `log10(columnMax + 1)` so loud moments stay bright.
- **Vertical zoom** steps divide the displayed frequency range by `⁴√2` per step; on a log axis the recentre preserves the geometric mean: `newMax = (d + √(d² + 4·min·max))/2` (`SpectrogramLayer.cpp:2661-2685`).

---

## 4. Colour3DPlotLayer — generic time × bin × value grid

**What it looks like.** Same visual family as the spectrogram — a heat map — but for *any* dense 3-D model (chromagrams, MFCCs, analysis plugin grids). Cells can be opaque or translucent over the waveform, smoothed or blocky; zoomed-in cells can print their numeric values.

**The math.**

- Bin → y, linear: `y = h − (bin − minBin)·h/(maxBin − minBin)`; log: same interpolation in `LogRange::map(bin+1)` space (`Colour3DPlotLayer.cpp:851-880`).
- Normalization options mirror the spectrogram (`None` / `Range01` per column / visible-area / `Hybrid`), with the Hybrid colour range fed as `[0, log10(modelMax + 1)]` (`Colour3DPlotLayer.cpp:1131-1133`).
- Gain edited in dB: `gain = 10^(value/20)`.

### The shared renderer (`Colour3DPlotRenderer`)

Both heat-map layers delegate to one pipeline, whose canonical order is:

```
get column → scale → normalise → record magnitude extents → peak-pick → distribute/interpolate → display gain
```

- **Three render strategies** (`decideRenderType`, `Colour3DPlotRenderer.cpp:442-504`): *DirectTranslucent* (few cells, no cache), *DrawBufferBinResolution* (zoomed in — render one column per source bin, then upscale between exact bin boundaries), *DrawBufferPixelResolution* (default).
- **Many bins per pixel → max-aggregate:** `aggregate[i] = max(aggregate[i], column[i])` so peaks are never averaged away (`:1300-1345`). **Fewer bins than pixels → `ColumnOp::distribute`** with either peak-preserving step mapping or interpolation. Upscaling uses a hand-written nearest-neighbour copy specifically because Qt's fast transform can drop single-pixel peaks (`:930-956`).
- **Scrolling cache:** `ScrollableImageCache` keeps one contiguous valid pixel span; on scroll it `memmove`s scanlines sideways and only re-renders the newly exposed strip, extending the valid region strictly at its left or right edge (rendering right-to-left when extending leftward) — never leaving holes (`ScrollableImageCache.cpp:54-169`). A parallel `ScrollableMagRangeCache` keeps per-column magnitude ranges (post-normalization, pre-display-gain) that drive View normalization and the dB legend.
- **Value → colour** (`ColourScale`, 256-entry palette):

  ```
  value ×gain → threshold cut (below → pixel 0 = background)
        → scale map (linear | log | meter-fader | ±1 clamp | |abs| | phase)
        → ×multiple → clamp to mapped range → proportion ∈ [0,1]
        → pixel = proportion·255 + 1
        → (+ colour rotation, wrapped in 1..255) → ColourMapper → RGB
  ```

  Pixel 0 bypasses rotation and the map entirely (pure black or white background). Translucent mode ramps alpha with the pixel index: `alpha = 20 + pixel·220/256`.

---

## 5. SpectrumLayer and SliceLayer — one moment, all frequencies

**What they look like.** A single curve of energy against bin/frequency at the view's centre time. `SliceLayer` draws any 3-D model column as **Lines** (peak envelope polyline), **Steps** (staircase), **Blocks** (outlined bars), or **Colours** (filled, colour-mapped). `SpectrumLayer` specialises it into an FFT spectrum: log frequency axis by default, a piano keyboard plus Hz scale underneath, detected peak lines coloured by level, and crosshairs that display Hz, pitch name, and dB — with harmonic tick marks at 2f, 3f, … 99f of the cursor frequency.

**Where the sound comes from.** SliceLayer reads one or more columns of a `DenseThreeDimensionalModel` around the view centre (sampling modes: nearest column, mean, or peak across the span). SpectrumLayer builds its own `FFTModel` (default window 4096) and registers it as the sliceable model; each bin is pre-multiplied by a bias curve `1/(windowSize/2)` to normalize FFT magnitude to voltage.

**The math.**

- **Bin ↔ frequency:** `f = bin·sampleRate/fftSize` and inverse (`SpectrumLayer.cpp:389-431`).
- **Log X axis** (`SliceLayer.cpp:198-270`): to avoid `log(0)` at bin 0, values are shifted by a compromise constant 0.8 before the log:

  ```
  x = w · (log10(p + 0.8) − log10(pmin + 0.8)) / (log10(pmax + 0.8) − log10(pmin + 0.8))
  ```

  A "Rev Log" variant mirrors this (`p → pmax − p`, `x → w − x`).
- **Energy scales** (`SliceLayer.cpp:359-423`), default dB: `norm = (dB − threshold)/(−threshold)` with `dB = quantity_to_dB(value·gain)`; Meter uses the IEC fader curve; Linear subtracts the threshold. Power vs root-power units are respected — dB is `10·log10` for power quantities, `20·log10` for amplitude.
- **Peak lines:** `FFTModel::getPeakFrequencies(MajorPitchAdaptivePeaks, …)` returns phase-interpolated peak frequencies capped at MIDI pitch 128; each drawn at its reassigned frequency, coloured by its normalized level.

---

## 6. Annotation overlays — sparse events on top of the sound

These are the editable layers that annotate the audio rather than render it.

### TimeValueLayer (points over time)
Seven plot styles: **Points**, **Stems** (vertical line from a zero baseline), **Connected Points**, **Lines**, **Curve** (cubic-spline smoothed: `cubicTo` control points at segment ends into midpoints), **Segmentation** (full-height colour bands per value), **Discrete Curves** (thick antialiased strokes, zeros treated as gaps). Vertical scales: auto-align (shares another layer's scale), linear (with a 10% headroom margin), log, ±1. A **derivative mode** plots successive differences with symmetrized extents. Segmentation colour = `ColourMapper.map(value)` at alpha 120.

### NoteLayer / FlexiNoteLayer (piano-roll)
Each note is a rectangle spanning its duration at the y of its frequency; height = one value-quantum or 3 px. The pitch math (`NoteLayer.cpp:236-259`):

```
event value v (MIDI, fractional) → pitch p = round(v), cents c = 100·(v − p)
frequency = Pitch::getFrequencyForPitch(p, c)          // f = 440·2^((p−69)/12), cent-adjusted
```

Scales: linear Hz, log Hz (with a piano keyboard beside the numeric scale), or fixed MIDI range (pitch 0–127). Extents padded ×1.06 either side. **FlexiNoteLayer** adds region editing with a fixed 16-px note height: the cursor's position relative to a note's edges (±8 px tolerance) selects drag-note / left-boundary / right-boundary / split modes, and dragging a note pitch re-analyses the underlying pitch track within ±1 semitone; note values snap to the **median** of the pitch-track points under the note.

### RegionLayer (labelled spans)
**Lines** style: an "I-beam" per region — horizontal bar with end caps at the region's value height. **Segmentation** style: abutting full-height colour bands. Its distinctive **EqualSpaced** scale ranks each *distinct value* with an ordinal index and centres each in its own band:

```
y = h − ( h·i/n + h/(2n) )        // n distinct values, band-centred
```

with a snapping inverse: a dragged region within ±gap/3 of an existing band snaps to that exact value, otherwise bisects between neighbours (`RegionLayer.cpp:663-749`).

### BoxLayer (time span × value span)
An unfilled rectangle from `(t0, value)` to `(t1, value + |level|)` — both corners mapped through the shared `CoordinateScale`. Linear or log vertical scale; can adopt another layer's extents.

### TimeInstantLayer (tick marks)
Full-height vertical lines at each time point (no value axis at all), or alternating-shade segmentation bands between successive instants.

### TextLayer / ImageLayer
Free labels and images anchored at a frame. TextLayer's y is a bare proportion: `y = h − height·h` with height ∈ [0,1]. ImageLayer scales images aspect-preserving into the available strip. `ImageRegionFinder` does a 4-connected flood fill with an adaptive colour-distance threshold (`thresh = |colour|/2`, pure black/white are hard boundaries) and requires ≥2 similar neighbours before expanding — suppressing 1-px antialiasing filaments.

### TimeRulerLayer (the time axis)
Picks a "nice" major tick interval by estimating how many labels fit (`width of "10:42.987654"` as minimum spacing) then walking the ideal gap up a **1 → 5 → 10 → 30/60 → 300 → 600 → 3600 s** progression (multiply stages ×5, ×2, ×6, then ×10s; the ×6 stages flag quarter-subdivision so minutes/hours divide into 4). Ten minor ticks per major (or 4/5 when tight), with graded lengths, and tick x positions rounded to exact zoom-block boundaries to avoid sub-pixel jitter while scrolling (`TimeRulerLayer.cpp:137-246`).

---

## 7. The shared math kernels

### CoordinateScale — every vertical axis
One class owns the value↔pixel mapping for all value layers (`CoordinateScale.cpp:183-236`):

```
point = map(value)         // identity | LogRange::map | Mel(frequency)
y     = h − h·(point − min)/(max − min)          // and the exact inverse
```

Log scales therefore interpolate linearly *in log space*. Frequency scales support Linear / Mel / Log maps. An `ScaleApplication` tag (Normal / Deferring / Personal / None) governs whether a layer's scale can auto-align with other layers sharing its unit.

### AudioLevel — every dB number
All dB math funnels through one utility: `voltage_to_dB` / `dB_to_voltage` (20·log10 amplitude), `quantity_to_dB` (10·log10 for power units, 20 for root-power), and the `Preview` fader curve for meter-style scales (used identically by WaveformLayer meter mode, SliceLayer meter mode, ColourScale Meter, and PaintAssistant's scale painter with its fixed tick ladder −40, −30, −20, −15, −10, −5, −3, −2, −1, −0.5, 0 dB).

### ColourMapper — normalized value → RGB
`norm = clamp((value − min)/(max − min))`, optionally inverted, then a per-map formula — e.g. Sunset's piecewise channels `r = (norm−0.24)·2.38, g = (norm−0.64)·2.777, b triangular`, Green's HSV rotation `h = ⅔(1−norm)`, and table maps (Ice, Cividis, Magma) linearly interpolated between stops (`ColourMapper.cpp:266-427`).

---

## 8. Observations

1. **Peak preservation is a design invariant.** Everywhere resolution is reduced — waveform summaries, colour-3D max-aggregation, the hand-rolled nearest-neighbour upscaler, `distribute` without interpolation — the code chooses max/peak-keeping over averaging, so transient events never vanish at any zoom.
2. **Pixel-stability tricks recur.** Block-aligned frame quantisation (waveform), tick frames rounded to zoom blocks (time ruler), and measurement rects stored as frames + fractional heights all exist so content doesn't shimmer during scrolls and resizes.
3. **The colour pipeline reserves index 0** as a below-threshold background that bypasses rotation and mapping — thresholding is structural, not cosmetic.
4. **Two files' math is external to this snapshot:** `ColumnOp` (normalize / peakPick / distribute arithmetic) and `FFTModel` (phase-vocoder instantaneous-frequency estimator). Call sites are quoted above; the definitions live in Sonic Visualiser's `svcore`, not in `Documentation/layers/`.
5. **Relevance to Sample Analysis:** the spectrogram value→pixel→colour chain (gain → threshold → log map → proportion → palette with reserved background), the widen-only display extents thinking, and the scrollable-strip cache are directly transferable patterns for the Web_Front client-side spectrogram and the Scananalyzer Extractor tab.

---

## 9. Deployment follow-on

This stack is now the **prototype guide** for making the Examiner wave view's overlays toggleable layers: each SV layer maps to an isolated TSX layer file (spectrum, envelope, phase, loudness broken out of the existing code; piano scale, slices, waterfall spectrogram, and 3-D spectrum added new), selected from a dropdown and composited either stacked or as rows. The component architecture, math mapping, and phased deployment strategy are in the companion audit: [`examiner_layer_overlays_audit.md`](examiner_layer_overlays_audit.md).

---

*Sources: five parallel deep-reads over the 75 files; all formulas quoted from source with file:line references as of commit 198a320.*
