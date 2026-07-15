import { ucsColor, ucsSubColor } from '../groupColors';
import { categoryLabel } from '../categoryEmoji';

// One footer shared by every tab: the selected sample's transport (download / play-stop /
// dig / autoplay), its length + UCS category + subcategory, and "push to" buttons that
// send the selected file to any other tab. Each tab supplies its own handlers; anything
// omitted simply doesn't render, so a tab only shows the controls it actually has.
export type FooterTab = 'extractor' | 'examiner' | 'stats' | 'cloud';

interface SampleFooterProps {
  item: any | null;
  playing?: boolean;
  digging?: boolean;
  autoPlay?: boolean;
  onDownload?: () => void;
  onPlay?: () => void;              // play / stop toggle
  onDig?: () => void;              // start / stop DIG
  onToggleAutoPlay?: (v: boolean) => void;
  // Push the selected file to another tab (pre-filtered to its name). The current tab's
  // own button is disabled.
  current: FooterTab;
  onPush?: (tab: FooterTab, name: string) => void;
}

const TAB_LABEL: Record<FooterTab, string> = { extractor: '✂ Extract', examiner: '🔍 Examine', stats: '📊 2D', cloud: '🌐 3D' };

export default function SampleFooter({
  item, playing, digging, autoPlay, onDownload, onPlay, onDig, onToggleAutoPlay, current, onPush,
}: SampleFooterProps) {
  const name = item?.metadata?.name || '';
  const len = item?.metadata?.length_seconds;
  const cat = item?.ucs?.category || '';
  const sub = (item?.ucs?.subcategory || '').trim();
  const btn: React.CSSProperties = { padding: '0.25rem 0.6rem', fontSize: '0.78rem' };

  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
      padding: '0.4rem 0.75rem', borderTop: '1px solid var(--border-color)', background: '#0B0E14' }}>
      {/* Transport */}
      {onDownload && <button className="btn secondary" style={btn} onClick={onDownload} disabled={!item} title="Download with rename options">⬇ Download</button>}
      {onPlay && <button className="btn secondary" style={btn} onClick={onPlay} disabled={!item}>{playing ? '■ Stop' : '▶ Play'}</button>}
      {onDig && <button className={`btn ${digging ? 'primary' : 'secondary'}`} style={digging ? { ...btn, background: '#ef4444' } : btn} onClick={onDig} disabled={!item}>{digging ? '■ DIG' : '⛏ DIG'}</button>}
      {onToggleAutoPlay && (
        <label className="btn secondary" style={{ ...btn, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={!!autoPlay} onChange={e => onToggleAutoPlay(e.target.checked)} /> auto-play
        </label>
      )}

      {/* Selected-sample readout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, marginLeft: '0.25rem', fontSize: '0.78rem' }}>
        <span style={{ color: 'var(--accent-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }} title={name}>{name || '—'}</span>
        {Number.isFinite(len) && <span className="text-secondary">· {len.toFixed(2)} s</span>}
        {cat && <span style={{ color: ucsColor(cat) }} title={cat}>· {categoryLabel(cat)}</span>}
        {sub && <span style={{ color: ucsSubColor(cat, sub) }}>/ {sub}</span>}
      </div>

      <div style={{ flex: 1 }} />

      {/* Push to any other tab */}
      {onPush && (Object.keys(TAB_LABEL) as FooterTab[]).map(t => (
        <button key={t} className="btn secondary" style={btn} disabled={!item || t === current}
          onClick={() => name && onPush(t, name)} title={t === current ? 'Current tab' : `Open this file in ${t}`}>
          {TAB_LABEL[t]}
        </button>
      ))}
    </div>
  );
}
