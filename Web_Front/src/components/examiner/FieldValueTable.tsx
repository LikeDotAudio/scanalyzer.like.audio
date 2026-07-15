// The bottom-left field/value details table for the selected sample.
//
// The record is grouped (metadata, classification, envelope, ...), so listing its
// top-level entries would just print seven "[object Object]" rows. Walk into each
// group and show its fields under a group heading.
interface Props {
  item: any;
}

const cell = (color: string): React.CSSProperties => ({
  padding: '0.2rem 0.4rem', color, wordBreak: 'break-word',
});

/** Render a leaf value: arrays flattened, numbers fixed, absent shown as a dash. */
function format(v: any): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length ? v.map(format).join(', ') : '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

const isGroup = (v: any) => typeof v === 'object' && v !== null && !Array.isArray(v);

export default function FieldValueTable({ item }: Props) {
  // Group rows first, then any stray top-level leaf, so nothing is hidden.
  const groups = item ? Object.entries(item).filter(([, v]) => isGroup(v)) : [];
  const loose = item ? Object.entries(item).filter(([, v]) => !isGroup(v)) : [];

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: '105px' }} />
        <col />
      </colgroup>
      <thead style={{ position: 'sticky', top: 0, background: '#1A1D24' }}>
        <tr>
          <th style={{ padding: '0.2rem 0.4rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Field</th>
          <th style={{ padding: '0.2rem 0.4rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Value</th>
        </tr>
      </thead>
      <tbody>
        {!item && (
          <tr><td colSpan={2} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Select a sample</td></tr>
        )}

        {groups.map(([group, fields]: [string, any]) => {
          const entries = Object.entries(fields);
          return [
            <tr key={group} style={{ background: 'rgba(255,255,255,0.04)' }}>
              <td colSpan={2} style={{ padding: '0.25rem 0.4rem', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.03em' }}>
                {group}
              </td>
            </tr>,
            ...(entries.length === 0
              ? [
                  <tr key={`${group}-empty`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td colSpan={2} style={{ ...cell('var(--text-secondary)'), fontStyle: 'italic' }}>
                      not analyzed — re-scan to fill in
                    </td>
                  </tr>,
                ]
              : entries.map(([k, v]) => (
                  <tr key={`${group}.${k}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
                    <td style={cell('#3B82F6')}>{k}</td>
                    <td style={cell('#FCD34D')}>{format(v)}</td>
                  </tr>
                ))),
          ];
        })}

        {loose.map(([k, v]) => (
          <tr key={k} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
            <td style={cell('#3B82F6')}>{k}</td>
            <td style={cell('#FCD34D')}>{format(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
