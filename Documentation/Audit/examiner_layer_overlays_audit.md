# Examiner Layer Overlays Audit — Migrating the Wave View to a Toggleable Layer Stack

**Date:** 2026-07-16
**Visual companion:** [`examiner_layer_overlays_audit.html`](examiner_layer_overlays_audit.html) (local, self-contained — interactive prototype of the layer dropdown, stacked and rows modes)
**Companion to:** [`layers_rendering_audit.md`](layers_rendering_audit.md) — the Sonic Visualiser layer stack in `Documentation/layers/` is the **prototype guide** for the layout and math below.
**Status:** implemented 2026-07-16 — all phases landed in one pass (`src/components/examiner/layers/` + `renderLayerStack.ts` + `LayersMenu.tsx`; ExaminerTab's `renderPreview` now assembles `LayerData` and delegates). A `NotesLayer` (root + harmonic series markers) was added beyond the original eight.
**Target:** `Web_Front/src/components/ExaminerTab/` + `Web_Front/src/components/examiner/`

---

## 1. What exists today (current-state audit)

The Examiner's wave view is one monolithic canvas render: `renderPreview` (`ExaminerTab.tsx:367-513`, ~150 lines inside a 966-line component). It draws, in fixed order, onto a single canvas:

| Overlay | Source | Math (as implemented) |
|---|---|---|
| Spectrum fill + trace | `drawSpectrum.ts` | Welch-style averaged FFT: up to 32 Hann-windowed segments (segment ≤ 16384 samples, radix-2 Cooley–Tukey in `audioAnalysis.ts:14`), bin-max condensed onto 360 log-frequency bands, peak-normalized; `x = w·(ln f − ln f₀)/(ln f₁ − ln f₀)`, `y = plotBottom − clamp((dB+90)/90)·plotH` |
| Waveform L/R | `drawWaveform.ts` | min/max per pixel column, `y = centerY − v·halfHeight·0.97`; stereo gets two lanes in the top pane |
| Loudness | `drawOverlays.ts:16` | windowed RMS per pixel column, `dB = 20·log10(rms)`, floor −60; `y = plotBottom − clamp((dB+60)/60)·plotH` |
| Phase | `drawOverlays.ts:44` | per-column normalized inter-channel correlation `corr = Σ L·R / √(Σ L² · Σ R²)`, `y = mid − corr·halfH` (+1 top, −1 bottom); stereo only |
| ADSR envelope | `drawEnvelope.ts:5` | dashed white polyline through `[0,0]→[attack,1]→[+decay,sustain]→[duration−release,sustain]→[duration,0]` |
| Beat grid, regions bar, axes/name, legend | `drawEnvelope.ts:44,79` + inline in `renderPreview` | BPM dots (red/orange/yellow/green), region colour bar, 8 time ticks, A-octave note axis (`27.5·2^oct` Hz), hard-coded legend |

**Findings:**

1. **No visibility control.** Every overlay always draws (phase gated only on stereo). The legend at `ExaminerTab.tsx:482` is hard-coded to three entries.
2. **Geometry is ad hoc.** The top-pane/bottom-pane split (`geoTop`/`geoBottom`, `ExaminerTab.tsx:399-410`) is computed inline; the full-height overlays (spectrum, envelope, markers) use the parent `geo`. This is exactly the "rows vs overlay" distinction the new dropdown needs — it just isn't expressed as data.
3. **The draw helpers are already layer-shaped.** Each is a pure `(ctx, data, geo, colour)` function with no React/DOM — the SV `paint(LayerGeometryProvider, QPainter, QRect)` contract in miniature. The migration is a formalisation, not a rewrite.
4. **A precedent for the dropdown already exists**: the ⚙ Columns menu with a persisted `Set` in localStorage (`COLS_KEY`, `ExaminerTab.tsx:114-128`). The layer menu should reuse this exact pattern.
5. **Decode work is well guarded** (generation-guarded, debounced) but analysis is recomputed per render: `computeSpectrum` runs on every `renderPreview`, including resize redraws. Layer-level caching (SV's dormancy idea) fixes this for free.

---

## 2. Target architecture — the SV contract, in TypeScript

The Sonic Visualiser stack audited in `layers_rendering_audit.md` gives us the shape:

| Sonic Visualiser | Examiner equivalent |
|---|---|
| `Layer::paint(LayerGeometryProvider*, QPainter&, QRect)` — geometry passed per call, never stored | `ExaminerLayer.draw(ctx, geo, data)` — pure function, `PlotGeo` passed per call |
| `LayerFactory` model-type → layer-type map | `layers/registry.ts` — the single list the dropdown, legend, and compositor all read |
| `isLayerOpaque` / paint order | `placement: 'overlay' \| 'row'` + registry order = z-order |
| Layer dormancy (hidden layers may drop caches) | hidden layers skip **both** compute and draw; analysis caches keyed per decode |
| `ColourScale` value→pixel chain (gain → threshold → log map → proportion → palette, pixel 0 reserved) | `layers/colourScale.ts` — one shared implementation for spectrogram / 3-D / slices |
| `ScaleApplication` (Normal / Deferring / Personal) | overlay layers share the master `PlotGeo`; row layers get a private lane geo |
| `RenderTimer` (0.1 s soft / 0.2 s hard budget) | chunked spectrogram painting across `requestAnimationFrame` ticks |

### 2.1 The layer interface (`layers/types.ts`)

```ts
// Full-English names throughout, per project convention.
export interface LayerData {
  buffer: AudioBuffer;
  mono: Float32Array;
  left: Float32Array;
  right: Float32Array | null;          // null for mono files
  spectrum: Spectrum | null;            // averaged trace (existing computeSpectrum)
  spectrogramFrames: SpectrogramFrames | null;   // STFT frames, computed lazily
  item: any;                            // full .PEAK record
  colours: { group: string; complement: string };
  duration: number;
  sampleRate: number;
}

export interface ExaminerLayer {
  id: string;                           // 'spectrum' | 'envelope' | 'phase' | 'loudness' | ...
  label: string;                        // dropdown + legend text
  colour: string;                       // legend swatch (or 'dynamic' for heat maps)
  defaultVisible: boolean;
  defaultPlacement: 'overlay' | 'row';  // user can override per layer
  needsStereo?: boolean;                // phase: auto-hidden for mono
  needsSpectrogram?: boolean;           // triggers lazy STFT computation when shown
  rowHeightWeight?: number;             // relative lane height in rows mode (default 1)
  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData): void;
}
```

### 2.2 File plan — one layer per file

**Break out of the existing code (pixel-identical extraction):**

| New file | Extracted from | Notes |
|---|---|---|
| `layers/WaveformLayer.tsx` | `drawWaveform.ts` + the stereo-lane logic at `ExaminerTab.tsx:417-435` | the L/R lane split moves in here |
| `layers/SpectrumLayer.tsx` | `drawSpectrum.ts` (fill + trace + note axis + root marker) | existing averaged-FFT math unchanged |
| `layers/EnvelopeLayer.tsx` | `drawEnvelope.ts` `drawEnvelope` | full-height overlay |
| `layers/LoudnessLayer.tsx` | `drawOverlays.ts` `drawLoudness` | "volume" toggle; keep −60 dB floor |
| `layers/PhaseLayer.tsx` | `drawOverlays.ts` `drawPhase` | `needsStereo: true` |
| `layers/ChromeLayer.tsx` | `drawBeats`, regions bar, `drawAxesAndName`, playhead chrome | always-on frame furniture, not in the dropdown |

**New layers, math guided by the SV prototype:**

| New file | Toggle name | SV guide (see companion audit) | Core math |
|---|---|---|---|
| `layers/PianoScaleLayer.tsx` | piano scale | `PianoScale.cpp` §horizontal | iterate MIDI 0–127, `f = 440·2^((p−69)/12)`; x from the spectrum's log-frequency mapper; white/black key rects along the top axis under the A-octave labels, middle C highlighted |
| `layers/SpectrogramLayer.tsx` | waterfall frequency view | `SpectrogramLayer` §3 + `Colour3DPlotRenderer` §4 | STFT heat map: window 1024 Hann, hop = width-derived (≥ 50% overlap); `f = bin·sr/fftSize`; y = log-frequency; colour via the ported value→pixel chain with **dB² option** (`2·log`) and reserved background pixel 0; when columns-per-pixel > 1, **max-aggregate — never average** |
| `layers/Spectrogram3DLayer.tsx` | 3d spectrum | `Colour3DPlotLayer` bin math + SV waterfall tradition | ridgeline waterfall: N time slices drawn back-to-front, each slice a filled spectrum trace offset by `(slice/N)·depthY` with occlusion (painter's algorithm); same log-x mapper as SpectrumLayer, dB y within each ridge |
| `layers/SlicesLayer.tsx` | slices | `SliceLayer` §2 | spectrum slice at the playhead (or at K evenly spaced anchors when paused): log-x with the 0.8-shift compromise `x = w·(log10(p+0.8)−log10(pmin+0.8))/(log10(pmax+0.8)−log10(pmin+0.8))`; dB energy `norm = (dB−thresh)/(−thresh)`; sampling nearest / mean / peak across the window |

**Support files:**

- `layers/registry.ts` — `export const EXAMINER_LAYERS: ExaminerLayer[]` in paint order (background → chrome). The dropdown, legend, and compositor all derive from this one list (the `LayerFactory` role).
- `layers/colourScale.ts` — the ported SV chain: `value ×gain → threshold cut (→ index 0) → {linear|log|dB²} → proportion → palette index 1–255 → RGB`; Sunset palette formulas from `ColourMapper.cpp` (`r=(n−0.24)·2.38, g=(n−0.64)·2.777, b triangular`).
- `layers/stft.ts` — `computeSpectrogramFrames(mono, sampleRate, {windowSize, hop})`, reusing `fftRadix2`; computed **once per decode, only when a spectrogram-needing layer is visible**, cached on the `LayerData`. If profiling demands it later, this is the seam to swap in the Rust/wasm engine (`analyze_buffer` already exists in the Scananalyzer workflow) — but plain JS STFT of a ≤30 s sample is well within budget.
- `LayerStack.tsx` — the orchestrator (next section).

### 2.3 LayerStack — dropdown, overlay mode, rows mode

`ExaminerTab` replaces `renderPreview` + the inline canvas with:

```tsx
<LayerStack buffer={decoded} item={full} playheadRef={playheadRef} />
```

`LayerStack` owns:

1. **The Layers dropdown** — same pattern as ⚙ Columns: a `glass-panel` menu with one row per registry entry: a checkbox (SHOW/HIDE), the legend swatch, and a small `overlay ⇄ row` placement toggle. Persisted as `scanalyzer_examiner_layers_v1` → `{ [id]: { visible, placement } }` in localStorage, versioned like `COLS_KEY`.
2. **Compositing, overlay mode** (default — today's look): all visible `placement:'overlay'` layers draw onto the shared full-height `PlotGeo` in registry order. Waveform keeps the top pane, loudness/phase the bottom pane, spectrum/envelope span both — the current `geoTop`/`geoBottom` split becomes data on those layers rather than inline code.
3. **Rows mode**: each visible layer gets its own lane — `laneH = plotH · weight/Σweights` — with a private `PlotGeo` (its own `mid`/`halfH`), all sharing the single time axis and playhead. This is SV's stacked-panes model. The mode switch ("Stack overlays" / "Rows") lives at the top of the same dropdown.
4. **The legend** — generated from visible layers (fixes the hard-coded list at `ExaminerTab.tsx:482`).
5. **Redraw plumbing** — the existing ResizeObserver redraw and generation guards move here unchanged. Heat-map layers paint chunked across animation frames with an SV-style budget so a long file never freezes the WebKitGTK webview.

Everything stays **100% client-side** — no server compute, no network calls, per the Web_Front constraint.

---

## 3. Deployment strategy

Phased so every step ships alone, each verifiable against the previous screenshot.

**Phase 0 — Extraction (no visual change).**
Create `layers/types.ts` + `registry.ts`; move the six existing draws into their layer files; `renderPreview` becomes a thin loop over the registry with everything visible in overlay mode. **Gate:** screenshot parity with today's view (same sample, same canvas size) on web and Tauri.

**Phase 1 — Visibility dropdown.**
Add `LayerStack` with the Layers menu (SHOW/HIDE only), localStorage persistence, legend generated from visible layers. Phase auto-disabled on mono stays. **Gate:** toggling each layer on/off leaves the others pixel-stable; prefs survive reload.

**Phase 2 — Cheap new layers.**
`PianoScaleLayer` (pure drawing, no new analysis) and `SlicesLayer` (one FFT column at the playhead — reuse `fftRadix2`). **Gate:** slice at the playhead matches the averaged spectrum's peaks for a steady tone; piano keys align with the A-octave axis (A4 key centre at 440 Hz).

**Phase 3 — Spectrogram engine + heat layers.**
`stft.ts` (lazy, cached per decode) + `colourScale.ts` (ported SV chain + Sunset), then `SpectrogramLayer` (waterfall frequency view) and `Spectrogram3DLayer` (ridgeline). Compute only when first shown — SV dormancy. **Gate:** a sine sweep draws a clean diagonal with no dropped peaks at any canvas width (the max-aggregate invariant); toggling the layer off after viewing frees no-longer-needed frames on next decode.

**Phase 4 — Rows mode.**
Per-layer placement toggle + the stack/rows mode switch; lane geometry with weights (spectrogram wants `rowHeightWeight: 2`). **Gate:** playhead and time axis stay aligned across every lane; mobile (narrow) falls back to overlay mode.

**Risks to watch:** WebKitGTK canvas performance on large STFTs (mitigate: chunked painting, cap frames to canvas width); localStorage schema drift (mitigate: versioned key, default-visible fallback); the 966-line `ExaminerTab` shrinking is a side benefit but don't refactor the table/transport in the same PRs.

---

## 4. Cross-reference map (audit → audit)

| Requested toggle | Examiner layer file | Existing web math | SV prototype section |
|---|---|---|---|
| spectrum | `SpectrumLayer.tsx` | `drawSpectrum.ts` averaged FFT | SpectrumLayer / SliceLayer (§5 of layers audit) |
| volume | `LoudnessLayer.tsx` | `drawOverlays.ts` RMS dBFS | WaveformLayer dB scale (§2) — the −80 dB floor / meter-curve options are the upgrade path |
| phase | `PhaseLayer.tsx` | `drawOverlays.ts` correlation | (no direct SV twin — SV's Phase is FFT-bin phase; an FFT-phase colour variant is a possible later mode) |
| envelope | `EnvelopeLayer.tsx` | `drawEnvelope.ts` ADSR | TimeValueLayer curve style (§7) |
| piano scale | `PianoScaleLayer.tsx` | — new | PianoScale horizontal (§7/§8) |
| slices | `SlicesLayer.tsx` | — new | SliceLayer (§5): log-x 0.8 shift, dB energy, nearest/mean/peak |
| waterfall frequency view | `SpectrogramLayer.tsx` | — new | SpectrogramLayer (§3) + renderer invariants (§4) |
| 3d spectrum | `Spectrogram3DLayer.tsx` | — new | Colour3DPlotLayer bin math (§4) applied as a ridgeline |

*Sources: `ExaminerTab.tsx` and `examiner/draw*.ts` read in full; SV formulas per `layers_rendering_audit.md` at commit 198a320.*
