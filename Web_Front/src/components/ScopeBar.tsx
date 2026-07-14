import { useMemo } from 'react';
import { groupColor } from '../groupColors';

import { type Taxonomy, ucsColor, ucsSubColor } from '../groupColors';

interface ScopeBarProps {
  analysisResult: any[];
  group: string | null;
  sub: string | null;
  setGroup: (g: string | null) => void;
  setSub: (s: string | null) => void;
  filterText?: string;
  setFilterText?: (f: string) => void;
  rightContent?: React.ReactNode;
  taxonomy?: Taxonomy;
}

export default function ScopeBar({ analysisResult, group, sub, setGroup, setSub, filterText, setFilterText, rightContent, taxonomy = 'Name groups' }: ScopeBarProps) {
  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const it of analysisResult) {
      s.add(taxonomy === 'UCS' ? (it.ucs?.category || '(unclassified)') : (it.classification?.group || 'Unclassified'));
    }
    return Array.from(s).sort();
  }, [analysisResult, taxonomy]);

  const subgroups = useMemo(() => {
    if (!group) return [];
    const s = new Set<string>();
    for (const it of analysisResult) {
      const g = taxonomy === 'UCS' ? (it.ucs?.category || '(unclassified)') : (it.classification?.group || 'Unclassified');
      const sg = taxonomy === 'UCS' ? (it.ucs?.subcategory || '').trim() : (it.classification?.subgroup || '').trim();
      if (g === group && sg) s.add(sg);
    }
    return Array.from(s).sort();
  }, [analysisResult, group, taxonomy]);

  const filterBtn = (label: string, active: boolean, onClick: () => void, color?: string) => (
    <button key={label} onClick={onClick} className={`btn ${active ? 'primary' : 'secondary'}`}
      style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', borderLeft: color ? `3px solid ${color}` : undefined }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Scope:</span>
        {filterBtn('All', !group, () => { setGroup(null); setSub(null); })}
        {groups.map(g => filterBtn(g, group === g, () => { setGroup(g); setSub(null); }, taxonomy === 'UCS' ? ucsColor(g) : groupColor(g, '')))}
      </div>
      {group && subgroups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>{group} subgroups:</span>
          {filterBtn('All', !sub, () => setSub(null))}
          {subgroups.map(sg => filterBtn(sg, sub === sg, () => setSub(sg), taxonomy === 'UCS' ? ucsSubColor(group || '', sg) : groupColor(group || '', sg)))}
        </div>
      )}
      {(setFilterText || rightContent) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.1rem' }}>
          {setFilterText && (
            <input type="text" placeholder="Filter by name, group, timbre..." value={filterText || ''} onChange={e => setFilterText(e.target.value)} style={{ flex: 1, maxWidth: '300px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: 'white', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }} />
          )}
          <div style={{ flex: 1 }} />
          {rightContent}
        </div>
      )}
    </div>
  );
}
