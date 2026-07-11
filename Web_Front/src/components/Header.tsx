import { Suspense } from 'react';

interface HeaderProps {
  isAnalyzing: boolean;
  progress: number;
  onImportPeak: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function Header({ isAnalyzing, progress, onImportPeak }: HeaderProps) {
  return (
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
        <label className="btn" style={{ cursor: 'pointer', margin: 0 }}>
          Load .PEAK
          <input 
            type="file" 
            accept=".peak,.PEAK,.json" 
            multiple
            style={{ display: 'none' }} 
            onChange={onImportPeak} 
          />
        </label>
        <button className="btn">Settings</button>
      </div>
    </header>
  );
}
