import { useState } from 'react';
import { useIsNarrow } from '../useIsNarrow';

// One footer shared by every tab: the selected sample's transport (download / copy-data /
// play-stop / dig / autoplay) and "push to" buttons that send the selected file to any other
// tab. Each tab supplies its own handlers; anything omitted simply doesn't render, so a tab
// only shows the controls it actually has. Layout is three groups: file actions (left),
// transport centred between flex spacers, push-to-tab (right). (The name / length / category
// readout lives in the header.)
export type FooterTab = 'extractor' | 'examiner' | 'stats' | 'cloud' | 'favorites';

interface SampleFooterProps {
  item: any | null;
  playing?: boolean;
  digging?: boolean;
  autoPlay?: boolean;
  autoLoop?: boolean;
  // Is the selected sample a favorite? The ★ button reflects and toggles it — the
  // touch/mouse twin of the global F key.
  favorite?: boolean;
  onToggleFavorite?: () => void;
  onDownload?: () => void;
  onCopyData?: () => void | Promise<any>; // copy the selected record's full .PEAK data to the clipboard
  onPlay?: () => void;              // play / stop toggle
  onDig?: () => void;              // start / stop DIG
  onToggleAutoPlay?: (v: boolean) => void;
  onToggleAutoLoop?: (v: boolean) => void;
  // Push the selected file to another tab (pre-filtered to its name). The current tab's
  // own button is disabled.
  current: FooterTab;
  onPush?: (tab: FooterTab, name: string) => void;
  // Extra control rendered after Copy Peak Data — the Examiner's 🎚 Layers menu.
  layersMenu?: React.ReactNode;
  // DB status for the live web deployment
  dbStatus?: { online: boolean; records: number; checked: boolean } | null;
}

// Emoji, then full label. On mobile only the emoji shows so the whole row fits one line.
const TAB_LABEL: Record<FooterTab, { icon: string; text: string }> = {
  extractor: { icon: '✂', text: 'Extract' }, examiner: { icon: '🔍', text: 'Examine' },
  stats: { icon: '📊', text: '2D' }, cloud: { icon: '🌐', text: '3D' },
  favorites: { icon: '★', text: 'Favorites' },
};

export default function SampleFooter({
  item, playing, digging, autoPlay, autoLoop, favorite, onToggleFavorite, onDownload, onCopyData, onPlay, onDig, onToggleAutoPlay, onToggleAutoLoop, current, onPush, layersMenu, dbStatus,
}: SampleFooterProps) {
  const narrow = useIsNarrow();
  const name = item?.metadata?.name || '';
  // On mobile the buttons collapse to their emoji and pack tightly so all ten fit one row.
  const btn: React.CSSProperties = narrow
    ? { padding: '0.25rem 0.45rem', fontSize: '0.9rem' }
    : { padding: '0.25rem 0.6rem', fontSize: '0.78rem' };
  // Play/Stop share a fixed width so the label swap doesn't nudge the neighbouring buttons.
  const playBtn: React.CSSProperties = narrow ? btn : { ...btn, minWidth: '4.75rem', textAlign: 'center' };
  // Same for Copy: sized for the wider "📋 Copy Peak Data" so the "✓ Copied" flash can't reflow.
  const copyBtn: React.CSSProperties = narrow ? btn : { ...btn, minWidth: '9.5rem', textAlign: 'center' };
  // A label that drops to its emoji on mobile.
  const lbl = (icon: string, text: string) => (narrow ? icon : `${icon} ${text}`);

  // Brief "✓ Copied" flash after a successful copy.
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await onCopyData?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: narrow ? '0.3rem' : '0.5rem', flexWrap: narrow ? 'nowrap' : 'wrap',
      padding: narrow ? '0.4rem 0.5rem' : '0.4rem 0.75rem', borderTop: '1px solid var(--border-color)', background: '#0B0E14' }}>
      {/* File actions (left) */}
      {onDownload && <button className="btn secondary" style={btn} onClick={onDownload} disabled={!item} title="Download with rename options">{lbl('⬇', 'Download')}</button>}
      {onCopyData && <button className="btn secondary" style={copyBtn} onClick={handleCopy} disabled={!item} title="Copy this sample's full .PEAK record to the clipboard">{copied ? (narrow ? '✓' : '✓ Copied') : lbl('📋', 'Copy Peak Data')}</button>}
      {layersMenu}

      {!narrow && <div style={{ flex: 1 }} />}

      {/* Transport (centred) */}
      {onToggleFavorite && (
        <button className="btn secondary" style={{ ...btn, color: favorite ? 'var(--accent-primary)' : undefined, borderColor: favorite ? 'var(--accent-primary)' : undefined, fontWeight: favorite ? 700 : undefined }}
          onClick={onToggleFavorite} disabled={!item} title={favorite ? 'Un-favorite — F' : 'Favorite — F'}>
          {narrow ? (favorite ? '★' : '☆') : (favorite ? '★ Favorite' : '☆ Favorite')}
        </button>
      )}
      {onPlay && <button className="btn secondary" style={playBtn} onClick={onPlay} disabled={!item} title={playing ? 'Stop' : 'Play'}>{playing ? (narrow ? '■' : '■ Stop') : lbl('▶', 'Play')}</button>}
      {onDig && <button className={`btn ${digging ? 'primary' : 'secondary'}`} style={digging ? { ...btn, background: '#ef4444' } : btn} onClick={onDig} disabled={!item} title="DIG">{digging ? (narrow ? '■' : '■ DIG') : lbl('⛏', 'DIG')}</button>}
      {onToggleAutoPlay && (
        <label className="btn secondary" style={{ ...btn, display: 'flex', alignItems: 'center', gap: '0.4rem' }} title="Auto-play on select">
          <input type="checkbox" checked={!!autoPlay} onChange={e => onToggleAutoPlay(e.target.checked)} /> {narrow ? '▶' : 'auto-play'}
        </label>
      )}
      {onToggleAutoLoop && (
        <label className="btn secondary" style={{ ...btn, display: 'flex', alignItems: 'center', gap: '0.4rem' }} title="Repeat the selected sample while it plays">
          <input type="checkbox" checked={!!autoLoop} onChange={e => onToggleAutoLoop(e.target.checked)} /> {narrow ? '🔁' : 'auto-loop'}
        </label>
      )}

      {!narrow && <div style={{ flex: 1 }} />}

      {/* Push to any other tab (right) */}
      {onPush && (Object.keys(TAB_LABEL) as FooterTab[]).map(t => (
        <button key={t} className="btn secondary" style={btn} disabled={!item || t === current}
          onClick={() => name && onPush(t, name)} title={t === current ? 'Current tab' : `Open this file in ${t}`}>
          {narrow ? TAB_LABEL[t].icon : `${TAB_LABEL[t].icon} ${TAB_LABEL[t].text}`}
        </button>
      ))}

      {/* DB Status (Web only) */}
      {dbStatus?.checked && !narrow && (
        <div style={{ fontSize: '0.75rem', color: dbStatus.online ? 'var(--accent-primary)' : 'var(--accent-secondary)', paddingLeft: '0.5rem', marginLeft: '0.5rem', borderLeft: '1px solid var(--border-color)' }}>
          {dbStatus.online ? `🟢 ${dbStatus.records.toLocaleString()}` : '🔴 Offline'}
        </div>
      )}
    </div>
  );
}
