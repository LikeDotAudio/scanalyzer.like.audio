import { useState, useMemo, useRef, useEffect } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, PieChart, Pie, Legend, BarChart, Bar, Tooltip } from 'recharts'
import { ucsColor, ucsSubColor } from '../../groupColors'
import { useIsNarrow } from '../../useIsNarrow'
import { categoryLabel, subcategoryLabel } from '../../categoryEmoji'

interface StatsTabProps {
  analysisResult: any[];
  filteredData: any[];
  audioFiles: File[];
  onSound?: (name: string) => void;
  selectedItem?: any;
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
  Cluster: 'unsupervised.cluster',
  'Crest Factor': 'spectral_features.crest_factor',
  Flatness: 'spectral_features.spectral_flatness',
  RMS: 'spectral_features.root_mean_square_level',
  ZCR: 'spectral_features.zero_crossings_per_second',
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

const PulsingDot = (props: any) => {
  const { cx, cy } = props;
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill="var(--accent-primary)" />
      <circle cx={cx} cy={cy} r={6} stroke="var(--accent-primary)" strokeWidth={2} fill="none">
        <animate attributeName="r" values="6; 24" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1; 0" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </g>
  );
};

export default function StatsTab({ filteredData, onSound, selectedItem }: StatsTabProps) {
  const [x1, setX1] = useState('Pitch');
  const [y1, setY1] = useState('Brightness');
  const [x2, setX2] = useState('Attack');
  const [y2, setY2] = useState('Sustain');
  const nowPlaying = selectedItem?.metadata?.name || '';
  const [plotAll, setPlotAll] = useState(false);
  const isNarrow = useIsNarrow();
  const decodeCtxRef = useRef<AudioContext | null>(null);
  const ignoreHoverRef = useRef(false);

  useEffect(() => {
    const onMove = () => { ignoreHoverRef.current = false; };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      decodeCtxRef.current?.close();
    };
  }, []);

  // The filtered dataset all charts are relative to.
  const data = filteredData;

  const currentCategory = useMemo(() => {
    if (data.length === 0) return null;
    const cats = new Set(data.map((it: any) => it.ucs?.category || '(unclassified)'));
    return cats.size === 1 ? Array.from(cats)[0] : null;
  }, [data]);

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

  const playItem = async (item: any) => {
    if (!item) return;
    onSound?.(item.metadata.name || '');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (!keys.includes(e.key)) return;
      if (plotData.length === 0) return;

      e.preventDefault();

      let current = plotData.find((d: any) => d.metadata?.name === nowPlaying);
      if (!current) {
        playItem(plotData[0]);
        return;
      }

      const getX = (it: any) => {
        const path = NUM_FEATURES[x1];
        return Number(path.split('.').reduce((o: any, k: string) => (o || {})[k], it)) || 0;
      };
      const getY = (it: any) => {
        const path = NUM_FEATURES[y1];
        return Number(path.split('.').reduce((o: any, k: string) => (o || {})[k], it)) || 0;
      };

      const cx = getX(current);
      const cy = getY(current);

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of plotData) {
        const px = getX(pt), py = getY(pt);
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;

      let bestDist = Infinity;
      let bestPoint = null;

      for (const pt of plotData) {
        if (pt === current) continue;
        const dx = (getX(pt) - cx) / rangeX;
        const dy = (getY(pt) - cy) / rangeY;
        
        let valid = false;
        let dist = 0;
        if (e.key === 'ArrowRight' && dx > 0) { valid = true; dist = dx * dx + 4 * dy * dy; }
        else if (e.key === 'ArrowLeft' && dx < 0) { valid = true; dist = dx * dx + 4 * dy * dy; }
        else if (e.key === 'ArrowUp' && dy > 0) { valid = true; dist = 4 * dx * dx + dy * dy; }
        else if (e.key === 'ArrowDown' && dy < 0) { valid = true; dist = 4 * dx * dx + dy * dy; }
        
        if (valid && dist < bestDist) {
          bestDist = dist;
          bestPoint = pt;
        }
      }
      ignoreHoverRef.current = true;
      if (bestPoint) playItem(bestPoint);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nowPlaying, plotData, x1, y1]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gate the (expensive) scatter behind a group pick when the scope is huge.
  const gated = !currentCategory && !plotAll && data.length > SCATTER_LIMIT;

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

  const selectedPointData = useMemo(() => {
    return nowPlaying ? plotData.filter((d: any) => d.metadata?.name === nowPlaying) : [];
  }, [nowPlaying, plotData]);

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
              <Scatter data={plotData} onClick={(pt: any) => playItem(pt?.payload || pt)} onMouseEnter={(pt: any) => { if (!ignoreHoverRef.current) playItem(pt?.payload || pt); }} cursor="pointer" isAnimationActive={false}>
                {plotData.map((entry, i) => (
                  <Cell key={i} fill={pointColor(entry)} />
                ))}
              </Scatter>
              {selectedPointData.length > 0 && (
                <Scatter data={selectedPointData} shape={<PulsingDot />} isAnimationActive={false} />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border-color)', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Library Stats</h2>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, display: 'grid', minHeight: 0, position: 'relative',
        ...(isNarrow
          ? { gridTemplateColumns: '1fr', gridAutoRows: '260px', overflowY: 'auto' }
          : { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }),
        gap: '0.5rem', padding: '0.5rem' }}>
        <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3 style={{ marginBottom: '0.25rem', color: 'var(--accent-primary)', fontSize: '0.85rem' }}>UCS Categories</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={categoryData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value" nameKey="name">
                {categoryData.map((e, i) => <Cell key={i} fill={ucsColor(e.name)} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid var(--border-color)' }} formatter={(v, n) => [v, categoryLabel(String(n))]} />
              <Legend wrapperStyle={{ fontSize: '0.7rem' }} formatter={(v) => categoryLabel(String(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-panel" style={{ padding: '0.5rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3 style={{ marginBottom: '0.25rem', color: 'var(--accent-secondary)', fontSize: '0.85rem' }}>
            {currentCategory ? `Subcategories in ${currentCategory}` : 'UCS Categories'}
          </h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={currentCategory ? subgroupData : categoryData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
              <XAxis type="number" stroke="var(--text-secondary)" fontSize={11} />
              <YAxis type="category" dataKey="name" stroke="var(--text-secondary)" width={currentCategory ? 150 : 110} fontSize={11}
                tickFormatter={currentCategory ? (v) => subcategoryLabel(currentCategory, String(v)) : (v) => categoryLabel(String(v))} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.85)', border: '1px solid var(--border-color)' }}
                labelFormatter={(label) => currentCategory ? subcategoryLabel(currentCategory, String(label)) : categoryLabel(String(label))} />
              <Bar dataKey="value">
                {(currentCategory ? subgroupData : categoryData).map((e: any, i) => (
                  <Cell key={i} fill={currentCategory ? ucsSubColor(e.cat, e.sub) : ucsColor(e.name)} />
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
