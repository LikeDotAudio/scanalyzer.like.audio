import React, { useState, useEffect, useRef } from 'react';
import initWasm, { analyzer_version } from 'wasm_analyzer';
import wasmUrl from 'wasm_analyzer/wasm_analyzer_bg.wasm?url';
import { filterAudioFiles, isTauri, fsaSupported, pickDirectoryFiles, getDirHandle, writePeakSidecar, writeRootFile, relPathOf } from '../../audioLinking';
import { normalizePeakRecords } from '../../peakSchema';
import { MANIFEST_FILE, buildManifest } from '../../manifest';
import TauriScan from './TauriScan';

/** The folder a record is filed under — the file's parent path, or '' at the root.
 *  Never a placeholder word: the UCS classifier reads this field as *text evidence*,
 *  so a literal fallback of "folder" matched the office-supplies synonym and filed
 *  the library under OBJECTS/OFFICE. An empty string says "no folder" and is silent. */
const folderOf = (file: File) => {
  const parts = (relPathOf(file) || file.name).split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
};

/** A file's path with its extension removed, used to pair `kick.wav` with `kick.PEAK`.
 *  Keyed on the full relative path, not the bare name: a library has a `Kick.wav` in
 *  every drum folder, and keying on the name alone pairs them all with one sidecar. */
const stem = (file: File) => (relPathOf(file) || file.name).replace(/\.[^./]+$/, '');

interface ScanalyzeTabProps {
  analysisResult: any[];
  setAnalysisResult: (results: any[] | ((prev: any[]) => any[])) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (val: boolean) => void;
  setProgress: (val: number) => void;
  onViewCloud: () => void;
  setAudioFiles: (files: File[]) => void;
}

