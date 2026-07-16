import { useMemo } from 'react';
import { type Taxonomy, taxonomyKeys, scopeSubgroups, scopeSubColor } from '../groupColors';
import { altCategory } from '../ucsIndex';

import { categoryLabel, subcategoryLabel } from '../categoryEmoji';
import AlphabetScrubber from './AlphabetScrubber';
import { useIsNarrow } from '../useIsNarrow';

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
  setAltRanks?: React.Dispatch<React.SetStateAction<Set<number>>>;
}

export default function ScopeBar({ analysisResult, group, sub, setGroup, setSub, filterText, setFilterText, rightContent, taxonomy = 'UCS', altRanks, setAltRanks }: ScopeBarProps) {
  const isNarrow = useIsNarrow();
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
        opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer', animation: 'fadeIn 0.2s ease-out' }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, opacity: filtering ? 0.35 : 1, pointerEvents: filtering ? 'none' : 'auto' }}>
          <AlphabetScrubber
            items={ucsCats}
            activeItem={group}
            onSelect={g => { setGroup(g); setSub(null); }}
            windowSize={5}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.1rem', flexWrap: 'wrap', minHeight: '28px' }}>
        
        {/* Subgroups (left) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', flex: 1, opacity: filtering ? 0.35 : 1, pointerEvents: filtering ? 'none' : 'auto' }}>
          {group && subgroups.length > 0 && (
            isNarrow ? (
              <select 
                value={sub || ''} 
                onChange={e => setSub(e.target.value || null)}
                style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.2rem 0.5rem', fontSize: '0.75rem', outline: 'none' }}
              >
                <option value="">All</option>
                {subgroups.map(sg => (
                  <option key={sg} value={sg}>{subcategoryLabel(group, sg)}</option>
                ))}
              </select>
            ) : (
              <>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>{categoryLabel(group)} subgroups:</span>
                {filterBtn('All', !sub, () => setSub(null), undefined, filtering)}
                {subgroups.map(sg => filterBtn(subcategoryLabel(group, sg), sub === sg, () => setSub(sg), scopeSubColor(group, sg), filtering))}
              </>
            )
          )}
        </div>

        {/* Match Alt 1 2 3 */}
        {setAltRanks && altRanks && (
          <div className="text-secondary" style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
            title="With a scope selected, also match samples where this runner-up falls in that UCS category.">
            <span>Match:</span>
            {[0, 1, 2].map(r => (
              <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={altRanks.has(r)}
                  onChange={() => setAltRanks(prev => {
                    const next = new Set(prev);
                    next.has(r) ? next.delete(r) : next.add(r);
                    return next;
                  })} />
                Alt {r + 1}
              </label>
            ))}
          </div>
        )}

        {/* Search Bar (right) */}
        {setFilterText !== undefined && (
          <div style={{ position: 'relative', width: isNarrow ? '150px' : '300px', flex: isNarrow ? 1 : '0 0 auto', display: 'flex', alignItems: 'center' }}>
            <input type="text" placeholder="Filter by name, group, timbre..." value={filterText || ''} onChange={e => setFilterText(e.target.value)}
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: `1px solid ${filtering ? 'var(--accent-primary)' : 'var(--border-color)'}`, color: 'white', padding: '0.3rem 1.6rem 0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', width: '100%', minWidth: 0 }} />
            {filtering && (
              <button onClick={() => setFilterText('')} title="Clear filter — re-enable scope"
                style={{ position: 'absolute', right: 4, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: '0 0.3rem' }}>✕</button>
            )}
          </div>
        )}
        
        {rightContent}
      </div>
    </div>
  );
}
