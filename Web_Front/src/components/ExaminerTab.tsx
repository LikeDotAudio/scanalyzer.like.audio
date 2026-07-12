import { useState, useRef, useEffect, useMemo } from 'react';
import { findAudioFile } from '../audioLinking';
import { groupColor, complementColor } from '../groupColors';
import { computeSpectrum, toMono, noteToFreq, type PlotGeo } from '../examiner/audioAnalysis';
import { drawWaveform } from '../examiner/drawWaveform';
import { drawSpectrumFill, drawSpectrumTrace } from '../examiner/drawSpectrum';
import { drawEnvelope, drawAxesAndName } from '../examiner/drawEnvelope';
import PropertyBars from '../examiner/PropertyBars';
import FieldValueTable from '../examiner/FieldValueTable';

interface ExaminerTabProps {
  analysisResult: any[];
  audioFiles: File[];
  onSound?: (name: string) => void;
}


const ROW_H = 24; // fixed row height (px) used by the virtualized sample list

// Column config drives the sortable header row. `get` returns the sort key.
const COLUMNS: { key: string; label: string; numeric?: boolean; get: (it: any) => any }[] = [
  { key: 'name', label: 'File', get: it => it.name || '' },
  { key: 'group', label: 'Group', get: it => it.group || '' },
  { key: 'reason', label: 'Reason', get: it => it.reason?.[0] || '' },
  { key: 'timbre', label: 'Timbre', get: it => it.timbre || '' },
  { key: 'cluster', label: 'Clust', numeric: true, get: it => (it.cluster ?? -1) },
  { key: 'root', label: 'Root', numeric: true, get: it => (noteToFreq(it.root_note_name) ?? -1) },
  { key: 'pitch_hz', label: 'Pitch', numeric: true, get: it => (it.pitch_hz || 0) },
  { key: 'length_seconds', label: 'Len', numeric: true, get: it => (it.length_seconds || 0) },
  { key: 'transient_count', label: 'Tr', numeric: true, get: it => (it.transient_count || 0) },
  { key: 'spectral_centroid_hz', label: 'Cntrd', numeric: true, get: it => (it.spectral_centroid_hz || 0) },
  { key: 'harmonicity', label: 'Harm', numeric: true, get: it => (it.harmonicity || 0) },
  { key: 'beats_per_minute', label: 'BPM', numeric: true, get: it => (it.beats_per_minute || 0) },
];

