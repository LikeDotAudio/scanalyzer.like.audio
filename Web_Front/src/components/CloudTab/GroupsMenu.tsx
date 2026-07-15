import { subKey, taxonomyColor } from '../../groupColors';
import type { Taxonomy } from '../../groupColors';
import { categoryLabel, subcategoryLabel } from '../../categoryEmoji';

interface GroupsMenuProps {
  groupTree: { group: string; count: number; subs: { name: string; count: number }[] }[];
  taxonomy: Taxonomy;
  hiddenGroups: Set<string>;
  setHiddenGroups: (s: Set<string>) => void;
  expanded: Set<string>;
  setExpanded: (s: Set<string>) => void;
  toggleKey: (k: string) => void;
  toggleExpand: (g: string) => void;
}

export default function GroupsMenu({ groupTree, taxonomy, hiddenGroups, setHiddenGroups, expanded, setExpanded, toggleKey, toggleExpand }: GroupsMenuProps) {
  return (
    <div className="glass-panel" style={{ position: 'absolute', top: '3.5rem', right: '1rem', zIndex: 20, background: 'rgba(17, 19, 24, 0.95)', padding: '1rem', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.15rem', width: '280px', maxHeight: 'calc(100% - 5rem)', overflowY: 'auto' }}>
      <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', fontSize: '0.9rem', margin: 0, marginBottom: '0.5rem' }}>{taxonomy === 'UCS' ? 'UCS categories / subcategories' : 'Music-production roles / groups'}</h3>
      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.2rem' }}>
        <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
          onClick={() => setHiddenGroups(new Set())}>Show all</button>
        <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
          onClick={() => setHiddenGroups(new Set(groupTree.map(g => g.group)))}>Show none</button>
      </div>
      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.5rem' }}>
        <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
          onClick={() => setExpanded(new Set(groupTree.filter(g => g.subs.length).map(g => g.group)))}>Expand all</button>
        <button className="btn secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', flex: 1 }}
          onClick={() => setExpanded(new Set())}>Collapse</button>
      </div>
      <div className="text-secondary" style={{ fontSize: '0.7rem', marginBottom: '0.5rem' }}>click to hide / show</div>
      {groupTree.map(({ group, count, subs }) => {
        const gHidden = hiddenGroups.has(group);
        const isOpen = expanded.has(group);
        return (
          <div key={group} style={{ marginBottom: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
              <span
                onClick={() => subs.length && toggleExpand(group)}
                style={{ width: '12px', cursor: subs.length ? 'pointer' : 'default', color: 'var(--text-secondary)', userSelect: 'none' }}>
                {subs.length ? (isOpen ? '▾' : '▸') : ''}
              </span>
              <div onClick={() => toggleKey(group)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', opacity: gHidden ? 0.35 : 1, flex: 1 }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: taxonomyColor(group, '', taxonomy), flexShrink: 0 }} />
                <span style={{ textDecoration: gHidden ? 'line-through' : 'none' }} title={group}>{categoryLabel(group)}</span>
                <span className="text-secondary" style={{ fontSize: '0.65rem' }}>({count.toLocaleString()})</span>
              </div>
            </div>
            {isOpen && subs.map(sg => {
              const key = subKey(group, sg.name);
              const sHidden = hiddenGroups.has(key) || gHidden;
              return (
                <div key={key} onClick={() => toggleKey(key)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', opacity: sHidden ? 0.35 : 1, fontSize: '0.75rem', paddingLeft: '1.5rem', marginTop: '2px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: taxonomyColor(group, sg.name, taxonomy), flexShrink: 0 }} />
                  <span style={{ textDecoration: hiddenGroups.has(key) ? 'line-through' : 'none' }} title={sg.name}>{subcategoryLabel(group, sg.name)}</span>
                  <span className="text-secondary" style={{ fontSize: '0.6rem' }}>({sg.count.toLocaleString()})</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
