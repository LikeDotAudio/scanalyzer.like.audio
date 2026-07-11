import React, { useState, useEffect } from 'react';
import initWasm, { analyze_audio_buffer } from 'wasm_analyzer';

interface ScanalyzeTabProps {
  analysisResult: any[];
  setAnalysisResult: (results: any[]) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (val: boolean) => void;
  setProgress: (val: number) => void;
  onExportPeak: () => void;
  onViewCloud: () => void;
}

export default function ScanalyzeTab({ 
    analysisResult, 
    setAnalysisResult, 
    isAnalyzing, 
    setIsAnalyzing, 
    setProgress, 
    onExportPeak, 
    onViewCloud 
}: ScanalyzeTabProps) {
  const [wasmReady, setWasmReady] = useState(false);
  const [pendingWavFiles, setPendingWavFiles] = useState<File[]>([]);

  useEffect(() => {
    initWasm().then(() => setWasmReady(true)).catch(console.error);
  }, []);

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !wasmReady) return;

    // Create a Set of already analyzed files to enable resuming
    const existingPaths = new Set(analysisResult.map(res => res.path));

    const allWavFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.wav'));
    
    // Only process files we haven't seen yet
    const wavFilesToProcess = allWavFiles.filter(file => {
        const folder = (file.webkitRelativePath || file.name).split('/')[0] || "folder";
        const expectedPath = `${folder}/${file.name}`;
        return !existingPaths.has(expectedPath);
    });

    if (wavFilesToProcess.length === 0) {
        alert("All files in this folder have already been analyzed!");
        return;
    }

    setPendingWavFiles(wavFilesToProcess);
  };

  const startAnalysis = async () => {
    setIsAnalyzing(true);
    setProgress(0);
    const newResults = [];

    for (let i = 0; i < pendingWavFiles.length; i++) {
        const file = pendingWavFiles[i];
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const folder = (file.webkitRelativePath || file.name).split('/')[0] || "folder";
        
        try {
            const jsonResult = analyze_audio_buffer(uint8Array, file.name, folder);
            const parsed = JSON.parse(jsonResult);
            if (parsed.status !== "error") {
                newResults.push(parsed);
            }
        } catch (err) {
            console.error(`Failed to analyze ${file.name}`, err);
        }

        setProgress(Math.round(((i + 1) / pendingWavFiles.length) * 100));
        
        // Auto-save every 10% if there are a lot of files (e.g., more than 1000)
        if (pendingWavFiles.length >= 1000) {
            const tenPercent = Math.floor(pendingWavFiles.length / 10);
            if (i > 0 && i % tenPercent === 0) {
                const chunk = newResults.slice(i - tenPercent, i);
                const blob = new Blob([JSON.stringify(chunk, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `scan_part_${Math.floor(i / tenPercent)}.peak`;
                a.click();
                URL.revokeObjectURL(url);
            }
        }

        await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Append new results to the existing ones!
    setAnalysisResult([...analysisResult, ...newResults]);
    setIsAnalyzing(false);
    setPendingWavFiles([]);
  };

  if (isAnalyzing) {
      return (
          <div className="tab-content glass-panel" style={{ margin: '1rem', padding: '2rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div className="text-secondary" style={{ fontSize: '1.2rem' }}>Scanning in progress. Please wait...</div>
          </div>
      );
  }

  if (pendingWavFiles.length > 0) {
      return (
          <div className="tab-content glass-panel" style={{ margin: '1rem', padding: '2rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Ready to Scan</h2>
              <p className="text-secondary" style={{ marginBottom: '2.5rem', fontSize: '1.2rem' }}>
                  Found <strong>{pendingWavFiles.length}</strong> new .wav files to process.
              </p>
              <div style={{ display: 'flex', gap: '1rem' }}>
                  <button className="btn" onClick={() => setPendingWavFiles([])}>Cancel</button>
                  <button className="btn primary" onClick={startAnalysis}>Continue to Analysis</button>
              </div>
          </div>
      );
  }

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
          {wasmReady ? 'Scan Folder' : 'Loading Engine...'}
          <input 
            type="file" 
            // @ts-ignore
            webkitdirectory="true" 
            directory="true" 
            style={{ display: 'none' }} 
            onChange={handleFolderUpload} 
            disabled={!wasmReady}
          />
        </label>
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
