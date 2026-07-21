import { SHAPE_OPTIONS } from '../SampleCloud';

const selStyle: React.CSSProperties = {
  background: '#fff', color: '#000',
  border: '1px solid var(--border-color)', borderRadius: 0,
  padding: '0.25rem 0.4rem', fontSize: '0.8rem',
};

interface ShapesMenuProps {
  shapeBy: string;
  setShapeBy: (v: string) => void;
}

export default function ShapesMenu({ shapeBy, setShapeBy }: ShapesMenuProps) {
  return (
    <div className="glass-panel" style={{ position: 'absolute', top: '3.5rem', right: '1rem', zIndex: 20, background: 'rgba(17, 19, 24, 0.95)', padding: '1rem', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '280px', maxHeight: 'calc(100% - 5rem)', overflowY: 'auto' }}>
      <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', fontSize: '0.9rem', margin: 0 }}>Shapes</h3>
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Presets:
        <select style={selStyle} value={shapeBy} onChange={e => setShapeBy(e.target.value)}>{SHAPE_OPTIONS.map(o => <option key={o}>{o}</option>)}</select>
      </label>
      <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Mapping:</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          {shapeBy === 'Uniform' && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>All</span> <span style={{ color: 'var(--text-primary)' }}>Sphere</span></div>
          )}
          {shapeBy === 'Music Production' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Percussive</span> <span style={{ color: 'var(--text-primary)' }}>Pyramid</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Impulsive with tail</span> <span style={{ color: 'var(--text-primary)' }}>Diamond</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tonal</span> <span style={{ color: 'var(--text-primary)' }}>Cube</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Complex</span> <span style={{ color: 'var(--text-primary)' }}>Torus</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>(Other)</span> <span style={{ color: 'var(--text-primary)' }}>Sphere</span></div>
            </>
          )}
          {shapeBy === 'Timbre' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Percussive</span> <span style={{ color: 'var(--text-primary)' }}>Pyramid</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Loop</span> <span style={{ color: 'var(--text-primary)' }}>Torus</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Bass</span> <span style={{ color: 'var(--text-primary)' }}>Cylinder</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tonal</span> <span style={{ color: 'var(--text-primary)' }}>Cube</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Noise</span> <span style={{ color: 'var(--text-primary)' }}>Diamond</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Bright</span> <span style={{ color: 'var(--text-primary)' }}>Icosahedron</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Pad</span> <span style={{ color: 'var(--text-primary)' }}>Dodecahedron</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>(Other)</span> <span style={{ color: 'var(--text-primary)' }}>Sphere</span></div>
            </>
          )}
          {shapeBy === 'Instrument' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Kick/Snare/Tom/Clap</span> <span style={{ color: 'var(--text-primary)' }}>Cylinder</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Cymbal/Hi-hat/Crash</span> <span style={{ color: 'var(--text-primary)' }}>Disc</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>IR/Impulsive tail</span> <span style={{ color: 'var(--text-primary)' }}>Diamond</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Perc/Percussive</span> <span style={{ color: 'var(--text-primary)' }}>Pyramid</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Loop/FX/Complex</span> <span style={{ color: 'var(--text-primary)' }}>Torus</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Bass/Synth/Tonal</span> <span style={{ color: 'var(--text-primary)' }}>Cube</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Vocal/Voice</span> <span style={{ color: 'var(--text-primary)' }}>Icosahedron</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>(Other)</span> <span style={{ color: 'var(--text-primary)' }}>Sphere</span></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
