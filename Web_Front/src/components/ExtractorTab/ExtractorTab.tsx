import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { resolveAudioUrl, isTauri, getDirHandle, writePeakSidecar, relPathOf } from '../../audioLinking';
import { toMono } from '../examiner/audioAnalysis';
import { decodeWav } from '../examiner/decodeWav';
import { decodeViaWasm } from '../examiner/wasmDecode';
import { ucsSubColor } from '../../groupColors';
import { DEFAULT_REGION_PARAMS, type Region, type RegionParams } from '../examiner/detectRegions';
import { extractorEngine, DEFAULT_ENGINE_PARAMS, type EngineParams, type ChunkAnalysis } from '../../extractorEngine';
import { useIsNarrow } from '../../useIsNarrow';
import { categoryEmoji, categoryLabel, subcategoryEmoji, subcategoryLabel } from '../../categoryEmoji';
import { altCategory } from '../../ucsIndex';
import FileGroups from './FileGroups';
import WavePlayer from './WavePlayer';
import WaveCircle from './WaveCircle';
import { regionColor } from './shared';

interface ExtractorTabProps {
  analysisResult: any[];
  filteredData: any[];
  audioFiles: File[];
  onSound?: (name: string) => void;
  setAnalysisResult: (results: any[]) => void;
  // The Extractor owns its own <audio> (it drives the wave circle eye, region loops and
  // fades), so it registers its transport and the footer's Play drives THIS player. See App.
  registerTransport?: (t: { play: () => void; dig: () => void } | null) => void;
  onPlayingChange?: (playing: boolean) => void;
  // Favorite flags (relative path → favorited_unix), owned by App — favorite rows in the
  // file list render their name in orange with a ★.
  favorites?: Map<string, number>;
}

const fmt = (s: number) => `${s.toFixed(3)}s`;

// A source filename often packs several pre-made names, dash-separated, e.g.
//   "93 - CRASHES WOOD - CRASHES CONCRETE - HEAVY WOOD CRASH.mp3"
// Split those into individual name options (dropping the extension and any pure-number
// index token like the leading "93") so each can be offered as a region name.
const parseNameOptions = (fileName: string): string[] => {
  const stem = (fileName || '').replace(/\.[^.]+$/, '');
  const seen = new Set<string>();
  return stem.split(/\s+-\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !/^\d+$/.test(s) && !seen.has(s) && seen.add(s));
};

// The UI keeps three sliders (threshold / min gap / min region); the engine takes the
// richer improved-algorithm params. Derive them: the threshold is the gate's OPEN floor,
// and CLOSE sits 6 dB below it for hysteresis (no chatter). Padding, transient-onset and
// zero-cross snapping use the improved defaults (clean, tight cuts).
const toEngineParams = (p: RegionParams): EngineParams => ({
  ...DEFAULT_ENGINE_PARAMS,
  open_threshold_db: p.threshold_decibels,
  close_threshold_db: p.threshold_decibels - 6,
  minimum_silence_seconds: p.minimum_silence_seconds,
  minimum_region_seconds: p.minimum_region_seconds,
});

