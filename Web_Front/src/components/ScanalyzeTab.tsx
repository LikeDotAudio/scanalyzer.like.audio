import React, { useState, useEffect } from 'react';
import initWasm, { analyze_audio_buffer } from 'wasm_analyzer';

interface ScanalyzeTabProps {
  analysisResult: any[];
  setAnalysisResult: (results: any[]) => void;
  onImportPeak: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExportPeak: () => void;
  onViewCloud: () => void;
}

export default function ScanalyzeTab({ analysisResult, setAnalysisResult, onImportPeak, onExportPeak, onViewCloud }: ScanalyzeTabProps) {
  const [wasmReady, setWasmReady] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    initWasm().then(() => setWasmReady(true)).catch(console.error);
  }, []);

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !wasmReady) return;

    const wavFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.wav'));
    if (wavFiles.length === 0) return;

    setIsAnalyzing(true);
    setProgress(0);
    const results = [];

    for (let i = 0; i < wavFiles.length; i++) {
        const file = wavFiles[i];
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const folder = (file.webkitRelativePath || file.name).split('/')[0] || "folder";
        
        try {
            const jsonResult = analyze_audio_buffer(uint8Array, file.name, folder);
            const parsed = JSON.parse(jsonResult);
            if (parsed.status !== "error") {
                results.push(parsed);
            }
        } catch (err) {
            console.error(`Failed to analyze ${file.name}`, err);
        }

        setProgress(Math.round(((i + 1) / wavFiles.length) * 100));
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    setAnalysisResult(results);
    setIsAnalyzing(false);
  };

  return (
    <div className="tab-content glass-panel" style={{ margin: '1rem', padding: '2rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Scan a Directory</h2>
      <p className="text-secondary" style={{ marginBottom: '1rem', fontSize: '1.2rem', textAlign: 'center', maxWidth: '800px' }}>
          Select a folder containing .wav files to begin local DSP analysis.
      </p>
      
      <div style={{ marginBottom: '2.5rem', background: 'rgba(244, 63, 94, 0.1)', border: '1px solid var(--accent-secondary)', padding: '1rem', borderRadius: '8px', maxWidth: '800px', textAlign: 'left' }}>
          <strong style={{ color: 'var(--accent-secondary)' }}>🔒 Privacy Notice:</strong> Your files are <strong>NOT</strong> uploaded to any server. All audio analysis is performed entirely locally on your machine using the compiled WebAssembly DSP Engine. The browser may ask for permission to "upload", but the data never leaves your computer. Sub-folders are scanned automatically.
      </div>
      
      <div className="text-secondary" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center' }}>
         <strong>WASM Engine Status:</strong> <span style={{ marginLeft: '0.5rem', color: wasmReady ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}>{wasmReady ? '🟢 Online' : '🔴 Offline'}</span>
      </div>
      
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <label className="btn primary" style={{ cursor: 'pointer', padding: '1rem 2.5rem', fontSize: '1.2rem', boxShadow: '0 4px 15px rgba(206, 171, 147, 0.2)' }}>
          {isAnalyzing ? `Analyzing... ${progress}%` : (wasmReady ? 'Scan Folder' : 'Loading Engine...')}
          <input 
            type="file" 
            // @ts-ignore
            webkitdirectory="true" 
            directory="true" 
            style={{ display: 'none' }} 
            onChange={handleFolderUpload} 
            disabled={isAnalyzing || !wasmReady}
          />
        </label>

        <label className="btn" style={{ cursor: 'pointer', padding: '1rem 2.5rem', fontSize: '1.2rem' }}>
          Load .PEAK
          <input 
            type="file" 
            accept=".peak,.PEAK,.json" 
            style={{ display: 'none' }} 
            onChange={onImportPeak} 
            disabled={isAnalyzing}
          />
        </label>
      </div>

      {isAnalyzing && (
        <div style={{ width: '100%', maxWidth: '600px', marginTop: '2.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
          <div style={{ width: `${progress}%`, height: '12px', background: 'var(--accent-primary)', transition: 'width 0.2s', boxShadow: '0 0 10px var(--accent-primary)' }}></div>
        </div>
      )}

      {analysisResult.length > 0 && !isAnalyzing && (
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
