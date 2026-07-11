

interface ExaminerTabProps {
  analysisResult: any[];
  onGoToScanalyze: () => void;
}

export default function ExaminerTab({ analysisResult, onGoToScanalyze }: ExaminerTabProps) {
  if (analysisResult.length === 0) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px dashed var(--border-color)' }}>
        <p className="text-secondary">Scan a directory first to see the analysis results here.</p>
        <button className="btn primary" style={{ marginTop: '1rem' }} onClick={onGoToScanalyze}>
          Go to Scanalyze
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '1.5rem', border: '1px solid var(--border-color)' }}>
      <h3 style={{ marginBottom: '1rem' }}>Analyzed Samples ({analysisResult.length})</h3>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {analysisResult.slice(0, 100).map((res, i) => (
            <div key={i} style={{ 
              background: 'rgba(255,255,255,0.03)', 
              padding: '1rem', 
              borderRadius: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
                <strong style={{ color: 'var(--text-primary)', wordBreak: 'break-all', flex: 1 }}>{res.name}</strong>
                <div style={{ display: 'flex', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem', width: '300px', justifyContent: 'flex-end' }}>
                  <span>Pitch: <span style={{ color: 'var(--accent-primary)' }}>{res.pitch_hz?.toFixed(1) || 'N/A'}</span> Hz</span>
                  <span>Cmplx: <span style={{ color: 'var(--accent-secondary)' }}>{res.complexity?.toFixed(2) || 'N/A'}</span></span>
                </div>
            </div>
        ))}
        {analysisResult.length > 100 && (
          <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>
            ... and {analysisResult.length - 100} more files
          </div>
        )}
      </div>
    </div>
  );
}
