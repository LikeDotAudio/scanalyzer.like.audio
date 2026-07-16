import { useState, useEffect, useMemo, useRef } from 'react'
import './index.css'
import { fsaSupported, getDirHandle, scanDirectoryHandle, clearDirHandle, setAudioRoot, getAudioRoot, filterAudioFiles, isTauri, getLastFolderName, clearLastFolderName, resolveAudioUrl } from './audioLinking'
import SampleFooter, { type FooterTab } from './components/SampleFooter'
import { normalizePeakRecords, LEGACY_MIGRATION_GAPS } from './peakSchema'
import Header from './components/Header'
import ScanalyzeTab from './components/ScanalyzeTab'
import CloudTab from './components/CloudTab'
import StatsTabRaw from './components/StatsTab'
import GroupsTabRaw from './components/GroupsTab'
import ExaminerTabRaw from './components/ExaminerTab'
import ExtractorTabRaw from './components/ExtractorTab'
import RenameTabRaw from './components/RenameTab'
import ScopeBar from './components/ScopeBar'
import { matchesScope, taxonomyKeys } from './groupColors'
import { altCategory, altSubcategory } from './ucsIndex'
import { lazy, Suspense } from 'react'

const StatsTab = lazy(async () => ({ default: StatsTabRaw }))
const GroupsTab = lazy(async () => ({ default: GroupsTabRaw }))
const ExaminerTab = lazy(async () => ({ default: ExaminerTabRaw }))
const ExtractorTab = lazy(async () => ({ default: ExtractorTabRaw }))
const RenameTab = lazy(async () => ({ default: RenameTabRaw }))

const TAB_IDS = ['scanalyze', 'cloud', 'stats', 'groups', 'examiner', 'extractor', 'rename'] as const;

function tabFromHash(): string {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (TAB_IDS as readonly string[]).includes(h) ? h : 'scanalyze';
}

