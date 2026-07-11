import { Suspense, useState, useRef, useMemo } from 'react';
import SampleCloud, { AXIS_OPTIONS, SIZE_OPTIONS, COLOR_OPTIONS } from '../SampleCloud';
import { groupColor } from '../groupColors';

interface CloudTabProps {
  analysisResult: any[];
  audioFiles: File[];
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
  background: 'rgba(255,255,255,0.06)', color: 'white',
  border: '1px solid var(--border-color)', borderRadius: '4px',
  padding: '0.25rem 0.4rem', fontSize: '0.8rem',
};

export default function CloudTab({ analysisResult, audioFiles }: CloudTabProps) {
  const [xAxis, setXAxis] = useState('Pitch');
  const [yAxis, setYAxis] = useState('Group');
  const [zAxis, setZAxis] = useState('Complexity');
  const [sizeAxis, setSizeAxis] = useState('Length');
  const [colorBy, setColorBy] = useState('Group');
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Distinct groups present in the data, for the legend.
  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const it of analysisResult) s.add(it.group || 'Unclassified');
    return Array.from(s).sort();
  }, [analysisResult]);

  const toggleGroup = (g: string) => {
    setHiddenGroups(prev => {
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
    const file = audioFiles.find(f => f.name === item.name || (f.webkitRelativePath && item.path && f.webkitRelativePath.endsWith(item.path)));
    if (file && audioRef.current) {
      audioRef.current.src = URL.createObjectURL(file);
      audioRef.current.play().catch(() => {});
    }
  };

  const selected = selectedIndex != null ? analysisResult[selectedIndex] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: '100%' }}>
      {/* Top toolbar: X / Y / Z / Size / Color + presets */}
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
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar: group legend (click to show/hide) */}
        <aside className="sidebar glass-panel" style={{ width: '200px', margin: 0, borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.4rem', overflowY: 'auto' }}>
          <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', fontSize: '0.9rem' }}>Name group</h3>
          <div className="text-secondary" style={{ fontSize: '0.7rem' }}>click a group to hide / show it</div>
          {groups.map(g => {
            const hidden = hiddenGroups.has(g);
            return (
              <div key={g} onClick={() => toggleGroup(g)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', opacity: hidden ? 0.35 : 1, fontSize: '0.8rem' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: groupColor(g, ''), flexShrink: 0 }} />
                <span style={{ textDecoration: hidden ? 'line-through' : 'none' }}>{g}</span>
              </div>
            );
          })}
        </aside>

        {/* 3D WebGL Canvas Area */}
        <section className="main-view glass-panel" style={{ margin: '1rem 1rem 1rem 0', padding: 0, overflow: 'hidden', flex: 1, position: 'relative' }}>
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
            <div style={{ position: 'absolute', top: '1rem', left: '1rem', zIndex: 10, background: 'rgba(0,0,0,0.65)', padding: '0.6rem 0.9rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', maxWidth: '340px' }}>
              <div style={{ color: '#FCD34D', fontSize: '0.85rem', marginBottom: '0.2rem' }}>{selected.name}</div>
              <div className="text-secondary" style={{ fontSize: '0.75rem' }}>{selected.group} · {selected.timbre} · {selected.length_seconds?.toFixed(2)}s</div>
              <button className="btn secondary" style={{ marginTop: '0.4rem', padding: '0.15rem 0.6rem', fontSize: '0.75rem' }} onClick={() => audioRef.current?.play()}>▶ Play</button>
            </div>
          )}

          <div style={{ position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 10 }}>
             <p className="text-secondary" style={{ background: 'rgba(0,0,0,0.6)', padding: '0.75rem 1.25rem', borderRadius: '8px', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)' }}>
               🖱️ Click a dot to hear it • Drag: orbit • Scroll: zoom
             </p>
          </div>
        </section>
      </div>
    </div>
  );
}
