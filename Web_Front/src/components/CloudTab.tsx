import { Suspense, useState, useEffect, useRef, useMemo } from 'react';
import SampleCloud, { AXIS_OPTIONS, SIZE_OPTIONS, COLOR_OPTIONS, SHAPE_OPTIONS } from '../SampleCloud';
import { groupColor, subKey } from '../groupColors';
import { findAudioFile } from '../audioLinking';
import ScopeBar from './ScopeBar';

interface CloudTabProps {
  analysisResult: any[];
  audioFiles: File[];
  onSound?: (name: string) => void;
  onLoadSounds?: () => void;
}

// One-click axis presets: [label, X, Y, Z, Size] — ported from the desktop app.
const PRESETS: [string, string, string, string, string][] = [
  ['A', 'Pitch', 'Group', 'Complexity', 'Length'],
  ['B', 'Pitch', 'Group', 'Brightness (centroid)', 'Length'],
  ['C', 'Attack', 'Sustain', 'Harmonicity', 'RMS'],
  ['D', 'Brightness (centroid)', 'Harmonicity', 'Complexity', 'Length'],
  ['E', 'Pitch', 'Harmonicity', 'Sustain', 'RMS'],
  ['F', 'Length', 'Group', 'Attack', 'RMS'],
];

const selStyle: React.CSSProperties = {
  background: '#000', color: '#fff',
  border: '1px solid var(--border-color)', borderRadius: 0,
  padding: '0.25rem 0.4rem', fontSize: '0.8rem',
};

const getPref = (key: string, def: string) => localStorage.getItem(`scanalyzer_cloud_${key}`) || def;

