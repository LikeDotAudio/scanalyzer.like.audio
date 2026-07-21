// One footer shared by every tab: the selected sample's transport (download / play-stop /
// dig / autoplay) and "push to" buttons that send the selected file to any other tab. Each
// tab supplies its own handlers; anything omitted simply doesn't render, so a tab only shows
// the controls it actually has. (The name / length / category readout lives in the header.)
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

      {/* The selected-sample readout (name · length · category / subcategory) lives in the
          header now, below the track name — the footer is transport + push only. */}
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
