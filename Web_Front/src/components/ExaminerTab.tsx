import { useState, useRef, useEffect, useMemo } from 'react';
import { resolveAudioUrl, hasAudio, isTauri } from '../audioLinking';
import { generateNewName } from '../renameConfig';
import { computeSpectrum, toMono, noteToFreq, estimateBpm, type PlotGeo } from '../examiner/audioAnalysis';
import { drawWaveform } from '../examiner/drawWaveform';
import ScopeBar from './ScopeBar';
import { complementColor, ucsColor, ucsSubColor, matchesScope, isProdRole } from '../groupColors';
import { altCategory, altSubcategory, altProbability } from '../ucsIndex';
import { drawSpectrumFill, drawSpectrumTrace } from '../examiner/drawSpectrum';
import { drawEnvelope, drawAxesAndName, drawBeats } from '../examiner/drawEnvelope';
import PropertyBars from '../examiner/PropertyBars';
import FieldValueTable from '../examiner/FieldValueTable';
import { useAudioPrefetch } from '../examiner/useAudioPrefetch';

interface ExaminerTabProps {
  analysisResult: any[];
  audioFiles: File[];
  onSound?: (name: string) => void;
}


const ROW_H = 24; // fixed row height (px) used by the virtualized sample list

// Bumped when the column set changes: a saved v1 set would hide every new column
// (Music Prod, UCS Alt 1-3) and keep pointing at the dropped god_category.
const COLS_KEY = 'scanalyzer_examiner_cols_v4';

const COLUMNS: { key: string; label: string; numeric?: boolean; width: string; get: (it: any) => any }[] = [
  { key: 'name', label: 'File', width: '250px', get: it => it.metadata?.name || '' },
  { key: 'ucs_category', label: 'UCS Category', width: '130px', get: it => it.ucs?.category || '' },
  { key: 'ucs_subcategory', label: 'UCS Subcategory', width: '140px', get: it => it.ucs?.subcategory || '' },
  // The runners-up the UCS matcher scored, best first. Each is "<category_id> <confidence>".
  { key: 'ucs_alt_1_group', label: 'Alt 1 Group', width: '100px', get: it => altCategory(it.ucs?.alternatives?.[0]) },
  { key: 'ucs_alt_1_subgroup', label: 'Alt 1 Sub', width: '100px', get: it => altSubcategory(it.ucs?.alternatives?.[0]) },
  { key: 'ucs_alt_1_probability', label: 'Alt 1 Prob', numeric: true, width: '80px', get: it => {
      const p = altProbability(it.ucs?.alternatives?.[0]);
      return Number.isFinite(p) ? p : -1;
  } },
  { key: 'ucs_alt_2_group', label: 'Alt 2 Group', width: '100px', get: it => altCategory(it.ucs?.alternatives?.[1]) },
  { key: 'ucs_alt_2_subgroup', label: 'Alt 2 Sub', width: '100px', get: it => altSubcategory(it.ucs?.alternatives?.[1]) },
  { key: 'ucs_alt_2_probability', label: 'Alt 2 Prob', numeric: true, width: '80px', get: it => {
      const p = altProbability(it.ucs?.alternatives?.[1]);
      return Number.isFinite(p) ? p : -1;
  } },
  { key: 'ucs_alt_3_group', label: 'Alt 3 Group', width: '100px', get: it => altCategory(it.ucs?.alternatives?.[2]) },
  { key: 'ucs_alt_3_subgroup', label: 'Alt 3 Sub', width: '100px', get: it => altSubcategory(it.ucs?.alternatives?.[2]) },
  { key: 'ucs_alt_3_probability', label: 'Alt 3 Prob', numeric: true, width: '80px', get: it => {
      const p = altProbability(it.ucs?.alternatives?.[2]);
      return Number.isFinite(p) ? p : -1;
  } },

  { key: 'reason', label: 'Reason', width: '200px', get: it => it.classification?.reason?.[0] || '' },
  { key: 'timbre', label: 'Timbre', width: '110px', get: it => it.classification?.timbre || '' },
  { key: 'cluster', label: 'Clust', numeric: true, width: '60px', get: it => (it.unsupervised?.cluster ?? -1) },
  { key: 'root', label: 'Root', numeric: true, width: '60px', get: it => (noteToFreq(it.musicality?.root_note_name) ?? -1) },
  { key: 'pitch_hz', label: 'Pitch', numeric: true, width: '70px', get: it => (it.musicality?.pitch_hz || 0) },
  { key: 'length_seconds', label: 'Len', numeric: true, width: '60px', get: it => (it.metadata?.length_seconds || 0) },
  { key: 'transient_count', label: 'Tr', numeric: true, width: '50px', get: it => (it.envelope?.transient_count || 0) },
  { key: 'spectral_centroid_hz', label: 'Cntrd', numeric: true, width: '80px', get: it => (it.spectral_features?.spectral_centroid_hz || 0) },
  { key: 'harmonicity', label: 'Harm', numeric: true, width: '60px', get: it => (it.spectral_features?.harmonicity || 0) },
  { key: 'beats_per_minute', label: 'BPM', numeric: true, width: '80px', get: it => (it.musicality?.beats_per_minute || 0) },
];

