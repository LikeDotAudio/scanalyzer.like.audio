import { Suspense, useState, useRef, useMemo } from 'react';
import SampleCloud, { AXIS_OPTIONS, SIZE_OPTIONS, COLOR_OPTIONS } from '../SampleCloud';
import { groupColor, subKey } from '../groupColors';
import { findAudioFile } from '../audioLinking';

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

export default function CloudTab({ analysisResult, audioFiles, onSound, onLoadSounds }: CloudTabProps) {
  const [xAxis, setXAxis] = useState('Pitch');
  const [yAxis, setYAxis] = useState('Group');
  const [zAxis, setZAxis] = useState('Complexity');
  const [sizeAxis, setSizeAxis] = useState('Length');
  const [colorBy, setColorBy] = useState('Group');
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
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
    const item = analysisResult[index];
    if (!item) return;
    onSound?.(item.name || '');
    if (audioFiles.length === 0) { setPlayMsg('No audio linked — click "Load Sounds" in the header.'); return; }
    const file = findAudioFile(audioFiles, item);
    if (file && audioRef.current) {
      audioRef.current.src = URL.createObjectURL(file);
      audioRef.current.play().catch(() => {});
      setPlayMsg('');
    } else {
      setPlayMsg(`No matching audio file found for "${item.name}".`);
    }
  };

  const replay = () => { audioRef.current?.play().catch(() => {}); };

  const selected = selectedIndex != null ? analysisResult[selectedIndex] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: '100%' }}>
      {/* Top toolbar: X / Y / Z / Size / Color + presets + link audio */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '0.5rem 1rem', background: '#111318', borderBottom: '1px solid var(--border-color)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>X:
          <select style={selStyle} value={xAxis} onChange={e => setXAxis(e.target.value)}>{AXIS_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Y:
          <select style={selStyle} value={yAxis} onChange={e => setYAxis(e.target.value)}>{AXIS_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Z:
          <select style={selStyle} value={zAxis} onChange={e => setZAxis(e.target.value)}>{AXIS_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Size:
          <select style={selStyle} value={sizeAxis} onChange={e => setSizeAxis(e.target.value)}>{SIZE_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Color:
          <select style={selStyle} value={colorBy} onChange={e => setColorBy(e.target.value)}>{COLOR_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Presets:
          {PRESETS.map(([label, x, y, z, s]) => (
            <button key={label} className="btn secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
              onClick={() => applyPreset(x, y, z, s)}>{label}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {audioFiles.length > 0
          ? <span className="text-secondary" style={{ fontSize: '0.75rem' }}>{audioFiles.length.toLocaleString()} audio linked</span>
          : <button className="btn primary blink" style={{ padding: '0.15rem 0.6rem', fontSize: '0.75rem' }} onClick={() => onLoadSounds?.()}>⚠ 0 audio linked — Load the scanned folder</button>}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar: nested group / subgroup legend (click to show/hide) */}
        <aside className="sidebar glass-panel" style={{ width: '210px', margin: 0, borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.15rem', overflowY: 'auto' }}>
          <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', fontSize: '0.9rem' }}>Groups / subgroups</h3>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
              onClick={() => setHiddenGroups(new Set())}>Show all</button>
            <button className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
              onClick={() => setHiddenGroups(new Set(groupTree.map(g => g.group)))}>Show none</button>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
              onClick={() => setExpanded(new Set(groupTree.filter(g => g.subs.length).map(g => g.group)))}>Expand all</button>
            <button className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
              onClick={() => setExpanded(new Set())}>Collapse</button>
          </div>
          <div className="text-secondary" style={{ fontSize: '0.7rem' }}>click to hide / show</div>
          {groupTree.map(({ group, count, subs }) => {
            const gHidden = hiddenGroups.has(group);
            const isOpen = expanded.has(group);
            return (
              <div key={group}>
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
                    <div key={key} onClick={() => toggleKey(key)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', opacity: sHidden ? 0.35 : 1, fontSize: '0.75rem', paddingLeft: '1.5rem' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: groupColor(group, sg.name), flexShrink: 0 }} />
                      <span style={{ textDecoration: hiddenGroups.has(key) ? 'line-through' : 'none' }}>{sg.name}</span>
                      <span className="text-secondary" style={{ fontSize: '0.6rem' }}>({sg.count.toLocaleString()})</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </aside>

        {/* 3D WebGL Canvas Area */}
        <section className="main-view glass-panel" style={{ margin: 0, padding: 0, overflow: 'hidden', flex: 1, position: 'relative' }}>
          <Suspense fallback={<div style={{ color: 'white', padding: '2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Initializing 3D Engine...</div>}>
            <SampleCloud
              data={analysisResult} xAxis={xAxis} yAxis={yAxis} zAxis={zAxis}
              sizeAxis={sizeAxis} colorBy={colorBy} hiddenGroups={hiddenGroups}
              selectedIndex={selectedIndex} onPick={handlePick}
            />
          </Suspense>
          <audio ref={audioRef} style={{ display: 'none' }} />

          {/* Selected sample readout */}
          {selected && (
            <div style={{ position: 'absolute', top: '1rem', left: '1rem', zIndex: 10, background: 'rgba(0,0,0,0.65)', padding: '0.6rem 0.9rem', border: '1px solid rgba(255,255,255,0.1)', maxWidth: '340px' }}>
              <div style={{ color: '#FCD34D', fontSize: '0.85rem', marginBottom: '0.2rem' }}>{selected.name}</div>
              <div className="text-secondary" style={{ fontSize: '0.75rem' }}>{selected.group}{selected.subgroup ? ` / ${selected.subgroup}` : ''} · {selected.timbre} · {selected.length_seconds?.toFixed(2)}s</div>
              <button className="btn secondary" style={{ marginTop: '0.4rem', padding: '0.15rem 0.6rem', fontSize: '0.75rem' }} onClick={replay}>▶ Play</button>
              {playMsg && <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: '#f59e0b' }}>{playMsg}</div>}
            </div>
          )}

          <div style={{ position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 10 }}>
             <p className="text-secondary" style={{ background: 'rgba(0,0,0,0.6)', padding: '0.6rem 1rem', border: '1px solid rgba(255,255,255,0.1)' }}>
               🖱️ Click a dot to hear it • Drag: orbit • Scroll: zoom
             </p>
          </div>
        </section>
      </div>
    </div>
  );
}
