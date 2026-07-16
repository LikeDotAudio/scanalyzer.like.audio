import { Fragment, useMemo } from 'react';
import { taxonomyKeys, ucsColor, ucsSubColor } from '../../groupColors';
import { categoryLabel, subcategoryLabel } from '../../categoryEmoji';

interface GroupsTabProps {
  // The current scoped/filtered view (honours the scope bar, text filter and the Groups
  // hide set), so this table always describes exactly what the rest of the app is showing.
  filteredData: any[];
}

// A count of the current view broken down by UCS CATEGORY → SUBCATEGORY. This used to bucket
// on the removed `classification.group` field and ignore every filter, so it showed the wrong
// taxonomy against a whole-library population; it now speaks UCS off `filteredData`.
export default function GroupsTab({ filteredData }: GroupsTabProps) {
  const groups = useMemo(() => {
    const map = new Map<string, { count: number; subs: Map<string, number> }>();
    for (const it of filteredData) {
      const [g, sg] = taxonomyKeys(it, 'UCS');
      const entry = map.get(g) || { count: 0, subs: new Map<string, number>() };
      entry.count++;
      if (sg) entry.subs.set(sg, (entry.subs.get(sg) || 0) + 1);
      map.set(g, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .map(([group, { count, subs }]) => ({
        group,
        count,
        subs: Array.from(subs.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([name, c]) => ({ name, count: c })),
      }));
  }, [filteredData]);

  const total = filteredData.length;

  if (total === 0) {
    return (
      <div style={{ marginTop: '1rem', padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        No samples in the current view.
      </div>
    );
  }

  return (
    <div style={{ marginTop: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '1.5rem', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
      <div className="text-secondary" style={{ fontSize: '0.8rem', marginBottom: '0.75rem' }}>
        {groups.length} categories · {total.toLocaleString()} samples in view
      </div>
      <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', color: 'var(--text-primary)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
            <th style={{ padding: '0.5rem' }}>UCS Category</th>
            <th style={{ padding: '0.5rem' }}>Subcategory</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Count</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ group, count, subs }) => (
            <Fragment key={group}>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <td style={{ padding: '0.5rem', fontWeight: 600 }}>
                  <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: ucsColor(group), marginRight: '0.5rem', verticalAlign: 'middle' }} />
                  {categoryLabel(group)}
                </td>
                <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>—</td>
                <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>{count.toLocaleString()}</td>
              </tr>
              {subs.map(sg => (
                <tr key={`${group}${sg.name}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '0.3rem 0.5rem' }} />
                  <td style={{ padding: '0.3rem 0.5rem 0.3rem 1.5rem', color: 'var(--text-secondary)' }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: ucsSubColor(group, sg.name), marginRight: '0.5rem', verticalAlign: 'middle' }} />
                    {subcategoryLabel(group, sg.name)}
                  </td>
                  <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: 'var(--text-secondary)' }}>{sg.count.toLocaleString()}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
