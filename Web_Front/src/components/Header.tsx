interface HeaderProps {
  isAnalyzing: boolean;
  progress: number;
  onImportPeak: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadSounds: () => void;
  audioCount: number;
  currentSound?: string;
  hasData: boolean;
}

export default function Header({ isAnalyzing, progress, onImportPeak, onLoadSounds, audioCount, currentSound, hasData }: HeaderProps) {
  return (
    <header className="app-header glass-panel" style={{ zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <a href="https://github.com/LikeDotAudio/scanalyzer.like.audio/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <img src="/logo.svg" alt="Scanalyzer logo" width={34} height={34} style={{ display: 'block' }} />
          <h1 className="accent-gradient" style={{ margin: 0 }}>
            SCANALYZER.Like.Audio
          </h1>
        </a>
        <span className="text-secondary" style={{ fontSize: '0.7rem' }}>Designed and Built by Anthony Peter Kuzub</span>
      </div>

      {!isAnalyzing && (
        <div className="hide-on-mobile" style={{ flex: 1, minWidth: '250px', textAlign: 'center', overflow: 'hidden' }}>
          {currentSound ? (
            <span className="accent-gradient" style={{ fontSize: '1.5rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{currentSound}</span>
          ) : !hasData ? (
            <span className="text-secondary" style={{ fontSize: '0.9rem' }}>
              <strong style={{ color: 'var(--accent-primary)' }}>Step 1:</strong> Scan a folder (Scanalize tab) or <strong style={{ color: 'var(--accent-primary)' }}>Load PEAK Files</strong> to bring in an analysis. →
            </span>
          ) : audioCount === 0 ? (
            <span className="text-secondary" style={{ fontSize: '0.9rem' }}>
              <strong style={{ color: 'var(--accent-primary)' }}>Step 2:</strong> Click <strong style={{ color: 'var(--accent-primary)' }}>Load Sounds</strong> to give the analyzer real-time access to your local files so you can hear them. →
            </span>
          ) : (
            <span className="text-secondary" style={{ fontSize: '0.9rem' }}>
              🟢 Online — select any sample to hear &amp; inspect it.
            </span>
          )}
        </div>
      )}

      {isAnalyzing && (
        <div className="hide-on-mobile" style={{ flex: 1, minWidth: '250px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ color: 'var(--accent-primary)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>Analyzing... {progress}%</span>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.3)', overflow: 'hidden', border: '1px solid var(--border-color)', height: '12px' }}>
            <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.2s' }}></div>
          </div>
        </div>
      )}

      <div className="hide-on-mobile" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label className={`btn ${hasData ? '' : 'primary blink'}`} style={{ cursor: 'pointer', margin: 0 }}>
          Load PEAK Files
          <input
            type="file"
            accept=".peak,.PEAK,.json"
            multiple
            style={{ display: 'none' }}
            onChange={onImportPeak}
          />
        </label>
        <button className={`btn ${audioCount > 0 ? '' : 'primary blink'}`} onClick={onLoadSounds}>Load Sounds</button>
        {audioCount > 0 && <span className="text-secondary" style={{ fontSize: '0.75rem' }}>{audioCount.toLocaleString()} linked</span>}
      </div>
    </header>
  );
}
