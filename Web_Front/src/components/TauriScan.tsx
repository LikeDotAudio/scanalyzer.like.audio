import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import initWasm, { analyzer_version } from 'wasm_analyzer';
import { normalizePeakRecords } from '../peakSchema';

export default function TauriScan({ analysisResult, setAnalysisResult, isAnalyzing, setIsAnalyzing, setProgress, onViewCloud }: any) {
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
                if (all.length) setAnalysisResult([...analysisResultRef.current, ...all]);
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

  const handlePickAndScan = async (stride?: number) => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === 'string') {
        targetDirRef.current = dir;   // read by the finish handler; no re-subscribe
        setIsAnalyzing(true);
        setDone(0);
        setTotal(0);
        setProgress(0);
        setStartTime(null);
        invoke('start_analysis', { directory: dir, stride });
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
      <button className="btn primary" style={{ cursor: 'pointer', padding: '1rem 2.5rem', fontSize: '1.2rem' }} onClick={() => handlePickAndScan()}>
        SCAN with RUST engine...
      </button>
      <button className="btn" style={{ cursor: 'pointer', padding: '0.5rem 1.5rem', fontSize: '0.9rem', opacity: 0.8 }} onClick={() => handlePickAndScan(50)}>
        SAMPLE scan (1 of 50 files)
      </button>
      
      {analysisResult.length > 0 && (
        <div style={{ marginTop: '2.5rem', textAlign: 'center' }}>
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
