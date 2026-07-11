import { useState, useRef, useEffect } from 'react';
import { pickDirectoryFiles, findAudioFile, fsaSupported, filterAudioFiles } from '../audioLinking';

interface ExaminerTabProps {
  analysisResult: any[];
  audioFiles: File[];
  setAudioFiles: (files: File[]) => void;
}

// In-place iterative radix-2 Cooley–Tukey FFT (length must be a power of two).
function fftRadix2(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = i + k + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] = re[a] + vr; im[a] = im[a] + vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// One-shot averaged spectral trace of the whole file, condensed onto a
// log-frequency grid (bin-max) and peak-normalized to dB. Mirrors the Python
// inspector's compute_spectrum. Returns { fx, fy } in Hz / dB, or null.
function computeSpectrum(mono: Float32Array, sr: number): { fx: number[]; fy: number[] } | null {
  const n = mono.length;
  if (n < 256 || sr <= 0) return null;
  let seg = 1;
  const cap = Math.min(n, 1 << 14);
  while (seg * 2 <= cap) seg *= 2;
  const half = seg >> 1;
  const window = new Float64Array(seg);
  for (let i = 0; i < seg; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (seg - 1));

  const maxSegments = 32;
  const count = Math.min(maxSegments, Math.max(1, Math.floor(n / seg)));
  const power = new Float64Array(half + 1);
  for (let s = 0; s < count; s++) {
    const start = count > 1 ? Math.round((s * (n - seg)) / (count - 1)) : 0;
    const re = new Float64Array(seg);
    const im = new Float64Array(seg);
    for (let i = 0; i < seg; i++) re[i] = mono[start + i] * window[i];
    fftRadix2(re, im);
    for (let k = 0; k <= half; k++) power[k] += re[k] * re[k] + im[k] * im[k];
  }

  let peak = 0;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    mag[k] = Math.sqrt(power[k] / count);
    if (mag[k] > peak) peak = mag[k];
  }
  const low = 20, high = sr / 2;
  if (peak <= 0 || high <= low) return null;
  const db = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) db[k] = 20 * Math.log10(Math.max(mag[k] / peak, 1e-6));

  // Bin-max onto a 360-band geometric (log) frequency grid.
  const bands = 360;
  const edges: number[] = [];
  for (let i = 0; i <= bands; i++) edges.push(low * Math.pow(high / low, i / bands));
  const idxFor = (f: number) => Math.min(half + 1, Math.max(0, Math.ceil((f * seg) / sr)));
  const fx: number[] = [], fy: number[] = [];
  for (let i = 0; i < bands; i++) {
    const a = idxFor(edges[i]);
    let b = idxFor(edges[i + 1]);
    if (a > half) break;
    b = Math.max(Math.min(b, half + 1), a + 1);
    let m = -Infinity;
    for (let k = a; k < b; k++) if (db[k] > m) m = db[k];
    fx.push(Math.sqrt(edges[i] * edges[i + 1]));
    fy.push(m);
  }
  return fx.length ? { fx, fy } : null;
}

const ROW_H = 24; // fixed row height (px) used by the virtualized sample list