function App() {
  const [analysisResult, setAnalysisResult] = useState<any[]>([])
  const [audioFiles, setAudioFiles] = useState<File[]>([])
  const [activeTab, setActiveTab] = useState(tabFromHash())
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentSound, setCurrentSound] = useState('')
  // Set when a loaded .PEAK predates the grouped schema and had to be migrated.
  const [schemaNotice, setSchemaNotice] = useState('')
  // Desktop only: the absolute folder relative .PEAK paths resolve against.
  const [audioRootLinked, setAudioRootLinked] = useState(getAudioRoot())
  // A previously scanned folder we can offer to reopen on startup: its display name,
  // plus a busy flag while its cached sidecars are being read back in.
  const [reopenName, setReopenName] = useState<string | null>(null)
  const [reopening, setReopening] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)

  // Global Scope State
  const [scopeGroup, setScopeGroup] = useState<string | null>(null)
  const [scopeSub, setScopeSub] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [scopeLetters, setScopeLetters] = useState<string[]>([])
  const [altRanks, setAltRanks] = useState<Set<number>>(new Set())

  const filteredData = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return analysisResult.filter(it => {
      if (!matchesScope(it, scopeGroup, scopeSub, altRanks)) return false;

      if (!scopeGroup && scopeLetters.length > 0) {
        const cat = taxonomyKeys(it, 'UCS')[0] || '';
        const char = cat.charAt(0).toUpperCase();
        // Only drop it if it's an alphabet letter and not in our active scrubber window.
        // (If it's a number/symbol, keep it visible).
        if (char >= 'A' && char <= 'Z' && !scopeLetters.includes(char)) return false;
      }

      const altText = (it.ucs?.alternatives || [])
        .map((a: any) => `${altCategory(a)} ${altSubcategory(a)}`).join(' ');
      if (q && !`${it.metadata?.name || ''} ${it.classification?.group || ''} ${it.classification?.subgroup || ''} ${it.ucs?.category || ''} ${it.ucs?.subcategory || ''} ${altText} ${it.classification?.timbre || ''} ${it.musicality?.root_note_name || ''} ${it.classification?.reason?.[0] || ''}`
        .toLowerCase().includes(q)) return false;
      return true;
    });
  }, [analysisResult, scopeGroup, scopeSub, filterText, altRanks, scopeLetters])

  // Global footer transport: every tab reports the sample it's playing via onSound
  // (its name), so we can resolve the whole record here and drive one shared footer —
  // download / play-stop and "push to any tab" — from any page.
  const footerAudioRef = useRef<HTMLAudioElement>(null)
  const [footerPlaying, setFooterPlaying] = useState(false)
  const footerItem = useMemo(
    () => (currentSound ? analysisResult.find(it => (it.metadata?.name || '') === currentSound) || null : null),
    [currentSound, analysisResult],
  )

  // Keep the active tab in sync with the URL hash (linkable / back-forward).
  useEffect(() => {
    const onHash = () => setActiveTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.hash = '#/scanalyze';
    return () => window.removeEventListener('hashchange', onHash);
  }, [])

  // Re-link the audio folder we remember, so samples play again after a reload.
  //
  // Chrome only hands a stored directory handle back on `granted`; if the grant has
  // lapsed to `prompt`, re-requesting it REQUIRES a user gesture, and there is no
  // "Load Sounds" button any more to supply one. So we borrow the gesture the user is
  // already making: the first click anywhere in the app re-asks. Clicking a point in
  // the cloud to hear it is itself the gesture that makes it audible.
  //
  // Without this the app looked linked, listed every sample, and played nothing.
  useEffect(() => {
    if (!fsaSupported()) return;
    let done = false;

    const link = async (mayPrompt: boolean) => {
      if (done) return;
      const handle = await getDirHandle();
      if (!handle) return;
      const options = { mode: 'read' } as any;
      let state = await handle.queryPermission(options);
      if (state !== 'granted') {
        if (!mayPrompt) return;                       // no gesture yet — wait for one
        state = await handle.requestPermission(options);
        if (state !== 'granted') return;              // the user said no; respect it
      }
      try {
        done = true;
        setAudioFiles(await scanDirectoryHandle(handle));
      } catch (err) {
        // The folder was moved, renamed or deleted since we stored the handle. Drop it,
        // or it throws on every load and every click for ever after.
        console.warn('Remembered audio folder is gone; forgetting it.', err);
        done = true;
        await clearDirHandle();
      }
    };

    void link(false);                                  // already granted? link silently.
    const onGesture = () => { void link(true); };
    window.addEventListener('pointerdown', onGesture);
    return () => window.removeEventListener('pointerdown', onGesture);
  }, []);

  // Offer to reopen a previously scanned folder. If one is remembered — a granted FSA
  // directory handle on the web, or a linked audio root on the desktop — surface a
  // prompt on startup. Reopening reads the cached .PEAK sidecars back in, no re-analysis.
  useEffect(() => {
    // Read the remembered folder name synchronously from the localStorage "cookie"
    // (set the last time a folder was picked), so the prompt appears immediately.
    if (isTauri()) {
      const root = getAudioRoot();
      if (root) setReopenName(root.split(/[\\/]/).pop() || root);
      return;
    }
    if (!fsaSupported()) return;
    const name = getLastFolderName();
    if (name) setReopenName(name);
  }, []);

  // Reopen the remembered folder: re-request read permission (the button click is the
  // required user gesture), re-walk it including .PEAK sidecars, and load the cached
  // records back in — no re-analysis.
  const reopenFolder = async () => {
    setReopening(true);
    try {
      if (isTauri()) {
        // Desktop: the native scan wrote an aggregate .PEAK in the folder. Read it back
        // directly (paged) — the same path the scan itself uses — so reopening loads the
        // cached analysis with no re-scan. Fall back to the Scanalyze tab if there's no
        // cached .PEAK to read.
        const dir = getAudioRoot();
        if (!dir) { goToTab('scanalyze'); return; }
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const count = await invoke<number>('open_peak_file', { directory: dir });
          const PAGE = 2000;
          const all: any[] = [];
          for (let offset = 0; offset < count; offset += PAGE) {
            const page = await invoke<string>('read_peak_page', { offset, limit: PAGE });
            all.push(...normalizePeakRecords(JSON.parse(page)).records);
          }
          await invoke('close_peak_file');
          if (all.length) { setAnalysisResult(all); goToTab('cloud'); }
          else goToTab('scanalyze');
        } catch (err) {
          console.warn('Reopen: no cached .PEAK for', dir, '— falling back to Scanalyze.', err);
          goToTab('scanalyze');
        }
        return;
      }
      const handle = await getDirHandle();
      if (!handle) { clearLastFolderName(); return; }
      const perm = await handle.requestPermission({ mode: 'read' } as any);
      if (perm !== 'granted') return;
      const all = await scanDirectoryHandle(handle, true); // audio + .PEAK sidecars
      setAudioFiles(filterAudioFiles(all));
      // Read the per-file sidecars back, chunked so a 40k-file library keeps the UI alive.
      const peaks = all.filter(f => /\.peak$/i.test(f.name));
      const records: any[] = [];
      const CHUNK = 300;
      for (let i = 0; i < peaks.length; i += CHUNK) {
        const texts = await Promise.all(peaks.slice(i, i + CHUNK).map(f => f.text().catch(() => null)));
        for (const t of texts) {
          if (!t) continue;
          try { const j = JSON.parse(t); records.push(...(Array.isArray(j) ? j : [j])); } catch { /* skip a bad sidecar */ }
        }
        await new Promise(r => setTimeout(r, 0));
      }
      const report = normalizePeakRecords(records);
      setAnalysisResult(report.records);
      setSchemaNotice(noticeFor(report.migrated, report.skipped));
      if (report.records.length) goToTab('cloud');
    } catch (err) {
      console.warn('Reopen failed; forgetting the remembered folder.', err);
      await clearDirHandle();
      clearLastFolderName();
    } finally {
      setReopening(false);
      setReopenName(null);
    }
  };

  // Load the bundled demo pack — 60 curated samples (music + SFX) with pre-computed
  // analysis, served from public/SampleSamplesForSampling — so a first-time visitor can
  // explore without picking a folder. Fetches the aggregate .PEAK for the analysis and
  // each audio file as a File (so playback resolves it by name, on web and desktop).
  const loadDemoPack = async () => {
    setDemoLoading(true);
    try {
      const base = `${import.meta.env.BASE_URL || '/'}SampleSamplesForSampling`;
      const peak = await (await fetch(`${base}/samples.PEAK`)).json();
      const report = normalizePeakRecords(Array.isArray(peak) ? peak : []);
      const manifest: { name: string }[] = await (await fetch(`${base}/manifest.json`)).json();
      const files: File[] = [];
      let skippedAudio = 0;
      for (const m of manifest) {
        try {
          // Encode the filename as a path segment, but keep commas literal. Vite's dev
          // static server (sirv) does NOT decode %2C back to a comma — it 404s and falls
          // through to the SPA index.html — so a comma-named sample (e.g. "AUTO, SHIFTER")
          // would be silently skipped here and later report "File not found" on playback.
          // A literal comma is valid in a path segment and every host we serve from accepts it.
          const res = await fetch(`${base}/${encodeURIComponent(m.name).replace(/%2C/g, ',')}`);
          const ctype = res.headers.get('content-type') || '';
          // A missing public file falls back to the SPA index.html (HTTP 200, text/html).
          // Blobbing that would hand GStreamer an HTML page to "decode" — skip it instead.
          if (!res.ok || ctype.includes('text/html')) { skippedAudio++; continue; }
          const blob = await res.blob();
          const f = new File([blob], m.name, { type: blob.type });
          (f as any).relPath = m.name;
          files.push(f);
        } catch { skippedAudio++; }
      }
      if (skippedAudio) console.warn(`Demo pack: ${skippedAudio} sample(s) unavailable and skipped.`);
      setAudioFiles(files);
      setAnalysisResult(report.records);
      setSchemaNotice(noticeFor(report.migrated, report.skipped));
      setReopenName(null);
      goToTab('cloud');
    } catch (err) {
      console.warn('Could not load the demo sample pack.', err);
    } finally {
      setDemoLoading(false);
    }
  };

  // Describe what a migration cost, so blank UCS/loudness columns aren't a mystery.
  const noticeFor = (migrated: number, skipped: number) => {
    const parts: string[] = [];
    if (migrated) {
      parts.push(
        `Migrated ${migrated} record(s) from an older analyzer. ` +
        `Re-scan the folder to fill in: ${LEGACY_MIGRATION_GAPS.join(', ')}.`
      );
    }
    if (skipped) parts.push(`Skipped ${skipped} unreadable record(s).`);
    return parts.join(' ');
  };

  const goToTab = (id: string) => { window.location.hash = `#/${id}`; setActiveTab(id); }

  const footerPlay = async () => {
    if (!footerItem || !footerAudioRef.current) return;
    if (footerPlaying) {
      footerAudioRef.current.pause();
      return;
    }
    const src = await resolveAudioUrl(audioFiles, footerItem);
    if (!src) return;
    if (footerAudioRef.current.src.startsWith('blob:')) URL.revokeObjectURL(footerAudioRef.current.src);
    footerAudioRef.current.src = src;
    footerAudioRef.current.play().catch(() => {});
  };

  const [autoPlay, setAutoPlay] = useState(false);
  const [autoLoop, setAutoLoop] = useState(false);
  const [digging, setDigging] = useState(false);

  // Play a newly selected item if autoPlay or DIG is active
  useEffect(() => {
    if ((autoPlay || digging) && footerItem && footerAudioRef.current) {
      (async () => {
        const src = await resolveAudioUrl(audioFiles, footerItem);
        if (src) {
          if (footerAudioRef.current!.src.startsWith('blob:')) URL.revokeObjectURL(footerAudioRef.current!.src);
          footerAudioRef.current!.src = src;
          footerAudioRef.current!.play().catch(() => {});
        }
      })();
    }
  }, [currentSound, autoPlay, digging]); // footerItem updates when currentSound updates

  const handleFooterEnded = () => {
    setFooterPlaying(false);
    if (digging) {
      const idx = filteredData.findIndex(it => it === footerItem);
      if (idx !== -1 && idx + 1 < filteredData.length) {
        setCurrentSound(filteredData[idx + 1].metadata?.name || '');
      } else {
        setDigging(false); // Reached end of list
      }
    }
  };

  const footerDownload = async () => {
    if (!footerItem) return;
    const url = await resolveAudioUrl(audioFiles, footerItem)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = footerItem.metadata?.name || 'sample'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }
  const footerPush = (tab: FooterTab, name: string) => {
    setFilterText(name);
    goToTab(tab);
  }

  const loadPeakFiles = (fileList: File[]) => {
    const files = fileList.filter(f => /\.peak$|\.json$/i.test(f.name) || f.type === 'application/json');
    if (files.length === 0) return;

    let allResults: any[] = [];
    let filesProcessed = 0;
    let migrated = 0;
    let skipped = 0;

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          if (Array.isArray(json)) {
            // A .PEAK may come from any analyzer version; re-group the old flat
            // schema so the UI's `item.metadata.*` reads don't hit undefined.
            const report = normalizePeakRecords(json);
            allResults = [...allResults, ...report.records];
            migrated += report.migrated;
            skipped += report.skipped;
          } else {
            console.error("Invalid .peak file format in", file.name);
          }
        } catch (err) {
          console.error("Failed to parse .peak file", file.name, err);
        }

        filesProcessed++;
        if (filesProcessed === files.length) {
           setAnalysisResult(allResults);
           setSchemaNotice(noticeFor(migrated, skipped));
           setAudioFiles([]);
           setCurrentSound('');
        }
      };
      reader.readAsText(file);
    });
  }

  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) loadPeakFiles(files);
  }

  // A full reset, not just an unlink: the analysis is what the 3D cloud, the 2D
  // charts and the file list are drawn from, so dropping the audio while leaving
  // 36k points on screen left the app claiming to show a library that was no
  // longer loaded. Nothing is lost — every scanned file's .PEAK sidecar is still
  // on disk, so re-scanning the folder reads it all back without re-analyzing.
  const handleUnloadSounds = async () => {
    if (analysisResult.length && !window.confirm(
      `Unload ${analysisResult.length.toLocaleString()} analyzed sample(s)? The 3D cloud, the 2D charts and the file list will be cleared. Your .PEAK sidecars stay on disk, so re-scanning the folder reads them straight back.`
    )) return;

    setAudioFiles([]);
    setAnalysisResult([]);
    setCurrentSound('');
    setSchemaNotice('');
    setAudioRoot('');
    setAudioRootLinked('');
    await clearDirHandle();
  }

  const tabs = [
    { id: 'scanalyze', label: 'SCANALYZE' },
    { id: 'cloud', label: '3D' },
    { id: 'stats', label: '2D' },
    { id: 'examiner', label: 'Examiner' },
    { id: 'extractor', label: 'Extractor' },
    { id: 'rename', label: 'File Names' }
  ];

  return (
    <div
      className="app-container"
      onDragOver={(e) => {
        // Only react to files being dragged in — ignore text/element drags.
        if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        if (!isDragging) setIsDragging(true);
      }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setIsDragging(false); }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, background: 'var(--accent-primary)', color: 'black', textAlign: 'center', padding: '0.35rem', fontSize: '0.85rem', fontWeight: 600, pointerEvents: 'none' }}>
          Drop .PEAK file to load
        </div>
      )}
      <Header isAnalyzing={isAnalyzing} progress={progress} onUnloadSounds={handleUnloadSounds} audioCount={audioFiles.length} audioRoot={audioRootLinked} currentSound={currentSound} sample={footerItem} hasData={analysisResult.length > 0} activeTab={activeTab} />

      {schemaNotice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0.75rem', background: 'rgba(255,190,60,0.10)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
          <span style={{ flex: 1 }}>{schemaNotice}</span>
          <button className="btn" onClick={() => setSchemaNotice('')} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}>Dismiss</button>
        </div>
      )}

      {reopenName && !analysisResult.length && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0.75rem', background: 'rgba(59,130,246,0.12)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.8rem' }}>
          <span style={{ flex: 1 }}>Reopen previously scanned folder <strong>“{reopenName}”</strong>? Its cached analysis loads without re-scanning.</span>
          <button className="btn primary" disabled={reopening} onClick={reopenFolder} style={{ padding: '0.2rem 0.7rem', fontSize: '0.75rem' }}>{reopening ? 'Opening…' : 'Open'}</button>
          <button className="btn" onClick={() => setReopenName(null)} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}>Not now</button>
        </div>
      )}

      {!analysisResult.length && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0.75rem', background: 'rgba(16,185,129,0.10)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.8rem' }}>
          <span style={{ flex: 1 }}>New here? Load a curated pack of 30 music + 30 sound-effect samples to explore right away — no folder needed.</span>
          <button className="btn primary" disabled={demoLoading} onClick={loadDemoPack} style={{ padding: '0.2rem 0.7rem', fontSize: '0.75rem' }}>{demoLoading ? 'Loading…' : '🎧 Sample samples for sampling'}</button>
        </div>
      )}



      {/* Tabs Navigation */}
      <nav className="tabs-nav glass-panel" style={{ display: 'flex', gap: '2px', padding: '2px', borderTop: 'none', borderBottom: '1px solid var(--border-color)', borderRadius: '0', zIndex: 40 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => goToTab(tab.id)}
            className={`btn ${activeTab === tab.id ? 'primary' : ''}`}
            style={{ 
              flex: 1,
              background: activeTab === tab.id ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
              color: activeTab === tab.id ? 'black' : 'var(--text-primary)',
              border: 'none',
              padding: '0.5rem 1rem',
              fontWeight: activeTab === tab.id ? 'bold' : 'normal',
              borderRadius: '2px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Global Scope Bar */}
      {analysisResult.length > 0 && (
        <div style={{ padding: '0.1rem 1rem', background: '#0d1017', borderBottom: '1px solid var(--border-color)', zIndex: 50 }}>
          <ScopeBar
            analysisResult={analysisResult}
            group={scopeGroup} sub={scopeSub} setGroup={setScopeGroup} setSub={setScopeSub}
            filterText={filterText} setFilterText={setFilterText}
            altRanks={altRanks} setAltRanks={setAltRanks}
            setScopeLetters={setScopeLetters}
          />
        </div>
      )}

      {/* Main Content Area */}
      <main className="app-main" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', padding: 0 }}>
        
        <div style={{ display: activeTab === 'scanalyze' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <ScanalyzeTab 
            analysisResult={analysisResult} 
            setAnalysisResult={setAnalysisResult}
            isAnalyzing={isAnalyzing}
            setIsAnalyzing={setIsAnalyzing}
            setProgress={setProgress}
            onViewCloud={() => goToTab('cloud')}
            setAudioFiles={setAudioFiles}
          />
        </div>

        <div style={{ display: activeTab === 'cloud' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <CloudTab analysisResult={analysisResult} filteredData={filteredData} audioFiles={audioFiles} onSound={setCurrentSound} selectedItem={footerItem} playing={footerPlaying}
            onExamine={(name) => footerPush('examiner', name)}
            onExtract={(name) => footerPush('extractor', name)} />
        </div>

        <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Loading tab...</div>}>
          {activeTab === 'stats' && <StatsTab analysisResult={analysisResult} filteredData={filteredData} audioFiles={audioFiles} onSound={setCurrentSound} selectedItem={footerItem} />}
          {activeTab === 'groups' && <GroupsTab analysisResult={analysisResult} />}
          {activeTab === 'examiner' && <ExaminerTab analysisResult={analysisResult} filteredData={filteredData} audioFiles={audioFiles} onSound={setCurrentSound} />}
          {activeTab === 'extractor' && <ExtractorTab analysisResult={analysisResult} filteredData={filteredData} audioFiles={audioFiles} onSound={setCurrentSound} setAnalysisResult={setAnalysisResult} />}
          {activeTab === 'rename' && <RenameTab analysisResult={analysisResult} filteredData={filteredData} audioFiles={audioFiles} />}
        </Suspense>

      </main>

      {/* Global footer */}
      {analysisResult.length > 0 && (
        <SampleFooter
          item={footerItem}
          playing={footerPlaying}
          digging={digging}
          autoPlay={autoPlay}
          autoLoop={autoLoop}
          current={activeTab as FooterTab}
          onPlay={footerPlay}
          onDig={() => setDigging(!digging)}
          onToggleAutoPlay={setAutoPlay}
          onToggleAutoLoop={setAutoLoop}
          onDownload={footerDownload}
          onCopyData={() => {
            if (footerItem) {
              navigator.clipboard.writeText(JSON.stringify(footerItem, null, 2));
            }
          }}
          onPush={footerPush}
        />
      )}
      <audio ref={footerAudioRef} style={{ display: 'none' }} loop={autoLoop && !digging}
        onPlay={() => setFooterPlaying(true)} onPause={() => setFooterPlaying(false)} onEnded={handleFooterEnded} />
    </div>
  )
}

export default App
