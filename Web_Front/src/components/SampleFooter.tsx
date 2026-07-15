import { useState } from 'react';

// One footer shared by every tab: the selected sample's transport (download / copy-data /
// play-stop / dig / autoplay) and "push to" buttons that send the selected file to any other
// tab. Each tab supplies its own handlers; anything omitted simply doesn't render, so a tab
// only shows the controls it actually has. Layout is three groups: file actions (left),
// transport centred between flex spacers, push-to-tab (right). (The name / length / category
// readout lives in the header.)
export type FooterTab = 'extractor' | 'examiner' | 'stats' | 'cloud';

interface SampleFooterProps {
  item: any | null;
  playing?: boolean;
  digging?: boolean;
  autoPlay?: boolean;
  autoLoop?: boolean;
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
}

const TAB_LABEL: Record<FooterTab, string> = { extractor: '✂ Extract', examiner: '🔍 Examine', stats: '📊 2D', cloud: '🌐 3D' };

export default function SampleFooter({
  item, playing, digging, autoPlay, autoLoop, onDownload, onCopyData, onPlay, onDig, onToggleAutoPlay, onToggleAutoLoop, current, onPush,
}: SampleFooterProps) {
  const name = item?.metadata?.name || '';
  const btn: React.CSSProperties = { padding: '0.25rem 0.6rem', fontSize: '0.78rem' };
  // Play/Stop share a fixed width so the label swap doesn't nudge the neighbouring buttons.
  const playBtn: React.CSSProperties = { ...btn, minWidth: '4.75rem', textAlign: 'center' };
  // Same for Copy: sized for the wider "📋 Copy Peak Data" so the "✓ Copied" flash can't reflow.
  const copyBtn: React.CSSProperties = { ...btn, minWidth: '9.5rem', textAlign: 'center' };

  // Brief "✓ Copied" flash after a successful copy.
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await onCopyData?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
      padding: '0.4rem 0.75rem', borderTop: '1px solid var(--border-color)', background: '#0B0E14' }}>
      {/* File actions (left) */}
      {onDownload && <button className="btn secondary" style={btn} onClick={onDownload} disabled={!item} title="Download with rename options">⬇ Download</button>}
      {onCopyData && <button className="btn secondary" style={copyBtn} onClick={handleCopy} disabled={!item} title="Copy this sample's full .PEAK record to the clipboard">{copied ? '✓ Copied' : '📋 Copy Peak Data'}</button>}

      <div style={{ flex: 1 }} />

      {/* Transport (centred) */}
      {onPlay && <button className="btn secondary" style={playBtn} onClick={onPlay} disabled={!item}>{playing ? '■ Stop' : '▶ Play'}</button>}
      {onDig && <button className={`btn ${digging ? 'primary' : 'secondary'}`} style={digging ? { ...btn, background: '#ef4444' } : btn} onClick={onDig} disabled={!item}>{digging ? '■ DIG' : '⛏ DIG'}</button>}
      {onToggleAutoPlay && (
        <label className="btn secondary" style={{ ...btn, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input type="checkbox" checked={!!autoPlay} onChange={e => onToggleAutoPlay(e.target.checked)} /> auto-play
        </label>
      )}
      {onToggleAutoLoop && (
        <label className="btn secondary" style={{ ...btn, display: 'flex', alignItems: 'center', gap: '0.4rem' }} title="Repeat the selected sample while it plays">
          <input type="checkbox" checked={!!autoLoop} onChange={e => onToggleAutoLoop(e.target.checked)} /> auto-loop
        </label>
      )}

      <div style={{ flex: 1 }} />

      {/* Push to any other tab (right) */}
      {onPush && (Object.keys(TAB_LABEL) as FooterTab[]).map(t => (
        <button key={t} className="btn secondary" style={btn} disabled={!item || t === current}
          onClick={() => name && onPush(t, name)} title={t === current ? 'Current tab' : `Open this file in ${t}`}>
          {TAB_LABEL[t]}
        </button>
      ))}
    </div>
  );
}
