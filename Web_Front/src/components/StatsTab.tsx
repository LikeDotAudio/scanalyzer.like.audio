import { useState, useMemo, useRef, useEffect } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, PieChart, Pie, Legend, BarChart, Bar, Tooltip } from 'recharts'
import { ucsColor, ucsSubColor, taxonomyKeys } from '../groupColors'
import { resolveAudioSrc, isTauri } from '../audioLinking'
import ScopeBar from './ScopeBar'

interface StatsTabProps {
  analysisResult: any[];
  audioFiles: File[];
  onSound?: (name: string) => void;
}

// Numeric features selectable on the configurable scatter charts.
const NUM_FEATURES: Record<string, string> = {
  Pitch: 'musicality.pitch_hz',
  Brightness: 'spectral_features.spectral_centroid_hz',
  Length: 'metadata.length_seconds',
  Complexity: 'spectral_features.complexity',
  Harmonicity: 'spectral_features.harmonicity',
  Attack: 'envelope.attack_seconds',
  Sustain: 'envelope.envelope_sustain_level',
  BPM: 'musicality.beats_per_minute',
  Transients: 'envelope.transient_count',
};
const NUM_LABELS = Object.keys(NUM_FEATURES);

const selStyle: React.CSSProperties = {
  background: '#fff', color: '#000', border: '1px solid var(--border-color)',
  borderRadius: 0, padding: '0.15rem 0.3rem', fontSize: '0.75rem',
};

// Recharts scatter with a Cell per point is slow; above this it's gated behind
// a group pick / explicit "plot all", and above SAMPLE_MAX it's downsampled.
const SCATTER_LIMIT = 3000;
const SAMPLE_MAX = 5000;

