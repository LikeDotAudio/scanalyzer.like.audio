import { useMemo } from 'react';
import { type Taxonomy, taxonomyKeys, scopeSubgroups, scopeChipColor, scopeSubColor } from '../groupColors';
import { altCategory } from '../ucsIndex';

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
  /** UCS runner-up ranks (0-2) the caller's filter also matches on. When set, a category
   *  that only ever appears as a runner-up still gets a chip — otherwise the filter could
   *  match rows the user has no way to scope to. */
  altRanks?: Set<number>;
}

export default function ScopeBar({ analysisResult, group, sub, setGroup, setSub, filterText, setFilterText, rightContent, taxonomy = 'UCS', altRanks }: ScopeBarProps) {
  const useAlts = taxonomy === 'UCS' && !!altRanks?.size;
  const ranks = useMemo(() => (useAlts ? Array.from(altRanks!) : []), [useAlts, altRanks]);

  // Top-level scope chips are the UCS categories the library actually contains.
  // (The old music-production ROLE chips were retired when MUSICPROD folded into
  // the exploded instrument categories.)
  const ucsCats = useMemo(() => {
    const s = new Set<string>();
    for (const it of analysisResult) {
      s.add(taxonomyKeys(it, 'UCS')[0]);
      for (const r of ranks) {
        const c = altCategory(it.ucs?.alternatives?.[r] || '');
        if (c) s.add(c);
      }
    }
    return Array.from(s).sort();
  }, [analysisResult, ranks]);

  const subgroups = useMemo(
    () => (group ? scopeSubgroups(analysisResult, group) : []),
    [analysisResult, group]
  );

  // A text filter isolates by name across the whole library, so the scope chips would
  // fight it — grey them out while filtering, and offer an X to clear the filter and hand
  // scoping back.
  const filtering = !!(filterText && filterText.trim());

  const filterBtn = (label: string, active: boolean, onClick: () => void, color?: string, disabled = false) => (
    <button key={label} onClick={onClick} disabled={disabled} className={`btn ${active ? 'primary' : 'secondary'}`}
      style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', borderLeft: color ? `3px solid ${color}` : undefined,
        opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Scope:</span>
        {filterBtn('All', !group, () => { setGroup(null); setSub(null); }, undefined, filtering)}
        {ucsCats.map(g => filterBtn(g, group === g, () => { setGroup(g); setSub(null); }, scopeChipColor(g), filtering))}
      </div>
      {group && subgroups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>{group} subgroups:</span>
          {filterBtn('All', !sub, () => setSub(null), undefined, filtering)}
          {subgroups.map(sg => filterBtn(sg, sub === sg, () => setSub(sg), scopeSubColor(group, sg), filtering))}
        </div>
      )}
      {(setFilterText || rightContent) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.1rem' }}>
          {setFilterText && (
            <div style={{ position: 'relative', flex: 1, maxWidth: '300px', display: 'flex', alignItems: 'center' }}>
              <input type="text" placeholder="Filter by name, group, timbre..." value={filterText || ''} onChange={e => setFilterText(e.target.value)}
                style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: `1px solid ${filtering ? 'var(--accent-primary)' : 'var(--border-color)'}`, color: 'white', padding: '0.3rem 1.6rem 0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', width: '100%' }} />
              {filtering && (
                <button onClick={() => setFilterText('')} title="Clear filter — re-enable scope"
                  style={{ position: 'absolute', right: 4, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: '0 0.3rem' }}>✕</button>
              )}
            </div>
          )}
          <div style={{ flex: 1 }} />
          {rightContent}
        </div>
      )}
    </div>
  );
}
