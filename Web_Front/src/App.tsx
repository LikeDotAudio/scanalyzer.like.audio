import { useState } from 'react'
import './index.css'
import ScanalyzeTab from './components/ScanalyzeTab'
import CloudTab from './components/CloudTab'
import StatsTab from './components/StatsTab'
import GroupsTab from './components/GroupsTab'
import ExaminerTab from './components/ExaminerTab'
import RenameTab from './components/RenameTab'

function App() {
  const [analysisResult, setAnalysisResult] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState('scanalyze')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)

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

  const handleImportPeak = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          setAnalysisResult(json);
        } else {
          console.error("Invalid .peak file format");
        }
      } catch (err) {
        console.error("Failed to parse .peak file", err);
      }
    };
    reader.readAsText(file);
  }

  const tabs = [
    { id: 'scanalyze', label: 'SCANALIZE' },
    { id: 'cloud', label: '3D Cloud' },
    { id: 'stats', label: 'Stats' },
    { id: 'groups', label: 'Groups' },
    { id: 'examiner', label: 'Examiner' },
    { id: 'guess', label: 'Auto-Guess' },
    { id: 'rename', label: 'Flatten / Rename' }
  ];

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header glass-panel" style={{ zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href="https://github.com/LikeDotAudio/scanalyzer.like.audio/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1>
            Scan<span className="accent-gradient">alyzer</span>
          </h1>
        </a>
        
        {isAnalyzing && (
          <div style={{ flex: 1, margin: '0 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>Analyzing... {progress}%</span>
            <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)', height: '12px' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.2s', boxShadow: '0 0 10px var(--accent-primary)' }}></div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn">Settings</button>
        </div>
      </header>

      {/* Tabs Navigation */}
      <nav className="tabs-nav glass-panel" style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 1rem', borderTop: 'none', borderBottom: '1px solid var(--border-color)', borderRadius: '0' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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
            onImportPeak={handleImportPeak} 
            onExportPeak={handleExportPeak}
            onViewCloud={() => setActiveTab('cloud')}
          />
        )}

        {activeTab === 'cloud' && <CloudTab analysisResult={analysisResult} />}

        {/* Placeholders for other tabs */}
        {['stats', 'groups', 'examiner', 'guess', 'rename'].includes(activeTab) && (
            <div className="tab-content glass-panel" style={{ margin: '1rem', padding: '2rem', flex: 1, overflowY: 'auto' }}>
                <h2 style={{ marginBottom: '1rem', color: 'var(--accent-primary)' }}>{tabs.find(t => t.id === activeTab)?.label}</h2>
                
                {activeTab === 'stats' && <StatsTab analysisResult={analysisResult} />}
                
                {activeTab === 'groups' && <GroupsTab analysisResult={analysisResult} />}
                
                {activeTab === 'rename' && <RenameTab analysisResult={analysisResult} />}
                
                {activeTab === 'examiner' && (
                  <ExaminerTab 
                    analysisResult={analysisResult} 
                    onGoToScanalyze={() => setActiveTab('scanalyze')} 
                  />
                )}
            </div>
        )}
      </main>
    </div>
  )
}

export default App
