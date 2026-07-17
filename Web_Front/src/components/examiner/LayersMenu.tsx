// The 🎚 Layers dropdown: SHOW/HIDE per layer, per-layer overlay⇄row placement,
// and the stacked/rows mode switch. Same pattern as the Examiner's ⚙ Columns
// menu; persisted by the caller via saveLayerSettings.

import { useEffect, useRef, useState } from 'react';
import { EXAMINER_LAYERS, MENU_SWATCHES } from './layers/registry';
import type { LayerSettings, StackMode } from './layers/types';

interface LayersMenuProps {
  settings: LayerSettings;
  onChange: (next: LayerSettings) => void;
  stereo: boolean;
}

export default function LayersMenu({ settings, onChange, stereo }: LayersMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const setMode = (mode: StackMode) => onChange({ ...settings, mode });
  const toggleVisible = (id: string) => {
    const cur = settings.layers[id];
    onChange({ ...settings, layers: { ...settings.layers, [id]: { ...cur, visible: !cur.visible } } });
  };
  const togglePlacement = (id: string) => {
    const cur = settings.layers[id];
    onChange({
      ...settings,
      layers: { ...settings.layers, [id]: { ...cur, placement: cur.placement === 'row' ? 'overlay' : 'row' } },
    });
  };

  const modeBtn = (mode: StackMode): React.CSSProperties => ({
    flex: 1, padding: '0.25rem 0.4rem', fontSize: '0.7rem', fontWeight: 600,
    cursor: 'pointer', border: 'none', borderRadius: 0,
    background: settings.mode === mode ? 'rgb(244,144,44)' : 'transparent',
    color: settings.mode === mode ? '#14100a' : 'var(--text-secondary)',
  });

  return (
    <div ref={rootRef} style={{ position: 'absolute', top: 6, left: 6, zIndex: 20 }}>
      <button className="btn secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', opacity: 0.9 }}
        onClick={() => setOpen(!open)} title="Show / hide overlay layers">
        🎚 Layers
      </button>
      {open && (
        <div className="glass-panel" style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '0.4rem', zIndex: 50,
          padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem',
          width: '215px', background: 'rgba(10,12,16,0.92)',
        }}>
          <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: 5, overflow: 'hidden', marginBottom: '0.3rem' }}>
            <button style={modeBtn('stack')} onClick={() => setMode('stack')}>Stacked</button>
            <button style={modeBtn('rows')} onClick={() => setMode('rows')}>Rows</button>
          </div>
          {EXAMINER_LAYERS.map(l => {
            const s = settings.layers[l.id];
            const disabled = l.needsStereo && !stereo;
            return (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', opacity: disabled ? 0.4 : 1 }}>
                <input type="checkbox" id={`layer-${l.id}`} checked={s?.visible ?? false}
                  disabled={disabled} onChange={() => toggleVisible(l.id)} style={{ accentColor: 'rgb(244,144,44)' }} />
                <span style={{ width: 13, height: 4, borderRadius: 2, flex: 'none', background: MENU_SWATCHES[l.id] || '#888' }} />
                <label htmlFor={`layer-${l.id}`} style={{ flex: 1, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                  {l.label}{disabled ? ' (stereo)' : ''}
                </label>
                {settings.mode === 'stack' && (
                  <button onClick={() => togglePlacement(l.id)} disabled={disabled}
                    title="Toggle overlay / own row placement"
                    style={{
                      fontSize: '0.6rem', fontWeight: 600, padding: '0.1rem 0.3rem', cursor: 'pointer',
                      background: 'transparent', borderRadius: 4,
                      border: `1px solid ${s?.placement === 'row' ? 'rgb(244,144,44)' : 'var(--border-color)'}`,
                      color: s?.placement === 'row' ? 'rgb(244,144,44)' : 'var(--text-secondary)',
                    }}>
                    {s?.placement === 'row' ? 'row' : 'ovl'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
