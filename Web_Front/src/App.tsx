import { useState } from 'react'
import './index.css'
import Header from './components/Header'
import ScanalyzeTab from './components/ScanalyzeTab'
import CloudTab from './components/CloudTab'
import StatsTab from './components/StatsTab'
import GroupsTab from './components/GroupsTab'
import ExaminerTab from './components/ExaminerTab'
import RenameTab from './components/RenameTab'

function App() {
  const [analysisResult, setAnalysisResult] = useState<any[]>([])
  const [audioFiles, setAudioFiles] = useState<File[]>([])
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
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    let allResults: any[] = [];
    let filesProcessed = 0;

    Array.from(files).forEach(file => {
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
    
    // Reset the input so the user can load the exact same file again if they want to
    e.target.value = '';
  }

  const tabs = [
    { id: 'scanalyze', label: 'SCANALIZE' },
    { id: 'cloud', label: '3D Cloud' },
    { id: 'stats', label: 'Stats' },
    { id: 'groups', label: 'Groups' },
    { id: 'examiner', label: 'Examiner' },
    { id: 'rename', label: 'Flatten / Rename' }
  ];

  return (
    <div className="app-container">
      <Header isAnalyzing={isAnalyzing} progress={progress} onImportPeak={handleImportPeak} />

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
            onExportPeak={handleExportPeak}
            onViewCloud={() => setActiveTab('cloud')}
            setAudioFiles={setAudioFiles}
          />
        )}

        {activeTab === 'cloud' && <CloudTab analysisResult={analysisResult} />}
        {activeTab === 'stats' && <StatsTab analysisResult={analysisResult} />}
        {activeTab === 'groups' && <GroupsTab analysisResult={analysisResult} />}
        {activeTab === 'examiner' && <ExaminerTab analysisResult={analysisResult} audioFiles={audioFiles} setAudioFiles={setAudioFiles} />}
        {activeTab === 'rename' && <RenameTab analysisResult={analysisResult} />}
        
      </main>
    </div>
  )
}

export default App
