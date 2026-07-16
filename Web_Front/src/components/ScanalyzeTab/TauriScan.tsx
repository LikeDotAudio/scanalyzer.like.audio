import { useState, useEffect, useRef } from 'react';

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import initWasm, { analyzer_version } from 'wasm_analyzer';
import { setAudioRoot } from '../../audioLinking';
import { normalizePeakRecords } from '../../peakSchema';

/** What survey_directory reports — see src-tauri/src/lib.rs. */
interface Survey {
  audio_files: number;
  total_bytes: number;
  with_sidecar: number;
  /** null when the sidecars here disagree on a version — "mixed", not a lie. */
  sidecar_engine: string | null;
  sample: { path: string; has_sidecar: boolean }[];
}

interface TauriScanProps {
  analysisResult: any[];
  setAnalysisResult: (results: any[]) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (is: boolean) => void;
  setProgress: (p: number) => void;
  onViewCloud: () => void;
}

export default function TauriScan({ analysisResult, setAnalysisResult, isAnalyzing, setIsAnalyzing, setProgress, onViewCloud }: TauriScanProps) {
  // What the picked folder holds, shown before a single file is decoded.
  const [survey, setSurvey] = useState<Survey | null>(null);
  const strideRef = useRef<number | undefined>(undefined);
  const setStrideRef = (v?: number) => { strideRef.current = v; };
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [workerCount, setWorkerCount] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [version, setVersion] = useState('');
  // Paging the finished .PEAK back out of Rust.
  const [loaded, setLoaded] = useState<{ done: number; total: number } | null>(null);

  const threadsTextRef = useRef<Record<number, HTMLSpanElement>>({});
  const threadsProgressRef = useRef<Record<number, HTMLDivElement>>({});

  // The listeners are established ONCE, on mount. They used to be torn down and
  // re-subscribed whenever targetDir or analysisResult changed — and since
  // handlePickAndScan sets targetDir and then immediately invokes the scan, the
  // `start` event (which carries `total` and `workers`) landed in the gap while
  // listen() was still re-attaching, and was lost. The scan ran, but the UI never
  // learned how many files there were, so it sat at 0 with an empty worker grid.
  // Anything the handlers need that changes over time is read through a ref.
  const targetDirRef = useRef<string | null>(null);
  const analysisResultRef = useRef<any[]>(analysisResult);
  useEffect(() => { analysisResultRef.current = analysisResult; }, [analysisResult]);
  // The finished-scan listener is bound once on mount, so it must reach the CURRENT
  // onViewCloud through a ref rather than the stale closure value.
  const onViewCloudRef = useRef<() => void>(onViewCloud);
  useEffect(() => { onViewCloudRef.current = onViewCloud; }, [onViewCloud]);

  useEffect(() => {
    initWasm().then(() => setVersion(analyzer_version())).catch(console.error);
    let unlistenProg: any;
    let unlistenErr: any;
    let unlistenFin: any;

    const setup = async () => {
      unlistenProg = await listen('analyzer-progress', (event: any) => {
        try {
            const msg = JSON.parse(event.payload);
            if (msg.type === 'start') {
                setTotal(msg.total || 0);
                setWorkerCount(msg.workers || 0);
                setStartTime(Date.now());
            } else if (msg.type === 'thread_start') {
                const textEl = threadsTextRef.current[msg.thread_id];
                const progEl = threadsProgressRef.current[msg.thread_id];
                if (textEl) textEl.textContent = msg.file;
                if (progEl) {
                    progEl.style.animation = 'none';
                    void progEl.offsetWidth; // trigger reflow
                    progEl.style.animation = 'thread-progress 1s infinite linear';
                }
            } else if (msg.type === 'result' || msg.type === 'skip') {
                const textEl = threadsTextRef.current[msg.thread_id];
                const progEl = threadsProgressRef.current[msg.thread_id];
                if (textEl) textEl.textContent = '...';
                if (progEl) progEl.style.animation = 'none';

                setDone(msg.done || 0);
                if (msg.total) {
                    setTotal(prev => prev === 0 ? msg.total : prev);
                    setProgress(Math.round(((msg.done || 0) / msg.total) * 100));
                }
            }
        } catch (e) {}
      });
      unlistenErr = await listen('analyzer-error', (event: any) => {
        alert(event.payload);
        setIsAnalyzing(false);
      });
      unlistenFin = await listen('analyzer-finished', async () => {
        setIsAnalyzing(false);
        const dir = targetDirRef.current;
        if (dir) {
            try {
                // Pull the finished .PEAK in pages. Reading it as one string used to
                // push ~150 MB through IPC on a library the size of FSD50K and kill
                // the webview; Rust parses it once and hands us slices.
                const count: number = await invoke('open_peak_file', { directory: dir });
                const PAGE = 2000;
                const all: any[] = [];
                for (let offset = 0; offset < count; offset += PAGE) {
                    const page: string = await invoke('read_peak_page', { offset, limit: PAGE });
                    // A .PEAK on disk may predate the grouped schema; normalize it the
                    // same way an imported one is, so the UI never sees a flat record.
                    all.push(...normalizePeakRecords(JSON.parse(page)).records);
                    setLoaded({ done: Math.min(offset + PAGE, count), total: count });
                }
                await invoke('close_peak_file');
                setLoaded(null);
                if (all.length) {
                    setAnalysisResult([...analysisResultRef.current, ...all]);
                    onViewCloudRef.current?.();   // the analysis is the point — show it
                }
            } catch (err) {
                setLoaded(null);
                console.error("Failed to load peak file:", err);
            }
        }
      });
    };
    setup();

    return () => {
      if (typeof unlistenProg === 'function') unlistenProg();
      if (typeof unlistenErr === 'function') unlistenErr();
      if (typeof unlistenFin === 'function') unlistenFin();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick a folder and SURVEY it — do not start work. The desktop build used to go
  // straight from the picker into a full re-analysis of a library it may already have
  // done, with no way to see what was there or to say no. This is the same survey the
  // browser has always shown, and it costs a directory listing.
  const handlePickAndSurvey = async (stride?: number) => {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || typeof dir !== 'string') return;
    targetDirRef.current = dir;   // read by the finish handler; no re-subscribe
    // The folder you scan IS the folder the audio lives in. Recording it as the audio
    // root is what lets playback resolve a record's relative path.
    setAudioRoot(dir);
    setStrideRef(stride);
    try {
      setSurvey(await invoke<Survey>('survey_directory', { directory: dir }));
    } catch (err) {
      alert(`Could not read that folder: ${err}`);
    }
  };

  const beginAnalysis = (force: boolean) => {
    const dir = targetDirRef.current;
    if (!dir) return;
    setSurvey(null);
    setIsAnalyzing(true);
    setDone(0);
    setTotal(0);
    setProgress(0);
    setStartTime(null);
    invoke('start_analysis', { directory: dir, stride: strideRef.current, force });
  };

  // "Just open what I already have" — read the sidecars, analyze nothing.
  const openExisting = async () => {
    const dir = targetDirRef.current;
    if (!dir) return;
    setSurvey(null);
    try {
      const count: number = await invoke('open_sidecars', { directory: dir });
      const PAGE = 2000;
      const all: any[] = [];
      for (let offset = 0; offset < count; offset += PAGE) {
        const page: string = await invoke('read_peak_page', { offset, limit: PAGE });
        all.push(...normalizePeakRecords(JSON.parse(page)).records);
        setLoaded({ done: Math.min(offset + PAGE, count), total: count });
      }
      await invoke('close_peak_file');
      setLoaded(null);
      if (all.length) {
        setAnalysisResult([...analysisResultRef.current, ...all]);
        onViewCloud?.();
      }
    } catch (err) {
      setLoaded(null);
      console.error('Failed to open sidecars:', err);
      alert(`Could not open the existing .PEAK sidecars: ${err}`);
    }
  };

  if (loaded) {
    const pct = loaded.total ? Math.round((loaded.done / loaded.total) * 100) : 0;
    return (
        <div className="tab-content glass-panel" style={{ margin: 0, padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <h2 style={{ fontSize: '1.6rem', marginBottom: '1rem' }}>Loading results…</h2>
            <div style={{ color: 'var(--accent-primary)', fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>
                {loaded.done.toLocaleString()} <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }}>/ {loaded.total.toLocaleString()}</span>
            </div>
            <div className="progress-container" style={{ width: '80%', maxWidth: '600px' }}>
                <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
  }

  if (isAnalyzing) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    
    let etaStr = '';
    if (startTime && done > 0 && done < total) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const rate = done / elapsedSec;
        const remSec = (total - done) / rate;
        if (Number.isFinite(remSec) && remSec >= 0) {
            if (remSec > 3600) {
                etaStr = ` · ETA ${Math.round(remSec / 3600)}h ${Math.round((remSec % 3600) / 60)}m`;
            } else if (remSec > 60) {
                etaStr = ` · ETA ${Math.round(remSec / 60)}m ${Math.round(remSec % 60)}s`;
            } else {
                etaStr = ` · ETA ${Math.round(remSec)}s`;
            }
        }
    }

    return (
        <div className="tab-content glass-panel" style={{ margin: 0, padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem', fontWeight: 600 }}>Analyzing using RUST {version}...</h2>
            <div style={{ color: 'var(--accent-primary)', fontSize: '2.5rem', fontWeight: 700, margin: '1rem 0' }}>
                {done} <span style={{ fontSize: '1.5rem', color: 'var(--text-secondary)' }}>/ {total}</span>
            </div>
            
            <div className="progress-container" style={{ width: '80%', maxWidth: '600px', marginBottom: '0.5rem' }}>
                <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                {pct}% Complete{etaStr}
            </div>

            {workerCount > 0 && (
                <div style={{ width: '100%', maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '4px' }}>
                        {Array.from({ length: workerCount }).map((_, i) => (
                            <div key={i} style={{ background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--accent-secondary)', width: '16px', opacity: 0.7 }}>#{i}</div>
                                <div style={{ flex: 1, position: 'relative', height: '16px', overflow: 'hidden', borderRadius: '2px', background: 'rgba(0,0,0,0.3)' }}>
                                    <div ref={el => { if (el) threadsProgressRef.current[i] = el; }}
                                         style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: '100%', background: 'var(--accent-primary)', opacity: 0.2, transformOrigin: 'left', animation: 'none' }} />
                                    <div ref={el => { if (el) threadsTextRef.current[i] = el; }}
                                         style={{ position: 'relative', fontSize: '0.7rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', padding: '0 4px', lineHeight: '16px' }}>
                                        ...
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
  }

  // The survey: what is in the folder, before a single byte is read.
  if (survey) {
    const gb = survey.total_bytes / 1e9;
    const toAnalyze = survey.audio_files - survey.with_sidecar;
    const stat: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '2rem', padding: '0.25rem 0' };
    const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: '0.78rem' };
    const staleScan = survey.with_sidecar > 0 && survey.sidecar_engine !== null && survey.sidecar_engine !== version;
    const mixedScan = survey.with_sidecar > 0 && survey.sidecar_engine === null;
    const currentScan = survey.with_sidecar > 0 && survey.sidecar_engine === version;

    return (
      <div className="tab-content glass-panel" style={{ margin: 0, padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        <h2 style={{ fontSize: '1.8rem' }}>Found {survey.audio_files.toLocaleString()} audio file(s)</h2>

        <div style={{ minWidth: '380px', fontSize: '0.9rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', padding: '0.5rem 0' }}>
          <div style={stat}><span>Audio files{strideRef.current && strideRef.current > 1 ? ` (1 of every ${strideRef.current})` : ''}</span><strong style={{ color: 'var(--text-primary)' }}>{survey.audio_files.toLocaleString()}</strong></div>
          <div style={stat}><span>Total audio</span><strong style={{ color: 'var(--text-primary)' }}>{gb >= 1 ? `${gb.toFixed(1)} GB` : `${(survey.total_bytes / 1e6).toFixed(0)} MB`}</strong></div>
          <div style={stat}><span>Already have a .PEAK sidecar</span><strong style={{ color: 'var(--accent-primary)' }}>{survey.with_sidecar.toLocaleString()}</strong></div>
          <div style={stat}><span>No sidecar — never analyzed</span><strong style={{ color: 'var(--accent-secondary)' }}>{toAnalyze.toLocaleString()}</strong></div>
          {survey.with_sidecar > 0 && (
            <>
              <div style={stat}>
                <span>Sidecar engine</span>
                <strong style={{ ...mono, color: currentScan ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}>
                  {mixedScan ? 'mixed versions' : survey.sidecar_engine}
                </strong>
              </div>
              <div style={stat}><span>Current engine</span><strong style={{ ...mono, color: 'var(--text-primary)' }}>{version || '—'}</strong></div>
            </>
          )}
        </div>

        {(staleScan || mixedScan) && (
          <div style={{ maxWidth: '640px', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.5 }}>
            These files were analyzed before, by <strong>different extractor code</strong> than the engine
            now loaded. Re-analyzing {survey.audio_files.toLocaleString()} file(s) will take a while;
            opening the existing sidecars is instant, but their numbers come from the older engine.
          </div>
        )}
        {currentScan && toAnalyze === 0 && (
          <div style={{ maxWidth: '640px', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            Every file already has a sidecar from <em>this</em> engine — re-analyzing could only
            reproduce the same numbers.
          </div>
        )}

        <div style={{ width: '100%', maxWidth: '640px', maxHeight: '220px', overflowY: 'auto', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-color)', padding: '0.4rem 0.6rem', fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
          {survey.sample.map((f, i) => (
            <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {f.has_sidecar ? '✓ ' : '· '}{f.path}
            </div>
          ))}
          {survey.audio_files > survey.sample.length && (
            <div style={{ paddingTop: '0.3rem', color: 'var(--accent-secondary)' }}>
              … and {(survey.audio_files - survey.sample.length).toLocaleString()} more (showing the first {survey.sample.length})
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {survey.with_sidecar > 0 && (
            <button className="btn primary" style={{ padding: '0.6rem 1.5rem' }}
              title="Load the analysis already on disk. Nothing is re-analyzed."
              onClick={() => { void openExisting(); }}>
              Open the {survey.with_sidecar.toLocaleString()} peak{survey.with_sidecar === 1 ? '' : 's'} as-is
            </button>
          )}
          <button className={`btn ${survey.with_sidecar > 0 ? '' : 'primary'}`} style={{ padding: '0.6rem 1.5rem' }}
            title="Ignore every existing sidecar and analyze every file from scratch."
            onClick={() => beginAnalysis(true)}>
            Rescan all {survey.audio_files.toLocaleString()}
          </button>
          {survey.with_sidecar > 0 && toAnalyze > 0 && (
            <button className="btn" style={{ padding: '0.6rem 1.5rem' }}
              title="Reuse sidecars written by this engine; analyze only what is missing or out of date."
              onClick={() => beginAnalysis(false)}>
              Only analyze what's missing
            </button>
          )}
          <button className="btn" style={{ padding: '0.6rem 1.5rem' }} onClick={() => setSurvey(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
      <button className="btn primary" style={{ cursor: 'pointer', padding: '1rem 2.5rem', fontSize: '1.2rem' }} onClick={() => handlePickAndSurvey()}>
        SCAN with RUST engine...
      </button>
      <button className="btn" style={{ cursor: 'pointer', padding: '0.5rem 1.5rem', fontSize: '0.9rem', opacity: 0.8 }} onClick={() => handlePickAndSurvey(50)}>
        SAMPLE scan (1 of 50 files)
      </button>
      
      {analysisResult.length > 0 && (
        <div style={{ marginTop: '2.5rem', textAlign: 'center', width: '100%', maxWidth: '1200px' }}>
          <h3 style={{ color: 'var(--accent-primary)', marginBottom: '0.5rem' }}>Analysis Complete</h3>
          <p className="text-secondary">{analysisResult.length} files successfully processed.</p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
            <button className="btn primary" onClick={onViewCloud}>
              View 3D Cloud
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