export default function CloudTab({ analysisResult, audioFiles, onSound, onLoadSounds }: CloudTabProps) {
  const [xAxis, setXAxis] = useState(() => getPref('xAxis', 'Pitch'));
  const [yAxis, setYAxis] = useState(() => getPref('yAxis', 'Group'));
  const [zAxis, setZAxis] = useState(() => getPref('zAxis', 'Complexity'));
  const [sizeAxis, setSizeAxis] = useState(() => getPref('sizeAxis', 'Length'));
  const [colorBy, setColorBy] = useState(() => getPref('colorBy', 'Group'));
  const [shapeBy, setShapeBy] = useState(() => getPref('shapeBy', 'Instrument'));
  const [scopeGroup, setScopeGroup] = useState<string | null>(null);
  const [scopeSub, setScopeSub] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  useEffect(() => {
    setScopeGroup(null);
    setScopeSub(null);
    setFilterText('');
  }, [analysisResult]);

  const data = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return analysisResult.filter(it => {
      if (scopeGroup && (it.group || 'Unclassified') !== scopeGroup) return false;
      if (scopeSub && (it.subgroup || '').trim() !== scopeSub) return false;
      if (q && !`${it.name || ''} ${it.group || ''} ${it.subgroup || ''} ${it.timbre || ''} ${it.root_note_name || ''} ${it.reason?.[0] || ''}`
        .toLowerCase().includes(q)) return false;
      return true;
    });
  }, [analysisResult, scopeGroup, scopeSub, filterText]);

  useEffect(() => {
    localStorage.setItem('scanalyzer_cloud_xAxis', xAxis);
    localStorage.setItem('scanalyzer_cloud_yAxis', yAxis);
    localStorage.setItem('scanalyzer_cloud_zAxis', zAxis);
    localStorage.setItem('scanalyzer_cloud_sizeAxis', sizeAxis);
    localStorage.setItem('scanalyzer_cloud_colorBy', colorBy);
    localStorage.setItem('scanalyzer_cloud_shapeBy', shapeBy);
  }, [xAxis, yAxis, zAxis, sizeAxis, colorBy, shapeBy]);
  const [showAxes, setShowAxes] = useState(true);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelectedIndex(null);
  }, [scopeGroup, scopeSub]);

  const [showGraphOptions, setShowGraphOptions] = useState(() => window.innerWidth > 768);
  const [showGroups, setShowGroups] = useState(false);
  const [playMsg, setPlayMsg] = useState<string>('');
  const audioRef = useRef<HTMLAudioElement>(null);

  // Distinct groups → their subgroups, with per-group and per-subgroup file
  // counts, for the nested legend.
  const groupTree = useMemo(() => {
    const map = new Map<string, { count: number; subs: Map<string, number> }>();
    for (const it of analysisResult) {
      const g = it.group || 'Unclassified';
      const entry = map.get(g) || { count: 0, subs: new Map<string, number>() };
      entry.count++;
      const sg = (it.subgroup || '').trim();
      if (sg) entry.subs.set(sg, (entry.subs.get(sg) || 0) + 1);
      map.set(g, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([g, { count, subs }]) => ({
        group: g,
        count,
        subs: Array.from(subs.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([name, c]) => ({ name, count: c })),
      }));
  }, [analysisResult]);

  const toggleKey = (key: string) => {
    setHiddenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleExpand = (g: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  };

  const applyPreset = (x: string, y: string, z: string, size: string) => {
    setXAxis(x); setYAxis(y); setZAxis(z); setSizeAxis(size);
  };

  const handlePick = (index: number) => {
    setSelectedIndex(index);
    const item = data[index];
    if (!item) return;
    onSound?.(item.name || '');
    if (audioFiles.length === 0) { setPlayMsg('No audio linked — click "Load Sounds" in the header.'); return; }
    const file = findAudioFile(audioFiles, item);
    if (!file) {
      setPlayMsg(`No file matched "${item.name}" among ${audioFiles.length} linked.`);
      return;
    }
    if (audioRef.current) {
      const el = audioRef.current;
      el.src = URL.createObjectURL(file);
      el.volume = 1;
      setPlayMsg('');
      el.play().then(() => setPlayMsg('')).catch(err => setPlayMsg(`Playback failed: ${err?.message || err}`));
    }
  };

  const replay = () => { audioRef.current?.play().catch(() => {}); };

  const selected = selectedIndex != null ? data[selectedIndex] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: '100%' }}>
      <div style={{ padding: '0.5rem 1rem', background: '#0d1017', borderBottom: '1px solid var(--border-color)', zIndex: 10 }}>
          <ScopeBar 
            analysisResult={analysisResult} group={scopeGroup} sub={scopeSub} setGroup={setScopeGroup} setSub={setScopeSub} 
            filterText={filterText} setFilterText={setFilterText}
            rightContent={
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{data.length} / {analysisResult.length} samples</span>
            }
          />
      </div>
      {/* 3D WebGL Canvas Area */}
      <section className="main-view glass-panel" style={{ margin: 0, padding: 0, overflow: 'hidden', flex: 1, position: 'relative' }}>
        <Suspense fallback={<div style={{ color: 'white', padding: '2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Initializing 3D Engine...</div>}>
          <SampleCloud
            data={data} xAxis={xAxis} yAxis={yAxis} zAxis={zAxis}
            sizeAxis={sizeAxis} colorBy={colorBy} shapeBy={shapeBy} hiddenGroups={hiddenGroups}
            selectedIndex={selectedIndex} onPick={handlePick} showAxes={showAxes}
          />
        </Suspense>
        <audio ref={audioRef} style={{ display: 'none' }} onError={() => setPlayMsg('Browser could not decode this audio file.')} />

        {/* Selected sample readout (Top Left) */}
        {selected && (
          <div style={{ position: 'absolute', top: '1rem', left: '1rem', zIndex: 10, background: 'rgba(0,0,0,0.65)', padding: '0.6rem 0.9rem', border: '1px solid rgba(255,255,255,0.1)', maxWidth: '340px' }}>
            <div style={{ color: '#FCD34D', fontSize: '0.85rem', marginBottom: '0.2rem' }}>{selected.name}</div>
            <div className="text-secondary" style={{ fontSize: '0.75rem' }}>{selected.group}{selected.subgroup ? ` / ${selected.subgroup}` : ''} · {selected.timbre} · {selected.length_seconds?.toFixed(2)}s</div>
            <button className="btn secondary" style={{ marginTop: '0.4rem', padding: '0.15rem 0.6rem', fontSize: '0.75rem' }} onClick={replay}>▶ Play</button>
            {playMsg && <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: '#f59e0b' }}>{playMsg}</div>}
          </div>
        )}

        {/* Instructions (Bottom Right) */}
        <div className="hide-on-mobile" style={{ position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 10 }}>
             <p className="text-secondary" style={{ background: 'rgba(0,0,0,0.6)', padding: '0.6rem 1rem', border: '1px solid rgba(255,255,255,0.1)', margin: 0 }}>
               🖱️ Click a dot to hear it • Drag: orbit • Scroll: zoom
             </p>
        </div>

        {/* Overlay Toggles (Top Right) */}
        <div style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 20, display: 'flex', gap: '0.5rem' }}>
          <button className={`btn ${showGroups ? 'primary' : 'secondary'}`} onClick={() => { setShowGroups(!showGroups); setShowGraphOptions(false); }}>📁 Groups</button>
          <button className={`btn ${showGraphOptions ? 'primary' : 'secondary'}`} onClick={() => { setShowGraphOptions(!showGraphOptions); setShowGroups(false); }}>⚙ Graph Options</button>
        </div>

        {/* Graph Options Overlay */}
        {showGraphOptions && (
          <div className="glass-panel" style={{ position: 'absolute', top: '3.5rem', right: '1rem', zIndex: 20, background: 'rgba(17, 19, 24, 0.95)', padding: '1rem', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '280px', maxHeight: 'calc(100% - 5rem)', overflowY: 'auto' }}>
            <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', fontSize: '0.9rem', margin: 0 }}>Graph Options</h3>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>X Axis:
              <select style={selStyle} value={xAxis} onChange={e => setXAxis(e.target.value)}>{AXIS_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
            </label>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Y Axis:
              <select style={selStyle} value={yAxis} onChange={e => setYAxis(e.target.value)}>{AXIS_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
            </label>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Z Axis:
              <select style={selStyle} value={zAxis} onChange={e => setZAxis(e.target.value)}>{AXIS_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
            </label>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Size:
              <select style={selStyle} value={sizeAxis} onChange={e => setSizeAxis(e.target.value)}>{SIZE_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
            </label>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Color:
              <select style={selStyle} value={colorBy} onChange={e => setColorBy(e.target.value)}>{COLOR_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
            </label>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Shape:
              <select style={selStyle} value={shapeBy} onChange={e => setShapeBy(e.target.value)}>{SHAPE_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', marginTop: '0.5rem' }}>
              <input type="checkbox" checked={showAxes} onChange={e => setShowAxes(e.target.checked)} /> Show axis labels
            </label>
            
            <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Presets:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {PRESETS.map(([label, x, y, z, s]) => (
                  <button key={label} className="btn secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', flex: '1 1 auto' }}
                    onClick={() => applyPreset(x, y, z, s)}>{label}</button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              {audioFiles.length > 0
                ? <div className="text-secondary" style={{ fontSize: '0.75rem', textAlign: 'center' }}>{audioFiles.length.toLocaleString()} audio linked</div>
                : <button className="btn primary blink" style={{ width: '100%', padding: '0.3rem', fontSize: '0.75rem' }} onClick={() => onLoadSounds?.()}>⚠ 0 audio linked — Load folder</button>}
            </div>
          </div>
        )}

        {/* Groups Overlay */}
        {showGroups && (
          <div className="glass-panel" style={{ position: 'absolute', top: '3.5rem', right: '1rem', zIndex: 20, background: 'rgba(17, 19, 24, 0.95)', padding: '1rem', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.15rem', width: '280px', maxHeight: 'calc(100% - 5rem)', overflowY: 'auto' }}>
            <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', fontSize: '0.9rem', margin: 0, marginBottom: '0.5rem' }}>Groups / subgroups</h3>
            <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.2rem' }}>
              <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
                onClick={() => setHiddenGroups(new Set())}>Show all</button>
              <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
                onClick={() => setHiddenGroups(new Set(groupTree.map(g => g.group)))}>Show none</button>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.5rem' }}>
              <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
                onClick={() => setExpanded(new Set(groupTree.filter(g => g.subs.length).map(g => g.group)))}>Expand all</button>
              <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
                onClick={() => setExpanded(new Set())}>Collapse</button>
            </div>
            <div className="text-secondary" style={{ fontSize: '0.7rem', marginBottom: '0.5rem' }}>click to hide / show</div>
            {groupTree.map(({ group, count, subs }) => {
              const gHidden = hiddenGroups.has(group);
              const isOpen = expanded.has(group);
              return (
                <div key={group} style={{ marginBottom: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                    <span
                      onClick={() => subs.length && toggleExpand(group)}
                      style={{ width: '12px', cursor: subs.length ? 'pointer' : 'default', color: 'var(--text-secondary)', userSelect: 'none' }}>
                      {subs.length ? (isOpen ? '▾' : '▸') : ''}
                    </span>
                    <div onClick={() => toggleKey(group)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', opacity: gHidden ? 0.35 : 1, flex: 1 }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: groupColor(group, ''), flexShrink: 0 }} />
                      <span style={{ textDecoration: gHidden ? 'line-through' : 'none' }}>{group}</span>
                      <span className="text-secondary" style={{ fontSize: '0.65rem' }}>({count.toLocaleString()})</span>
                    </div>
                  </div>
                  {isOpen && subs.map(sg => {
                    const key = subKey(group, sg.name);
                    const sHidden = hiddenGroups.has(key) || gHidden;
                    return (
                      <div key={key} onClick={() => toggleKey(key)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', opacity: sHidden ? 0.35 : 1, fontSize: '0.75rem', paddingLeft: '1.5rem', marginTop: '2px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: groupColor(group, sg.name), flexShrink: 0 }} />
                        <span style={{ textDecoration: hiddenGroups.has(key) ? 'line-through' : 'none' }}>{sg.name}</span>
                        <span className="text-secondary" style={{ fontSize: '0.6rem' }}>({sg.count.toLocaleString()})</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
