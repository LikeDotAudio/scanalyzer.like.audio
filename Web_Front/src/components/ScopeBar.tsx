import { useMemo } from 'react';
import { type Taxonomy, taxonomyKeys, taxonomyColor } from '../groupColors';
import { altCategory, altSubcategory } from '../ucsIndex';

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
  /** When given, the bar renders its own taxonomy switch. UCS answers "what IS this
   *  sound"; Music production answers "what ROLE does it play". MUSICPROD is deliberately
   *  not one of the 82 UCS categories — build.rs excludes it from the matcher, because its
   *  signatures are copied from MUSICAL and it would give every music sample a twin
   *  candidate — so it can only ever be reached by switching taxonomy, never by scrolling
   *  the UCS chips looking for it. */
  setTaxonomy?: (t: Taxonomy) => void;
  /** UCS runner-up ranks (0-2) the caller's filter also matches on. When set, a category
   *  that only ever appears as a runner-up still gets a chip — otherwise the filter could
   *  match rows the user has no way to scope to. */
  altRanks?: Set<number>;
}

export default function ScopeBar({ analysisResult, group, sub, setGroup, setSub, filterText, setFilterText, rightContent, taxonomy = 'UCS', setTaxonomy, altRanks }: ScopeBarProps) {
  const useAlts = taxonomy === 'UCS' && !!altRanks?.size;
  const ranks = useMemo(() => (useAlts ? Array.from(altRanks!) : []), [useAlts, altRanks]);

  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const it of analysisResult) {
      s.add(taxonomyKeys(it, taxonomy)[0]);
      for (const r of ranks) {
        const c = altCategory(it.ucs?.alternatives?.[r] || '');
        if (c) s.add(c);
      }
    }
    return Array.from(s).sort();
  }, [analysisResult, taxonomy, ranks]);

  const subgroups = useMemo(() => {
    if (!group) return [];
    const s = new Set<string>();
    for (const it of analysisResult) {
      const [g, sg] = taxonomyKeys(it, taxonomy);
      if (g === group && sg) s.add(sg);
      for (const r of ranks) {
        const alt = it.ucs?.alternatives?.[r] || '';
        if (altCategory(alt) === group) {
          const asg = altSubcategory(alt);
          if (asg) s.add(asg);
        }
      }
    }
    return Array.from(s).sort();
  }, [analysisResult, group, taxonomy, ranks]);

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
        {setTaxonomy && (
          <span style={{ display: 'inline-flex', gap: '2px', marginRight: '0.4rem', border: '1px solid var(--border-color)', padding: '1px' }}>
            {(['UCS', 'Music production'] as Taxonomy[]).map(t => (
              <button
                key={t}
                className="btn"
                title={t === 'UCS'
                  ? 'What the sound IS — the 82 UCS categories.'
                  : 'What ROLE it plays in a production — percussion, keyed, plucked, loop. Not a UCS category: it is a second taxonomy over the same samples.'}
                onClick={() => { if (t !== taxonomy) { setGroup(null); setSub(null); setTaxonomy(t); } }}
                style={{
                  padding: '0.1rem 0.5rem', fontSize: '0.68rem', border: 'none',
                  background: t === taxonomy ? 'var(--accent-primary)' : 'transparent',
                  color: t === taxonomy ? '#000' : 'var(--text-secondary)',
                }}
              >
                {t === 'UCS' ? 'UCS' : 'Music role'}
              </button>
            ))}
          </span>
        )}
        {filterBtn('All', !group, () => { setGroup(null); setSub(null); })}
        {groups.map(g => filterBtn(g, group === g, () => { setGroup(g); setSub(null); }, taxonomyColor(g, '', taxonomy)))}
      </div>
      {group && subgroups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>{group} subgroups:</span>
          {filterBtn('All', !sub, () => setSub(null))}
          {subgroups.map(sg => filterBtn(sg, sub === sg, () => setSub(sg), taxonomyColor(group || '', sg, taxonomy)))}
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