export default function ExaminerTab({ analysisResult, audioFiles, onSound }: ExaminerTabProps) {
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [autoPlay, setAutoPlay] = useState(true);
  const [digging, setDigging] = useState(false);
  const [filter, setFilter] = useState('');
  const [scopeGroup, setScopeGroup] = useState<string | null>(null);
  const [scopeSub, setScopeSub] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  // Groups present, and subgroups within the scoped group — for the scope bar.
  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const it of analysisResult) s.add(it.group || 'Unclassified');
    return Array.from(s).sort();
  }, [analysisResult]);
  const subgroups = useMemo(() => {
    if (!scopeGroup) return [];
    const s = new Set<string>();
    for (const it of analysisResult) {
      if ((it.group || 'Unclassified') === scopeGroup && (it.subgroup || '').trim()) s.add(it.subgroup.trim());
    }
    return Array.from(s).sort();
  }, [analysisResult, scopeGroup]);

  // Rows matching the group/subgroup scope AND the filter text.
  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return analysisResult.filter(it => {
      if (scopeGroup && (it.group || 'Unclassified') !== scopeGroup) return false;
      if (scopeSub && (it.subgroup || '').trim() !== scopeSub) return false;
      if (q && !`${it.name || ''} ${it.group || ''} ${it.subgroup || ''} ${it.timbre || ''} ${it.root_note_name || ''} ${it.reason?.[0] || ''}`
        .toLowerCase().includes(q)) return false;
      return true;
    });
  }, [analysisResult, filter, scopeGroup, scopeSub]);

  // The displayed list: filtered, then sorted by the clicked column.
  const rows = useMemo(() => {
    if (!sort) return filteredRows;
    const col = COLUMNS.find(c => c.key === sort.key);
    if (!col) return filteredRows;
    const arr = filteredRows.slice();
    arr.sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      const cmp = col.numeric ? (va - vb) : String(va).localeCompare(String(vb));
      return cmp * sort.dir;
    });
    return arr;
  }, [filteredRows, sort]);

  const toggleSort = (key: string) =>
    setSort(prev => prev?.key === key ? { key, dir: (prev.dir === 1 ? -1 : 1) } : { key, dir: 1 });

  // Per-feature min/max across the dataset, so each property bar fills relative
  // (property-bar scaling lives in the PropertyBars component)
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  const [bottomHeight, setBottomHeight] = useState(400); // draggable visualizer height
  // A lightweight context used only to decode audio for the static preview.
  const decodeCtxRef = useRef<AudioContext | null>(null);
  // Last decoded buffer/item so the preview can be re-drawn on resize.
  const lastBufferRef = useRef<AudioBuffer | null>(null);
  const lastItemRef = useRef<any>(null);

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
      if (!rows.length) return;
      e.preventDefault();
      const idx = selectedItem ? rows.indexOf(selectedItem) : -1;
      const next = idx < 0
        ? 0
        : e.key === 'ArrowDown'
          ? Math.min(rows.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      handleSelect(rows[next]);
      // Centre the selected row in the viewport as you arrow through the list.
      const el = scrollRef.current;
      if (el) el.scrollTop = Math.max(0, next * ROW_H - el.clientHeight / 2 + ROW_H / 2);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedItem, rows, autoPlay, audioFiles]);

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

  // Re-draw the preview whenever the canvas changes size (sash drag / window resize).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (lastBufferRef.current) renderPreview(lastBufferRef.current, lastItemRef.current);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [selectedItem]);

  // Drag the sash between the sample list and the visualizer to resize them.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const rect = outerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const h = rect.bottom - ev.clientY;
      setBottomHeight(Math.max(140, Math.min(rect.height - 120, h)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Keep the selected row visible as the user arrows through the (virtualized) list.
  useEffect(() => {
    const el = scrollRef.current;
    if (!selectedItem || !el) return;
    const idx = rows.indexOf(selectedItem);
    if (idx < 0) return;
    const top = idx * ROW_H;
    const bottom = top + ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [selectedItem, rows]);

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

    // Shared plot geometry — room for note labels (top) and time labels (bottom).
    const padTop = 26, padBottom = 18;
    const geo: PlotGeo = {
      w, h, padTop,
      plotTop: padTop, plotBottom: h - padBottom, plotH: Math.max(1, h - padBottom - padTop),
      mid: (padTop + h - padBottom) / 2, halfH: Math.max(1, h - padBottom - padTop) / 2,
    };

    const mono = toMono(buffer);
    const duration = buffer.duration;

    // Waveform = the sample's group colour; spectrum = its complement.
    const gcol = groupColor(item?.group || 'Unclassified', item?.subgroup || '');
    const ccol = complementColor(gcol);
    const spec = computeSpectrum(mono, buffer.sampleRate);

    // Draw order: spectrum fill (behind) → waveform → spectrum trace → envelope → axes.
    if (spec) drawSpectrumFill(ctx, spec, geo, ccol);
    drawWaveform(ctx, mono, geo, gcol);
    if (spec) drawSpectrumTrace(ctx, spec, geo, ccol, item);
    drawEnvelope(ctx, item, duration, geo);
    drawAxesAndName(ctx, item, duration, geo);
  };

  const handleSelect = async (item: any, forcePlay = false) => {
    setSelectedItem(item);
    onSound?.(item?.name || '');

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
      if (autoPlay || forcePlay) audioRef.current.play().catch(() => {});
    }

    // Decode the whole file and draw the static preview.
    try {
      if (!decodeCtxRef.current) {
        decodeCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const buf = await file.arrayBuffer();
      const decoded = await decodeCtxRef.current.decodeAudioData(buf);
      lastBufferRef.current = decoded;
      lastItemRef.current = item;
      renderPreview(decoded, item);
    } catch {
      /* undecodable file — leave the preview blank */
    }
  };

  // DIG: play through the list, advancing to the next playable sample each time
  // one finishes, until the user stops. Skips samples with no linked audio.
  const advanceDig = (fromIdx: number) => {
    let i = Math.max(0, fromIdx);
    while (i < rows.length && !findAudioFile(audioFiles, rows[i])) i++;
    if (i < rows.length) handleSelect(rows[i], true);
    else setDigging(false); // reached the end of the list
  };

  const startDig = () => {
    setDigging(true);
    const idx = selectedItem ? rows.indexOf(selectedItem) : -1;
    if (idx >= 0 && findAudioFile(audioFiles, selectedItem)) handleSelect(selectedItem, true);
    else advanceDig(idx + 1);
  };

  const stopDig = () => {
    setDigging(false);
    audioRef.current?.pause();
  };

  const handleEnded = () => {
    if (!digging) return;
    advanceDig(rows.indexOf(selectedItem) + 1);
  };

  return (
    <div ref={outerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>

      {/* Top Half: Data Table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', background: '#111318' }}>
              <button className="btn secondary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}>Open .PEAK...</button>
              <input type="text" placeholder="Filter…" value={filter} onChange={e => setFilter(e.target.value)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px' }} />
              <div style={{ flex: 1 }} />
              <div className="text-secondary" style={{ fontSize: '0.8rem' }}>{(filter || scopeGroup) ? `${rows.length} / ${analysisResult.length}` : analysisResult.length} samples{audioFiles.length ? ` · ${audioFiles.length} audio linked` : ''}</div>
          </div>

          {/* Group / subgroup scope filter bar. When a group is active, it and
              its subgroups lead on the left and the other groups grey out. */}
          <div style={{ padding: '0.3rem 1rem', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap', background: '#0d1017', borderBottom: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Scope:</span>
              <button className={`btn ${!scopeGroup ? 'primary' : 'secondary'}`} style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => { setScopeGroup(null); setScopeSub(null); }}>All</button>

              {scopeGroup ? (
                  <>
                      {/* Active group + its subgroups, front and centre */}
                      <button className="btn primary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', borderLeft: `3px solid ${groupColor(scopeGroup, '')}` }} onClick={() => setScopeSub(null)}>{scopeGroup}</button>
                      {subgroups.length > 0 && (
                          <>
                              <button className={`btn ${!scopeSub ? 'primary' : 'secondary'}`} style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setScopeSub(null)}>All {scopeGroup}</button>
                              {subgroups.map(sg => (
                                  <button key={sg} className={`btn ${scopeSub === sg ? 'primary' : 'secondary'}`} style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', borderLeft: `3px solid ${groupColor(scopeGroup, sg)}` }} onClick={() => setScopeSub(sg)}>{sg}</button>
                              ))}
                          </>
                      )}
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0.25rem' }}>│</span>
                      {/* Every other group, greyed until the scope is cleared */}
                      {groups.filter(g => g !== scopeGroup).map(g => (
                          <button key={g} className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', borderLeft: `3px solid ${groupColor(g, '')}`, opacity: 0.35 }} onClick={() => { setScopeGroup(g); setScopeSub(null); }}>{g}</button>
                      ))}
                  </>
              ) : (
                  groups.map(g => (
                      <button key={g} className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', borderLeft: `3px solid ${groupColor(g, '')}` }} onClick={() => { setScopeGroup(g); setScopeSub(null); }}>{g}</button>
                  ))
              )}
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
                          {COLUMNS.map(c => (
                              <th key={c.key} onClick={() => toggleSort(c.key)}
                                  title={`Sort by ${c.label}`}
                                  style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', userSelect: 'none', color: sort?.key === c.key ? 'var(--accent-secondary)' : undefined }}>
                                  {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                              </th>
                          ))}
                      </tr>
                  </thead>
                  <tbody>
                      {(() => {
                          const total = rows.length;
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
                              {rows.slice(startIndex, endIndex).map((item, i) => {
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
                                          <td style={cell({ color: groupColor(item.group || 'Unclassified', item.subgroup || '') })}>{item.group}</td>
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

      {/* Draggable sash between the sample list and the visualizer */}
      <div onMouseDown={startResize} title="Drag to resize"
           style={{ height: '6px', cursor: 'row-resize', background: 'var(--border-color)', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)' }} />

      {/* Bottom Half: Details, Bar Chart, Waveform */}
      <div style={{ height: `${bottomHeight}px`, flexShrink: 0, display: 'flex', background: '#0B0E14' }}>

          {/* Bottom Left: Field/Value details */}
          <div style={{ width: '300px', borderRight: '1px solid var(--border-color)', overflowY: 'auto' }}>
              <FieldValueTable item={selectedItem} />
          </div>

          {/* Bottom Middle: property bar graph */}
          <div style={{ width: '250px', borderRight: '1px solid var(--border-color)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
              <PropertyBars item={selectedItem} analysisResult={analysisResult} />
          </div>

          {/* Bottom Right: Static waveform + FFT preview */}
          <div style={{ flex: 1, position: 'relative', background: '#0A0A0A', padding: '0.75rem' }}>
              {selectedItem ? (
                  <>
                      <canvas ref={canvasRef} style={{ width: '100%', height: 'calc(100% - 1.5rem)', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', display: 'block' }} />
                      <audio ref={audioRef} style={{ display: 'none' }} onEnded={handleEnded} />
                      <div style={{ position: 'absolute', bottom: '1.25rem', right: '1.25rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <button className="btn secondary" onClick={() => audioRef.current?.play()}>▶ Play</button>
                          {digging
                            ? <button className="btn primary" style={{ background: '#ef4444' }} onClick={stopDig}>■ Stop DIG</button>
                            : <button className="btn primary" onClick={startDig}>⛏ DIG</button>}
                          <label className="btn secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input type="checkbox" checked={autoPlay} onChange={e => setAutoPlay(e.target.checked)} /> auto-play
                          </label>
                          <span className="text-secondary" style={{ fontSize: '0.8rem' }}>{selectedItem.length_seconds ? `${selectedItem.length_seconds.toFixed(2)} s · ${Math.round(selectedItem.length_seconds * (Number(selectedItem.sample_rate ?? selectedItem.samplerate) || 44100)).toLocaleString()} smp` : ''}</span>
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
