import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import initWasm, { analyzer_version } from 'wasm_analyzer';

export default function TauriScan({ analysisResult, setAnalysisResult, isAnalyzing, setIsAnalyzing, setProgress, onViewCloud }: any) {
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [workerCount, setWorkerCount] = useState(0);
  const [targetDir, setTargetDir] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [version, setVersion] = useState('');

  const threadsTextRef = useRef<Record<number, HTMLSpanElement>>({});
  const threadsProgressRef = useRef<Record<number, HTMLDivElement>>({});

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
                setWorkerCount(prev => prev === 0 ? 30 : prev);
            }
            if (msg.type === 'thread_start') {
                // If we missed start event, recover total/workers if possible
                setWorkerCount(prev => prev === 0 ? 30 : prev);
            }
        } catch (e) {}
      });
      unlistenErr = await listen('analyzer-error', (event: any) => {
        alert(event.payload);
        setIsAnalyzing(false);
      });
      unlistenFin = await listen('analyzer-finished', async () => {
        setIsAnalyzing(false);
        if (targetDir) {
            try {
                const res: string = await invoke('read_peak_file', { directory: targetDir });
                const json = JSON.parse(res);
                if (Array.isArray(json)) {
                    setAnalysisResult([...analysisResult, ...json]);
                }
            } catch (err) {
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
  }, [targetDir, analysisResult, setAnalysisResult, setIsAnalyzing, setProgress]);

  const handlePickAndScan = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir && typeof dir === 'string') {
        setTargetDir(dir);
        setIsAnalyzing(true);
        setDone(0);
        setTotal(0);
        setProgress(0);
        setStartTime(null);
        invoke('start_analysis', { directory: dir });
    }
  };

  if (isAnalyzing) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    
    let etaStr = '';
    if (startTime && done > 0 && done < total) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const rate = done / elapsedSec;
        const remSec = (total - done) / rate;
        if (Number.isFinite(remSec) && remSec >= 0) {
            if (remSec > 3600) {
                etaStr = ` · ETA: ${(remSec / 3600).toFixed(1)}h`;
            } else if (remSec > 60) {
                etaStr = ` · ETA: ${Math.ceil(remSec / 60)}m`;
            } else {
                etaStr = ` · ETA: ${Math.ceil(remSec)}s`;
            }
        }
    }

    return (
        <div className="tab-content glass-panel" style={{ margin: 0, padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem', textAlign: 'center' }}>Analyzing using RUST {version}…</h2>
            <div style={{ textAlign: 'center', color: 'var(--accent-primary)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                {done.toLocaleString()} of {total.toLocaleString()} files &middot; {pct}%{etaStr}
            </div>
            <div style={{ width: '100%', maxWidth: '640px', height: '16px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-color)', overflow: 'hidden', marginBottom: '1rem' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.15s' }} />
            </div>

            {workerCount > 0 && (
                <div style={{ marginTop: '2rem', width: '100%', maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{workerCount} Threads Running</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.4rem' }}>
                        {Array.from({ length: workerCount }).map((_, i) => (
                            <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '2px', padding: '0.25rem 0.5rem', position: 'relative', overflow: 'hidden' }}>
                                <div ref={el => { if (el) threadsProgressRef.current[i] = el; }} style={{ position: 'absolute', top: 0, left: 0, bottom: 0, background: 'rgba(244, 144, 44, 0.15)', width: '0%' }} />
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', position: 'relative', zIndex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{i}:</span> <span ref={el => { if (el) threadsTextRef.current[i] = el; }}>...</span>
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
      <button className="btn primary" style={{ cursor: 'pointer', padding: '1rem 2.5rem', fontSize: '1.2rem' }} onClick={handlePickAndScan}>
        Native Tauri Scan Directory…
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
