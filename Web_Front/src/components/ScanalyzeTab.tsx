import React, { useState, useEffect } from 'react';
import initWasm, { analyze_audio_buffer } from 'wasm_analyzer';
import { filterAudioFiles } from '../audioLinking';

interface ScanalyzeTabProps {
  analysisResult: any[];
  setAnalysisResult: (results: any[]) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (val: boolean) => void;
  setProgress: (val: number) => void;
  onExportPeak: () => void;
  onViewCloud: () => void;
  setAudioFiles: (files: File[]) => void;
  onImportPeak: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function ScanalyzeTab({
    analysisResult,
    setAnalysisResult,
    isAnalyzing,
    setIsAnalyzing,
    setProgress,
    onExportPeak,
    onViewCloud,
    setAudioFiles,
    onImportPeak
}: ScanalyzeTabProps) {
  const [wasmReady, setWasmReady] = useState(false);
  const [pendingWavFiles, setPendingWavFiles] = useState<File[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

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
        setAudioFiles(filterAudioFiles(Array.from(files))); // Update audio files even if skipping scan
        return;
    }

    setPendingWavFiles(wavFilesToProcess);
    setAudioFiles(filterAudioFiles(Array.from(files))); // Link audio folder automatically when they scan
  };

  const startAnalysis = async () => {
    setIsAnalyzing(true);
    setProgress(0);
    setDone(0);
    setTotal(pendingWavFiles.length);
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

        setDone(i + 1);
        setProgress(Math.round(((i + 1) / pendingWavFiles.length) * 100));

        await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Append new results to the existing ones, then auto-download the analysis
    // as a single .peak (the whole point of the scan).
    const combined = [...analysisResult, ...newResults];
    setAnalysisResult(combined);
    try {
        const now = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}`;
        const blob = new Blob([JSON.stringify(combined, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Scanalyzer.like.audio - File Audit ${ts}.peak`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Failed to auto-save .peak', err);
    }
    setIsAnalyzing(false);
    setPendingWavFiles([]);
  };

  if (isAnalyzing) {
      const pct = total ? Math.round((done / total) * 100) : 0;
      return (
          <div className="tab-content glass-panel" style={{ margin: 0, padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: '640px' }}>
                  <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem', textAlign: 'center' }}>Scanning in progress…</h2>
                  <div style={{ textAlign: 'center', color: 'var(--accent-primary)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                      {done.toLocaleString()} of {total.toLocaleString()} files &middot; {pct}%
                  </div>
                  <div style={{ width: '100%', height: '16px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-color)', overflow: 'hidden', marginBottom: '1.5rem' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.15s' }} />
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', padding: '1rem', fontSize: '0.95rem', lineHeight: 1.6 }}>
                      <strong style={{ color: 'var(--accent-primary)' }}>What happens next</strong>
                      <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
                          <li>When the scan finishes, a <strong>.peak</strong> file downloads automatically — this is the analysis of your shared folder.</li>
                          <li>Load it back in with <strong>Load PEAK Files</strong> (top right).</li>
                          <li>Then click <strong>Load Sounds</strong> to give the analyzer access again to read your local storage in real time.</li>
                      </ol>
                      <div style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>
                          🔒 Again, nothing is uploaded — this is all done locally on your machine.
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  if (pendingWavFiles.length > 0) {
      return (
          <div className="tab-content glass-panel" style={{ margin: 0, padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
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
    <div className="tab-content glass-panel" style={{ margin: 0, padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Scan a New Directory…</h2>
      <p className="text-secondary" style={{ marginBottom: '1rem', fontSize: '1.2rem', textAlign: 'center', maxWidth: '800px' }}>
          Select a folder containing .wav files to begin local DSP analysis.
      </p>
      
      <div style={{ marginBottom: '1.5rem', background: 'rgba(244, 63, 94, 0.1)', border: '1px solid var(--accent-secondary)', padding: '0.75rem', maxWidth: '800px', textAlign: 'left' }}>
          <strong style={{ color: 'var(--accent-secondary)' }}>🔒 Privacy Notice:</strong> Your files are <strong>NOT</strong> uploaded to any server. All audio analysis is performed entirely locally on your machine using the compiled WebAssembly DSP Engine. The browser may ask for permission to "upload", but the data never leaves your computer. Sub-folders are scanned automatically.
      </div>
      
      <div className="text-secondary" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center' }}>
         <strong>WASM Engine Status:</strong> <span style={{ marginLeft: '0.5rem', color: wasmReady ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}>{wasmReady ? '🟢 Online' : '🔴 Offline'}</span>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
        <label className="btn primary" style={{ cursor: 'pointer', padding: '1rem 2.5rem', fontSize: '1.2rem' }}>
          {wasmReady ? 'Scan a New Directory…' : 'Loading Engine...'}
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
        <label className="btn" style={{ cursor: 'pointer', padding: '0.6rem 1.5rem' }}>
          Load a PEAK File previously scanned…
          <input type="file" accept=".peak,.PEAK,.json" multiple style={{ display: 'none' }} onChange={onImportPeak} />
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
