import { useState, useMemo, useRef } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, PieChart, Pie, Legend, BarChart, Bar, Tooltip } from 'recharts'
import { groupColor, godColor, godCategory } from '../groupColors'
import { findAudioFile, pickDirectoryFiles, fsaSupported, filterAudioFiles } from '../audioLinking'

interface StatsTabProps {
  analysisResult: any[];
  audioFiles: File[];
  setAudioFiles: (files: File[]) => void;
}

// Numeric features selectable on the configurable scatter charts.
const NUM_FEATURES: Record<string, string> = {
  Pitch: 'pitch_hz',
  Brightness: 'spectral_centroid_hz',
  Length: 'length_seconds',
  Complexity: 'complexity',
  Harmonicity: 'harmonicity',
  Attack: 'attack_seconds',
  Sustain: 'envelope_sustain_level',
  BPM: 'beats_per_minute',
  Transients: 'transient_count',
};
const NUM_LABELS = Object.keys(NUM_FEATURES);

const selStyle: React.CSSProperties = {
  background: '#000', color: '#fff', border: '1px solid var(--border-color)',
  borderRadius: 0, padding: '0.15rem 0.3rem', fontSize: '0.75rem',
};

export default function StatsTab({ analysisResult, audioFiles, setAudioFiles }: StatsTabProps) {
  const [group, setGroup] = useState<string | null>(null);      // null = All
  const [sub, setSub] = useState<string | null>(null);
  const [x1, setX1] = useState('Pitch');
  const [y1, setY1] = useState('Brightness');
  const [x2, setX2] = useState('Attack');
  const [y2, setY2] = useState('Sustain');
  const [nowPlaying, setNowPlaying] = useState<string>('');
  const audioRef = useRef<HTMLAudioElement>(null);

  // Groups and (for the active group) subgroups present in the data.
  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const it of analysisResult) s.add(it.group || 'Unclassified');
    return Array.from(s).sort();
  }, [analysisResult]);

  const subgroups = useMemo(() => {
    if (!group) return [];
    const s = new Set<string>();
    for (const it of analysisResult) {
      if ((it.group || 'Unclassified') === group && (it.subgroup || '').trim()) s.add(it.subgroup.trim());
    }
    return Array.from(s).sort();
  }, [analysisResult, group]);

  // The filtered dataset all charts are relative to.
  const data = useMemo(() => analysisResult.filter(it => {
    if (group && (it.group || 'Unclassified') !== group) return false;
    if (sub && (it.subgroup || '').trim() !== sub) return false;
    return true;
  }), [analysisResult, group, sub]);

  const categoryData = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of data) { const k = it.god_category || godCategory(it.group || ''); c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [data]);

  const groupData = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of data) { const k = it.group || 'Unclassified'; c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [data]);

  const subgroupData = useMemo(() => {
    const c: Record<string, { value: number; group: string; sub: string }> = {};
    for (const it of data) {
      const sg = (it.subgroup || '').trim();
      if (!sg) continue;
      const g = it.group || 'Unclassified';
      const label = `${g} / ${sg}`;
      if (!c[label]) c[label] = { value: 0, group: g, sub: sg };
      c[label].value++;
    }
    return Object.entries(c).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value).slice(0, 24);
  }, [data]);

  const linkAudio = async () => {
    try { setAudioFiles(await pickDirectoryFiles()); }
    catch (err) { if ((err as Error)?.name !== 'AbortError') console.warn(err); }
  };

  const playItem = (item: any) => {
    if (!item) return;
    const file = findAudioFile(audioFiles, item);
    if (file && audioRef.current) {
      audioRef.current.src = URL.createObjectURL(file);
      audioRef.current.play().catch(() => {});
      setNowPlaying(item.name);
    } else {
      setNowPlaying(audioFiles.length ? `No audio file for "${item.name}"` : 'No audio linked');
    }
  };

  const filterBtn = (label: string, active: boolean, onClick: () => void, color?: string) => (
    <button key={label} onClick={onClick} className={`btn ${active ? 'primary' : 'secondary'}`}
      style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', borderLeft: color ? `3px solid ${color}` : undefined }}>
      {label}
    </button>
  );

  if (analysisResult.length === 0) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-secondary)' }}>No data to graph. Scan a folder or load a .PEAK file.</div>;
  }

  const chartCard = (title: string, xLabel: string, setX: (v: string) => void, yLabel: string, setY: (v: string) => void) => {
    const xk = NUM_FEATURES[xLabel], yk = NUM_FEATURES[yLabel];
    return (
      <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 600 }}>{title}</span>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>X <select style={selStyle} value={xLabel} onChange={e => setX(e.target.value)}>{NUM_LABELS.map(o => <option key={o}>{o}</option>)}</select></label>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Y <select style={selStyle} value={yLabel} onChange={e => setY(e.target.value)}>{NUM_LABELS.map(o => <option key={o}>{o}</option>)}</select></label>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 15, bottom: 15, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis type="number" dataKey={xk} name={xLabel} stroke="var(--text-secondary)" fontSize={11} />
            <YAxis type="number" dataKey={yk} name={yLabel} stroke="var(--text-secondary)" fontSize={11} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid var(--border-color)' }}
              formatter={(v: any, n: any) => [v, n]} labelFormatter={() => ''} />
            <Scatter data={data} onClick={(pt: any) => playItem(pt?.payload || pt)} cursor="pointer">
              {data.map((entry, i) => (
                <Cell key={i} fill={groupColor(entry.group || 'Unclassified', entry.subgroup || '')} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Filter + player bar */}
      <div style={{ padding: '0.4rem 0.75rem', background: '#111318', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Scope:</span>
          {filterBtn('All', !group, () => { setGroup(null); setSub(null); })}
          {groups.map(g => filterBtn(g, group === g, () => { setGroup(g); setSub(null); }, groupColor(g, '')))}
        </div>
        {group && subgroups.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>{group} subgroups:</span>
            {filterBtn('All', !sub, () => setSub(null))}
            {subgroups.map(sg => filterBtn(sg, sub === sg, () => setSub(sg), groupColor(group, sg)))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{data.length} samples in scope</span>
          <div style={{ flex: 1 }} />
          {(fsaSupported() ? (
            <button className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={linkAudio}>Link Audio</button>
          ) : (
            <label className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer' }}>
              Link Audio
              <input type="file" webkitdirectory="true" directory="true" style={{ display: 'none' }}
                onChange={e => e.target.files && setAudioFiles(filterAudioFiles(Array.from(e.target.files)))} />
            </label>
          ))}
          <button className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => audioRef.current?.play()}>▶</button>
          <span className="text-secondary" style={{ fontSize: '0.72rem', minWidth: '120px' }}>{nowPlaying || 'click a point to play'}</span>
          <audio ref={audioRef} style={{ display: 'none' }} />
        </div>
      </div>

      {/* Charts grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '0.5rem', padding: '0.5rem', minHeight: 0 }}>
        {/* God Categories donut */}
        <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3 style={{ marginBottom: '0.25rem', color: 'var(--accent-primary)', fontSize: '0.85rem' }}>God Categories</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={categoryData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value" nameKey="name">
                {categoryData.map((e, i) => <Cell key={i} fill={godColor(e.name)} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid var(--border-color)' }} />
              <Legend wrapperStyle={{ fontSize: '0.7rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Identified Groups / Subgroups bar */}
        <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3 style={{ marginBottom: '0.25rem', color: 'var(--accent-secondary)', fontSize: '0.85rem' }}>
            {group ? `Subgroups in ${group}` : 'Identified Groups'}
          </h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={group ? subgroupData : groupData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
              <XAxis type="number" stroke="var(--text-secondary)" fontSize={11} />
              <YAxis type="category" dataKey="name" stroke="var(--text-secondary)" width={group ? 130 : 90} fontSize={11} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid var(--border-color)' }} />
              <Bar dataKey="value">
                {(group ? subgroupData : groupData).map((e: any, i) => (
                  <Cell key={i} fill={group ? groupColor(e.group, e.sub) : groupColor(e.name, '')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {chartCard('Scatter A', x1, setX1, y1, setY1)}
        {chartCard('Scatter B', x2, setX2, y2, setY2)}
      </div>
    </div>
  );
}
