import { useState } from 'react';
import { ucsColor } from '../../groupColors';
import { categoryLabel } from '../../categoryEmoji';

type GroupRow = { kind: 'header'; category: string; count: number } | { kind: 'file'; item: any };

interface FileGroupsProps {
  groupedRows: GroupRow[];
  rowsCount: number;
  multiOnly: boolean;
  setMultiOnly: (b: boolean) => void;
  selectedItem: any;
  onSelect: (item: any) => void;
  // On mobile the panel is full-width, its list is height-capped, and it can fold away
  // so the waveform/slices below it aren't pushed off-screen.
  isNarrow?: boolean;
}

// The left-hand "groups" panel: the file list grouped under UCS category headers.
export default function FileGroups({ groupedRows, rowsCount, multiOnly, setMultiOnly, selectedItem, onSelect, isNarrow }: FileGroupsProps) {
  const [folded, setFolded] = useState(false);
  return (
    <div style={{ ...(isNarrow
        ? { width: '100%', borderBottom: '1px solid var(--border-color)' }
        : { width: 280, flexShrink: 0, borderRight: '1px solid var(--border-color)' }),
      display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {isNarrow && (
          <button className="btn secondary" onClick={() => setFolded(f => !f)}
            style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{folded ? '▸' : '▾'} Files</span>
            <span style={{ opacity: 0.7 }}>{rowsCount.toLocaleString()}</span>
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={multiOnly} onChange={e => setMultiOnly(e.target.checked)} />
          Multiple regions only <span title="Uses the region count stored in each .PEAK — scan a folder with this engine to populate it.">ⓘ</span>
        </label>
        {!isNarrow && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{rowsCount.toLocaleString()} file(s)</div>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: isNarrow && folded ? 'none' : undefined, maxHeight: isNarrow ? '32vh' : undefined }}>
        {groupedRows.map((row, i) => {
          if (row.kind === 'header') {
            return (
              <div key={`h${i}`} style={{ position: 'sticky', top: 0, zIndex: 1, background: '#12151c',
                padding: '0.25rem 0.5rem', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.03em', color: ucsColor(row.category), borderTop: '1px solid var(--border-color)',
                borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.category}>{categoryLabel(row.category)}</span>
                <span style={{ opacity: 0.6, flexShrink: 0 }}>{row.count}</span>
              </div>
            );
          }
          const it = row.item;
          const count = it.regions?.count ?? null;
          const sel = it === selectedItem;
          return (
            <div key={i} onClick={() => onSelect(it)}
              style={{ padding: '0.3rem 0.5rem 0.3rem 1rem', cursor: 'pointer', fontSize: '0.76rem', display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
                background: sel ? 'rgba(59,130,246,0.25)' : (i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent'),
                color: sel ? '#fff' : 'var(--accent-secondary)' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.metadata?.name}>{it.metadata?.name}</span>
              {count != null && <span style={{ color: count > 1 ? '#f59e0b' : 'var(--text-secondary)', flexShrink: 0 }}>{count}▮</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
