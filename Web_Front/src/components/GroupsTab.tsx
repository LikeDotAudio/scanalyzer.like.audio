

interface GroupsTabProps {
  analysisResult: any[];
}

export default function GroupsTab({ analysisResult }: GroupsTabProps) {
  return (
    <div style={{ marginTop: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '1.5rem', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
      <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', color: 'var(--text-primary)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
            <th style={{ padding: '0.5rem' }}>Group</th>
            <th style={{ padding: '0.5rem' }}>Subgroup</th>
            <th style={{ padding: '0.5rem' }}>Count</th>
          </tr>
        </thead>
        <tbody>
          {/* Simple grouping example */}
          {Object.entries(
            analysisResult.reduce((acc, curr) => {
              const key = curr.group || 'Other';
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
          ).map(([group, count], idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <td style={{ padding: '0.5rem' }}>{group}</td>
              <td style={{ padding: '0.5rem' }}>-</td>
              <td style={{ padding: '0.5rem' }}>{count as number}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
