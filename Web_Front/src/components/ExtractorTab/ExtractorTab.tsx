import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { resolveAudioUrl, isTauri, getDirHandle, writePeakSidecar, relPathOf } from '../../audioLinking';
import { toMono } from '../examiner/audioAnalysis';
import { ucsSubColor, matchesScope } from '../../groupColors';
import {
  amplitudeEnvelope, detectRegionsFromEnvelope, DEFAULT_REGION_PARAMS,
  type Region, type RegionParams,
} from '../examiner/detectRegions';
import ScopeBar from '../ScopeBar';
import FileGroups from './FileGroups';
import WavePlayer from './WavePlayer';
import WaveCircle from './WaveCircle';
import { regionColor } from './shared';

interface ExtractorTabProps {
  analysisResult: any[];
  audioFiles: File[];
  onSound?: (name: string) => void;
  setAnalysisResult: (results: any[]) => void;
  // "Send to Extractor" from the Examiner: filter the file list to this name. The nonce
  // makes re-sending the same name re-apply the filter.
  filterHint?: { name: string; nonce: number };
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

export default function ExtractorTab({ analysisResult, audioFiles, onSound, setAnalysisResult, filterHint }: ExtractorTabProps) {
  const [filter, setFilter] = useState('');
  const [scopeGroup, setScopeGroup] = useState<string | null>(null);
  const [scopeSub, setScopeSub] = useState<string | null>(null);
  // Apply a "Send to Extractor" filter hint (keyed on its nonce so repeats re-fire).
  useEffect(() => { if (filterHint?.name) setFilter(filterHint.name); }, [filterHint?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [multiOnly, setMultiOnly] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [params, setParams] = useState<RegionParams>(DEFAULT_REGION_PARAMS);
  const [regions, setRegions] = useState<Region[]>([]);
  const [decoding, setDecoding] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const audioRef = useRef<HTMLAudioElement>(null);
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
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => () => { decodeCtxRef.current?.close(); }, []);

  const color = useMemo(
    () => ucsSubColor(selectedItem?.ucs?.category || '', (selectedItem?.ucs?.subcategory || '').trim()),
    [selectedItem],
  );
  const nameOptions = useMemo(() => parseNameOptions(selectedItem?.metadata?.name || ''), [selectedItem]);

  // The file list: scope chips + filter text + optional "multiple regions only".
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return analysisResult.filter(it => {
      if (multiOnly && !((it.regions?.count ?? 0) > 1)) return false;
      if (scopeGroup && !matchesScope(it, scopeGroup, scopeSub)) return false;
      if (q && !`${it.metadata?.name || ''} ${it.ucs?.category || ''} ${it.ucs?.subcategory || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [analysisResult, filter, multiOnly, scopeGroup, scopeSub]);

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

  // Playback looping (the linear + circular playheads read `progress` themselves). A
  // one-shot region preview (stopAtRef) pauses at its end; else loop the hovered region,
  // or the whole file.
  useEffect(() => {
    let id: number;
    const tick = () => {
      const el = audioRef.current;
      if (el && !el.paused) {
        if (stopAtRef.current != null) {
          if (el.currentTime >= stopAtRef.current) { el.pause(); stopAtRef.current = null; }
        } else {
          const loop = loopRegionRef.current;
          const start = loop ? loop.start : 0;
          const end = loop ? loop.end : (lengthRef.current || el.duration || 0);
          if (end > 0 && (el.currentTime >= end - 0.004 || el.currentTime < start - 0.05)) el.currentTime = start;
        }
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

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
    loopRegionRef.current = null;
    if (el.currentTime >= (lengthRef.current || 0)) el.currentTime = 0;
    el.play().catch(() => {});
  };

  // Current playback position as a fraction of the file (for the playheads).
  const progress = () => {
    const el = audioRef.current;
    const len = lengthRef.current || el?.duration || 0;
    return el && len > 0 ? el.currentTime / len : null;
  };

  const regionAtTime = (t: number) => regions.findIndex(r => t >= r.start_seconds && t <= r.end_seconds);
  // Hovering a position (in seconds) on either waveform: loop the region under it, and if
  // playing jump to its start; null / between regions returns to the full-file loop.
  const hoverAtTime = (t: number | null) => {
    if (t == null) { loopRegionRef.current = null; return; }
    const i = regionAtTime(t);
    if (i < 0) { loopRegionRef.current = null; return; }
    const r = regions[i];
    const prev = loopRegionRef.current;
    loopRegionRef.current = { start: r.start_seconds, end: r.end_seconds };
    const el = audioRef.current;
    if (el && !el.paused && (!prev || Math.abs(prev.start - r.start_seconds) > 1e-4)) el.currentTime = r.start_seconds;
  };
  const onScrub = (f: number) => {
    const el = audioRef.current;
    if (!el) return;
    stopAtRef.current = null;
    loopRegionRef.current = null;
    el.currentTime = f * (lengthRef.current || el.duration || 0);
    if (el.paused) el.play().catch(() => {});
  };

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
      setTimeout(() => download(name, encodeWav(slice, sr), 'audio/wav'), i * 150);
    });
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

      {/* Scope bar — same UI as the Examiner: category chips + filter. */}
      <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', background: '#0d1017' }}>
        <ScopeBar analysisResult={analysisResult} group={scopeGroup} sub={scopeSub}
          setGroup={setScopeGroup} setSub={setScopeSub} filterText={filter} setFilterText={setFilter} />
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <FileGroups groupedRows={groupedRows} rowsCount={rows.length} multiOnly={multiOnly} setMultiOnly={setMultiOnly} selectedItem={selectedItem} onSelect={handleSelect} />

        {/* Center: waveform + controls + region table */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#0A0A0A' }}>
          {!selectedItem ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
              Select a file (or drop one) to detect its regions.
            </div>
          ) : (
            <>
              <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.85rem', color: '#fff', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedItem.metadata?.name}>{selectedItem.metadata?.name}</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{regions.length} region{regions.length === 1 ? '' : 's'}</span>
                {decoding && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>decoding…</span>}
              </div>

              <WavePlayer samples={samplesRef.current} length={lengthRef.current} regions={regions} color={color}
                onUpdateRegion={updateRegion} onHoverTime={hoverAtTime} getProgress={progress} />

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

              {nameOptions.length > 0 && (
                <datalist id="region-name-options">{nameOptions.map((n, i) => <option key={i} value={n} />)}</datalist>
              )}

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
                        <td style={cell}><input value={r.name} placeholder={`region_${i + 1}`} onChange={e => updateRegion(i, { name: e.target.value })} list={nameOptions.length ? 'region-name-options' : undefined} style={{ ...numInput, width: 150 }} /></td>
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
            </>
          )}
        </div>

        <WaveCircle samples={samplesRef.current} color={color} arcs={arcs} playing={playing} hasSelection={!!selectedItem}
          onPlay={playAll} getProgress={progress} onScrub={onScrub}
          onHover={(f) => hoverAtTime(f == null ? null : f * (lengthRef.current || 0))} />
      </div>

      <audio ref={audioRef} style={{ display: 'none' }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); stopAtRef.current = null; }} />
    </div>
  );
}
