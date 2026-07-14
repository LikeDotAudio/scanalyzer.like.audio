import React, { useState, useEffect, useRef } from 'react';
import initWasm, { analyzer_version } from 'wasm_analyzer';
import { filterAudioFiles, isTauri, fsaSupported, pickDirectoryFiles, getDirHandle, writePeakSidecar } from '../audioLinking';
import TauriScan from './TauriScan';

/** The folder a record is filed under — the file's parent path. */
const folderOf = (file: File) => {
  const parts = (file.webkitRelativePath || file.name).split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : 'folder';
};

/** A file's path with its extension removed, used to pair `kick.wav` with `kick.PEAK`. */
const stem = (file: File) => (file.webkitRelativePath || file.name).replace(/\.[^./]+$/, '');

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
  onLoadSounds: () => void;
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
    onImportPeak,
    onLoadSounds
}: ScanalyzeTabProps) {
  const [wasmReady, setWasmReady] = useState(false);
  const [pendingWavFiles, setPendingWavFiles] = useState<File[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [absorbed, setAbsorbed] = useState(0);
  const [stale, setStale] = useState(0);
  const stopRef = useRef(false);
  const startMsRef = useRef<number>(0);
  const threadsRef = useRef<number>(1);

  if (isTauri()) {
    return (
      <TauriScan
        analysisResult={analysisResult}
        setAnalysisResult={setAnalysisResult}
        isAnalyzing={isAnalyzing}
        setIsAnalyzing={setIsAnalyzing}
        setProgress={setProgress}
        onViewCloud={onViewCloud}
      />
    );
  }

  useEffect(() => {
    initWasm().then(() => setWasmReady(true)).catch(console.error);
  }, []);

  // Discover WAV files in the picked folder. everyNth > 1 samples the library
  // (e.g. every 50th file) for a quick representative test scan.
  //
  // A folder that has been analyzed before carries a `.PEAK` sidecar next to
  // each sample. The directory picker hands those to us along with the audio, so
  // we read them: a sidecar stamped with *this* engine's version was produced by
  // identical extractor code, and re-analyzing the file could only reproduce it.
  // We absorb it and skip the work. Anything else — no sidecar, a sidecar from an
  // older engine, an unreadable one — is analyzed as normal.
  const discover = async (files: FileList | null | File[], everyNth = 1) => {
    if (!files || !wasmReady) return;
    const all = Array.from(files);
    const engine = analyzer_version();

    // Index the sidecars the picker gave us, by the path they describe.
    const sidecars = new Map<string, File>();
    for (const f of all) {
      if (/\.peak$/i.test(f.name)) sidecars.set(stem(f), f);
    }

    let wavFiles = all.filter(f => f.name.toLowerCase().endsWith('.wav'));
    if (everyNth > 1) wavFiles = wavFiles.filter((_, i) => i % everyNth === 0);

    // Already in this session's results — resume rather than redo. (This used to
    // compare against only the *top* folder segment while the records store the
    // full parent path, so the resume check never actually matched.)
    const existingPaths = new Set(analysisResult.map(res => res.metadata.path));

    const absorbed: any[] = [];
    const toProcess: File[] = [];
    let staleSidecars = 0;

    for (const file of wavFiles) {
      if (existingPaths.has(`${folderOf(file)}/${file.name}`)) continue;

      const sidecar = sidecars.get(stem(file));
      if (sidecar) {
        try {
          const rec = JSON.parse(await sidecar.text());
          // Same engine and the sidecar really describes this file.
          if (rec && rec.analyzer_version === engine && rec.name === file.name) {
            absorbed.push(rec);
            continue;
          }
          staleSidecars++;      // written by different extractor code — recompute
        } catch {
          /* unreadable or not JSON: fall through and analyze the file */
        }
      }
      toProcess.push(file);
    }

    setAudioFiles(filterAudioFiles(all));   // link the audio either way
    setAbsorbed(absorbed.length);
    setStale(staleSidecars);

    if (absorbed.length) setAnalysisResult([...analysisResult, ...absorbed]);

    if (toProcess.length === 0) {
      alert(absorbed.length
        ? `Nothing to analyze — absorbed ${absorbed.length} up-to-date .PEAK sidecar(s).`
        : "All files in this folder have already been analyzed!");
      setPendingWavFiles([]);
      return;
    }
    setPendingWavFiles(toProcess);
  };

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => { void discover(e.target.files, 1); };

  const downloadPeak = (records: any[]) => {
    try {
        const now = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}`;
        const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Scanalyzer.like.audio - File Audit ${ts}.peak`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Failed to save .peak', err);
    }
  };

  const startAnalysis = async () => {
    setIsAnalyzing(true);
    setProgress(0);
    setDone(0);
    setTotal(pendingWavFiles.length);
    stopRef.current = false;
    const newResults: any[] = [];
    let stopped = false;
    let completed = 0;

    startMsRef.current = performance.now();
    const numWorkers = navigator.hardwareConcurrency || 4;
    threadsRef.current = numWorkers;
    const workers = Array.from({ length: numWorkers }).map(() => 
        new Worker(new URL('../wasmWorker.ts', import.meta.url), { type: 'module' })
    );

    let nextFileIdx = 0;
    const dirHandle = await getDirHandle();

    // wait for all workers to be ready
    await Promise.all(workers.map(worker => new Promise(resolve => {
        worker.onmessage = (e) => {
            if (e.data.type === 'ready') resolve(true);
        };
    })));

    await new Promise<void>((resolve) => {
        const checkDone = () => {
            if (completed >= nextFileIdx && (nextFileIdx >= pendingWavFiles.length || stopRef.current)) {
                resolve();
            }
        };

        const assignWork = (worker: Worker) => {
            if (stopRef.current) {
                stopped = true;
                checkDone();
                return;
            }
            if (nextFileIdx >= pendingWavFiles.length) {
                checkDone();
                return;
            }

            const idx = nextFileIdx++;
            const file = pendingWavFiles[idx];
            
            file.arrayBuffer().then(arrayBuffer => {
                const parts = (file.webkitRelativePath || file.name).split('/');
                const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : "folder";
                
                worker.onmessage = async (e) => {
                    const { result, error } = e.data;
                    if (error) {
                        console.error(`Failed to analyze ${file.name}`, error);
                    } else if (result) {
                        try {
                            const parsed = JSON.parse(result);
                            if (parsed.status !== "error") {
                                newResults.push(parsed);
                                if (dirHandle) {
                                    // Use webkitRelativePath for the sidecar, falling back to name
                                    const relPath = (file as any).relPath || file.webkitRelativePath || file.name;
                                    await writePeakSidecar(dirHandle, relPath, parsed);
                                }
                            }
                        } catch (err) {
                            console.error(`Failed to parse result for ${file.name}`, err);
                        }
                    }
                    completed++;
                    setDone(completed);
                    setProgress(Math.round((completed / pendingWavFiles.length) * 100));
                    assignWork(worker);
                };
                
                worker.postMessage({ id: idx, buffer: arrayBuffer, name: file.name, folder }, [arrayBuffer]);
            }).catch(err => {
                console.error(`Failed to read ${file.name}`, err);
                completed++;
                setDone(completed);
                setProgress(Math.round((completed / pendingWavFiles.length) * 100));
                assignWork(worker);
            });
        };

        workers.forEach(assignWork);
    });

    workers.forEach(w => w.terminate());

    // Keep whatever was scanned. On a clean finish, auto-download the .peak;
    // on a manual stop, ask whether to keep the partial analysis.
    const combined = [...analysisResult, ...newResults];
    setAnalysisResult(combined);
    if (stopped) {
        if (window.confirm(`Scan stopped after ${newResults.length} file(s). Keep the .PEAK of what was scanned so far?`)) {
            downloadPeak(combined);
        }
    } else {
        downloadPeak(combined);
    }
    stopRef.current = false;
    setIsAnalyzing(false);
    setPendingWavFiles([]);
  };

  if (isAnalyzing) {
      const pct = total ? Math.round((done / total) * 100) : 0;
      const elapsedS = (performance.now() - startMsRef.current) / 1000;
      let etaStr = "Calculating ETA...";
      if (done > 5 && elapsedS > 1) {
          const rate = done / elapsedS;
          const rem = total - done;
          const etaS = Math.max(0, Math.round(rem / rate));
          const m = Math.floor(etaS / 60);
          const s = etaS % 60;
          etaStr = `ETA: ${m}m ${s.toString().padStart(2, '0')}s`;
      }

      return (
          <div className="tab-content glass-panel" style={{ margin: 0, padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: '640px' }}>
                  <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem', textAlign: 'center' }}>Analyzing with WASM {analyzer_version()}…</h2>
                  <div style={{ textAlign: 'center', color: 'var(--accent-primary)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                      {done.toLocaleString()} of {total.toLocaleString()} files &middot; {pct}%
                  </div>
                  <div style={{ width: '100%', height: '16px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-color)', overflow: 'hidden', marginBottom: '1rem' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.15s' }} />
                  </div>
                  <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem', lineHeight: 1.5 }}>
                      <strong>{threadsRef.current}</strong> concurrent threads &middot; {etaStr}
                      {fsaSupported() && <><br /><span style={{ color: 'var(--accent-secondary)' }}>Writing .PEAK sidecars locally to source directories</span></>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                      <button className="btn" style={{ background: '#ef4444', color: 'white', border: 'none' }} onClick={() => { stopRef.current = true; }}>■ Stop scan</button>
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
              <p className="text-secondary" style={{ marginBottom: '0.75rem', fontSize: '1.2rem' }}>
                  Found <strong>{pendingWavFiles.length}</strong> new .wav files to process.
              </p>
              {(absorbed > 0 || stale > 0) && (
                <p className="text-secondary" style={{ marginBottom: '2.5rem', fontSize: '0.95rem', textAlign: 'center', maxWidth: '640px' }}>
                  {absorbed > 0 && (
                    <>Absorbed <strong style={{ color: 'var(--accent-primary)' }}>{absorbed}</strong> up-to-date .PEAK sidecar{absorbed === 1 ? '' : 's'} — same engine, so those files are already done and will not be re-analyzed. </>
                  )}
                  {stale > 0 && (
                    <><strong>{stale}</strong> sidecar{stale === 1 ? ' was' : 's were'} written by a different engine version and will be recomputed.</>
                  )}
                </p>
              )}
              {absorbed === 0 && stale === 0 && <div style={{ marginBottom: '2.5rem' }} />}
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
          <strong style={{ color: 'var(--accent-secondary)' }}>🔒 Privacy Notice:</strong> Your files are <strong>NOT</strong> uploaded to any server. All audio analysis is performed entirely locally on your machine using the compiled WebAssembly DSP Engine. The browser may ask for permission to "upload" or save files, but the data never leaves your computer. Sub-folders are scanned automatically. 
          {fsaSupported() && <><br /><br /><strong>💾 Caching:</strong> Small <code>.PEAK</code> sidecar files will be written right beside your audio files on your local drive to cache the analysis, making future scans instantaneous!</>}
      </div>
      
      <div className="text-secondary" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center' }}>
         <strong>WASM Engine Status:</strong> <span style={{ marginLeft: '0.5rem', color: wasmReady ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}>{wasmReady ? '🟢 Online' : '🔴 Offline'}</span>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
        {fsaSupported() ? (
          <button
            className="btn primary"
            style={{ cursor: 'pointer', padding: '1rem 2.5rem', fontSize: '1.2rem' }}
            disabled={!wasmReady}
            onClick={async () => {
              try {
                const files = await pickDirectoryFiles(true);
                void discover(files, 1);
              } catch (err) {
                console.warn(err);
              }
            }}
          >
            {wasmReady ? 'Scan a New Directory…' : 'Loading Engine...'}
          </button>
        ) : (
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
        )}
        <label className="btn" style={{ cursor: 'pointer', padding: '0.6rem 1.5rem' }} title="Quick test: analyze every 50th file discovered">
          🎲 Sample the Samples — scan every 50th file (quick test)
          <input
            type="file"
            // @ts-ignore
            webkitdirectory="true"
            directory="true"
            style={{ display: 'none' }}
            onChange={(e) => { void discover(e.target.files, 50); }}
            disabled={!wasmReady}
          />
        </label>
        <label className="btn" style={{ cursor: 'pointer', padding: '0.6rem 1.5rem' }}>
          Load a PEAK File previously scanned…
          <input type="file" accept=".peak,.PEAK,.json" multiple style={{ display: 'none' }} onChange={onImportPeak} />
        </label>
        <button className="btn primary" style={{ cursor: 'pointer', padding: '0.6rem 1.5rem' }} onClick={onLoadSounds}>
          Load Sounds Directory…
        </button>
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
