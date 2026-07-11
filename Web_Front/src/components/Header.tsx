interface HeaderProps {
  isAnalyzing: boolean;
  progress: number;
  onImportPeak: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadSounds: () => void;
  audioCount: number;
  currentSound?: string;
}

export default function Header({ isAnalyzing, progress, onImportPeak, onLoadSounds, audioCount, currentSound }: HeaderProps) {
  return (
    <header className="app-header glass-panel" style={{ zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <a href="https://github.com/LikeDotAudio/scanalyzer.like.audio/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1 style={{ margin: 0 }}>
            SCANALYZER<span className="accent-gradient">.Like.Audio</span>
          </h1>
        </a>
        <span className="text-secondary" style={{ fontSize: '0.7rem' }}>Designed and Built by Anthony Peter Kuzub</span>
      </div>

      {!isAnalyzing && currentSound && (
        <div style={{ flex: 1, margin: '0 2rem', minWidth: 0, textAlign: 'center', overflow: 'hidden' }}>
          <span className="accent-gradient" style={{ fontSize: '1.5rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{currentSound}</span>
        </div>
      )}

      {isAnalyzing && (
        <div style={{ flex: 1, margin: '0 2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>Analyzing... {progress}%</span>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', overflow: 'hidden', border: '1px solid var(--border-color)', height: '12px' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.2s' }}></div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <label className="btn" style={{ cursor: 'pointer', margin: 0 }}>
          Load PEAK Files
          <input
            type="file"
            accept=".peak,.PEAK,.json"
            multiple
            style={{ display: 'none' }}
            onChange={onImportPeak}
          />
        </label>
        <button className="btn primary" onClick={onLoadSounds}>Load Sounds</button>
        {audioCount > 0 && <span className="text-secondary" style={{ fontSize: '0.75rem' }}>{audioCount} linked</span>}
        <button className="btn">Settings</button>
      </div>
    </header>
  );
}
