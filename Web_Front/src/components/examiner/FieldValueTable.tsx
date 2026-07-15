import { useState, Fragment } from 'react';

// The bottom-left field/value explorer for the selected sample. A COMPLETE, dynamic dump:
// it walks the record recursively, so every field at every depth shows — nested objects
// and arrays-of-objects included (e.g. ucs.alternatives → alt 1/2/3, each with its own
// category / subcategory / id / probability). A button bar (in place of the old
// Field/Value header) isolates a single top-level parent group.
interface Props {
  item: any;
}

const cell = (color: string): React.CSSProperties => ({
  padding: '0.2rem 0.4rem', color, wordBreak: 'break-word',
});

const isObj = (v: any) => typeof v === 'object' && v !== null;
const isPlainObj = (v: any) => isObj(v) && !Array.isArray(v);
// Expandable = has structure worth recursing into: a non-empty object, or an array that
// holds at least one object. A primitive, or an array of only primitives, is a leaf.
const isExpandable = (v: any) =>
  (isPlainObj(v) && Object.keys(v).length > 0) ||
  (Array.isArray(v) && v.some(isObj));

/** Format a leaf value: primitive-arrays flattened, numbers fixed, absent shown as a dash. */
function format(v: any): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length ? v.map(format).join(', ') : '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

// Array elements that are objects get a friendly 1-based label (alt "#1", region "#2", …);
// object keys keep their name.
const childEntries = (v: any): [string, any][] =>
  Array.isArray(v) ? v.map((e, i) => [`#${i + 1}`, e] as [string, any]) : Object.entries(v);

/** Recursively render rows for one (label, value). Depth drives the indent. */
function renderNode(label: string, value: any, depth: number, keyPath: string): React.ReactNode[] {
  const indent = { paddingLeft: `${0.4 + depth * 0.85}rem` };

  if (!isExpandable(value)) {
    return [
      <tr key={keyPath} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
        <td style={{ ...cell('#3B82F6'), ...indent }}>{label}</td>
        <td style={cell('#FCD34D')}>{format(value)}</td>
      </tr>,
    ];
  }

  const heading = (
    <tr key={`${keyPath}::h`} style={{ background: depth === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)' }}>
      <td colSpan={2} style={{ ...indent, padding: '0.25rem 0.4rem', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.03em' }}>
        {label}
      </td>
    </tr>
  );

  const entries = childEntries(value);
  const children = entries.flatMap(([k, cv]) => renderNode(k, cv, depth + 1, `${keyPath}.${k}`));
  return [heading, ...children];
}

export default function FieldValueTable({ item }: Props) {
  // Top-level groups (the objects) drive the isolation buttons; any stray top-level leaf
  // (a bare number/string on the record) is shown too so nothing is hidden.
  const entries: [string, any][] = item ? Object.entries(item) : [];
  const groups = entries.filter(([, v]) => isPlainObj(v));
  const loose = entries.filter(([, v]) => !isPlainObj(v));

  // Isolate a single parent group (null = show all). If the remembered group is absent
  // from the newly selected record, fall back to showing everything.
  const [only, setOnly] = useState<string | null>(null);
  const activeOnly = only && groups.some(([g]) => g === only) ? only : null;
  const shownGroups = activeOnly ? groups.filter(([g]) => g === activeOnly) : groups;

  const groupBtn: React.CSSProperties = { padding: '0.1rem 0.4rem', fontSize: '0.68rem' };

  return (
    <>
      {/* Parent-group isolation buttons — the replacement for the Field/Value header. */}
      {item && (
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1A1D24', display: 'flex', flexWrap: 'wrap', gap: '3px', padding: '0.3rem 0.4rem', borderBottom: '1px solid var(--border-color)' }}>
          <button className={`btn ${!activeOnly ? 'primary' : 'secondary'}`} style={groupBtn} onClick={() => setOnly(null)}>All</button>
          {groups.map(([g]) => (
            <button key={g} className={`btn ${activeOnly === g ? 'primary' : 'secondary'}`} style={groupBtn}
              onClick={() => setOnly(activeOnly === g ? null : g)}>{g}</button>
          ))}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '38%' }} />
          <col />
        </colgroup>
        <tbody>
          {!item && (
            <tr><td colSpan={2} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Select a sample</td></tr>
          )}

          {shownGroups.map(([group, fields]) => (
            <Fragment key={group}>
              {isPlainObj(fields) && Object.keys(fields).length === 0
                ? [
                    <tr key={`${group}::h`} style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <td colSpan={2} style={{ padding: '0.25rem 0.4rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{group}</td>
                    </tr>,
                    <tr key={`${group}::empty`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td colSpan={2} style={{ ...cell('var(--text-secondary)'), paddingLeft: '1.25rem', fontStyle: 'italic' }}>not analyzed — re-scan to fill in</td>
                    </tr>,
                  ]
                : renderNode(group, fields, 0, group)}
            </Fragment>
          ))}

          {!activeOnly && loose.map(([k, v]) => (
            <tr key={k} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
              <td style={cell('#3B82F6')}>{k}</td>
              <td style={cell('#FCD34D')}>{format(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
