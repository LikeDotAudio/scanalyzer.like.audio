import TipJar from './TipJar';
import { isTauri } from '../audioLinking';

interface HeaderProps {
  isAnalyzing: boolean;
  progress: number;
  onLoadSounds: () => void;
  /** Desktop: absolute root that relative .PEAK paths resolve against. */
  audioRoot?: string;
  onUnloadSounds?: () => void;
  audioCount: number;
  currentSound?: string;
  hasData: boolean;
  activeTab?: string;
}

export default function Header({ isAnalyzing, progress, onLoadSounds, onUnloadSounds, audioCount, audioRoot, currentSound, hasData, activeTab }: HeaderProps) {
  // Desktop links one root folder; the browser links a list of File objects.
  const audioLinked = isTauri() ? !!audioRoot : audioCount > 0;
  return (
    <header className="app-header glass-panel" style={{ zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <a href="https://github.com/LikeDotAudio/scanalyzer.like.audio/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <img src="/logo.svg" alt="Scanalyzer logo" width={34} height={34} style={{ display: 'block' }} />
          <h1 className="accent-gradient" style={{ margin: 0 }}>
            SCANALYZER.Like.Audio
          </h1>
        </a>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.1rem' }}>
          <span className="text-secondary" style={{ fontSize: '0.7rem', lineHeight: 1.1 }}>Designed and Built by Anthony Peter Kuzub</span>
          <TipJar activeTab={activeTab} hasData={hasData} audioCount={audioCount} />
        </div>
      </div>

      {!isAnalyzing && (
        <div className="hide-on-mobile" style={{ flex: 1, minWidth: '250px', textAlign: 'center', overflow: 'hidden' }}>
          {currentSound ? (
            <span className="accent-gradient" style={{ fontSize: '1.5rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{currentSound}</span>
          ) : !hasData ? (
            <span className="text-secondary" style={{ fontSize: '0.9rem' }}>
              <strong style={{ color: 'var(--accent-primary)' }}>Step 1:</strong> Scan a folder in the <strong style={{ color: 'var(--accent-primary)' }}>Scanalize</strong> tab to bring in an analysis. →
            </span>
          ) : !audioLinked ? (
            <span className="text-secondary" style={{ fontSize: '0.9rem' }}>
              <strong style={{ color: 'var(--accent-primary)' }}>Step 2:</strong> Click <strong style={{ color: 'var(--accent-primary)' }}>{isTauri() ? 'Link Audio Folder' : 'Load Sounds'}</strong> to give the analyzer real-time access to your local files so you can hear them. →
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
        {/* Desktop: a .PEAK scanned in the browser holds relative paths, so the
            asset protocol needs an absolute root to join them onto. */}
        <button className={`btn ${audioLinked ? '' : 'primary blink'}`} onClick={onLoadSounds}>
          {isTauri() ? 'Link Audio Folder' : 'Load Sounds'}
        </button>
        {audioCount > 0 && (
          <button 
            className="btn" 
            style={{ background: 'gray', color: 'white', fontSize: '0.75rem' }} 
            onClick={onUnloadSounds}
          >
            Unlink and reset {audioCount.toLocaleString()} files
          </button>
        )}
      </div>
    </header>
  );
}