export default function StatsTab({ analysisResult, audioFiles, onSound }: StatsTabProps) {
  const [group, setGroup] = useState<string | null>(null);      // null = All
  const [sub, setSub] = useState<string | null>(null);
  const [x1, setX1] = useState('Pitch');
  const [y1, setY1] = useState('Brightness');
  const [x2, setX2] = useState('Attack');
  const [y2, setY2] = useState('Sustain');
  const [nowPlaying, setNowPlaying] = useState<string>('');
  const [plotAll, setPlotAll] = useState(false);
  const [filterText, setFilterText] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);


  useEffect(() => {
    setGroup(null);
    setSub(null);
    setFilterText('');
  }, [analysisResult]);



  // The filtered dataset all charts are relative to.
  const data = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return analysisResult.filter(it => {
      // The ScopeBar scopes by UCS category -> subcategory; match what it renders.
      const [role, g] = taxonomyKeys(it, 'UCS');
      if (group && role !== group) return false;
      if (sub && g !== sub) return false;
      if (q && !`${it.metadata?.name || ''} ${it.classification?.group || ''} ${it.classification?.subgroup || ''} ${it.classification?.timbre || ''} ${it.musicality?.root_note_name || ''} ${it.classification?.reason?.[0] || ''}`
        .toLowerCase().includes(q)) return false;
      return true;
    });
  }, [analysisResult, group, sub, filterText]);

  // UCS category counts — the coarse level, shown in the donut and, unscoped, the bar.
  const categoryData = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of data) { const k = it.ucs?.category || '(unclassified)'; c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [data]);

  // Scatter points coloured the same way as the cloud: UCS category hue, subcategory shade.
  const pointColor = (it: any) =>
    ucsSubColor(it.ucs?.category || '', (it.ucs?.subcategory || '').trim());

  // Downsample the scatter to keep it responsive on huge scopes.
  const plotData = useMemo(() => {
    if (data.length <= SAMPLE_MAX) return data;
    const step = Math.ceil(data.length / SAMPLE_MAX);
    return data.filter((_, i) => i % step === 0);
  }, [data]);
  const sampled = data.length > SAMPLE_MAX;

  // UCS subcategories within the scoped category — the fine level, shown in the bar
  // once a category chip is picked. `data` is already filtered to that category.
  const subgroupData = useMemo(() => {
    const c: Record<string, { value: number; cat: string; sub: string }> = {};
    for (const it of data) {
      const sub = (it.ucs?.subcategory || '').trim();
      if (!sub) continue;
      const cat = it.ucs?.category || '(unclassified)';
      if (!c[sub]) c[sub] = { value: 0, cat, sub };
      c[sub].value++;
    }
    return Object.entries(c).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value).slice(0, 24);
  }, [data]);

  const playItem = (item: any) => {
    if (!item) return;
    onSound?.(item.metadata.name || '');
    const src = resolveAudioSrc(audioFiles, item);
    if (src && audioRef.current) {
      document.querySelectorAll('audio').forEach(a => a.pause());
      audioRef.current.currentTime = 0;
      audioRef.current.src = src;
      audioRef.current.play().catch(() => {});
      setNowPlaying(item.metadata.name);
    } else {
      setNowPlaying((isTauri() || audioFiles.length) ? `No audio file for "${item.metadata.name}"` : 'No audio linked');
    }
  };

  if (analysisResult.length === 0) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-secondary)' }}>No data to graph. Scan a folder or load a .PEAK file.</div>;
  }

  // Gate the (expensive) scatter behind a group pick when the scope is huge.
  const gated = !group && !plotAll && data.length > SCATTER_LIMIT;

  const ScatterTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const it = payload[0].payload;
      return (
        <div style={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid var(--border-color)', padding: '0.5rem', color: '#fff', fontSize: '0.8rem', maxWidth: '300px' }}>
          <div style={{ fontWeight: 'bold', color: 'var(--accent-primary)', marginBottom: '0.2rem', wordBreak: 'break-all' }}>{it.metadata?.name}</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>Group:</strong> {it.classification?.group || 'Unclassified'} {it.classification?.subgroup ? `/ ${it.classification?.subgroup}` : ''}</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>Instrument:</strong> {it.classification?.timbre || 'Unknown'}</div>
          <div><strong style={{ color: 'var(--text-secondary)' }}>Length:</strong> {it.metadata?.length_seconds?.toFixed(2)}s</div>
          <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.75rem' }}>
            {payload.map((p: any) => (
              <div key={p.name}><strong style={{ color: 'var(--text-secondary)' }}>{p.name}:</strong> {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const chartCard = (title: string, xLabel: string, setX: (v: string) => void, yLabel: string, setY: (v: string) => void) => {
    const xk = NUM_FEATURES[xLabel], yk = NUM_FEATURES[yLabel];
    return (
      <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 600 }}>{title}</span>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>X <select style={selStyle} value={xLabel} onChange={e => setX(e.target.value)}>{NUM_LABELS.map(o => <option key={o}>{o}</option>)}</select></label>
          <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Y <select style={selStyle} value={yLabel} onChange={e => setY(e.target.value)}>{NUM_LABELS.map(o => <option key={o}>{o}</option>)}</select></label>
          {!gated && sampled && <span className="text-secondary" style={{ fontSize: '0.68rem' }}>({plotData.length.toLocaleString()} of {data.length.toLocaleString()} shown)</span>}
        </div>
        {gated ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>
            <div><strong style={{ color: 'var(--text-primary)' }}>{data.length.toLocaleString()}</strong> samples in scope</div>
            <div style={{ fontSize: '0.8rem' }}>Pick a group above to explore — or plot everything (may be slow).</div>
            <button className="btn primary" style={{ padding: '0.3rem 0.9rem' }} onClick={() => setPlotAll(true)}>Plot all {data.length.toLocaleString()}</button>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 5, right: 15, bottom: 15, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis type="number" dataKey={xk} name={xLabel} stroke="var(--text-secondary)" fontSize={11} />
              <YAxis type="number" dataKey={yk} name={yLabel} stroke="var(--text-secondary)" fontSize={11} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<ScatterTooltip />} />
              <Scatter data={plotData} onClick={(pt: any) => playItem(pt?.payload || pt)} onMouseEnter={(pt: any) => playItem(pt?.payload || pt)} cursor="pointer" isAnimationActive={false}>
                {plotData.map((entry, i) => (
                  <Cell key={i} fill={pointColor(entry)} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Filter + player bar */}
      <div style={{ padding: '0.5rem 1rem', background: '#0d1017', borderBottom: '1px solid var(--border-color)' }}>
        <ScopeBar 
          analysisResult={analysisResult} group={group} sub={sub} setGroup={(g) => { setGroup(g); setPlotAll(false); }} setSub={setSub} 
          filterText={filterText} setFilterText={setFilterText}
          rightContent={
            <>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{data.length} samples in scope</span>
              <button className="btn secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', marginLeft: '0.5rem' }} onClick={() => audioRef.current?.play()}>▶</button>
              <span className="text-secondary" style={{ fontSize: '0.72rem', minWidth: '120px' }}>{nowPlaying || 'click a point to play'}</span>
              <audio ref={audioRef} style={{ display: 'none' }} />
            </>
          }
        />
      </div>

      {/* Charts grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '0.5rem', padding: '0.5rem', minHeight: 0 }}>
        {/* God Categories donut */}
        <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3 style={{ marginBottom: '0.25rem', color: 'var(--accent-primary)', fontSize: '0.85rem' }}>UCS Categories</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={categoryData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value" nameKey="name">
                {categoryData.map((e, i) => <Cell key={i} fill={ucsColor(e.name)} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid var(--border-color)' }} />
              <Legend wrapperStyle={{ fontSize: '0.7rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Identified Groups / Subgroups bar */}
        <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3 style={{ marginBottom: '0.25rem', color: 'var(--accent-secondary)', fontSize: '0.85rem' }}>
            {group ? `Subcategories in ${group}` : 'UCS Categories'}
          </h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={group ? subgroupData : categoryData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
              <XAxis type="number" stroke="var(--text-secondary)" fontSize={11} />
              <YAxis type="category" dataKey="name" stroke="var(--text-secondary)" width={group ? 130 : 90} fontSize={11} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid var(--border-color)' }} />
              <Bar dataKey="value">
                {(group ? subgroupData : categoryData).map((e: any, i) => (
                  <Cell key={i} fill={group ? ucsSubColor(e.cat, e.sub) : ucsColor(e.name)} />
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
