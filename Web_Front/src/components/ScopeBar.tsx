import { useMemo } from 'react';
import { type Taxonomy, taxonomyKeys, prodRoleOf, isProdRole, scopeSubgroups, scopeChipColor, scopeSubColor } from '../groupColors';
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

  // Two families of top-level chip, side by side: the music-production ROLES
  // (Percussion, Keyed, Loop…) and the UCS CATEGORIES (Musical, Doors, Water…). Their
  // names never collide, so a chip's name alone says which axis it scopes. Roles come
  // first — this is a sample library, and the role is what a producer reaches for.
  const prodRoles = useMemo(() => {
    const s = new Set<string>();
    for (const it of analysisResult) s.add(prodRoleOf(it));
    return Array.from(s).filter(Boolean).sort();
  }, [analysisResult]);

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
        {prodRoles.map(g => filterBtn(g, group === g, () => { setGroup(g); setSub(null); }, scopeChipColor(g)))}
        {prodRoles.length > 0 && ucsCats.length > 0 && (
          <span style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border-color)', margin: '0 0.25rem' }} />
        )}
        {ucsCats.map(g => filterBtn(g, group === g, () => { setGroup(g); setSub(null); }, scopeChipColor(g)))}
      </div>
      {group && subgroups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>{group} {isProdRole(group) ? 'instruments' : 'subgroups'}:</span>
          {filterBtn('All', !sub, () => setSub(null))}
          {subgroups.map(sg => filterBtn(sg, sub === sg, () => setSub(sg), scopeSubColor(group, sg)))}
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
