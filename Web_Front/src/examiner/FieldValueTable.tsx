// The bottom-left field/value details table for the selected sample.
interface Props {
  item: any;
}

export default function FieldValueTable({ item }: Props) {
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
        {item ? Object.entries(item).map(([k, v]: [string, any]) => {
          if (Array.isArray(v)) v = v.join(', ');
          if (typeof v === 'number') v = v.toFixed(2);
          return (
            <tr key={k} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
              <td style={{ padding: '0.2rem 0.4rem', color: '#3B82F6', wordBreak: 'break-word' }}>{k}</td>
              <td style={{ padding: '0.2rem 0.4rem', color: '#FCD34D', wordBreak: 'break-word' }}>{v?.toString()}</td>
            </tr>
          );
        }) : (
          <tr><td colSpan={2} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Select a sample</td></tr>
        )}
      </tbody>
    </table>
  );
}
