import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { resolveAudioUrl, isTauri, getDirHandle, writePeakSidecar, relPathOf } from '../../audioLinking';
import { toMono, type PlotGeo } from '../examiner/audioAnalysis';
import { drawWaveform } from '../examiner/drawWaveform';
import RadialWaveform from '../examiner/RadialWaveform';
import { ucsSubColor, ucsColor } from '../../groupColors';
import {
  amplitudeEnvelope, detectRegionsFromEnvelope, DEFAULT_REGION_PARAMS,
  type Region, type RegionParams,
} from '../examiner/detectRegions';

interface ExtractorTabProps {
  analysisResult: any[];
  audioFiles: File[];
  onSound?: (name: string) => void;
  setAnalysisResult: (results: any[]) => void;
}

// A distinct hue per region, reused by the arcs, the waveform spans and the table.
const regionColor = (i: number) => `hsl(${(i * 47) % 360} 75% 58%)`;
const fmt = (s: number) => `${s.toFixed(3)}s`;
const HANDLE_H = 8; // px height of the drag tabs on the in/out boundary lines

export default function ExtractorTab({ analysisResult, audioFiles, onSound, setAnalysisResult }: ExtractorTabProps) {
  const [filter, setFilter] = useState('');
  const [multiOnly, setMultiOnly] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [params, setParams] = useState<RegionParams>(DEFAULT_REGION_PARAMS);
  const [regions, setRegions] = useState<Region[]>([]);
  const [decoding, setDecoding] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const decodeCtxRef = useRef<AudioContext | null>(null);
  const samplesRef = useRef<Float32Array | null>(null);
  const envelopeRef = useRef<{ envelope: Float64Array; rateHz: number } | null>(null);
  const lengthRef = useRef(0);
  const sampleRateRef = useRef(44100);
  const loadGenRef = useRef(0);
  // While set, playback stops at this time — used to preview a single region (the ▶
  // button in the table). One-shot, no loop.
  const stopAtRef = useRef<number | null>(null);
  // Active loop window while playing: a hovered region [start,end], or null to loop the
  // whole file. Set by hovering a region on either waveform.
  const loopRegionRef = useRef<{ start: number; end: number } | null>(null);
  // Which region boundary is being dragged on the linear waveform.
  const dragRef = useRef<{ region: number; edge: 'start' | 'end' } | null>(null);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => () => { decodeCtxRef.current?.close(); }, []);

  const color = useMemo(
    () => ucsSubColor(selectedItem?.ucs?.category || '', (selectedItem?.ucs?.subcategory || '').trim()),
    [selectedItem],
  );

  // The file list: filter text + optional "multiple regions only" (uses the
  // stored .PEAK region count, present once a folder is scanned by this engine).
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return analysisResult.filter(it => {
      if (multiOnly && !((it.regions?.count ?? 0) > 1)) return false;
      if (q && !`${it.metadata?.name || ''} ${it.ucs?.category || ''} ${it.ucs?.subcategory || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [analysisResult, filter, multiOnly]);

  // The list grouped by UCS category, flattened to header/file rows so the user can see
  // the categories in the browser. Capped so a 37k-file library still renders instantly.
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
      out.push({ kind: 'header', category: cat, count: items.length });
      for (const it of items) out.push({ kind: 'file', item: it });
      if (out.length > 3000) break;
    }
    return out;
  }, [rows]);

  // Carry user-typed names across a re-detect: match a new region to the closest
  // old one whose start is within 30 ms, so nudging a slider doesn't wipe labels.
  const reseedNames = (next: Region[], prev: Region[]): Region[] => {
    if (!prev.length) return next;
    return next.map(r => {
      const near = prev.find(p => p.name && Math.abs(p.start_seconds - r.start_seconds) < 0.03);
      return near ? { ...r, name: near.name } : r;
    });
  };

  const recompute = useCallback((p: RegionParams, prev: Region[]) => {
    const env = envelopeRef.current;
    if (!env) { setRegions([]); return; }
    const fresh = detectRegionsFromEnvelope(env.envelope, env.rateHz, lengthRef.current, p);
    setRegions(reseedNames(fresh, prev));
  }, []);

  // Draw the linear waveform with a translucent span + in/out lines per region.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const samples = samplesRef.current;
    if (!canvas) return;
    const w = Math.max(1, Math.floor(canvas.clientWidth || 800));
    const h = Math.max(1, Math.floor(canvas.clientHeight || 200));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, w, h);
    if (!samples) return;

    const pad = 6;
    const geo: PlotGeo = {
      w, h, padTop: pad,
      plotTop: pad, plotBottom: h - pad, plotH: Math.max(1, h - 2 * pad),
      mid: h / 2, halfH: Math.max(1, (h - 2 * pad) / 2),
    };
    const len = lengthRef.current || 1;
    const xOf = (t: number) => (t / len) * w;

    // Region spans behind the trace.
    regions.forEach((r, i) => {
      const x0 = xOf(r.start_seconds), x1 = xOf(r.end_seconds);
      ctx.fillStyle = regionColor(i).replace('58%)', '58% / 0.16)');
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    });
    drawWaveform(ctx, samples, geo, color);
    // In/out lines + draggable handles + index label on top.
    regions.forEach((r, i) => {
      const x0 = xOf(r.start_seconds), x1 = xOf(r.end_seconds);
      ctx.strokeStyle = regionColor(i);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, h);
      ctx.moveTo(x1 - 0.5, 0); ctx.lineTo(x1 - 0.5, h); ctx.stroke();
      // Grab handles: a tab at the top of the in-line and the bottom of the out-line.
      ctx.fillStyle = regionColor(i);
      ctx.fillRect(x0 - 1, 0, 5, HANDLE_H);           // in handle (top-left)
      ctx.fillRect(x1 - 4, h - HANDLE_H, 5, HANDLE_H); // out handle (bottom-right)
      ctx.font = '10px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(r.name || `${i + 1}`, x0 + 6, 3);
    });
  }, [regions, color]);

  useEffect(() => { draw(); }, [draw]);

  // Redraw on canvas resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // Playhead animation + looping. While playing: a one-shot region preview (stopAtRef)
  // pauses at its end; otherwise playback loops — within the hovered region if one is
  // set, else around the whole file.
  useEffect(() => {
    let id: number;
    const tick = () => {
      const el = audioRef.current, ph = playheadRef.current;
      if (el && !el.paused) {
        if (stopAtRef.current != null) {
          if (el.currentTime >= stopAtRef.current) { el.pause(); stopAtRef.current = null; }
        } else {
          const loop = loopRegionRef.current;
          const start = loop ? loop.start : 0;
          const end = loop ? loop.end : (lengthRef.current || el.duration || 0);
          if (end > 0 && (el.currentTime >= end - 0.004 || el.currentTime < start - 0.05)) {
            el.currentTime = start;
          }
        }
      }
      if (ph) {
        if (el && el.duration && !el.paused) {
          ph.style.left = `${(el.currentTime / (lengthRef.current || el.duration)) * 100}%`;
          ph.style.display = 'block';
        } else ph.style.display = 'none';
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  // Shared decode + region-detect path, used by both the list selection and a dropped
  // file. `src` is any URL the <audio> element and fetch can load.
  const setupAudioAndDetect = async (src: string, savedRegions: Region[]) => {
    const gen = ++loadGenRef.current;
    setDecoding(true);
    samplesRef.current = null;
    envelopeRef.current = null;
    setRegions([]);
    try {
      if (audioRef.current) {
        document.querySelectorAll('audio').forEach(a => a.pause());
        audioRef.current.src = src;
        audioRef.current.currentTime = 0;
      }
      if (!decodeCtxRef.current) {
        decodeCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const buf = await (await fetch(src)).arrayBuffer();
      if (gen !== loadGenRef.current) return;
      const decoded = await decodeCtxRef.current.decodeAudioData(buf);
      if (gen !== loadGenRef.current) return;
      const mono = toMono(decoded);
      samplesRef.current = mono;
      lengthRef.current = decoded.duration;
      sampleRateRef.current = decoded.sampleRate;
      envelopeRef.current = amplitudeEnvelope(mono, decoded.sampleRate);
      // Detect fresh, then seed any names already saved on the record.
      const fresh = detectRegionsFromEnvelope(envelopeRef.current.envelope, envelopeRef.current.rateHz, decoded.duration, params);
      setRegions(reseedNames(fresh, savedRegions));
    } catch {
      samplesRef.current = null;
      setRegions([]);
    } finally {
      if (gen === loadGenRef.current) setDecoding(false);
    }
  };

  const handleSelect = async (item: any) => {
    setSelectedItem(item);
    setSaveMsg('');
    onSound?.(item?.metadata?.name || '');
    const src = await resolveAudioUrl(audioFiles, item);
    if (!src) { setDecoding(false); return; }
    await setupAudioAndDetect(src, item.regions?.regions || []);
  };

  // Drop an audio file straight onto the Extractor — no scan needed.
  const loadDroppedFile = async (file: File) => {
    if (!/\.(wav|wave|mp3|flac|aif|aiff|aifc|ogg|oga|m4a|mp4|aac)$/i.test(file.name)) return;
    const item = { metadata: { name: file.name, path: file.name }, ucs: {}, classification: {}, regions: { count: 0, regions: [] } };
    setSelectedItem(item);
    setSaveMsg('');
    onSound?.(file.name);
    await setupAudioAndDetect(URL.createObjectURL(file), []);
  };

  const changeParam = (key: keyof RegionParams, value: number) => {
    const next = { ...params, [key]: value };
    setParams(next);
    recompute(next, regions);
  };

  const playRegion = (r: Region) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = r.start_seconds;
    stopAtRef.current = r.end_seconds;
    el.play().catch(() => {});
  };

  const playAll = () => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) { el.pause(); return; }
    stopAtRef.current = null;
    loopRegionRef.current = null; // start a full-file loop; hovering narrows it
    if (el.currentTime >= (lengthRef.current || 0)) el.currentTime = 0;
    el.play().catch(() => {});
  };

  // The region that contains time `t`, or -1.
  const regionAtTime = (t: number) => regions.findIndex(r => t >= r.start_seconds && t <= r.end_seconds);

  // Hovering a position on either waveform: if it falls inside a region, loop that region
  // (and, if already playing, jump to its start to audition it). Leaving (t = null) or
  // hovering between regions returns to the full-file loop.
  const hoverAtTime = (t: number | null) => {
    if (t == null) { loopRegionRef.current = null; return; }
    const i = regionAtTime(t);
    if (i < 0) { loopRegionRef.current = null; return; }
    const r = regions[i];
    const prev = loopRegionRef.current;
    loopRegionRef.current = { start: r.start_seconds, end: r.end_seconds };
    const el = audioRef.current;
    if (el && !el.paused && (!prev || Math.abs(prev.start - r.start_seconds) > 1e-4)) {
      el.currentTime = r.start_seconds;
    }
  };

  // Encode a mono Float32 slice as a 16-bit PCM WAV.
  const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
    const n = samples.length;
    const b = new ArrayBuffer(44 + n * 2);
    const v = new DataView(b);
    const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Blob([b], { type: 'audio/wav' });
  };

  // Slice a region out of the decoded mono buffer, applying its fade-in/out.
  const sliceRegion = (r: Region): Float32Array | null => {
    const src = samplesRef.current;
    if (!src) return null;
    const sr = sampleRateRef.current;
    const a = Math.max(0, Math.floor(r.start_seconds * sr));
    const bb = Math.min(src.length, Math.floor(r.end_seconds * sr));
    if (bb <= a) return null;
    const out = src.slice(a, bb);
    const fi = Math.floor((r.fade_in_seconds || 0) * sr);
    const fo = Math.floor((r.fade_out_seconds || 0) * sr);
    for (let i = 0; i < fi && i < out.length; i++) out[i] *= i / fi;
    for (let i = 0; i < fo && i < out.length; i++) out[out.length - 1 - i] *= i / fo;
    return out;
  };

  const exportSlices = () => {
    if (!samplesRef.current || !regions.length) return;
    const base = (selectedItem?.metadata?.name || 'slice').replace(/\.[^.]+$/, '');
    const sr = sampleRateRef.current;
    regions.forEach((r, i) => {
      const slice = sliceRegion(r);
      if (!slice) return;
      const name = `${base}_${(r.name || `region_${i + 1}`).replace(/[^\w.-]+/g, '_')}.wav`;
      // Stagger so the browser doesn't drop simultaneous downloads.
      setTimeout(() => download(name, encodeWav(slice, sr), 'audio/wav'), i * 150);
    });
  };

  // --- linear-waveform pointer interaction: drag in/out handles, else hover-to-loop ---
  const linearTimeAt = (clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return frac * (lengthRef.current || 0);
  };
  // The nearest region boundary within ~6px of the pointer, or null.
  const boundaryHit = (clientX: number): { region: number; edge: 'start' | 'end' } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const tol = (6 / rect.width) * (lengthRef.current || 0);
    const t = linearTimeAt(clientX);
    let best: { region: number; edge: 'start' | 'end' } | null = null, bestD = tol;
    regions.forEach((r, i) => {
      const ds = Math.abs(t - r.start_seconds), de = Math.abs(t - r.end_seconds);
      if (ds < bestD) { bestD = ds; best = { region: i, edge: 'start' }; }
      if (de < bestD) { bestD = de; best = { region: i, edge: 'end' }; }
    });
    return best;
  };
  const onWaveDown = (e: React.PointerEvent) => {
    const hit = boundaryHit(e.clientX);
    if (hit) { dragRef.current = hit; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
  };
  const onWaveMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (dragRef.current) {
      const t = linearTimeAt(e.clientX);
      const { region, edge } = dragRef.current;
      const r = regions[region];
      if (!r) return;
      if (edge === 'start') updateRegion(region, { start_seconds: Math.max(0, Math.min(t, r.end_seconds - 0.01)) });
      else updateRegion(region, { end_seconds: Math.min(lengthRef.current || t, Math.max(t, r.start_seconds + 0.01)) });
    } else {
      if (canvas) canvas.style.cursor = boundaryHit(e.clientX) ? 'ew-resize' : 'pointer';
      hoverAtTime(linearTimeAt(e.clientX));
    }
  };
  const onWaveUp = () => { dragRef.current = null; };
  const onWaveLeave = () => { dragRef.current = null; hoverAtTime(null); };

  const updateRegion = (i: number, patch: Partial<Region>) => {
    setRegions(rs => rs.map((r, j) => {
      if (j !== i) return r;
      const merged = { ...r, ...patch };
      merged.duration_seconds = Math.max(0, merged.end_seconds - merged.start_seconds);
      return merged;
    }));
  };
  const deleteRegion = (i: number) => setRegions(rs => rs.filter((_, j) => j !== i).map((r, j) => ({ ...r, index: j })));
  const addRegion = () => setRegions(rs => {
    const start = rs.length ? rs[rs.length - 1].end_seconds : 0;
    const end = Math.min(lengthRef.current || start + 0.5, start + 0.5);
    return [...rs, { index: rs.length, start_seconds: start, end_seconds: end, duration_seconds: Math.max(0, end - start), peak_amplitude: 0, name: '' }];
  });

  // The array the user asked for: name + in/out points, plus context.
  const buildExport = () => ({
    file: selectedItem?.metadata?.name || '',
    path: selectedItem?.metadata?.path || '',
    length_seconds: lengthRef.current,
    detection: { ...params },
    regions: regions.map((r, i) => ({
      index: i,
      name: r.name || `region_${i + 1}`,
      in_point_seconds: r.start_seconds,
      out_point_seconds: r.end_seconds,
      duration_seconds: r.duration_seconds,
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

  // Persist the edited regions onto the in-memory record (so exports/other views
  // see them) and best-effort write them back into the .PEAK sidecar on disk.
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
    // Try to persist to the .PEAK sidecar (browser File System Access only).
    try {
      const dir = await getDirHandle();
      if (dir && !isTauri()) {
        const rel = relPathOf({ name: selectedItem.metadata?.name, webkitRelativePath: selectedItem.metadata?.path } as any) || selectedItem.metadata?.path || selectedItem.metadata?.name;
        await writePeakSidecar(dir, rel, updated);
        setSaveMsg('Saved to record and .PEAK sidecar.');
        return;
      }
    } catch { /* fall through to in-memory-only message */ }
    setSaveMsg('Saved to the loaded record (export to keep a file).');
  };

  const arcs = useMemo(() => {
    const len = lengthRef.current || 1;
    return regions.map((r, i) => ({ start: r.start_seconds / len, end: r.end_seconds / len, color: regionColor(i) }));
  }, [regions]);

  const cell: React.CSSProperties = { padding: '0.2rem 0.4rem', whiteSpace: 'nowrap' };
  const numInput: React.CSSProperties = { width: 70, background: '#0d1017', color: '#fff', border: '1px solid var(--border-color)', fontSize: '0.72rem', padding: '0.1rem 0.2rem' };

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', position: 'relative' }}
      onDragOver={(e) => { e.preventDefault(); if (!dropActive) setDropActive(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropActive(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDropActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) loadDroppedFile(file);
      }}>
      {dropActive && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(59,130,246,0.12)', border: '2px dashed var(--accent-primary)',
          color: '#fff', fontSize: '1rem', fontWeight: 600 }}>
          Drop an audio file to extract its regions
        </div>
      )}
      {/* Left: file list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
        <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter files…"
            style={{ background: '#0d1017', color: '#fff', border: '1px solid var(--border-color)', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={multiOnly} onChange={e => setMultiOnly(e.target.checked)} />
            Multiple regions only <span title="Uses the region count stored in each .PEAK — scan a folder with this engine to populate it.">ⓘ</span>
          </label>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{rows.length.toLocaleString()} file(s)</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {groupedRows.map((row, i) => {
            if (row.kind === 'header') {
              return (
                <div key={`h${i}`} style={{ position: 'sticky', top: 0, zIndex: 1, background: '#12151c',
                  padding: '0.25rem 0.5rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.03em', color: ucsColor(row.category), borderTop: '1px solid var(--border-color)',
                  borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.category}</span>
                  <span style={{ opacity: 0.6, flexShrink: 0 }}>{row.count}</span>
                </div>
              );
            }
            const it = row.item;
            const count = it.regions?.count ?? null;
            const sel = it === selectedItem;
            return (
              <div key={i} onClick={() => handleSelect(it)}
                style={{ padding: '0.3rem 0.5rem 0.3rem 1rem', cursor: 'pointer', fontSize: '0.76rem', display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
                  background: sel ? 'rgba(59,130,246,0.25)' : (i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent'),
                  color: sel ? '#fff' : 'var(--accent-secondary)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.metadata?.name}>{it.metadata?.name}</span>
                {count != null && <span style={{ color: count > 1 ? '#f59e0b' : 'var(--text-secondary)', flexShrink: 0 }}>{count}▮</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Center: waveform + controls + region table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#0A0A0A' }}>
        {!selectedItem ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
            Select a file to detect its regions.
          </div>
        ) : (
          <>
            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.85rem', color: '#fff', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedItem.metadata?.name}>{selectedItem.metadata?.name}</strong>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{regions.length} region{regions.length === 1 ? '' : 's'}</span>
              {decoding && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>decoding…</span>}
            </div>

            {/* Linear waveform with region spans + playhead */}
            <div style={{ height: 180, flexShrink: 0, position: 'relative', padding: '0.5rem 0.75rem' }}>
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <canvas ref={canvasRef}
                  onPointerDown={onWaveDown} onPointerMove={onWaveMove} onPointerUp={onWaveUp}
                  onPointerCancel={onWaveUp} onPointerLeave={onWaveLeave}
                  style={{ width: '100%', height: '100%', display: 'block', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }} />
                <div ref={playheadRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, background: 'rgb(244,144,44)', pointerEvents: 'none', display: 'none' }} />
              </div>
            </div>

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
              <button className="btn secondary" style={{ alignSelf: 'flex-end', padding: '0.15rem 0.5rem', fontSize: '0.72rem' }}
                onClick={() => { setParams(DEFAULT_REGION_PARAMS); recompute(DEFAULT_REGION_PARAMS, regions); }}>Reset</button>
            </div>

            {/* Region table */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.25rem 0.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#12151c' }}>
                  <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                    <th style={cell}>#</th><th style={cell}>Name</th><th style={cell}>In (s)</th><th style={cell}>Out (s)</th><th style={cell}>Dur</th><th style={cell}>Fade in</th><th style={cell}>Fade out</th><th style={cell}></th>
                  </tr>
                </thead>
                <tbody>
                  {regions.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={cell}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: regionColor(i), marginRight: 4 }} />{i + 1}</td>
                      <td style={cell}>
                        <input value={r.name} placeholder={`region_${i + 1}`} onChange={e => updateRegion(i, { name: e.target.value })}
                          style={{ ...numInput, width: 150 }} />
                      </td>
                      <td style={cell}><input type="number" step={0.001} value={Number(r.start_seconds.toFixed(3))} onChange={e => updateRegion(i, { start_seconds: Number(e.target.value) })} style={numInput} /></td>
                      <td style={cell}><input type="number" step={0.001} value={Number(r.end_seconds.toFixed(3))} onChange={e => updateRegion(i, { end_seconds: Number(e.target.value) })} style={numInput} /></td>
                      <td style={{ ...cell, color: 'var(--text-secondary)' }}>{fmt(r.duration_seconds)}</td>
                      <td style={cell}><input type="number" min={0} step={0.005} value={Number((r.fade_in_seconds || 0).toFixed(3))} onChange={e => updateRegion(i, { fade_in_seconds: Math.max(0, Number(e.target.value)) })} style={numInput} /></td>
                      <td style={cell}><input type="number" min={0} step={0.005} value={Number((r.fade_out_seconds || 0).toFixed(3))} onChange={e => updateRegion(i, { fade_out_seconds: Math.max(0, Number(e.target.value)) })} style={numInput} /></td>
                      <td style={cell}>
                        <button className="btn secondary" style={{ padding: '0 0.35rem', fontSize: '0.72rem' }} onClick={() => playRegion(r)} title="Play region">▶</button>
                        <button className="btn secondary" style={{ padding: '0 0.35rem', fontSize: '0.72rem', marginLeft: 4 }} onClick={() => deleteRegion(i)} title="Delete region">✕</button>
                      </td>
                    </tr>
                  ))}
                  {regions.length === 0 && !decoding && (
                    <tr><td colSpan={8} style={{ ...cell, color: 'var(--text-secondary)', padding: '1rem' }}>No regions at these settings — lower the threshold or the minimums.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Export row */}
            <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={addRegion}>＋ Add region</button>
              <div style={{ flex: 1 }} />
              <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={exportJson} disabled={!regions.length}>⬇ JSON</button>
              <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={exportCsv} disabled={!regions.length}>⬇ CSV</button>
              <button className="btn secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={exportSlices} disabled={!regions.length || !samplesRef.current} title="Export each region as a .wav (with fades)">⬇ Slices</button>
              <button className="btn primary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={saveToRecord}>💾 Save regions</button>
              {saveMsg && <span style={{ fontSize: '0.72rem', color: 'var(--accent-primary)' }}>{saveMsg}</span>}
            </div>
          </>
        )}
      </div>

      {/* Right: circular waveform, anchored centre, region arcs + centre play */}
      <div style={{ width: 340, flexShrink: 0, borderLeft: '1px solid var(--border-color)', background: '#0B0E14', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1rem' }}>
        {selectedItem ? (
          <>
            <RadialWaveform samples={samplesRef.current} color={color} size={280} regions={arcs}
              onPlay={playAll} playing={playing}
              getProgress={() => {
                const el = audioRef.current;
                const len = lengthRef.current || el?.duration || 0;
                return el && len > 0 ? el.currentTime / len : null;
              }}
              onScrub={(f) => {
                const el = audioRef.current;
                if (!el) return;
                stopAtRef.current = null;
                loopRegionRef.current = null;
                el.currentTime = f * (lengthRef.current || el.duration || 0);
                if (el.paused) el.play().catch(() => {});
              }}
              onHover={(f) => hoverAtTime(f == null ? null : f * (lengthRef.current || 0))} />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
              starts at 0° (right) · wraps 360°
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center' }}>Circular waveform</div>
        )}
      </div>

      <audio ref={audioRef} style={{ display: 'none' }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); stopAtRef.current = null; }} />
    </div>
  );
}