// Scientific-pitch note name (e.g. "C1", "F#2", "A4") → frequency in Hz.
// A4 = 440 Hz, A0 = 27.5 Hz — matches the top axis's A-octave series.
function noteToFreq(name: any): number | null {
  if (!name || typeof name !== 'string') return null;
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const letters: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let semi = letters[m[1].toUpperCase()];
  if (semi == null) return null;
  if (m[2] === '#') semi += 1; else if (m[2] === 'b') semi -= 1;
  const midi = (parseInt(m[3], 10) + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export default function ExaminerTab({ analysisResult, audioFiles, setAudioFiles }: ExaminerTabProps) {
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [autoPlay, setAutoPlay] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  // A lightweight context used only to decode audio for the static preview.
  const decodeCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      if (decodeCtxRef.current) decodeCtxRef.current.close();
    };
  }, []);

  // Arrow Up / Down move to the previous / next sample.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!analysisResult.length) return;
      e.preventDefault();
      const idx = selectedItem ? analysisResult.indexOf(selectedItem) : -1;
      const next = idx < 0
        ? 0
        : e.key === 'ArrowDown'
          ? Math.min(analysisResult.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      handleSelect(analysisResult[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedItem, analysisResult, autoPlay, audioFiles]);

  // Track the scroll viewport height for virtualization.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the selected row visible as the user arrows through the (virtualized) list.
  useEffect(() => {
    const el = scrollRef.current;
    if (!selectedItem || !el) return;
    const idx = analysisResult.indexOf(selectedItem);
    if (idx < 0) return;
    const top = idx * ROW_H;
    const bottom = top + ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [selectedItem, analysisResult]);

  // Draw the STATIC player preview (no animation): whole-file waveform +
  // averaged-FFT spectral trace, note-frequency axis on top, time axis on the
  // bottom, ADSR envelope overlay. Mirrors the Python inspector's preview.
  const renderPreview = (buffer: AudioBuffer, item: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(1, Math.floor(canvas.clientWidth || 800));
    const h = Math.max(1, Math.floor(canvas.clientHeight || 320));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, w, h);

    // Leave room for note-frequency labels (top) and time labels (bottom).
    const padTop = 26, padBottom = 18;
    const plotTop = padTop;
    const plotBottom = h - padBottom;
    const plotH = Math.max(1, plotBottom - plotTop);
    const mid = (plotTop + plotBottom) / 2;
    const halfH = plotH / 2;

    // Mono mixdown, shared by the waveform and the FFT.
    const ch = buffer.numberOfChannels;
    const len = buffer.length;
    const chans: Float32Array[] = [];
    for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let c = 0; c < ch; c++) s += chans[c][i];
      mono[i] = s / ch;
    }
    const duration = buffer.duration;
    const sr = buffer.sampleRate;

    // ---- FFT spectral trace: olive fill first (behind the waveform) ----
    const spec = computeSpectrum(mono, sr);
    let xFreq: ((f: number) => number) | null = null;
    let fx: number[] = [], fy: number[] = [];
    if (spec) {
      fx = spec.fx; fy = spec.fy;
      const lf0 = Math.log(fx[0]);
      const lf1 = Math.log(fx[fx.length - 1]);
      xFreq = (f: number) => ((Math.log(f) - lf0) / (lf1 - lf0)) * w;
      const yDb = (db: number) => plotBottom - Math.max(0, Math.min(1, (db + 90) / 90)) * plotH;

      ctx.beginPath();
      ctx.moveTo(xFreq(fx[0]), plotBottom);
      for (let i = 0; i < fx.length; i++) ctx.lineTo(xFreq(fx[i]), yDb(fy[i]));
      ctx.lineTo(xFreq(fx[fx.length - 1]), plotBottom);
      ctx.closePath();
      ctx.fillStyle = 'rgba(150,150,30,0.18)';
      ctx.fill();
    }

    // ---- Waveform: blue min/max amplitude per pixel column ----
    const samplesPerCol = len / w;
    ctx.strokeStyle = 'rgba(74,88,224,0.70)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const start = Math.floor(x * samplesPerCol);
      const end = Math.min(len, Math.floor((x + 1) * samplesPerCol));
      let min = 1.0, max = -1.0;
      for (let i = start; i < end; i++) {
        const v = mono[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min > max) { min = 0; max = 0; }
      ctx.moveTo(x + 0.5, mid - max * halfH * 0.97);
      ctx.lineTo(x + 0.5, mid - min * halfH * 0.97);
    }
    ctx.stroke();

    // ---- FFT spectral trace: bright yellow line on top of the waveform ----
    if (spec && xFreq) {
      const yDb = (db: number) => plotBottom - Math.max(0, Math.min(1, (db + 90) / 90)) * plotH;
      ctx.beginPath();
      for (let i = 0; i < fx.length; i++) {
        const X = xFreq(fx[i]), Y = yDb(fy[i]);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.strokeStyle = 'rgba(214,214,26,0.95)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Top axis: A-octave note series (A4 = 440 Hz), note above / frequency below.
      const f0 = fx[0], f1 = fx[fx.length - 1];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = '9px sans-serif';
      for (let oct = 0; oct < 10; oct++) {
        const f = 27.5 * Math.pow(2, oct);
        if (f < f0 || f > f1) continue;
        const X = xFreq(f);
        if (oct % 2 === 0) {
          ctx.strokeStyle = 'rgba(211,211,211,0.10)';
          ctx.beginPath();
          ctx.moveTo(X, plotTop);
          ctx.lineTo(X, plotBottom);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(127,214,226,0.5)';
        ctx.beginPath();
        ctx.moveTo(X, plotTop);
        ctx.lineTo(X, plotTop - 4);
        ctx.stroke();
        const flabel = f >= 1000 ? `${+(f / 1000).toPrecision(3)}k` : `${Math.round(f)}`;
        ctx.fillStyle = '#7fd6e2';
        ctx.fillText(`A${oct}`, X, 2);
        ctx.fillStyle = 'rgba(127,214,226,0.7)';
        ctx.fillText(flabel, X, 12);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(127,214,226,0.85)';
      ctx.fillText('spectrum', w - 4, 2);

      // Root-note fundamental as a vertical marker on the frequency axis.
      const rf = noteToFreq(item?.root_note_name);
      if (rf && rf >= f0 && rf <= f1) {
        const X = xFreq(rf);
        ctx.strokeStyle = 'rgba(168,85,247,0.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(X, plotTop);
        ctx.lineTo(X, plotBottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(196,150,255,0.95)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(`root ${item.root_note_name}`, Math.min(X + 3, w - 62), plotTop + 3);
      }
    }

    // ---- ADSR envelope overlay (white dashed line + markers) ----
    const att = Number(item?.envelope_attack_seconds ?? item?.attack_seconds ?? 0) || 0;
    const dec = Number(item?.envelope_decay_seconds ?? 0) || 0;
    const sus = Number(item?.envelope_sustain_level ?? 0) || 0;
    const rel = Number(item?.envelope_release_seconds ?? 0) || 0;
    if (duration > 0 && (att || dec || sus || rel)) {
      const t1 = Math.min(duration, att);
      const t2 = Math.min(duration, t1 + dec);
      const t3 = Math.max(t2, duration - rel);
      const pts: [number, number][] = [
        [0, 0], [t1, 1], [t2, sus], [t3, sus], [duration, 0],
      ];
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      pts.forEach(([t, v], i) => {
        const px = (t / duration) * w;
        const py = mid - v * halfH * 0.97;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      pts.forEach(([t, v]) => {
        const px = (t / duration) * w;
        const py = mid - v * halfH * 0.97;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // ---- Bottom axis: time in seconds ----
    if (duration > 0) {
      const nTicks = 8;
      ctx.font = '9px sans-serif';
      ctx.textBaseline = 'bottom';
      for (let i = 0; i <= nTicks; i++) {
        const X = (i / nTicks) * w;
        const t = (i / nTicks) * duration;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(X, plotBottom);
        ctx.lineTo(X, plotBottom + 4);
        ctx.stroke();
        ctx.fillStyle = '#999';
        ctx.textAlign = i === 0 ? 'left' : i === nTicks ? 'right' : 'center';
        ctx.fillText(`${t.toFixed(1)}`, Math.max(2, Math.min(w - 2, X)), h - 2);
      }
    }

    // ---- Sample name (top-left) ----
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#cddc39';
    ctx.fillText(String(item?.name || '').slice(0, 60), 4, padTop - 2);
  };

  const handleSelect = async (item: any) => {
    setSelectedItem(item);

    const file = findAudioFile(audioFiles, item);
    if (!file) {
      // No linked audio — clear the preview so it doesn't show a stale sample.
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) { ctx.fillStyle = '#0A0A0A'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      return;
    }

    if (audioRef.current) {
      audioRef.current.src = URL.createObjectURL(file);
      if (autoPlay) audioRef.current.play().catch(() => {});
    }

    // Decode the whole file and draw the static preview.
    try {
      if (!decodeCtxRef.current) {
        decodeCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const buf = await file.arrayBuffer();
      const decoded = await decodeCtxRef.current.decodeAudioData(buf);
      renderPreview(decoded, item);
    } catch {
      /* undecodable file — leave the preview blank */
    }
  };

  const handleLinkFolder = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
          setAudioFiles(filterAudioFiles(Array.from(e.target.files)));
      }
  };

  const handleDeepLink = async () => {
      try {
          const files = await pickDirectoryFiles();
          setAudioFiles(files);
      } catch (err) {
          // User cancelled the picker, or the API is unavailable — ignore.
          if ((err as Error)?.name !== 'AbortError') console.warn(err);
      }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>

      {/* Top Half: Data Table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', background: '#111318' }}>
              <button className="btn secondary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}>Open .PEAK...</button>
              <input type="text" placeholder="Filter:" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px' }} />
              <div style={{ flex: 1 }} />
              {fsaSupported() && (
                <button className="btn primary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }} onClick={handleDeepLink}>
                    Link Audio Folder
                </button>
              )}
              <label className="btn secondary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', cursor: 'pointer' }} title="Fallback folder picker">
                  {fsaSupported() ? 'Link (basic)' : 'Link Audio Folder'}
                  <input type="file" webkitdirectory="true" directory="true" style={{ display: 'none' }} onChange={handleLinkFolder} />
              </label>
              <div className="text-secondary" style={{ fontSize: '0.8rem' }}>{analysisResult.length} samples{audioFiles.length ? ` · ${audioFiles.length} audio linked` : ''}</div>
          </div>
          <div ref={scrollRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed' }}>
                  <colgroup>
                      <col style={{ width: '22%' }} /><col style={{ width: '9%' }} /><col style={{ width: '20%' }} />
                      <col style={{ width: '8%' }} /><col style={{ width: '5%' }} /><col style={{ width: '6%' }} />
                      <col style={{ width: '6%' }} /><col style={{ width: '5%' }} /><col style={{ width: '4%' }} />
                      <col style={{ width: '6%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} />
                  </colgroup>
                  <thead style={{ position: 'sticky', top: 0, background: '#1A1D24', zIndex: 1 }}>
                      <tr>
                          {['File', 'Group', 'Reason', 'Timbre', 'Clust', 'Root', 'Pitch', 'Len', 'Tr', 'Cntrd', 'Harm', 'BPM'].map(h => (
                              <th key={h} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</th>
                          ))}
                      </tr>
                  </thead>
                  <tbody>
                      {(() => {
                          const total = analysisResult.length;
                          const OVER = 12;
                          const startIndex = Math.max(0, Math.floor(scrollTop / ROW_H) - OVER);
                          const endIndex = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_H) + OVER);
                          const topPad = startIndex * ROW_H;
                          const botPad = Math.max(0, (total - endIndex) * ROW_H);
                          const cell = (extra: React.CSSProperties = {}): React.CSSProperties => ({
                              padding: '0 0.5rem', height: ROW_H, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...extra,
                          });
                          return (
                            <>
                              {topPad > 0 && <tr style={{ height: topPad }}><td colSpan={12} style={{ padding: 0 }} /></tr>}
                              {analysisResult.slice(startIndex, endIndex).map((item, i) => {
                                  const idx = startIndex + i;
                                  const isSelected = selectedItem === item;
                                  return (
                                      <tr key={idx}
                                          onClick={() => handleSelect(item)}
                                          style={{
                                              cursor: 'pointer', height: ROW_H,
                                              background: isSelected ? 'rgba(59, 130, 246, 0.25)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'),
                                          }}>
                                          <td style={cell({ color: isSelected ? 'white' : 'var(--accent-secondary)' })} title={item.name}>{item.name}</td>
                                          <td style={cell({ color: 'var(--accent-primary)' })}>{item.group}</td>
                                          <td style={cell({ color: 'var(--text-secondary)' })} title={item.reason?.[0] || ''}>{item.reason?.[0] || ''}</td>
                                          <td style={cell()}>{item.timbre}</td>
                                          <td style={cell({ color: '#10B981' })}>{item.cluster !== -1 ? item.cluster : ''}</td>
                                          <td style={cell({ color: '#8B5CF6' })}>{item.root_note_name}</td>
                                          <td style={cell()}>{item.pitch_hz ? Math.round(item.pitch_hz) : 0}</td>
                                          <td style={cell()}>{item.length_seconds?.toFixed(2)}</td>
                                          <td style={cell({ color: '#F59E0B' })}>{item.transient_count}</td>
                                          <td style={cell()}>{item.spectral_centroid_hz ? Math.round(item.spectral_centroid_hz) : 0}</td>
                                          <td style={cell()}>{item.harmonicity?.toFixed(2)}</td>
                                          <td style={cell()}>{item.beats_per_minute || 0}</td>
                                      </tr>
                                  );
                              })}
                              {botPad > 0 && <tr style={{ height: botPad }}><td colSpan={12} style={{ padding: 0 }} /></tr>}
                            </>
                          );
                      })()}
                  </tbody>
              </table>
          </div>
      </div>

      {/* Bottom Half: Details, Bar Chart, Waveform */}
      <div style={{ height: '400px', display: 'flex', background: '#0B0E14' }}>

          {/* Bottom Left: Field/Value Table */}
          <div style={{ width: '300px', borderRight: '1px solid var(--border-color)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', tableLayout: 'fixed' }}>
                  <colgroup>
                      <col style={{ width: '105px' }} />
                      <col />
                  </colgroup>
                  <thead style={{ position: 'sticky', top: 0, background: '#1A1D24' }}>
                      <tr>
                          <th style={{ padding: '0.2rem 0.4rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Field</th>
                          <th style={{ padding: '0.2rem 0.4rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Value</th>
                      </tr>
                  </thead>
                  <tbody>
                      {selectedItem ? Object.entries(selectedItem).map(([k, v]: [string, any]) => {
                          if (Array.isArray(v)) v = v.join(', ');
                          if (typeof v === 'number') v = v.toFixed(2);
                          return (
                              <tr key={k} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
                                  <td style={{ padding: '0.2rem 0.4rem', color: '#3B82F6', wordBreak: 'break-word' }}>{k}</td>
                                  <td style={{ padding: '0.2rem 0.4rem', color: '#FCD34D', wordBreak: 'break-word' }}>{v?.toString()}</td>
                              </tr>
                          );
                      }) : (
                          <tr><td colSpan={2} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Select a sample</td></tr>
                      )}
                  </tbody>
              </table>
          </div>

          {/* Bottom Middle: Horizontal Bar Chart properties */}
          <div style={{ width: '250px', borderRight: '1px solid var(--border-color)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
              {selectedItem ? (
                  ['pitch_hz', 'length_seconds', 'complexity', 'spectral_centroid_hz', 'harmonicity', 'attack_seconds'].map(prop => (
                      <div key={prop} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'right' }}>{prop}</div>
                          <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)' }}>
                              <div style={{ width: `${Math.min(100, (selectedItem[prop] || 0) / 100)}%`, height: '100%', background: '#10B981' }} />
                          </div>
                      </div>
                  ))
              ) : null}
          </div>

          {/* Bottom Right: Static waveform + FFT preview */}
          <div style={{ flex: 1, position: 'relative', background: '#0A0A0A', padding: '0.75rem' }}>
              {selectedItem ? (
                  <>
                      <canvas ref={canvasRef} style={{ width: '100%', height: 'calc(100% - 1.5rem)', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', display: 'block' }} />
                      <audio ref={audioRef} style={{ display: 'none' }} />
                      <div style={{ position: 'absolute', bottom: '1.25rem', right: '1.25rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <button className="btn secondary" onClick={() => audioRef.current?.play()}>▶ Play</button>
                          <label className="btn secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input type="checkbox" checked={autoPlay} onChange={e => setAutoPlay(e.target.checked)} /> auto-play
                          </label>
                          <span className="text-secondary" style={{ fontSize: '0.8rem' }}>{selectedItem.length_seconds ? `${selectedItem.length_seconds.toFixed(2)} s` : ''}</span>
                      </div>
                  </>
              ) : (
                  <div style={{ display: 'flex', height: '100%', justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)' }}>
                      No sample selected
                  </div>
              )}
          </div>

      </div>
    </div>
  );
}