export default function ExtractorTab({ analysisResult, filteredData, audioFiles, onSound, setAnalysisResult, registerTransport, onPlayingChange, favorites }: ExtractorTabProps) {
  const [filter, setFilter] = useState('');
  useEffect(() => { setFilter(''); }, [analysisResult]);

  const [multiOnly, setMultiOnly] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [params, setParams] = useState<RegionParams>(DEFAULT_REGION_PARAMS);
  const [regions, setRegions] = useState<Region[]>([]);
  // The chunk row the user has selected (highlighted; its loop is auditioned on play).
  const [selRegion, setSelRegion] = useState<number | null>(null);
  // Per-chunk UCS analysis (slice → full analyzer → Peak), keyed by region index, plus the
  // set currently being analyzed. A chunk too short to analyze comes back {status:'too_short'}.
  const [chunkUcs, setChunkUcs] = useState<Record<number, ChunkAnalysis>>({});
  const [examining, setExamining] = useState<Set<number>>(new Set());
  const [decoding, setDecoding] = useState(false);
  // Automatic anti-click micro-fade applied to every exported slice, in SAMPLES. A couple of
  // samples in and a short tail out removes the boundary click without audibly altering the
  // slice. Acts as a floor: a larger per-region fade (the Fade in/out columns) still wins.
  const [rampInSamples, setRampInSamples] = useState(2);
  const [tailOutSamples, setTailOutSamples] = useState(20);
  const [playing, setPlaying] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  // Bumped the moment the decoded PCM (samplesRef / lengthRef) is ready. samples & length
  // are refs, so the waveform/circle would otherwise not redraw until the next state change
  // (post-detect); bumping this forces the render that draws them, so playback can start in
  // sync with a visible waveform rather than running ahead of a blank one.
  const [, setWaveNonce] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const decodeCtxRef = useRef<AudioContext | null>(null);
  // Playback graph: the <audio> routed through a GainNode so preview playback can sound
  // each region's fades (what you hear matches what you export), not just show them.
  const playCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const samplesRef = useRef<Float32Array | null>(null);
  const lengthRef = useRef(0);
  const sampleRateRef = useRef(44100);
  const loadGenRef = useRef(0);
  // Latest regions, for the debounced slider re-detect to reseed names against without
  // re-creating the callback each render.
  const regionsRef = useRef<Region[]>([]);
  useEffect(() => { regionsRef.current = regions; });
  // Monotonic detect sequence: a slower detect that resolves after a newer one is dropped.
  const detectSeqRef = useRef(0);
  // Debounce handle for slider-driven re-detects.
  const detectTimerRef = useRef<number | null>(null);
  // While set, playback stops at this time — used to preview a single region (the ▶
  // button in the table). One-shot, no loop.
  const stopAtRef = useRef<number | null>(null);
  // Active loop window while playing: a hovered region [start,end], or null to loop the
  // whole file. Set by hovering a region on either waveform.
  const loopRegionRef = useRef<{ start: number; end: number } | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const isNarrow = useIsNarrow();

  useEffect(() => () => { decodeCtxRef.current?.close(); playCtxRef.current?.close(); }, []);

  const color = useMemo(
    () => ucsSubColor(selectedItem?.ucs?.category || '', (selectedItem?.ucs?.subcategory || '').trim()),
    [selectedItem],
  );
  const nameOptions = useMemo(() => parseNameOptions(selectedItem?.metadata?.name || ''), [selectedItem]);

  // The file list: scope chips + filter text + optional "multiple regions only".
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return filteredData.filter((it: any) => {
      if (multiOnly && !((it.regions?.count ?? 0) > 1)) return false;
      if (q && !`${it.metadata?.name || ''} ${it.ucs?.category || ''} ${it.ucs?.subcategory || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [filteredData, filter, multiOnly]);

  // Grouped under UCS category headers, capped so a 37k-file library renders instantly.
  const groupedRows = useMemo(() => {
    const byCat = new Map<string, any[]>();
    for (const it of rows) {
      const cat = it.ucs?.category || '(unclassified)';
      const bucket = byCat.get(cat);
      if (bucket) bucket.push(it); else byCat.set(cat, [it]);
    }
    const out: ({ kind: 'header'; category: string; count: number } | { kind: 'file'; item: any })[] = [];
    for (const cat of Array.from(byCat.keys()).sort()) {
      const items = byCat.get(cat)!;
      // Most-cut files first: sort by region/cut count, highest to lowest. A count
      // of 1 means "no real cuts" — rank it with 0 so it doesn't outrank uncounted files.
      const cuts = (it: any) => { const c = it.regions?.count ?? 0; return c > 1 ? c : 0; };
      items.sort((a, b) => cuts(b) - cuts(a));
      out.push({ kind: 'header', category: cat, count: items.length });
      for (const it of items) out.push({ kind: 'file', item: it });
      if (out.length > 3000) break;
    }
    return out;
  }, [rows]);

  // A region count of 1 is a region of none: a lone region just restates "the whole
  // file", so identifying it wastes list space and load time. Only 2+ regions are real.
  const meaningfulRegions = (rs: Region[]): Region[] => (rs.length > 1 ? rs : []);

  // Carry user-typed names across a re-detect: match a new region to the closest
  // old one whose start is within 30 ms, so nudging a slider doesn't wipe labels.
  const reseedNames = (next: Region[], prev: Region[]): Region[] => {
    if (!prev.length) return next;
    return next.map(r => {
      // Match a freshly-detected region to the closest stored one (start within 30 ms) and
      // carry across BOTH the user-typed name AND the stored offline analysis — so a default
      // re-detect keeps the precomputed per-region UCS instead of blanking the column.
      const near = prev.find(p => Math.abs(p.start_seconds - r.start_seconds) < 0.03);
      if (!near) return r;
      return { ...r, name: (near as any).name || (r as any).name, analysis: (near as any).analysis ?? (r as any).analysis } as Region;
    });
  };

  // Re-detect on the loaded session (the Rust engine, in a worker). Sequence-guarded so a
  // slow detect that lands after a newer one is dropped, and it reseeds user-typed names.
  const runDetect = useCallback(async (p: RegionParams, prev: Region[]) => {
    if (!samplesRef.current) { setRegions([]); return; }
    const seq = ++detectSeqRef.current;
    const fresh = await extractorEngine.detect(toEngineParams(p));
    if (seq !== detectSeqRef.current) return;
    setRegions(meaningfulRegions(reseedNames(fresh, prev)));
  }, []);

  // Playback looping (the linear + circular playheads read `progress` themselves). A
  // one-shot region preview (stopAtRef) pauses at its end; else loop the hovered region,
  // or the whole file.
  useEffect(() => {
    let id: number;
    const tick = () => {
      const el = audioRef.current;
      if (el && !el.paused) {
        // A one-shot region preview stops at its out-point. Otherwise playback runs straight
        // to the natural end — no looping (the region loop-on-hover was resetting currentTime
        // every frame, which is the "stalls and repeats the start" bug).
        if (stopAtRef.current != null && el.currentTime >= stopAtRef.current) { el.pause(); stopAtRef.current = null; }
        // Sound the fades: duck the gain over the containing region's fade-in/out windows,
        // matching the linear ramp the exporter applies.
        const g = gainRef.current;
        if (g) {
          const t = el.currentTime;
          const r = regionsRef.current.find(rr => t >= rr.start_seconds && t <= rr.end_seconds);
          let gain = 1;
          if (r) {
            const fi = r.fade_in_seconds || 0, fo = r.fade_out_seconds || 0;
            if (fi > 0 && t < r.start_seconds + fi) gain = Math.max(0, (t - r.start_seconds) / fi);
            else if (fo > 0 && t > r.end_seconds - fo) gain = Math.max(0, (r.end_seconds - t) / fo);
          }
          g.gain.value = gain;
        }
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const setupAudioAndDetect = async (src: string, savedRegions: Region[], nativePath: string | null, lengthHint = 0) => {
    const gen = ++loadGenRef.current;
    setDecoding(true);
    samplesRef.current = null;
    // Show the .PEAK's stored regions right away, so a file the scan found N regions in
    // never reads as "0 regions" while (or if) the live re-detect can't run.
    setRegions(meaningfulRegions(savedRegions));
    setSelRegion(null);
    setChunkUcs({});
    setExamining(new Set());
    // On desktop with a real path, detect/slice/analyze run natively in-process; otherwise
    // (web, or a dropped file with no path) they run in the WASM worker.
    extractorEngine.setNative(nativePath);

    // Display waveform: decode via Web Audio, best-effort. This can intermittently FAIL for
    // MP3 in the WebKitGTK webview, so it must not gate detection — the native detect decodes
    // the file itself. On web the worker session needs this PCM, so load() runs only here.
    let decodedOk = false;
    if (src) {
      try {
        if (audioRef.current) {
          document.querySelectorAll('audio').forEach(a => a.pause());
          audioRef.current.src = src;
          audioRef.current.currentTime = 0;
          // Prime the source, but DON'T play yet: the waveform/circle can't draw until the
          // decode below fills samplesRef/lengthRef, so starting here runs the audio ahead of
          // a blank wave. Auto-play begins once the PCM is ready (or on decode failure).
          stopAtRef.current = null;
          loopRegionRef.current = null;
          ensureAudioGraph();
        }
        if (!decodeCtxRef.current) {
          decodeCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const buf = await (await fetch(src)).arrayBuffer();
        if (gen !== loadGenRef.current) return;
        // decodeAudioData detaches the buffer, so decode a copy and keep `buf` for the
        // fallbacks (WebKitGTK's Web Audio decode fails on plain WAV intermittently and on
        // compressed formats outright). decodeWav catches WAV; the WASM analyzer catches
        // MP3/OGG/M4A/AAC/FLAC/AIFF. `nativePath`/`src` supply the extension hint.
        let decoded: AudioBuffer | null | undefined = null;
        try {
          const decodePromise = decodeCtxRef.current.decodeAudioData(buf.slice(0));
          if (decodePromise) {
            decoded = await Promise.race([
              decodePromise,
              new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 150))
            ]);
          }
        } catch (e) {
          // decodeAudioData rejected or timed out
        }

        if (!decoded) {
          decoded =
            decodeWav(buf, decodeCtxRef.current) ??
            (await decodeViaWasm(buf, nativePath || src || '', decodeCtxRef.current));
        }
        if (gen !== loadGenRef.current) return;
        if (!decoded) throw new Error('undecodable');
        const mono = toMono(decoded);
        samplesRef.current = mono;
        lengthRef.current = decoded.duration;
        sampleRateRef.current = decoded.sampleRate;
        decodedOk = true;
        // The PCM (and true length) are ready. Force the render that draws the waveform and
        // circle off the freshly-filled refs, then start playback from the top — so the audio,
        // the linear playhead and the ring all begin together, in sync.
        setWaveNonce(n => n + 1);
        const el = audioRef.current;
        if (el && gen === loadGenRef.current) { el.currentTime = 0; el.play().catch(() => {}); }
        if (!nativePath) await extractorEngine.load(mono, decoded.sampleRate); // web worker session
      } catch {
        samplesRef.current = null; // waveform trace stays blank, but detection can still run
        // No decoded waveform to sync to (e.g. an MP3 the webview's Web Audio couldn't decode).
        // The <audio> element can still play the file directly — auto-play best-effort.
        const el = audioRef.current;
        if (el && gen === loadGenRef.current) el.play().catch(() => {});
      }
    }
    if (!decodedOk && nativePath && lengthHint > 0) lengthRef.current = lengthHint; // give the overlay a time base

    // Detect chunks. Native (desktop) decodes from the path itself, so it runs even when the
    // display decode above failed; the WASM worker path needs the loaded PCM (decodedOk).
    try {
      if (gen !== loadGenRef.current) return;
      if (nativePath || decodedOk) {
        const fresh = await extractorEngine.detect(toEngineParams(params));
        if (gen !== loadGenRef.current) return;
        // If the live detect comes back empty but the record already knows regions, keep the
        // stored ones rather than wiping to nothing.
        setRegions(meaningfulRegions(fresh.length ? reseedNames(fresh, savedRegions) : savedRegions));
      }
      // else: couldn't decode or detect — leave the stored regions in place (set above).
    } catch {
      /* keep the stored regions set above */
    } finally {
      if (gen === loadGenRef.current) setDecoding(false);
    }
  };

  // A slim manifest row carries only regions.count; the full .PEAK carries every region
  // plus its stored offline analysis. Fetch the full record (desktop) so the Extractor can
  // show the precomputed per-region UCS and boundaries without re-analyzing. On any failure,
  // or on web, fall back to whatever the row already has.
  const fetchFull = async (item: any): Promise<any> => {
    if (Array.isArray(item?.regions?.regions)) return item;
    const path = item?.metadata?.path;
    if (isTauri() && path) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const txt = await invoke<string>('read_full_record', { path });
        const parsed = JSON.parse(txt);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (e) { console.warn('[extractor] could not load full record', path, e); }
    }
    return item;
  };

  const handleSelect = async (item: any) => {
    setSelectedItem(item);
    setSaveMsg('');
    onSound?.(item?.metadata?.name || '');
    const src = await resolveAudioUrl(audioFiles, item);
    // Desktop can decode + detect the real file natively — but ONLY when the record carries
    // a real absolute path. The demo pack (and browser-scanned .PEAKs) record a relative
    // web path that is not a file on disk; handing that to the native engine just fails, so
    // it must go through the decoded-blob / worker path instead.
    const path = String(item?.metadata?.path || '');
    const isAbs = /^([A-Za-z]:[\\/]|\/)/.test(path);
    const nativePath = isTauri() && isAbs ? path : null;
    if (!src && !nativePath) { setDecoding(false); return; }
    // Load the full record first (stored regions + their offline analysis), then detect.
    const full = await fetchFull(item);
    await setupAudioAndDetect(src || '', full.regions?.regions || [], nativePath, Number(item?.metadata?.length_seconds) || 0);
  };

  // Flat file list in the exact display order, for arrow-key navigation.
  const flatFiles = useMemo(
    () => groupedRows.filter((r): r is { kind: 'file'; item: any } => r.kind === 'file').map(r => r.item),
    [groupedRows],
  );

  // ↑/↓ move the file SELECTION (and load it) rather than scrolling the panel — the
  // page's default arrow-scroll is suppressed. Ignored while a text/number field is
  // focused, so editing region names and in/out points still works normally. From no
  // selection, ↓ picks the first file and ↑ the last.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!flatFiles.length) return;
      e.preventDefault();
      const cur = flatFiles.indexOf(selectedItem);
      const next = cur === -1
        ? (e.key === 'ArrowDown' ? 0 : flatFiles.length - 1)
        : Math.max(0, Math.min(flatFiles.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      if (next !== cur) handleSelect(flatFiles[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flatFiles, selectedItem]);

  const loadDroppedFile = async (file: File) => {
    if (!/\.(wav|wave|mp3|flac|aif|aiff|aifc|ogg|oga|m4a|mp4|aac)$/i.test(file.name)) return;
    const item = { metadata: { name: file.name, path: file.name }, ucs: {}, classification: {}, regions: { count: 0, regions: [] } };
    setSelectedItem(item);
    setSaveMsg('');
    onSound?.(file.name);
    // A dropped file has no on-disk path we can hand the native decoder — use the worker.
    await setupAudioAndDetect(URL.createObjectURL(file), [], null);
  };

  const changeParam = (key: keyof RegionParams, value: number) => {
    const next = { ...params, [key]: value };
    setParams(next);
    // Debounce: dragging a slider fires many changes; re-detect once it settles (~40 ms).
    if (detectTimerRef.current) clearTimeout(detectTimerRef.current);
    detectTimerRef.current = window.setTimeout(() => runDetect(next, regionsRef.current), 40);
  };

  // Route the <audio> through a GainNode once, so the playback loop can duck the volume
  // over each region's fade windows. createMediaElementSource can only run once per
  // element, so it's lazy and guarded. Resumed on the user gesture that triggers play.
  const ensureAudioGraph = () => {
    const el = audioRef.current;
    if (!el) return;
    if (!playCtxRef.current) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const src = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        src.connect(gain);
        gain.connect(ctx.destination);
        playCtxRef.current = ctx;
        gainRef.current = gain;
      } catch { /* older webview without MediaElementSource — playback just skips fades */ }
    }
    playCtxRef.current?.resume().catch(() => {});
  };

  const playRegion = (r: Region) => {
    const el = audioRef.current;
    if (!el) return;
    ensureAudioGraph();
    el.currentTime = r.start_seconds;
    stopAtRef.current = r.end_seconds;
    el.play().catch(() => {});
  };
  // Select (highlight) a chunk row, focus the players' loop on it, and audition it right
  // away — selecting IS playing, so there's no separate per-row play button.
  const selectRegion = (i: number) => {
    setSelRegion(i);
    const r = regions[i];
    if (r) {
      loopRegionRef.current = { start: r.start_seconds, end: r.end_seconds };
      playRegion(r);
    }
  };
  // Wheel over the circular player steps to the next (+1) / previous (-1) slice and
  // auditions it. From no selection, down → first, up → last.
  const stepRegion = (dir: 1 | -1) => {
    if (!regions.length) return;
    const cur = selRegion ?? (dir > 0 ? -1 : regions.length);
    const next = Math.max(0, Math.min(regions.length - 1, cur + dir));
    selectRegion(next); // selecting auditions the region
  };

  // Run one chunk through the full UCS analyzer (slice → WAV → analyze in the engine
  // worker) and stash the Peak (or the too-short sentinel) for the row to show.
  const examineChunk = async (i: number) => {
    const r = regions[i];
    if (!r) return;
    setExamining(s => new Set(s).add(i));
    const base = (selectedItem?.metadata?.name || 'chunk').replace(/\.[^.]+$/, '');
    const name = `${base}_${(r.name || `region_${i + 1}`).replace(/[^\w.-]+/g, '_')}`;
    const folder = selectedItem?.metadata?.folder || '';
    try {
      const res = await extractorEngine.analyzeChunk(r, name, folder);
      setChunkUcs(u => ({ ...u, [i]: res }));
    } finally {
      setExamining(s => { const n = new Set(s); n.delete(i); return n; });
    }
  };
  const examineAll = async () => { for (let i = 0; i < regions.length; i++) await examineChunk(i); };
  const playAll = () => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) { el.pause(); return; }
    ensureAudioGraph();
    stopAtRef.current = null;
    if (el.duration && el.currentTime >= el.duration - 0.01) el.currentTime = 0;
    el.play().catch(() => {});
  };

  // Mirror playing state up, and register the transport so the footer Play drives THIS
  // player (and thus the wave circle eye). Dig isn't a concept here → no-op. A ref wrapper
  // keeps a stable identity that always calls the latest playAll.
  useEffect(() => { onPlayingChange?.(playing); }, [playing, onPlayingChange]);
  const playAllRef = useRef(playAll);
  playAllRef.current = playAll;
  useEffect(() => {
    registerTransport?.({ play: () => playAllRef.current(), dig: () => {} });
    return () => registerTransport?.(null);
  }, [registerTransport]);

  // Current playback position as a fraction of the file (for the playheads).
  const progress = () => {
    const el = audioRef.current;
    const len = lengthRef.current || el?.duration || 0;
    return el && len > 0 ? el.currentTime / len : null;
  };

  // Mouse over the circular player → start playback (from the current position, or the top
  // if it had reached the end). No-op if already playing. Clicking the ring seeks — onScrub.
  const playFromHover = () => {
    const el = audioRef.current;
    if (!el || !el.paused) return;
    ensureAudioGraph();
    if (el.duration && el.currentTime >= el.duration - 0.01) el.currentTime = 0;
    el.play().catch(() => {});
  };
  // Click / drag on a waveform → seek there (and play).
  const onScrub = (f: number) => {
    const el = audioRef.current;
    if (!el) return;
    ensureAudioGraph();
    stopAtRef.current = null;
    el.currentTime = f * (lengthRef.current || el.duration || 0);
    if (el.paused) el.play().catch(() => {});
  };

  // Each slice is cut + faded + WAV-encoded by the Rust engine (in the worker), so the
  // exported file is byte-identical to what the analyzer would read back and never janks
  // the UI. Downloads are staggered so the browser doesn't drop simultaneous ones.
  const exportSlices = async () => {
    if (!samplesRef.current || !regions.length) return;
    const base = (selectedItem?.metadata?.name || 'slice').replace(/\.[^.]+$/, '');
    const sr = sampleRateRef.current || 44100;
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      // Apply the anti-click micro-fade as a floor on this region's fades (samples → seconds).
      const eff: Region = {
        ...r,
        fade_in_seconds: Math.max(r.fade_in_seconds || 0, rampInSamples / sr),
        fade_out_seconds: Math.max(r.fade_out_seconds || 0, tailOutSamples / sr),
      };
      const wav = await extractorEngine.sliceWav(eff);
      if (!wav.length) continue;
      // Copy into a plain-ArrayBuffer-backed view so it's a valid BlobPart.
      const bytes = new Uint8Array(wav.length);
      bytes.set(wav);
      const name = `${base}_${(r.name || `region_${i + 1}`).replace(/[^\w.-]+/g, '_')}.wav`;
      download(name, new Blob([bytes], { type: 'audio/wav' }), 'audio/wav');
      await new Promise(res => setTimeout(res, 120));
    }
  };

  const updateRegion = (i: number, patch: Partial<Region>) => {
    setRegions(rs => rs.map((r, j) => {
      if (j !== i) return r;
      const merged = { ...r, ...patch };
      merged.duration_seconds = Math.max(0, merged.end_seconds - merged.start_seconds);
      return merged;
    }));
  };
  const deleteRegion = (i: number) => setRegions(rs => rs.filter((_, j) => j !== i).map((r, j) => ({ ...r, index: j })));
  const applyNameOptions = () => {
    if (!nameOptions.length) return;
    setRegions(rs => rs.map((r, i) => (i < nameOptions.length ? { ...r, name: nameOptions[i] } : r)));
  };
  const addRegion = () => setRegions(rs => {
    const start = rs.length ? rs[rs.length - 1].end_seconds : 0;
    const end = Math.min(lengthRef.current || start + 0.5, start + 0.5);
    return [...rs, { index: rs.length, start_seconds: start, end_seconds: end, duration_seconds: Math.max(0, end - start), peak_amplitude: 0, name: '' }];
  });

  const buildExport = () => ({
    file: selectedItem?.metadata?.name || '',
    path: selectedItem?.metadata?.path || '',
    length_seconds: lengthRef.current,
    detection: { ...params },
    regions: regions.map((r, i) => ({
      index: i, name: r.name || `region_${i + 1}`,
      in_point_seconds: r.start_seconds, out_point_seconds: r.end_seconds, duration_seconds: r.duration_seconds,
    })),
  });
  const download = (name: string, text: BlobPart, type: string) => {
    const blob = text instanceof Blob ? text : new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const exportJson = () => {
    const base = (selectedItem?.metadata?.name || 'regions').replace(/\.[^.]+$/, '');
    download(`${base}.regions.json`, JSON.stringify(buildExport(), null, 2), 'application/json');
  };
  const exportCsv = () => {
    const base = (selectedItem?.metadata?.name || 'regions').replace(/\.[^.]+$/, '');
    const rowsCsv = [
      'index,name,in_point_seconds,out_point_seconds,duration_seconds',
      ...regions.map((r, i) => `${i},"${(r.name || `region_${i + 1}`).replace(/"/g, '""')}",${r.start_seconds.toFixed(6)},${r.end_seconds.toFixed(6)},${r.duration_seconds.toFixed(6)}`),
    ].join('\n');
    download(`${base}.regions.csv`, rowsCsv, 'text/csv');
  };
  const saveToRecord = async () => {
    if (!selectedItem) return;
    const payload = {
      count: regions.length,
      detection_threshold_decibels: params.threshold_decibels,
      minimum_silence_seconds: params.minimum_silence_seconds,
      minimum_region_seconds: params.minimum_region_seconds,
      regions: regions.map((r, i) => ({
        index: i, start_seconds: r.start_seconds, end_seconds: r.end_seconds,
        duration_seconds: r.duration_seconds, peak_amplitude: r.peak_amplitude, name: r.name,
      })),
    };
    const updated = { ...selectedItem, regions: payload };
    setAnalysisResult(analysisResult.map(it => (it === selectedItem ? updated : it)));
    setSelectedItem(updated);
    try {
      const dir = await getDirHandle();
      if (dir && !isTauri()) {
        const rel = relPathOf({ name: selectedItem.metadata?.name, webkitRelativePath: selectedItem.metadata?.path } as any) || selectedItem.metadata?.path || selectedItem.metadata?.name;
        await writePeakSidecar(dir, rel, updated);
        setSaveMsg('Saved to record and .PEAK sidecar.');
        return;
      }
    } catch { /* fall through */ }
    setSaveMsg('Saved to the loaded record (export to keep a file).');
  };

  const arcs = useMemo(() => {
    const len = lengthRef.current || 1;
    return regions.map((r, i) => ({ start: r.start_seconds / len, end: r.end_seconds / len, color: regionColor(i) }));
  }, [regions]);

  const cell: React.CSSProperties = { padding: '0.2rem 0.4rem', whiteSpace: 'nowrap' };
  const numInput: React.CSSProperties = { width: 70, background: '#0d1017', color: '#fff', border: '1px solid var(--border-color)', fontSize: '0.72rem', padding: '0.1rem 0.2rem' };

  // The UCS result for a chunk row: a spinner while analyzing, the category/subcategory
  // coloured like the cloud once it lands, or a "too short" note the analyzer couldn't score.
  const ucsResult = (i: number) => {
    if (examining.has(i)) return <span style={{ color: 'var(--text-secondary)' }}>…</span>;
    // Prefer a live re-examination; otherwise show the stored offline per-region analysis
    // that shipped in the .PEAK, so the UCS column is filled the instant the file loads.
    const a: ChunkAnalysis | undefined = chunkUcs[i] ?? (regions[i] as any)?.analysis;
    if (!a) return null;
    if (a.status === 'too_short') return <span style={{ color: '#f59e0b' }} title="Too short for the analyzer to score">too short</span>;
    if (a.status === 'error') return <span style={{ color: '#ef4444' }} title={a.message}>error</span>;
    const cat = (a as any).ucs?.category || '—';
    const sub = ((a as any).ucs?.subcategory || '').trim();
    // Emoji + name normally; on narrow (column shrunk) just the category emoji.
    const disp = isNarrow ? (categoryEmoji(cat) || cat) : `${categoryLabel(cat)}${sub ? ` / ${subcategoryLabel(cat, sub)}` : ''}`;
    return <span style={{ color: ucsSubColor(cat, sub) }} title={`${cat}${sub ? ` / ${sub}` : ''}`}>{disp}</span>;
  };

  // The circular player. Desktop: a fixed right-hand column. Mobile: full-width, tucked
  // into the vertical stack directly under the waveform (the "slices").
  const waveCircle = (
    <WaveCircle samples={samplesRef.current} color={color} arcs={arcs} playing={playing} hasSelection={!!selectedItem}
      onPlay={playAll} getProgress={progress} onScrub={onScrub} onWheel={stepRegion} isNarrow={isNarrow}
      onHover={(f) => { if (f != null) playFromHover(); }} />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', position: 'relative' }}
      onDragOver={(e) => { e.preventDefault(); if (!dropActive) setDropActive(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropActive(false); }}
      onDrop={(e) => { e.preventDefault(); setDropActive(false); const file = e.dataTransfer.files?.[0]; if (file) loadDroppedFile(file); }}>
      {dropActive && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(59,130,246,0.12)', border: '2px dashed var(--accent-primary)', color: '#fff', fontSize: '1rem', fontWeight: 600 }}>
          Drop an audio file to extract its regions
        </div>
      )}

      {/* Extractor uses the global ScopeBar now */}

      <div style={{ display: 'flex', flexDirection: isNarrow ? 'column' : 'row', flex: 1, minHeight: 0, overflowY: isNarrow ? 'auto' : undefined }}>
        <FileGroups groupedRows={groupedRows} rowsCount={rows.length} multiOnly={multiOnly} setMultiOnly={setMultiOnly} selectedItem={selectedItem} onSelect={handleSelect} isNarrow={isNarrow} favorites={favorites} />

        {/* Center: waveform + controls + region table */}
        <div style={{ flex: isNarrow ? 'none' : 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#0A0A0A' }}>
          {!selectedItem ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
              Select a file (or drop one) to detect its regions.
            </div>
          ) : (
            <>
              <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                {/* Classification at a glance: the file's category emoji, then its alt 1/2/3
                    category emojis (muted), sitting beside the file name. */}
                {(() => {
                  const primary = categoryEmoji(selectedItem.ucs?.category || '') || subcategoryEmoji(selectedItem.ucs?.category || '', (selectedItem.ucs?.subcategory || '').trim());
                  const alts = [0, 1, 2].map(i => categoryEmoji(altCategory(selectedItem.ucs?.alternatives?.[i] || ''))).filter(Boolean);
                  if (!primary && !alts.length) return null;
                  return (
                    <span style={{ fontSize: '1rem', flexShrink: 0 }} title={`${selectedItem.ucs?.category || ''}${alts.length ? ` · alts: ${alts.join(' ')}` : ''}`}>
                      {primary}
                      {alts.length > 0 && <span style={{ opacity: 0.55, marginLeft: 4, fontSize: '0.85rem' }}>{alts.join(' ')}</span>}
                    </span>
                  );
                })()}
                <strong style={{ fontSize: '0.85rem', color: '#fff', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedItem.metadata?.name}>{selectedItem.metadata?.name}</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{regions.length} region{regions.length === 1 ? '' : 's'}</span>
                {decoding && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>decoding…</span>}
              </div>

              <WavePlayer samples={samplesRef.current} length={lengthRef.current} regions={regions} color={color}
                onUpdateRegion={updateRegion} onHoverTime={() => {}} getProgress={progress} />

              {/* Mobile: the play circle sits right under the slices, before the text fields. */}
              {isNarrow && waveCircle}

              {/* Detection sliders — live re-detect */}
              <div style={{ padding: '0.4rem 0.75rem', display: 'flex', gap: '1.25rem', flexWrap: 'wrap', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Threshold {params.threshold_decibels} dB</span>
                  <input type="range" min={-72} max={-12} step={1} value={params.threshold_decibels} onChange={e => changeParam('threshold_decibels', Number(e.target.value))} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Min gap {Math.round(params.minimum_silence_seconds * 1000)} ms</span>
                  <input type="range" min={0.02} max={1} step={0.01} value={params.minimum_silence_seconds} onChange={e => changeParam('minimum_silence_seconds', Number(e.target.value))} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Min region {Math.round(params.minimum_region_seconds * 1000)} ms</span>
                  <input type="range" min={0.01} max={1} step={0.01} value={params.minimum_region_seconds} onChange={e => changeParam('minimum_region_seconds', Number(e.target.value))} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title="Anti-click fade-in applied to every exported slice (a floor; a larger per-region fade still wins)">
                  <span>Ramp in {rampInSamples} smp</span>
                  <input type="number" min={0} step={1} value={rampInSamples} onChange={e => setRampInSamples(Math.max(0, Math.round(Number(e.target.value))))} style={{ width: 64, background: '#0d1017', color: '#fff', border: '1px solid var(--border-color)', fontSize: '0.72rem', padding: '0.1rem 0.2rem' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }} title="Anti-click fade-out (tail) applied to every exported slice (a floor; a larger per-region fade still wins)">
                  <span>Tail out {tailOutSamples} smp</span>
                  <input type="number" min={0} step={1} value={tailOutSamples} onChange={e => setTailOutSamples(Math.max(0, Math.round(Number(e.target.value))))} style={{ width: 64, background: '#0d1017', color: '#fff', border: '1px solid var(--border-color)', fontSize: '0.72rem', padding: '0.1rem 0.2rem' }} />
                </label>
                <button className="btn secondary" style={{ alignSelf: 'flex-end', padding: '0.15rem 0.5rem', fontSize: '0.72rem' }}
                  onClick={() => { setParams(DEFAULT_REGION_PARAMS); runDetect(DEFAULT_REGION_PARAMS, regions); }}>Reset</button>
              </div>

              {/* Region actions + export — sits between the detection controls and the table. */}
              <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={addRegion}>＋ Add region</button>
                <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={examineAll} disabled={!regions.length || examining.size > 0}
                  title="Run every chunk through the full UCS analyzer">🔬 Examine all</button>
                {nameOptions.length > 0 && (
                  <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={applyNameOptions} disabled={!regions.length}
                    title={`Assign the ${nameOptions.length} pre-made name(s) from the filename to the regions in order`}>🏷 Apply names ({nameOptions.length})</button>
                )}
                <div style={{ flex: 1 }} />
                <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={exportJson} disabled={!regions.length}>⬇ JSON</button>
                <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={exportCsv} disabled={!regions.length}>⬇ CSV</button>
                <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={exportSlices} disabled={!regions.length || !samplesRef.current} title="Export each region as a .wav (with fades)">⬇ Slices</button>
                <button className="btn primary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={saveToRecord}>💾 Save regions</button>
                {saveMsg && <span style={{ fontSize: '0.72rem', color: 'var(--accent-primary)' }}>{saveMsg}</span>}
              </div>

              {nameOptions.length > 0 && (
                <datalist id="region-name-options">{nameOptions.map((n, i) => <option key={i} value={n} />)}</datalist>
              )}

              {/* Region table */}
              <div style={{ flex: isNarrow ? 'none' : 1, overflowY: isNarrow ? 'visible' : 'auto', padding: '0.25rem 0.5rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#12151c' }}>
                    <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                      <th style={cell}>#</th><th style={cell}>Name</th><th style={cell}>UCS</th><th style={cell}>In (s)</th><th style={cell}>Out (s)</th><th style={cell}>Dur</th><th style={cell}>Fade in</th><th style={cell}>Fade out</th><th style={cell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {regions.map((r, i) => (
                      <tr key={i} onClick={() => selectRegion(i)}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
                          background: selRegion === i ? 'rgba(59,130,246,0.22)' : undefined }}>
                        <td style={cell}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: regionColor(i), marginRight: 4 }} />{i + 1}</td>
                        <td style={cell}><input value={r.name} placeholder={`region_${i + 1}`} onChange={e => updateRegion(i, { name: e.target.value })} list={nameOptions.length ? 'region-name-options' : undefined} style={{ ...numInput, width: 150 }} /></td>
                        <td style={{ ...cell, fontSize: '0.72rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ucsResult(i)}</td>
                        <td style={cell}><input type="number" step={0.001} value={Number(r.start_seconds.toFixed(3))} onChange={e => updateRegion(i, { start_seconds: Number(e.target.value) })} style={numInput} /></td>
                        <td style={cell}><input type="number" step={0.001} value={Number(r.end_seconds.toFixed(3))} onChange={e => updateRegion(i, { end_seconds: Number(e.target.value) })} style={numInput} /></td>
                        <td style={{ ...cell, color: 'var(--text-secondary)' }}>{fmt(r.duration_seconds)}</td>
                        <td style={cell}><input type="number" min={0} step={0.005} value={Number((r.fade_in_seconds || 0).toFixed(3))} onChange={e => updateRegion(i, { fade_in_seconds: Math.max(0, Number(e.target.value)) })} style={numInput} /></td>
                        <td style={cell}><input type="number" min={0} step={0.005} value={Number((r.fade_out_seconds || 0).toFixed(3))} onChange={e => updateRegion(i, { fade_out_seconds: Math.max(0, Number(e.target.value)) })} style={numInput} /></td>
                        <td style={cell}>
                          <button className="btn secondary" style={{ padding: '0 0.35rem', fontSize: '0.72rem' }} onClick={(e) => { e.stopPropagation(); examineChunk(i); }} disabled={examining.has(i)} title="Analyze this chunk through the full UCS analyzer">🔬</button>
                          <button className="btn secondary" style={{ padding: '0 0.35rem', fontSize: '0.72rem', marginLeft: 4 }} onClick={(e) => { e.stopPropagation(); deleteRegion(i); }} title="Delete region">✕</button>
                        </td>
                      </tr>
                    ))}
                    {regions.length === 0 && !decoding && (
                      <tr><td colSpan={9} style={{ ...cell, color: 'var(--text-secondary)', padding: '1rem' }}>No regions at these settings — lower the threshold or the minimums.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Desktop: the play circle is the right-hand column. */}
        {!isNarrow && waveCircle}
      </div>

      <audio ref={audioRef} style={{ display: 'none' }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); stopAtRef.current = null; }} />
    </div>
  );
}
