import { useState, useEffect } from 'react'
import './index.css'
import { pickDirectoryFiles, fsaSupported, filterAudioFiles, getDirHandle, scanDirectoryHandle } from './audioLinking'
import Header from './components/Header'
import ScanalyzeTab from './components/ScanalyzeTab'
import CloudTab from './components/CloudTab'
import StatsTab from './components/StatsTab'
import GroupsTab from './components/GroupsTab'
import ExaminerTab from './components/ExaminerTab'
import RenameTab from './components/RenameTab'

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
    if (fsaSupported()) {
      getDirHandle().then(async (handle) => {
        if (handle) {
          const options = { mode: 'read' } as any;
          if ((await handle.queryPermission(options)) === 'granted') {
             const files = await scanDirectoryHandle(handle);
             setAudioFiles(files);
          } else {
             setHasPreviousDir(true);
          }
        }
      });
    }
  }, []);

  // Auto-load default peak file on mount so users can wander around
  useEffect(() => {
    import('./assets/Scanalyzer.like.audio - File Audit 202607112254.peak?url').then(mod => {
      fetch(mod.default)
        .then(res => res.json())
        .then(json => {
          if (Array.isArray(json)) {
            setAnalysisResult(prev => prev.length === 0 ? json : prev);
          }
        })
        .catch(err => console.error("Failed to load default peak file:", err));
    }).catch(err => console.error("Failed to import default peak file URL:", err));
  }, [])

  const goToTab = (id: string) => { window.location.hash = `#/${id}`; setActiveTab(id); }

  const handleExportPeak = () => {
    if (analysisResult.length === 0) return;
    const blob = new Blob([JSON.stringify(analysisResult, null, 2)], { type: 'application/json' });
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

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          if (Array.isArray(json)) {
            allResults = [...allResults, ...json];
          } else {
            console.error("Invalid .peak file format in", file.name);
          }
        } catch (err) {
          console.error("Failed to parse .peak file", file.name, err);
        }

        filesProcessed++;
        if (filesProcessed === files.length) {
           setAnalysisResult(allResults);
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
              setAudioFiles(await scanDirectoryHandle(handle));
              setHasPreviousDir(false);
              return;
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
      <Header isAnalyzing={isAnalyzing} progress={progress} onImportPeak={handleImportPeak} onLoadSounds={handleLoadSounds} audioCount={audioFiles.length} currentSound={currentSound} hasData={analysisResult.length > 0} />

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
        
        {activeTab === 'scanalyze' && (
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
        )}

        {activeTab === 'cloud' && <CloudTab analysisResult={analysisResult} audioFiles={audioFiles} onSound={setCurrentSound} onLoadSounds={handleLoadSounds} />}
        {activeTab === 'stats' && <StatsTab analysisResult={analysisResult} audioFiles={audioFiles} onSound={setCurrentSound} />}
        {activeTab === 'groups' && <GroupsTab analysisResult={analysisResult} />}
        {activeTab === 'examiner' && <ExaminerTab analysisResult={analysisResult} audioFiles={audioFiles} onSound={setCurrentSound} />}
        {activeTab === 'rename' && <RenameTab analysisResult={analysisResult} />}
        
      </main>
    </div>
  )
}

export default App
