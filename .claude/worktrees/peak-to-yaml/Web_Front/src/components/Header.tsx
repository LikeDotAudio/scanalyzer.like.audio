import TipJar from './TipJar';
import { ucsColor, ucsSubColor } from '../groupColors';
import { categoryLabel, subcategoryLabel } from '../categoryEmoji';

interface HeaderProps {
  isAnalyzing: boolean;
  progress: number;
  /** Desktop: absolute root that relative .PEAK paths resolve against. */
  audioRoot?: string;
  onUnloadSounds?: () => void;
  audioCount: number;
  currentSound?: string;
  /** The full record for the current sound, so the header can show its length + UCS
   *  category / subcategory (with emojis) beneath the track name. */
  sample?: any;
  hasData: boolean;
  activeTab?: string;
}

export default function Header({ isAnalyzing, progress, onUnloadSounds, audioCount, currentSound, sample, hasData, activeTab }: HeaderProps) {
  const len = sample?.metadata?.length_seconds;
  const cat = sample?.ucs?.category || '';
  const sub = (sample?.ucs?.subcategory || '').trim();
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
            <>
              <span className="accent-gradient" style={{ fontSize: '1.5rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{currentSound}</span>
              {(Number.isFinite(len) || cat) && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.8rem', marginTop: '0.1rem', flexWrap: 'wrap' }}>
                  {Number.isFinite(len) && <span className="text-secondary">{len.toFixed(2)} s</span>}
                  {cat && <span style={{ color: ucsColor(cat) }} title={cat}>· {categoryLabel(cat)}</span>}
                  {sub && <span style={{ color: ucsSubColor(cat, sub) }} title={sub}>/ {subcategoryLabel(cat, sub)}</span>}
                </div>
              )}
            </>
          ) : hasData ? (
            <span className="text-secondary" style={{ fontSize: '0.9rem' }}>
              🟢 Online — select any sample to hear &amp; inspect it.
            </span>
          ) : null}
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