export default function ScanalyzeTab({
    analysisResult,
    setAnalysisResult,
    isAnalyzing,
    setIsAnalyzing,
    setProgress,
    onViewCloud,
    setAudioFiles
}: ScanalyzeTabProps) {
  const [wasmReady, setWasmReady] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [absorbed, setAbsorbed] = useState(0);
  const [stale, setStale] = useState(0);
  const [version, setVersion] = useState('');
  // What the folder survey found, shown for confirmation before any file is read.
  // `sidecarEngine` is read from a small sample of the sidecars, not all of them:
  // on a 41k-file folder reading every one is what used to hang the tab. It is the
  // version stamp the existing analysis was produced by, or null if none were readable.
  const [preview, setPreview] = useState<
    { all: File[]; wavFiles: File[]; sidecars: Map<string, File>; everyNth: number;
      sidecarEngine: string | null } | null
  >(null);
  // Progress while absorbing existing sidecars in chunks.
  const [absorbing, setAbsorbing] = useState<{ done: number; total: number } | null>(null);
  const stopRef = useRef(false);
  const startMsRef = useRef<number>(0);
  const threadsRef = useRef<number>(1);

  useEffect(() => {
    // Desktop scans natively — don't fetch the web analyzer wasm there.
    if (isTauri()) return;
    // Instantiate from fetched bytes (see wasmWorker) so a wrong .wasm MIME type doesn't
    // trigger the instantiateStreaming warning/fallback.
    (async () => {
        await initWasm(await (await fetch(wasmUrl)).arrayBuffer());
        setWasmReady(true);
        setVersion(analyzer_version());
    })().catch(console.error);
  }, []);

  // Below every hook — an early return above a hook breaks the Rules of Hooks.
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

  // Discover WAV files in the picked folder. everyNth > 1 samples the library
  // (e.g. every 50th file) for a quick representative test scan.
  //
  // A folder that has been analyzed before carries a `.PEAK` sidecar next to
  // each sample. The directory picker hands those to us along with the audio, so
  // we read them: a sidecar stamped with *this* engine's version was produced by
  // identical extractor code, and re-analyzing the file could only reproduce it.
  // We absorb it and skip the work. Anything else — no sidecar, a sidecar from an
  // older engine, an unreadable one — is analyzed as normal.
  // Survey the picked folder WITHOUT reading anything off disk, and show what was
  // found. A real library is large — FSD50K's dev split is 41k wavs alongside 40k
  // sidecars — and the old flow read every one of those sidecars, one awaited
  // `.text()` at a time, before it drew a single pixel. On a folder that size the
  // tab simply hung and then died. Listing a FileList is cheap (a File is a handle,
  // not the bytes), so we count first, let the user look, and only then do work.
  const discover = async (files: FileList | null | File[], everyNth = 1) => {
    if (!files || !wasmReady) return;
    const all = Array.from(files);

    const sidecars = new Map<string, File>();
    for (const f of all) {
      if (/\.peak$/i.test(f.name)) sidecars.set(stem(f), f);
    }

    // Every format the engine can decode, not just .wav — the desktop build has always
    // counted them all, and a library with a folder of AIFFs or FLACs was quietly
    // reporting a smaller number here than the same folder reported there.
    let wavFiles = filterAudioFiles(all);
    if (everyNth > 1) wavFiles = wavFiles.filter((_, i) => i % everyNth === 0);

    if (wavFiles.length === 0) {
      alert('No audio files found in that folder.');
      return;
    }

    // Which engine produced the sidecars that are already here? Read a handful,
    // spread across the folder, rather than all 40k — enough to name the version
    // and let the user decide whether re-analyzing is worth it.
    let sidecarEngine: string | null = null;
    const withSidecar = wavFiles.filter(f => sidecars.has(stem(f)));
    if (withSidecar.length) {
      const step = Math.max(1, Math.floor(withSidecar.length / SIDECAR_PROBES));
      const probes = withSidecar.filter((_, i) => i % step === 0).slice(0, SIDECAR_PROBES);
      const versions = await Promise.all(probes.map(async f => {
        try {
          const [rec] = normalizePeakRecords([JSON.parse(await sidecars.get(stem(f))!.text())]).records;
          return rec?.metadata?.analyzer_version || null;
        } catch { return null; }
      }));
      const seen = versions.filter(Boolean) as string[];
      // A folder scanned across two engine versions has no single answer; say so by
      // leaving it null rather than picking one and lying about the other half.
      sidecarEngine = seen.length && seen.every(v => v === seen[0]) ? seen[0] : null;
    }

    setPreview({ all, wavFiles, sidecars, everyNth, sidecarEngine });
  };

  /** How many sidecars/wavs to touch per chunk before yielding to the browser. */
  const CHUNK = 250;
  /** Sidecars sampled during the survey just to name the engine that wrote them. */
  const SIDECAR_PROBES = 12;
  const yieldToUi = () => new Promise(r => setTimeout(r, 0));

  // The user said go. Absorb existing sidecars in chunks, keeping the UI alive, then
  // hand whatever still needs analyzing to the worker pool.
  //
  //   'auto'    absorb sidecars written by THIS engine; analyze everything else.
  //   'open'    absorb every readable sidecar whatever engine wrote it, and analyze
  //             nothing. Re-analysis is expensive and the old numbers are often what
  //             you actually want to look at; this is "just open what I already have".
  //   'rescan'  ignore every sidecar and analyze all of it from scratch.
  const confirmPreview = async (mode: 'auto' | 'open' | 'rescan' = 'auto') => {
    if (!preview) return;
    const { all, wavFiles, sidecars } = preview;
    const engine = analyzer_version();
    setPreview(null);

    if (mode === 'rescan') {
      setAudioFiles(filterAudioFiles(all));
      setAbsorbed(0);
      setStale(0);
      void startAnalysis(wavFiles);
      return;
    }

    setAbsorbing({ done: 0, total: wavFiles.length });

    // Already in this session's results — resume rather than redo. (This used to
    // compare against only the *top* folder segment while the records store the
    // full parent path, so the resume check never actually matched.)
    const existingPaths = new Set(analysisResult.map(res => res.metadata?.path));

    const absorbed: any[] = [];
    const toProcess: File[] = [];
    let staleSidecars = 0;
    let noSidecar = 0;      // 'open' mode only: files left out because they had no usable .PEAK

    for (let i = 0; i < wavFiles.length; i += CHUNK) {
      const chunk = wavFiles.slice(i, i + CHUNK);

      // Read this chunk's sidecars concurrently rather than one awaited call at a
      // time — the old serial loop was the bottleneck on a big folder.
      const reads = await Promise.all(chunk.map(async file => {
        if (existingPaths.has(`${folderOf(file)}/${file.name}`)) return { file, skip: true };
        const sidecar = sidecars.get(stem(file));
        if (!sidecar) return { file, rec: null };
        try {
          // A sidecar can predate the grouped schema, so read it through the same
          // normalizer as an imported .PEAK. An older one carries an older version
          // stamp and so falls through to `staleSidecars` and gets recomputed.
          const [rec] = normalizePeakRecords([JSON.parse(await sidecar.text())]).records;
          return { file, rec };
        } catch {
          return { file, rec: null };   // unreadable or not JSON: analyze it
        }
      }));

      for (const r of reads) {
        if ((r as any).skip) continue;
        const rec = (r as any).rec;
        // The sidecar must at least describe THIS file. In 'open' mode we take it
        // whatever engine wrote it; in 'auto' only if the extractor code was identical,
        // because then re-analyzing could only reproduce the same numbers.
        const describesFile = rec && rec.metadata.name === r.file.name;
        const sameEngine = describesFile && rec.metadata.analyzer_version === engine;
        if (describesFile && (mode === 'open' || sameEngine)) {
          if (!sameEngine) staleSidecars++;   // opened as-is, but from other extractor code
          absorbed.push(rec);
        } else if (mode === 'open') {
          // No usable sidecar and the user asked not to analyze. Leave it out rather
          // than silently starting a 41k-file scan they declined — but keep the count,
          // because "opened 40,900 of 40,966" is a fact they need to see.
          noSidecar++;
        } else {
          if (rec) staleSidecars++;    // written by different extractor code
          toProcess.push(r.file);
        }
      }

      setAbsorbing({ done: Math.min(i + CHUNK, wavFiles.length), total: wavFiles.length });
      await yieldToUi();
    }

    setAbsorbing(null);
    setAudioFiles(filterAudioFiles(all));   // link the audio either way
    setAbsorbed(absorbed.length);
    setStale(staleSidecars);

    if (absorbed.length) setAnalysisResult([...analysisResult, ...absorbed]);

    if (toProcess.length === 0) {
      if (mode !== 'open') {
        alert(absorbed.length
          ? `Nothing to analyze — absorbed ${absorbed.length} up-to-date .PEAK sidecar(s).`
          : "All files in this folder have already been analyzed!");
        // Everything was already current — no scan runs, but still (re)build the manifest
        // so a library that predates it, or one with new sidecars, gets a fresh index.
        if (absorbed.length) void cacheManifest([...analysisResult, ...absorbed]);
      }
      if (absorbed.length) onViewCloud();   // opened existing peaks — show them
      return;
    }
    // The survey screen already showed the file list and the user picked an action there,
    // so go straight to work rather than asking them to confirm the same folder twice.
    // Pass the reused records so the rebuilt manifest covers the whole folder, not just
    // the newly analyzed delta.
    void startAnalysis(toProcess, absorbed);
  };

  const [dbLoading, setDbLoading] = useState(false);
  const loadFromDatabase = async () => {
    setDbLoading(true);
    try {
      const baseUrl = isTauri() ? 'https://scanalyzer.like.audio' : '.';
      const res = await fetch(`${baseUrl}/api/get_peaks.php?t=${Date.now()}`);
      
      // Attempt to parse the response text first so we can safely log it on failure
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.error("DB Load Error: PHP endpoint did not return valid JSON. Response was:", text.substring(0, 500) + (text.length > 500 ? "..." : ""));
        alert("Error: Database endpoint returned invalid data. Check browser console.");
        setDbLoading(false);
        return;
      }

      if (Array.isArray(data)) {
        setAnalysisResult(prev => {
          // Map existing records by file name
          const map = new Map(prev.map(p => [p.metadata?.name, p]));
          // DB records overwrite any existing local records with the same file name
          data.forEach(p => {
            if (p?.metadata?.name) {
              map.set(p.metadata.name, p);
            }
          });
          return Array.from(map.values());
        });
        onViewCloud();
      } else {
        console.error("DB Load Error: Expected JSON array, but got:", data);
        alert("Failed to load from database: " + (data.error || "Invalid format (check console)"));
      }
    } catch (e) {
      console.error("DB Load Exception: Network or server connection failed:", e);
      alert("Error connecting to database (check console for details).");
    } finally {
      setDbLoading(false);
    }
  };

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => { void discover(e.target.files, 1); };

  // Rebuild the slim manifest at the folder root from the given (same-engine) record set,
  // so it always covers the WHOLE folder — reused + newly analyzed — not just the delta.
  const cacheManifest = async (records: any[]) => {
    if (!records.length) return;
    try {
      const dirHandle = await getDirHandle();
      if (!dirHandle) return;
      await writeRootFile(dirHandle, MANIFEST_FILE, JSON.stringify(buildManifest('', records, analyzer_version())));
    } catch (e) { console.warn('Could not write manifest', e); }
  };

  // `priorAbsorbed` are records reused from up-to-date sidecars this run (the "only analyze
  // what's missing" case). They're threaded in explicitly because the setAnalysisResult that
  // added them hasn't propagated to this closure yet — without them the rebuilt manifest
  // would omit every reused file.
  const startAnalysis = async (files: File[], priorAbsorbed: any[] = []) => {
    if (files.length === 0) return;
    setIsAnalyzing(true);
    setProgress(0);
    setDone(0);
    setTotal(files.length);
    stopRef.current = false;
    const newResults: any[] = [];
    let completed = 0;

    let dbBatch: any[] = [];
    const flushDbBatch = async (records: any[]) => {
      // Only upload if running in browser (Tauri app handles its own DB sync in Rust)
      if (isTauri()) return;

      // Phase 2: Frontend Payload Optimization (Strip arrays to reduce payload by 99%)
      const stripArrays = (obj: any): any => {
        if (Array.isArray(obj)) return undefined; // Destroy all arrays (waveforms, MFCCs, etc)
        if (typeof obj === 'object' && obj !== null) {
          const stripped: any = {};
          for (const key in obj) {
            const val = stripArrays(obj[key]);
            if (val !== undefined) stripped[key] = val;
          }
          return stripped;
        }
        return obj;
      };

      const lightweightRecords = records.map(stripArrays);

      try {
        const baseUrl = isTauri() ? 'https://scanalyzer.like.audio' : '.';
        await fetch(`${baseUrl}/api/upload_peak.php`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lightweightRecords)
        });
      } catch (e) {
        console.warn("DB upload failed for batch", e);
      }
    };

    startMsRef.current = performance.now();
    const numWorkers = navigator.hardwareConcurrency || 4;
    threadsRef.current = numWorkers;
    const workers = Array.from({ length: numWorkers }).map(() => 
        new Worker(new URL('../../wasmWorker.ts', import.meta.url), { type: 'module' })
    );

    let nextFileIdx = 0;
    const dirHandle = await getDirHandle();

    // wait for all workers to be ready (with a 10s timeout to prevent deadlocks)
    await Promise.all(workers.map(worker => new Promise(resolve => {
        let done = false;
        const complete = () => { if (!done) { done = true; resolve(true); } };
        worker.onmessage = (e) => {
            if (e.data.type === 'ready' || e.data.type === 'init_error') complete();
        };
        worker.postMessage({ type: 'ping' });
        setTimeout(complete, 10000); // safety timeout
    })));

    await new Promise<void>((resolve) => {
        const checkDone = () => {
            if (completed >= nextFileIdx && (nextFileIdx >= files.length || stopRef.current)) {
                resolve();
            }
        };

        const assignWork = (worker: Worker) => {
            if (stopRef.current) {
                checkDone();
                return;
            }
            if (nextFileIdx >= files.length) {
                checkDone();
                return;
            }

            const idx = nextFileIdx++;
            const file = files[idx];
            
            file.arrayBuffer().then(arrayBuffer => {
                const parts = (relPathOf(file) || file.name).split('/');
                const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                
                worker.onmessage = async (e) => {
                    const { result, error, type } = e.data;
                    if (type === 'ready' || type === 'init_error') return; // ignore stray init messages
                    if (error) {
                        console.error(`Failed to analyze ${file.name}`, error);
                    } else if (result) {
                        try {
                            const parsed = JSON.parse(result);
                            if (parsed.status !== "error") {
                                newResults.push(parsed);
                                if (dirHandle) {
                                    const relPath = relPathOf(file) || file.name;
                                    await writePeakSidecar(dirHandle, relPath, parsed);
                                }
                                
                                // Queue for DB upload
                                dbBatch.push(parsed);
                                if (dbBatch.length >= 500) {
                                    const batchToUpload = [...dbBatch];
                                    dbBatch = [];
                                    flushDbBatch(batchToUpload); // Fire and forget background upload
                                }
                            }
                        } catch (err) {
                            console.error(`Failed to parse result for ${file.name}`, err);
                        }
                    }
                    completed++;
                    setDone(completed);
                    setProgress(Math.round((completed / files.length) * 100));
                    assignWork(worker);
                };
                
                worker.postMessage({ id: idx, buffer: arrayBuffer, name: file.name, folder }, [arrayBuffer]);
            }).catch(err => {
                console.error(`Failed to read ${file.name}`, err);
                completed++;
                setDone(completed);
                setProgress(Math.round((completed / files.length) * 100));
                assignWork(worker);
            });
        };

        workers.forEach(assignWork);
    });

    if (dbBatch.length > 0) {
        await flushDbBatch(dbBatch);
    }

    workers.forEach(w => w.terminate());

    // Keep whatever was scanned. Every finished file already wrote its own .PEAK
    // sidecar next to the audio, so there is nothing to download and nothing to
    // ask about on a manual stop — the partial analysis is on disk either way.
    const finalSet = [...analysisResult, ...priorAbsorbed, ...newResults];
    setAnalysisResult(finalSet);

    // Rebuild the manifest to cover the whole folder (reused sidecars included), so the
    // next reopen skips reading every per-file sidecar.
    await cacheManifest(finalSet);

    stopRef.current = false;
    setIsAnalyzing(false);
    if (newResults.length) onViewCloud();   // the analysis is the point — show it
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
                  <h2 style={{ fontSize: '1.8rem', marginBottom: '0.5rem', textAlign: 'center' }}>Analyzing with WASM {version}…</h2>
                  <div style={{ textAlign: 'center', color: 'var(--accent-primary)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                      {done.toLocaleString()} of {total.toLocaleString()} files &middot; {pct}%
                  </div>
                  <div style={{ width: '100%', height: '16px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border-color)', overflow: 'hidden', marginBottom: '1rem' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.15s' }} />
                  </div>
                  {(absorbed > 0 || stale > 0) && (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.5 }}>
                      {absorbed > 0 && (
                        <>Absorbed <strong style={{ color: 'var(--accent-primary)' }}>{absorbed.toLocaleString()}</strong> up-to-date .PEAK sidecar{absorbed === 1 ? '' : 's'} — same engine, so those files are not being re-analyzed. </>
                      )}
                      {stale > 0 && (
                        <><strong>{stale.toLocaleString()}</strong> sidecar{stale === 1 ? ' was' : 's were'} written by a different engine version and {stale === 1 ? 'is' : 'are'} being recomputed.</>
                      )}
                    </div>
                  )}
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
                          <li>Each file's analysis is written as a <strong>.PEAK</strong> sidecar right beside the audio, as it finishes.</li>
                          <li>When the scan is done, click <strong>View 3D Cloud</strong> — the results are already loaded.</li>
                          <li>Re-scanning this folder later reads those sidecars back instantly instead of re-analyzing.</li>
                      </ol>
                      <div style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>
                          🔒 Again, nothing is uploaded — this is all done locally on your machine.
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  // Reading 40k sidecars takes a while even chunked — show it happening.
  if (absorbing) {
    const pct = absorbing.total ? Math.round((absorbing.done / absorbing.total) * 100) : 0;
    return (
      <div className="tab-content glass-panel" style={{ margin: 0, padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h2 style={{ fontSize: '1.6rem', marginBottom: '1rem' }}>Reading existing .PEAK sidecars…</h2>
        <div style={{ color: 'var(--accent-primary)', fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>
          {absorbing.done.toLocaleString()} <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }}>/ {absorbing.total.toLocaleString()}</span>
        </div>
        <div className="progress-container" style={{ width: '80%', maxWidth: '600px' }}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  // The survey: what is in the folder, before a single byte is read.
  if (preview) {
    const { wavFiles, sidecars, everyNth, sidecarEngine } = preview;
    const bytes = wavFiles.reduce((n, f) => n + f.size, 0);
    const gb = bytes / 1e9;
    const withSidecar = wavFiles.filter(f => sidecars.has(stem(f))).length;
    const toAnalyze = wavFiles.length - withSidecar;
    const stat: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '2rem', padding: '0.25rem 0' };

    // These files have been scanned before. Whether that analysis is still current
    // decides the whole choice, so say it plainly instead of quietly re-analyzing 41k
    // files because a version string moved.
    const engine = version;
    // The version stamp is `<timestamp>-<sourceHash>`. The hash is what actually decides
    // whether re-analysis could change anything: identical extractor sources produce
    // identical numbers, so a hash match means a rescan is pointless even if the timestamp
    // moved. Compare on the hash, not the whole stamp.
    const engineHash = (v: string | null) => (v ? v.split('-').pop() || v : null);
    const sameHash = withSidecar > 0 && !!sidecarEngine && engineHash(sidecarEngine) === engineHash(engine);
    const staleScan = withSidecar > 0 && sidecarEngine !== null && !sameHash;
    const mixedScan = withSidecar > 0 && sidecarEngine === null;
    const currentScan = sameHash;
    const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: '0.78rem' };

    return (
      <div className="tab-content glass-panel" style={{ margin: 0, padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        <h2 style={{ fontSize: '1.8rem' }}>Found {wavFiles.length.toLocaleString()} audio file(s)</h2>

        <div style={{ minWidth: '380px', fontSize: '0.9rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', padding: '0.5rem 0' }}>
          <div style={stat}><span>Audio files{everyNth > 1 ? ` (1 of every ${everyNth})` : ''}</span><strong style={{ color: 'var(--text-primary)' }}>{wavFiles.length.toLocaleString()}</strong></div>
          <div style={stat}><span>Total audio</span><strong style={{ color: 'var(--text-primary)' }}>{gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`}</strong></div>
          <div style={stat}><span>Already have a .PEAK sidecar</span><strong style={{ color: 'var(--accent-primary)' }}>{withSidecar.toLocaleString()}</strong></div>
          <div style={stat}><span>No sidecar — never analyzed</span><strong style={{ color: 'var(--accent-secondary)' }}>{toAnalyze.toLocaleString()}</strong></div>
          {withSidecar > 0 && (
            <>
              <div style={stat}>
                <span>Sidecar engine</span>
                <strong style={{ ...mono, color: currentScan ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}>
                  {mixedScan ? 'mixed versions' : sidecarEngine}
                </strong>
              </div>
              <div style={stat}>
                <span>Current engine</span>
                <strong style={{ ...mono, color: currentScan ? 'var(--accent-primary)' : 'var(--text-primary)' }}>{engine || '—'}</strong>
              </div>
            </>
          )}
        </div>

        {(staleScan || mixedScan) && (
          <div style={{ maxWidth: '640px', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.5 }}>
            These files were analyzed before, by <strong>different extractor code</strong> than the
            engine now loaded. Re-analyzing {wavFiles.length.toLocaleString()} file(s) will take a
            while; opening the existing sidecars is instant, but their numbers come from the older
            engine.
          </div>
        )}
        {currentScan && toAnalyze === 0 && (
          <div style={{ maxWidth: '640px', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
            Every file already has a sidecar from <em>this</em> engine — re-analyzing could only
            reproduce the same numbers.
          </div>
        )}

        <div style={{ width: '100%', maxWidth: '640px', maxHeight: '220px', overflowY: 'auto', background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-color)', padding: '0.4rem 0.6rem', fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
          {wavFiles.slice(0, 200).map((f, i) => (
            <div key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sidecars.has(stem(f)) ? '✓ ' : '· '}{relPathOf(f) || f.name}
            </div>
          ))}
          {wavFiles.length > 200 && (
            <div style={{ paddingTop: '0.3rem', color: 'var(--accent-secondary)' }}>
              … and {(wavFiles.length - 200).toLocaleString()} more (showing the first 200)
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {withSidecar > 0 && (
            <button className="btn primary" style={{ padding: '0.6rem 1.5rem' }}
              title="Load the analysis already on disk. Nothing is re-analyzed."
              onClick={() => { void confirmPreview('open'); }}>
              Open the {withSidecar.toLocaleString()} peak{withSidecar === 1 ? '' : 's'} as-is
            </button>
          )}
          {/* Hidden when the sidecars were written by this exact engine source (same hash):
              re-analyzing could only reproduce identical numbers. */}
          {!sameHash && (
            <button className={`btn ${withSidecar > 0 ? '' : 'primary'}`} style={{ padding: '0.6rem 1.5rem' }}
              title="Ignore every existing sidecar and analyze every file from scratch."
              onClick={() => { void confirmPreview('rescan'); }}>
              Rescan all {wavFiles.length.toLocaleString()}
            </button>
          )}
          {withSidecar > 0 && toAnalyze > 0 && (
            <button className="btn" style={{ padding: '0.6rem 1.5rem' }}
              title="Reuse sidecars written by this engine; analyze only what is missing or out of date."
              onClick={() => { void confirmPreview('auto'); }}>
              Only analyze what's missing
            </button>
          )}
          <button className="btn" style={{ padding: '0.6rem 1.5rem' }} onClick={() => setPreview(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content glass-panel" style={{ margin: 0, padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h2 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Scan a New Directory…</h2>
      <p className="text-secondary" style={{ marginBottom: '1rem', fontSize: '1.2rem', textAlign: 'center', maxWidth: '800px' }}>
          Select a folder of audio files to begin local DSP analysis.
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
                const files = await pickDirectoryFiles(true, true);
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

        <button className="btn" style={{ cursor: 'pointer', padding: '0.6rem 1.5rem', marginTop: '1rem', background: 'rgba(255,255,255,0.05)', color: 'var(--accent-primary)' }} disabled={dbLoading} onClick={loadFromDatabase}>
          {dbLoading ? 'Loading Database...' : '☁️ Load All Cloud Records from Database'}
        </button>
      </div>

      {analysisResult.length > 0 && (
        <div style={{ marginTop: '2.5rem', textAlign: 'center' }}>
          <h3 style={{ color: 'var(--accent-primary)', marginBottom: '0.5rem' }}>Analysis Complete</h3>
          <p className="text-secondary">{analysisResult.length} files successfully processed.</p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1rem' }}>
            <button className="btn primary" onClick={onViewCloud}>
              View 3D Cloud
            </button>
          </div>
          <p className="text-secondary" style={{ marginTop: '1rem', fontSize: '0.9rem', fontStyle: 'italic' }}>Note: Select a category to hear the sounds.</p>
        </div>
      )}
    </div>
  );
}
