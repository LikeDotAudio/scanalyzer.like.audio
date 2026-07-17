// The 🎚 Layers dropdown, living in the global footer (opens upward). Two
// groups — FREQUENCY (normalled to the top pane) and TIME (normalled to the
// bottom pane) — with three placement columns per layer: top pane / bottom
// pane / own row. Clicking the active column again hides the layer; the
// columns ARE the show/hide control. ▲▼ reorders a layer within its group
// (row order + paint order). A legend checkbox toggles the in-canvas legend.
// Settings flow through the shared store in registry.ts (the Examiner canvas
// subscribes to the same store), persisted to localStorage on every change.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useIsNarrow } from '../../useIsNarrow';
import {
  MENU_SWATCHES, getLayerSettings, layerById, orderedLayers,
  subscribeLayerSettings, updateLayerSettings,
} from './layers/registry';
import type { ExaminerLayer, LayerDomain, LayerPlacement, StackMode } from './layers/types';

interface LayersMenuProps {
  stereo: boolean;
}

const ORANGE = 'rgb(244,144,44)';
const PLACEMENT_COLS: { placement: LayerPlacement; label: string; hint: string }[] = [
  { placement: 'top', label: 'top', hint: 'top (frequency) pane' },
  { placement: 'bottom', label: 'btm', hint: 'bottom (time) pane' },
  { placement: 'row', label: 'row', hint: 'own row' },
];
const CELL_W = 24, ARROWS_W = 30;

export default function LayersMenu({ stereo }: LayersMenuProps) {
  const settings = useSyncExternalStore(subscribeLayerSettings, getLayerSettings);
  const onChange = updateLayerSettings;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Sized like its SampleFooter neighbours: emoji-only and packed on mobile.
  const narrow = useIsNarrow();

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

  // Click a column cell: place the layer there; click the active cell: hide it.
  const setPlacement = (id: string, placement: LayerPlacement) => {
    const cur = settings.layers[id]?.placement ?? 'off';
    const next: LayerPlacement = cur === placement ? 'off' : placement;
    onChange({ ...settings, layers: { ...settings.layers, [id]: { placement: next } } });
  };

  // Move a layer up/down within its domain group, leaving the other group's
  // slots in settings.order untouched.
  const move = (id: string, dir: -1 | 1) => {
    const domain = layerById(id)?.domain;
    const slots = settings.order
      .map((v, i) => ({ v, i }))
      .filter(s => layerById(s.v)?.domain === domain);
    const pos = slots.findIndex(s => s.v === id);
    const other = pos + dir;
    if (pos < 0 || other < 0 || other >= slots.length) return;
    const order = [...settings.order];
    order[slots[pos].i] = slots[other].v;
    order[slots[other].i] = slots[pos].v;
    onChange({ ...settings, order });
  };

  const modeBtn = (mode: StackMode): React.CSSProperties => ({
    flex: 1, padding: '0.25rem 0.4rem', fontSize: '0.7rem', fontWeight: 600,
    cursor: 'pointer', border: 'none', borderRadius: 0,
    background: settings.mode === mode ? ORANGE : 'transparent',
    color: settings.mode === mode ? '#14100a' : 'var(--text-secondary)',
  });

  const renderRow = (l: ExaminerLayer, idx: number, count: number) => {
    const placement = settings.layers[l.id]?.placement ?? 'off';
    const disabled = l.needsStereo && !stereo;
    const hidden = placement === 'off';
    return (
      <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', opacity: disabled ? 0.4 : 1 }}>
        <span style={{ width: 13, height: 4, borderRadius: 2, flex: 'none', background: MENU_SWATCHES[l.id] || '#888', opacity: hidden ? 0.45 : 1 }} />
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: hidden ? 'var(--text-secondary)' : 'inherit' }}>
          {l.label}{disabled ? ' (stereo)' : ''}
          {l.isScale && (
            <span style={{ marginLeft: 5, fontSize: '0.55rem', fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 3, padding: '0 3px', verticalAlign: 'middle' }}>
              scale
            </span>
          )}
        </span>
        {PLACEMENT_COLS.map(c => {
          const active = placement === c.placement;
          return (
            <button key={c.placement} disabled={disabled}
              onClick={() => setPlacement(l.id, c.placement)}
              title={active ? `hide ${l.label}` : `${l.label} → ${c.hint}`}
              style={{
                width: CELL_W, height: 16, flex: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer',
                borderRadius: 3, border: `1px solid ${active ? ORANGE : 'var(--border-color)'}`,
                background: active ? ORANGE : 'transparent',
              }} />
          );
        })}
        <span style={{ width: ARROWS_W, flex: 'none', display: 'flex', gap: 2 }}>
          {([[-1, '▲'], [1, '▼']] as const).map(([dir, glyph]) => {
            const end = dir === -1 ? idx === 0 : idx === count - 1;
            return (
              <button key={glyph} disabled={end} onClick={() => move(l.id, dir)} title="reorder"
                style={{
                  width: 14, height: 16, padding: 0, fontSize: '0.5rem', lineHeight: 1, cursor: end ? 'default' : 'pointer',
                  background: 'transparent', border: 'none', color: end ? 'var(--border-color)' : 'var(--text-secondary)',
                }}>
                {glyph}
              </button>
            );
          })}
        </span>
      </div>
    );
  };

  const renderGroup = (domain: LayerDomain, title: string) => {
    const layers = orderedLayers(settings, domain);
    return (
      <>
        <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.09em', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          {title}
        </div>
        {layers.map((l, i) => renderRow(l, i, layers.length))}
      </>
    );
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button className="btn secondary"
        style={narrow ? { padding: '0.25rem 0.45rem', fontSize: '0.9rem' } : { padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
        onClick={() => setOpen(!open)} title="Show / hide / place viewer layers">
        {narrow ? '🎚' : '🎚 Layers'}
      </button>
      {open && (
        <div className="glass-panel" style={{
          position: 'absolute', bottom: '100%', left: 0, marginBottom: '0.4rem', zIndex: 50,
          padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem',
          width: '285px', background: 'rgba(10,12,16,0.92)',
        }}>
          <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: 5, overflow: 'hidden', marginBottom: '0.3rem' }}>
            <button style={modeBtn('stack')} onClick={() => setMode('stack')}>Stacked</button>
            <button style={modeBtn('rows')} onClick={() => setMode('rows')}>Rows</button>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', fontSize: '0.55rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            <span style={{ flex: 1 }} />
            {PLACEMENT_COLS.map(c => (
              <span key={c.placement} style={{ width: CELL_W, flex: 'none', textAlign: 'center' }} title={c.hint}>{c.label}</span>
            ))}
            <span style={{ width: ARROWS_W, flex: 'none' }} />
          </div>
          {renderGroup('frequency', 'FREQUENCY')}
          {renderGroup('time', 'TIME')}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', cursor: 'pointer', marginTop: '0.25rem', paddingTop: '0.35rem', borderTop: '1px solid var(--border-color)' }}>
            <input type="checkbox" checked={settings.legend} style={{ accentColor: ORANGE }}
              onChange={e => onChange({ ...settings, legend: e.target.checked })} />
            legend
          </label>
        </div>
      )}
    </div>
  );
}
