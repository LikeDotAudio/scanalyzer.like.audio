import { AXIS_OPTIONS, SIZE_OPTIONS, COLOR_OPTIONS } from '../SampleCloud';

const PRESETS: [string, string, string, string, string][] = [
  ['A', 'Pitch', 'Group', 'Complexity', 'Length'],
  ['B', 'Pitch', 'Group', 'Brightness (centroid)', 'Length'],
  ['C', 'Attack', 'Sustain', 'Harmonicity', 'RMS'],
  ['D', 'Brightness (centroid)', 'Harmonicity', 'Complexity', 'Length'],
  ['E', 'Pitch', 'Harmonicity', 'Sustain', 'RMS'],
  ['F', 'Length', 'Group', 'Attack', 'RMS'],
];

const selStyle: React.CSSProperties = {
  background: '#fff', color: '#000',
  border: '1px solid var(--border-color)', borderRadius: 0,
  padding: '0.25rem 0.4rem', fontSize: '0.8rem',
};

interface GraphOptionsMenuProps {
  xAxis: string; setXAxis: (v: string) => void;
  yAxis: string; setYAxis: (v: string) => void;
  zAxis: string; setZAxis: (v: string) => void;
  sizeAxis: string; setSizeAxis: (v: string) => void;
  colorBy: string; setColorBy: (v: string) => void;
  showAxes: boolean; setShowAxes: (v: boolean) => void;
  audioFilesLength: number;
}

export default function GraphOptionsMenu({
  xAxis, setXAxis, yAxis, setYAxis, zAxis, setZAxis, sizeAxis, setSizeAxis, colorBy, setColorBy,
  showAxes, setShowAxes, audioFilesLength
}: GraphOptionsMenuProps) {
  const applyPreset = (x: string, y: string, z: string, size: string) => {
    setXAxis(x); setYAxis(y); setZAxis(z); setSizeAxis(size);
  };
  return (
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
        {audioFilesLength > 0
          ? <div className="text-secondary" style={{ fontSize: '0.75rem', textAlign: 'center' }}>{audioFilesLength === 1 ? 'Native Audio linked' : audioFilesLength.toLocaleString() + ' audio linked'}</div>
          : <div className="text-secondary" style={{ fontSize: '0.75rem', textAlign: 'center', color: 'var(--accent-secondary)' }}>⚠ 0 audio linked — re-scan the folder to hear samples</div>}
      </div>
    </div>
  );
}
