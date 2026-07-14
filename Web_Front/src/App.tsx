import { useState, useEffect } from 'react'
import './index.css'
import { pickDirectoryFiles, fsaSupported, filterAudioFiles, getDirHandle, scanDirectoryHandle, clearDirHandle } from './audioLinking'
import { normalizePeakRecords, LEGACY_MIGRATION_GAPS } from './peakSchema'
import Header from './components/Header'
import ScanalyzeTab from './components/ScanalyzeTab'
import CloudTab from './components/CloudTab'
import StatsTabRaw from './components/StatsTab'
import GroupsTabRaw from './components/GroupsTab'
import ExaminerTabRaw from './components/ExaminerTab'
import RenameTabRaw from './components/RenameTab'
import { lazy, Suspense } from 'react'

const StatsTab = lazy(async () => ({ default: StatsTabRaw }))
const GroupsTab = lazy(async () => ({ default: GroupsTabRaw }))
const ExaminerTab = lazy(async () => ({ default: ExaminerTabRaw }))
const RenameTab = lazy(async () => ({ default: RenameTabRaw }))

const TAB_IDS = ['scanalyze', 'cloud', 'stats', 'groups', 'examiner', 'rename'] as const;

function tabFromHash(): string {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (TAB_IDS as readonly string[]).includes(h) ? h : 'cloud';
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

  // Keep the active tab in sync with the URL hash (linkable / back-forward).
  useEffect(() => {
    const onHash = () => setActiveTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.hash = '#/cloud';
    return () => window.removeEventListener('hashchange', onHash);
  }, [])

  // Auto-load previous directory handle if permitted
  const [hasPreviousDir, setHasPreviousDir] = useState(false);
  useEffect(() => {
    if (!fsaSupported()) return;
    (async () => {
      const handle = await getDirHandle();
      if (!handle) return;
      const options = { mode: 'read' } as any;
      if ((await handle.queryPermission(options)) !== 'granted') {
        setHasPreviousDir(true);
        return;
      }
      try {
        setAudioFiles(await scanDirectoryHandle(handle));
      } catch (err) {
        // The folder was moved, renamed or deleted since we stored the handle.
        // Drop it, or it throws on every load and "Load Sounds" keeps resuming it.
        console.warn('Remembered audio folder is gone; forgetting it.', err);
        await clearDirHandle();
        setHasPreviousDir(false);
      }
    })();
  }, []);

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

  const handleExportPeak = () => {
    if (analysisResult.length === 0) return;
    const blob = new Blob([JSON.stringify(analysisResult)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_analysis.peak';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
           setHasPreviousDir(false);
        }
      };
      reader.readAsText(file);
    });
  }

  const handleImportPeak = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    loadPeakFiles(Array.from(e.target.files));
    // Reset the input so the user can load the exact same file again if they want to
    e.target.value = '';
  }

  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) loadPeakFiles(files);
  }

  // Global "Load Sounds": link an audio folder app-wide (all tabs share it).
  const handleLoadSounds = async () => {
    if (fsaSupported()) {
      try {
        if (hasPreviousDir && audioFiles.length === 0) {
          const handle = await getDirHandle();
          if (handle) {
            const options = { mode: 'read' } as any;
            if ((await handle.requestPermission(options)) === 'granted') {
              try {
                setAudioFiles(await scanDirectoryHandle(handle));
                setHasPreviousDir(false);
                return;
              } catch (err) {
                // Folder is gone — forget it and fall through to the picker
                // rather than leaving the user with a button that does nothing.
                console.warn('Remembered audio folder is gone; forgetting it.', err);
                await clearDirHandle();
                setHasPreviousDir(false);
              }
            }
          }
        }
        setAudioFiles(await pickDirectoryFiles()); 
        setHasPreviousDir(false);
      }
      catch (err) { if ((err as Error)?.name !== 'AbortError') console.warn(err); }
    } else {
      // Fallback: a hidden directory <input> for non-Chromium browsers.
      const input = document.createElement('input');
      input.type = 'file';
      (input as any).webkitdirectory = true;
      input.onchange = () => { if (input.files) setAudioFiles(filterAudioFiles(Array.from(input.files))); };
      input.click();
    }
  }

  const handleUnloadSounds = () => {
    setAudioFiles([]);
    setHasPreviousDir(false);
  }

  const tabs = [
    { id: 'scanalyze', label: 'SCANALIZE' },
    { id: 'cloud', label: '3D' },
    { id: 'stats', label: '2D' },
    // { id: 'groups', label: 'Groups' },
    { id: 'examiner', label: 'Examiner' },
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
      <Header isAnalyzing={isAnalyzing} progress={progress} onImportPeak={handleImportPeak} onLoadSounds={handleLoadSounds} onUnloadSounds={handleUnloadSounds} audioCount={audioFiles.length} currentSound={currentSound} hasData={analysisResult.length > 0} activeTab={activeTab} />

      {schemaNotice && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0.75rem', background: 'rgba(255,190,60,0.10)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
          <span style={{ flex: 1 }}>{schemaNotice}</span>
          <button className="btn" onClick={() => setSchemaNotice('')} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}>Dismiss</button>
        </div>
      )}

      {/* Tabs Navigation */}
      <nav className="tabs-nav glass-panel" style={{ display: 'flex', gap: '2px', padding: '2px', borderTop: 'none', borderBottom: '1px solid var(--border-color)', borderRadius: '0' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => goToTab(tab.id)}
            className={`btn ${activeTab === tab.id ? 'primary' : ''}`}
            style={{ 
              background: activeTab === tab.id ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
              color: activeTab === tab.id ? 'black' : 'var(--text-primary)',
              border: 'none',
              padding: '0.5rem 1rem',
              fontWeight: activeTab === tab.id ? 'bold' : 'normal',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Main Content Area */}
      <main className="app-main" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: 0 }}>
        
        <div style={{ display: activeTab === 'scanalyze' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <ScanalyzeTab 
            analysisResult={analysisResult} 
            setAnalysisResult={setAnalysisResult}
            isAnalyzing={isAnalyzing}
            setIsAnalyzing={setIsAnalyzing}
            setProgress={setProgress}
            onExportPeak={handleExportPeak}
            onViewCloud={() => goToTab('cloud')}
            setAudioFiles={setAudioFiles}
            onImportPeak={handleImportPeak}
            onLoadSounds={handleLoadSounds}
          />
        </div>

        <div style={{ display: activeTab === 'cloud' ? 'flex' : 'none', flex: 1, flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <CloudTab analysisResult={analysisResult} audioFiles={audioFiles} onSound={setCurrentSound} onLoadSounds={handleLoadSounds} />
        </div>

        <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>Loading tab...</div>}>
          {activeTab === 'stats' && <StatsTab analysisResult={analysisResult} audioFiles={audioFiles} onSound={setCurrentSound} />}
          {activeTab === 'groups' && <GroupsTab analysisResult={analysisResult} />}
          {activeTab === 'examiner' && <ExaminerTab analysisResult={analysisResult} audioFiles={audioFiles} onSound={setCurrentSound} />}
          {activeTab === 'rename' && <RenameTab analysisResult={analysisResult} audioFiles={audioFiles} />}
        </Suspense>
        
      </main>
    </div>
  )
}

export default App