// A small emoji per timbre class, shown in the Timbre column.
const TIMBRE_EMOJI: Record<string, string> = {
  Percussive: '🥁', Tonal: '🎵', Noise: '🌫️', Bass: '🔈',
  Bright: '✨', Loop: '🔁', Pad: '☁️',
};

export default function ExaminerTab({ analysisResult, audioFiles, onSound }: ExaminerTabProps) {
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [autoPlay, setAutoPlay] = useState(true);
  const [digging, setDigging] = useState(false);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  const [scopeGroup, setScopeGroup] = useState<string | null>(null);
  const [scopeSub, setScopeSub] = useState<string | null>(null);
  // UCS is king — no music-vs-UCS switch. The Examiner scopes by UCS only.
  const taxonomy = 'UCS' as const;
  // Which UCS runner-up ranks the scope filter also matches on. 0/1/2 = Alt 1/2/3.
  const [altRanks, setAltRanks] = useState<Set<number>>(new Set([0, 1, 2]));
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [showColMenu, setShowColMenu] = useState(false);

  useEffect(() => {
    setScopeGroup(null);
    setScopeSub(null);
    setFilter('');
  }, [analysisResult, taxonomy]);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(COLS_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set(COLUMNS.map(c => c.key));
  });

  const toggleCol = (key: string) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisibleColumns(next);
    localStorage.setItem(COLS_KEY, JSON.stringify(Array.from(next)));
  };

  const activeColumns = COLUMNS.filter(c => visibleColumns.has(c.key));

  // Rows matching the group/subgroup scope AND the filter text.
  //
  // The UCS scorer reports runners-up as well as a winner, and the winner is often only
  // narrowly ahead — a door squeak can land on WOOD with DOORS as its second guess. So
  // under the UCS taxonomy the scope also matches an enabled alternate rank: pick DOORS
  // and, with Alt 1-3 ticked, you get everything the scorer *considered* a door, not just
  // what it committed to. The alternates are ids ("DOORKnck 0.31"), so they resolve
  // through UCS_BY_ID rather than by string-matching the category name.
  // Rows that only got into scope through a runner-up. They are shown, but greyed:
  // the scorer *considered* them a door, it did not commit to one.
  const [viaAlt, setViaAlt] = useState<WeakSet<any>>(new WeakSet());

  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const ranks = [...altRanks].sort();
    const alts = new WeakSet<any>();
    const out = analysisResult.filter(it => {
      if (scopeGroup) {
        let hit = matchesScope(it, scopeGroup, scopeSub);
        // Runner-up matching applies only to UCS categories (a role has no alternatives).
        if (!hit && !isProdRole(scopeGroup) && ranks.length) {
          hit = ranks.some(r => {
            const alt = it.ucs?.alternatives?.[r];
            if (!alt) return false;
            if (altCategory(alt) !== scopeGroup) return false;
            return !scopeSub || altSubcategory(alt) === scopeSub;
          });
          if (hit) alts.add(it);
        }
        if (!hit) return false;
      }

      // Search reads the runners-up too, so typing "door" finds what the scorer
      // considered a door even when it committed to WOOD.
      const altText = (it.ucs?.alternatives || [])
        .map((a: any) => `${altCategory(a)} ${altSubcategory(a)}`).join(' ');
      if (q && !`${it.metadata?.name || ''} ${it.classification?.group || ''} ${it.classification?.subgroup || ''} ${it.ucs?.category || ''} ${it.ucs?.subcategory || ''} ${altText} ${it.classification?.timbre || ''} ${it.musicality?.root_note_name || ''} ${it.classification?.reason?.[0] || ''}`
        .toLowerCase().includes(q)) return false;
      return true;
    });
    setViaAlt(alts);
    return out;
  }, [analysisResult, filter, scopeGroup, scopeSub, taxonomy, altRanks]);

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

  const maxBpm = useMemo(() => analysisResult.reduce((max, it) => Math.max(max, it.musicality?.beats_per_minute || 0), 1), [analysisResult]);
  const maxBrightness = useMemo(() => analysisResult.reduce((max, it) => Math.max(max, it.spectral_features?.spectral_centroid_hz || 0), 1), [analysisResult]);

  // Scroll-ahead audio buffering: pre-read a window of rows around the viewport so
  // the next few selections play instantly (see useAudioPrefetch). `scrollDirRef`
  // remembers which way the list last moved so the window leans that way.
  const prefetch = useAudioPrefetch(rows, audioFiles);
  const scrollDirRef = useRef<1 | -1>(1);
  const lastScrollTopRef = useRef(0);
  const lastAnchorRef = useRef(-1);
  const prefetchRafRef = useRef(0);
  // The heavy per-selection work (read bytes, decode, draw preview, play) is
  // debounced behind selection and generation-guarded, so hammering ↑/↓ can't
  // pile up dozens of concurrent decodeAudioData calls and freeze the webview.
  const loadGenRef = useRef(0);
  const loadTimerRef = useRef(0);

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
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedItem, rows, autoPlay, audioFiles]);

  // Always center the selected track in the list
  useEffect(() => {
    if (!selectedItem) return;
    const idx = rows.indexOf(selectedItem);
    if (idx < 0) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({
        top: Math.max(0, idx * ROW_H - el.clientHeight / 2 + ROW_H / 2),
        behavior: 'smooth'
      });
    }
  }, [selectedItem, rows]);

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

  // Playhead animation loop (bypasses React state to prevent 60fps re-renders)
  useEffect(() => {
    let frameId: number;
    const update = () => {
      const el = audioRef.current;
      const playhead = playheadRef.current;
      if (playhead) {
        if (el && el.duration && !el.paused) {
          const progress = el.currentTime / el.duration;
          playhead.style.left = `${progress * 100}%`;
          playhead.style.display = 'block';
        } else {
          playhead.style.display = 'none';
        }
      }
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
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
    const gcol = ucsSubColor(item?.ucs?.category || '', (item?.ucs?.subcategory || '').trim());
    const ccol = complementColor(gcol);
    const spec = computeSpectrum(mono, buffer.sampleRate);

    // BPM: prefer the record's value; for loops with none, estimate in-browser.
    let bpm = Number(item?.musicality?.beats_per_minute) || 0;
    let bpmEst = false;
    if (!bpm && (item?.classification?.timbre === 'Loop' || item?.classification?.length_class === 'Loop')) {
      bpm = estimateBpm(mono, buffer.sampleRate);
      bpmEst = bpm > 0;
    }

    // Draw order: spectrum fill (behind) → waveform → spectrum → beats → envelope → axes.
    if (spec) drawSpectrumFill(ctx, spec, geo, ccol);
    // Stereo → two lanes (left channel top, right channel bottom) with a faint
    // divider and L/R labels; mono → one full-height trace as before.
    if (buffer.numberOfChannels >= 2) {
      const quarter = geo.plotH / 4;
      const topMid = geo.plotTop + quarter;
      const botMid = geo.plotTop + quarter * 3;
      drawWaveform(ctx, buffer.getChannelData(0), geo, gcol, topMid, quarter);
      drawWaveform(ctx, buffer.getChannelData(1), geo, gcol, botMid, quarter);
      // Divider between the two channel lanes.
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, geo.mid + 0.5);
      ctx.lineTo(geo.w, geo.mid + 0.5);
      ctx.stroke();
      // Channel labels, top-left of each lane.
      ctx.fillStyle = gcol + '99';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('L', 4, topMid - quarter + 2);
      ctx.fillText('R', 4, botMid - quarter + 2);
    } else {
      drawWaveform(ctx, mono, geo, gcol);
    }
    if (spec) drawSpectrumTrace(ctx, spec, geo, ccol, item);
    drawBeats(ctx, geo, duration, bpm, bpmEst);
    drawEnvelope(ctx, item, duration, geo);
    drawAxesAndName(ctx, item, duration, geo);
  };

  // Drive the virtualized window AND the audio prefetch off one scroll event.
  // Direction = sign of the scroll delta; anchor = the row at the viewport centre.
  // Coalesced to one prefetch per frame, and only when the anchor row changes.
  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const st = e.currentTarget.scrollTop;
    setScrollTop(st);
    if (st !== lastScrollTopRef.current) {
      scrollDirRef.current = st > lastScrollTopRef.current ? 1 : -1;
      lastScrollTopRef.current = st;
    }
    if (prefetchRafRef.current) return;
    prefetchRafRef.current = requestAnimationFrame(() => {
      prefetchRafRef.current = 0;
      const anchor = Math.floor((st + viewportH / 2) / ROW_H);
      if (anchor === lastAnchorRef.current) return;
      lastAnchorRef.current = anchor;
      prefetch.prefetchWindow(anchor, scrollDirRef.current);
    });
  };

  // Prime the buffer once rows are known (initial load, new scan) so the first
  // clicks are instant before the user has scrolled at all.
  useEffect(() => {
    lastAnchorRef.current = -1;
    if (rows.length) prefetch.prefetchWindow(0, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Select instantly (highlight only), then debounce the expensive audio work.
  // Holding ↓ through 50 rows reschedules the timer each keypress, so exactly one
  // load+decode runs when you settle — not one per row.
  const DEBOUNCE_MS = 90;
  const handleSelect = (item: any, forcePlay = false) => {
    setSelectedItem(item);
    onSound?.(item?.metadata?.name || '');
    // Pin the playing item so a scroll can't evict its blob, and buffer around it
    // (covers arrow-key stepping and DIG, which move selection without scrolling).
    prefetch.pin(item);
    const gen = ++loadGenRef.current;
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    // DIG advances only on 'ended' (never rapid), but the 90ms delay is imperceptible
    // there too, so it takes the same debounced path.
    loadTimerRef.current = window.setTimeout(() => loadSelected(item, gen, forcePlay), DEBOUNCE_MS);
  };

  const loadSelected = async (item: any, gen: number, forcePlay: boolean) => {
    // Bail if a newer selection has superseded this one (guards every await below).
    const fresh = () => gen === loadGenRef.current;
    const selIdx = rows.indexOf(item);
    if (selIdx >= 0) prefetch.prefetchWindow(selIdx, scrollDirRef.current);

    const src = await prefetch.ensure(item);
    if (!fresh()) return;
    if (!src) {
      // Say WHY, rather than just going quiet. Silence here has different causes that
      // need different fixes, so guessing between them wastes an afternoon.
      console.warn('[examiner] no audio source for this record', {
        desktop: isTauri(),
        recordedPath: item?.metadata?.path,
        audioFilesLinked: audioFiles.length,
        hint: isTauri()
          ? 'desktop: read_audio_bytes failed — check the path exists and is readable'
          : 'browser: no File matched — re-scan the folder to re-link the audio',
      });
      // No linked audio — clear the preview so it doesn't show a stale sample.
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) { ctx.fillStyle = '#0A0A0A'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      return;
    }

    // The <audio> element is only rendered once something is selected, so on the FIRST
    // selection this runs before it exists and the ref is still null — the source was
    // never assigned and the sample never played. Retry after the render that mounts it.
    const load = () => {
      const el = audioRef.current;
      if (!el) return false;
      document.querySelectorAll('audio').forEach(a => a.pause());
      // Don't revoke the previous src here — the prefetch cache owns every URL it
      // hands out and revokes on eviction/unmount. Revoking a buffered URL would
      // break it for the next selection that reuses it.
      el.currentTime = 0;
      el.src = src;
      if (autoPlay || forcePlay) el.play().catch(err => console.warn('[examiner] play rejected', err));
      return true;
    };
    if (!load()) requestAnimationFrame(load);

    // Decode the whole file and draw the static preview. Each await is gated on
    // `fresh()` so a superseded selection never reaches decodeAudioData (the step
    // that piles up and freezes WebKitGTK) or paints a stale preview.
    try {
      if (!decodeCtxRef.current) {
        decodeCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const buf = await (await fetch(src)).arrayBuffer();
      if (!fresh()) return;
      const decoded = await decodeCtxRef.current.decodeAudioData(buf);
      if (!fresh()) return;
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
    while (i < rows.length && !hasAudio(audioFiles, rows[i])) i++;
    if (i < rows.length) handleSelect(rows[i], true);
    else setDigging(false); // reached the end of the list
  };

  const startDig = () => {
    setDigging(true);
    const idx = selectedItem ? rows.indexOf(selectedItem) : -1;
    if (idx >= 0 && hasAudio(audioFiles, selectedItem)) handleSelect(selectedItem, true);
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

  const handleDownload = async () => {
    if (!selectedItem) return;
    const url = await resolveAudioUrl(audioFiles, selectedItem);
    if (!url) {
      alert('Audio file not found in linked directory.');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = generateNewName(selectedItem);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div ref={outerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>

      {/* Top Half: Data Table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ padding: '0.5rem 1rem', background: '#0d1017', borderBottom: '1px solid var(--border-color)' }}>
              <ScopeBar 
                analysisResult={analysisResult} 
                group={scopeGroup} sub={scopeSub} setGroup={setScopeGroup} setSub={setScopeSub}
                filterText={filter} setFilterText={setFilter} taxonomy={taxonomy} altRanks={altRanks}
                rightContent={
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative' }}>
                    {/* Which runner-up ranks the scope also matches on — the record carries
                        the scorer's alternatives. */}
                    {(
                      <div className="text-secondary" style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
                        title="With a scope selected, also match samples where this runner-up falls in that UCS category.">
                        <span>Match:</span>
                        {[0, 1, 2].map(r => (
                          <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <input type="checkbox" checked={altRanks.has(r)}
                              onChange={() => setAltRanks(prev => {
                                const next = new Set(prev);
                                next.has(r) ? next.delete(r) : next.add(r);
                                return next;
                              })} />
                            Alt {r + 1}
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="text-secondary" style={{ fontSize: '0.8rem' }}>{(filter || scopeGroup) ? `${rows.length} / ${analysisResult.length}` : analysisResult.length} samples{(isTauri() || audioFiles.length) ? ` · ${isTauri() ? 'Native Audio' : audioFiles.length + ' audio linked'}` : ''}</div>
                    <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => setShowColMenu(!showColMenu)}>⚙ Columns</button>
                    {showColMenu && (
                      <div className="glass-panel" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem', zIndex: 50, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '220px', maxHeight: '300px', overflowY: 'auto' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', fontWeight: 600, textTransform: 'uppercase' }}>Visible Columns</div>
                        {COLUMNS.map(c => (
                          <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={visibleColumns.has(c.key)} onChange={() => toggleCol(c.key)} />
                            {c.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                }
              />
          </div>
          <div ref={scrollRef} onScroll={handleListScroll} style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ minWidth: '100%', width: 'max-content', borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed' }}>
                  <colgroup>
                      {activeColumns.map(c => <col key={c.key} style={{ width: c.width }} />)}
                  </colgroup>
                  <thead style={{ position: 'sticky', top: 0, background: '#1A1D24', zIndex: 1 }}>
                      <tr>
                          {activeColumns.map(c => (
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
                              {topPad > 0 && <tr style={{ height: topPad }}><td colSpan={activeColumns.length} style={{ padding: 0 }} /></tr>}
                              {rows.slice(startIndex, endIndex).map((item, i) => {
                                  const idx = startIndex + i;
                                  const isSelected = selectedItem === item;
                                  return (
                                      <tr key={idx}
                                          onClick={() => handleSelect(item)}
                                          style={{
                                              cursor: 'pointer', height: ROW_H,
                                              // In scope only because a runner-up matched: grey, not a committed hit.
                                              background: isSelected
                                                ? 'rgba(59, 130, 246, 0.25)'
                                                : viaAlt.has(item)
                                                  ? 'rgba(150,150,150,0.16)'
                                                  : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'),
                                              opacity: !isSelected && viaAlt.has(item) ? 0.75 : 1,
                                          }}>
                                          {activeColumns.find(c => c.key === 'name') && <td style={cell({ color: isSelected ? 'white' : 'var(--accent-secondary)' })} title={item.metadata.name}>{item.metadata.name}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_category') && <td style={cell({ color: item.ucs.category ? ucsColor(item.ucs.category) : 'var(--text-secondary)' })} title={item.ucs.category}>{item.ucs.category}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_subcategory') && <td style={cell({ color: item.ucs.subcategory ? ucsSubColor(item.ucs.category || '', item.ucs.subcategory) : 'var(--text-secondary)' })} title={item.ucs.subcategory}>{item.ucs.subcategory}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_alt_1_group') && <td style={cell({ color: 'var(--text-secondary)' })} title={altCategory(item.ucs?.alternatives?.[0])}>{altCategory(item.ucs?.alternatives?.[0])}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_alt_1_subgroup') && <td style={cell({ color: 'var(--text-secondary)' })} title={altSubcategory(item.ucs?.alternatives?.[0])}>{altSubcategory(item.ucs?.alternatives?.[0])}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_alt_1_probability') && <td style={cell({ color: 'var(--text-secondary)' })}>{Number.isFinite(altProbability(item.ucs?.alternatives?.[0])) ? altProbability(item.ucs?.alternatives?.[0]).toFixed(3) : ''}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_alt_2_group') && <td style={cell({ color: 'var(--text-secondary)' })} title={altCategory(item.ucs?.alternatives?.[1])}>{altCategory(item.ucs?.alternatives?.[1])}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_alt_2_subgroup') && <td style={cell({ color: 'var(--text-secondary)' })} title={altSubcategory(item.ucs?.alternatives?.[1])}>{altSubcategory(item.ucs?.alternatives?.[1])}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_alt_2_probability') && <td style={cell({ color: 'var(--text-secondary)' })}>{Number.isFinite(altProbability(item.ucs?.alternatives?.[1])) ? altProbability(item.ucs?.alternatives?.[1]).toFixed(3) : ''}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_alt_3_group') && <td style={cell({ color: 'var(--text-secondary)' })} title={altCategory(item.ucs?.alternatives?.[2])}>{altCategory(item.ucs?.alternatives?.[2])}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_alt_3_subgroup') && <td style={cell({ color: 'var(--text-secondary)' })} title={altSubcategory(item.ucs?.alternatives?.[2])}>{altSubcategory(item.ucs?.alternatives?.[2])}</td>}
                                          {activeColumns.find(c => c.key === 'ucs_alt_3_probability') && <td style={cell({ color: 'var(--text-secondary)' })}>{Number.isFinite(altProbability(item.ucs?.alternatives?.[2])) ? altProbability(item.ucs?.alternatives?.[2]).toFixed(3) : ''}</td>}
                                          {activeColumns.find(c => c.key === 'reason') && <td style={cell({ color: 'var(--text-secondary)' })} title={item.classification.reason?.[0] || ''}>{item.classification.reason?.[0] || ''}</td>}
                                          {activeColumns.find(c => c.key === 'timbre') && <td style={cell()} title={item.classification.timbre}>{item.classification.timbre ? `${TIMBRE_EMOJI[item.classification.timbre] || '🎚️'} ${item.classification.timbre}` : ''}</td>}
                                          {activeColumns.find(c => c.key === 'cluster') && <td style={cell({ color: '#10B981' })}>{item.unsupervised.cluster !== -1 ? item.unsupervised.cluster : ''}</td>}
                                          {activeColumns.find(c => c.key === 'root') && <td style={cell({ color: '#8B5CF6' })}>{item.musicality.root_note_name}</td>}
                                          {activeColumns.find(c => c.key === 'pitch_hz') && <td style={cell()}>{item.musicality.pitch_hz ? Math.round(item.musicality.pitch_hz) : 0}</td>}
                                          {activeColumns.find(c => c.key === 'length_seconds') && <td style={cell()}>{item.metadata.length_seconds?.toFixed(2)}</td>}
                                          {activeColumns.find(c => c.key === 'transient_count') && <td style={cell({ color: '#F59E0B' })}>{item.envelope.transient_count}</td>}
                                          {activeColumns.find(c => c.key === 'spectral_centroid_hz') && <td style={cell({
                                              background: item.spectral_features?.spectral_centroid_hz 
                                                  ? `linear-gradient(90deg, rgba(244, 144, 44, 0.25) ${(item.spectral_features.spectral_centroid_hz / maxBrightness) * 100}%, transparent ${(item.spectral_features.spectral_centroid_hz / maxBrightness) * 100}%)` 
                                                  : undefined
                                          })}>{item.spectral_features.spectral_centroid_hz ? Math.round(item.spectral_features.spectral_centroid_hz) : 0}</td>}
                                          {activeColumns.find(c => c.key === 'harmonicity') && <td style={cell()}>{item.spectral_features?.harmonicity?.toFixed(2)}</td>}
                                          {activeColumns.find(c => c.key === 'beats_per_minute') && <td style={cell({
                                              background: item.musicality?.beats_per_minute 
                                                  ? `linear-gradient(90deg, rgba(16, 185, 129, 0.25) ${(item.musicality.beats_per_minute / maxBpm) * 100}%, transparent ${(item.musicality.beats_per_minute / maxBpm) * 100}%)` 
                                                  : undefined
                                          })}>{item.musicality.beats_per_minute || 0}</td>}
                                      </tr>
                                  );
                              })}
                              {botPad > 0 && <tr style={{ height: botPad }}><td colSpan={activeColumns.length} style={{ padding: 0 }} /></tr>}
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
                      <div style={{ width: '100%', height: 'calc(100% - 1.5rem)', position: 'relative' }}>
                        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', display: 'block' }} />
                        <div ref={playheadRef} style={{
                          position: 'absolute', top: 0, bottom: 0, left: 0,
                          width: '2px', backgroundColor: 'rgb(244, 144, 44)', zIndex: 10,
                          pointerEvents: 'none', display: 'none'
                        }}>
                          <div style={{ position: 'absolute', top: 0, left: '-4px', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid rgb(244, 144, 44)' }} />
                        </div>
                      </div>
                      <audio ref={audioRef} style={{ display: 'none' }} onEnded={handleEnded} />
                      <div style={{ position: 'absolute', bottom: '1.25rem', right: '1.25rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <button className="btn secondary" onClick={handleDownload} title="Download with rename options">⬇ Download</button>
                          <button className="btn secondary" onClick={() => audioRef.current?.play()}>▶ Play</button>
                          {digging
                            ? <button className="btn primary" style={{ background: '#ef4444' }} onClick={stopDig}>■ Stop DIG</button>
                            : <button className="btn primary" onClick={startDig}>⛏ DIG</button>}
                          <label className="btn secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input type="checkbox" checked={autoPlay} onChange={e => setAutoPlay(e.target.checked)} /> auto-play
                          </label>
                          <span className="text-secondary" style={{ fontSize: '0.8rem' }}>{selectedItem.metadata?.length_seconds ? `${selectedItem.metadata.length_seconds.toFixed(2)} s · ${Math.round(selectedItem.metadata.length_seconds * (Number(selectedItem.metadata.sample_rate) || 44100)).toLocaleString()} smp` : ''}</span>
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
