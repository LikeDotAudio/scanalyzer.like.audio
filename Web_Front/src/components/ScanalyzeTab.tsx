import React from 'react';

interface ScanalyzeTabProps {
  analysisResult: any[];
  onImportPeak: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExportPeak: () => void;
  onViewCloud: () => void;
}

export default function ScanalyzeTab({ analysisResult, onImportPeak, onExportPeak, onViewCloud }: ScanalyzeTabProps) {
  return (
    <div className="tab-content glass-panel" style={{ margin: '1rem', padding: '2rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Load Analysis Data</h2>
      <p className="text-secondary" style={{ marginBottom: '2.5rem', fontSize: '1.2rem', textAlign: 'center', maxWidth: '800px' }}>
          Please run the native analysis tool locally on your computer to process your samples, then load the results here.
      </p>
      
      <div style={{ marginBottom: '2.5rem', background: 'rgba(0, 0, 0, 0.3)', border: '1px solid var(--border-color)', padding: '2rem', borderRadius: '12px', maxWidth: '800px', textAlign: 'left', width: '100%' }}>
          <h3 style={{ marginBottom: '1rem', color: 'var(--accent-primary)' }}>Step 1: Process Locally</h3>
          <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
            Open your terminal and run the native Rust analyzer on your folder. It will scan all sub-folders recursively and run on each and every file to generate a <code>sample_cloud_data.PEAK</code> output.
          </p>
          <pre style={{ background: '#111', padding: '1rem', borderRadius: '8px', color: '#0ea5e9', overflowX: 'auto', marginBottom: '2rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            /home/anthony/Documents/GitProjects/Sample\ Analysis/sample_analyzer_rs/target/release/oa_sample_analyzer /path/to/your/audio/folder --workers 30
          </pre>
          
          <h3 style={{ marginBottom: '1rem', color: 'var(--accent-primary)' }}>Step 2: Visualize</h3>
          <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
            Once the tool finishes processing your library, upload the generated <code>.PEAK</code> file here to visualize the data in the 3D cloud.
          </p>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
            <label className="btn primary" style={{ cursor: 'pointer', padding: '1rem 2.5rem', fontSize: '1.2rem', boxShadow: '0 4px 15px rgba(206, 171, 147, 0.2)' }}>
              Load .PEAK File
              <input 
                type="file" 
                accept=".peak,.PEAK,.json" 
                style={{ display: 'none' }} 
                onChange={onImportPeak} 
              />
            </label>
          </div>
      </div>

      {analysisResult.length > 0 && (
        <div style={{ marginTop: '2.5rem', textAlign: 'center' }}>
          <h3 style={{ color: 'var(--accent-primary)', marginBottom: '0.5rem' }}>Analysis Complete</h3>
          <p className="text-secondary">{analysisResult.length} files successfully processed.</p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
            <button className="btn" onClick={onExportPeak}>
              Save .PEAK File
            </button>
            <button className="btn primary" onClick={onViewCloud}>
              View 3D Cloud
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
