import { useState, useRef, useEffect } from 'react';
import { buildScript, type RenamePlan, type ScriptKind, type Mode } from '../renameScript';

interface RenameTabProps {
  analysisResult: any[];
}

const PREVIEW_ROW_H = 26; // virtualized preview row height (px)

// The complete set of rename variables. Every one is available in BOTH the
// prepend and append lists — the two lists are just different orderings of the
// same category set.
type TokenKey =
  | 'folderPath' | 'godCategory' | 'group' | 'subgroup' | 'timbre'
  | 'instrumentFamily' | 'rootNote' | 'bpm' | 'lengthTier' | 'envelopeShape'
  | 'distortion' | 'cluster' | 'pitch' | 'brightness' | 'harmonicity';

const TOKEN_LABELS: Record<TokenKey, string> = {
  folderPath: 'Folder Path',
  godCategory: 'God Category',
  group: 'Group',
  subgroup: 'Subgroup',
  timbre: 'Timbre',
  instrumentFamily: 'Instrument Family',
  rootNote: 'Root Note',
  bpm: 'BPM',
  lengthTier: 'Length Tier',
  envelopeShape: 'Envelope Shape',
  distortion: 'Distortion',
  cluster: 'Cluster',
  pitch: 'Pitch',
  brightness: 'Brightness',
  harmonicity: 'Harmonicity',
};

const ALL_TOKENS = Object.keys(TOKEN_LABELS) as TokenKey[];

// How each token reads a value off an analyzed record (empty → skipped in name).
function tokenValue(item: any, key: TokenKey): string {
  switch (key) {
    case 'folderPath': {
      const p = String(item.path || '');
      const parts = p.split('/').filter(Boolean);
      return parts.length > 1 ? parts.slice(0, -1).join('-') : (parts[0] || '');
    }
    case 'godCategory': return item.god_category || '';
    case 'group': return item.group || '';
    case 'subgroup': return item.subgroup || '';
    case 'timbre': return item.timbre || '';
    case 'instrumentFamily': return item.instrument_family || '';
    case 'rootNote': return item.root_note_name || '';
    case 'bpm': return item.beats_per_minute ? `${item.beats_per_minute}BPM` : '';
    case 'lengthTier': return item.length_tier || '';
    case 'envelopeShape': return item.envelope_shape || '';
    case 'distortion': return item.distortion || '';
    case 'cluster': return item.cluster != null && item.cluster !== -1 ? `C${item.cluster}` : '';
    case 'pitch': return item.pitch_hz ? `${Math.round(item.pitch_hz)}Hz` : '';
    case 'brightness': return item.spectral_centroid_hz ? `${Math.round(item.spectral_centroid_hz)}Hz` : '';
    case 'harmonicity': return item.harmonicity != null ? item.harmonicity.toFixed(2) : '';
    default: return '';
  }
}

interface Slot { key: TokenKey; enabled: boolean; }

// Build a default ordered slot list with a chosen subset enabled.
function buildSlots(enabledDefaults: TokenKey[], order: TokenKey[]): Slot[] {
  const seen = new Set(order);
  const full = [...order, ...ALL_TOKENS.filter(k => !seen.has(k))];
  return full.map(key => ({ key, enabled: enabledDefaults.includes(key) }));
}

export default function RenameTab({ analysisResult }: RenameTabProps) {
  const [flatten, setFlatten] = useState(false);

  // Destination subfolders (unchanged behaviour).
  const [subfolders, setSubfolders] = useState<Record<string, boolean>>({
    godCategory: true, group: true, subgroup: true, timbre: false,
    instrumentFamily: false, distortion: false, envelopeShape: false,
    lengthTier: false, cluster: false,
  });

  const [prepend, setPrepend] = useState<Slot[]>(
    buildSlots(['godCategory', 'group', 'subgroup', 'timbre'],
      ['folderPath', 'godCategory', 'group', 'subgroup', 'timbre', 'instrumentFamily']));

  const [append, setAppend] = useState<Slot[]>(
    buildSlots(['rootNote', 'bpm', 'envelopeShape'],
      ['rootNote', 'bpm', 'lengthTier', 'envelopeShape', 'distortion', 'cluster']));

  const move = (setter: React.Dispatch<React.SetStateAction<Slot[]>>, idx: number, dir: -1 | 1) => {
    setter(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const toggle = (setter: React.Dispatch<React.SetStateAction<Slot[]>>, idx: number) => {
    setter(prev => prev.map((s, i) => i === idx ? { ...s, enabled: !s.enabled } : s));
  };

  const [destRoot, setDestRoot] = useState('Renamed Samples');
  const [mode, setMode] = useState<Mode>('copy');

  // Virtualized preview scroll state.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compose the new base name for a record from the ordered enabled tokens.
  const newNameFor = (item: any): string => {
    const base = String(item.name || '').replace(/\.[^.]+$/, '');
    const ext = (String(item.name || '').match(/\.[^.]+$/) || [''])[0];
    const pre = prepend.filter(s => s.enabled).map(s => tokenValue(item, s.key)).filter(Boolean);
    const post = append.filter(s => s.enabled).map(s => tokenValue(item, s.key)).filter(Boolean);
    return [...pre, base, ...post].join('_') + ext;
  };

  // Destination subfolder path for a record, from the enabled subfolder tokens.
  const folderFor = (item: any): string =>
    Object.entries(subfolders).filter(([, v]) => v)
      .map(([k]) => tokenValue(item, k as TokenKey)).filter(Boolean).join('/');

  // Build the source→destination plan and download a rename script.
  const generate = (kind: ScriptKind) => {
    const plan: RenamePlan = analysisResult.map(item => {
      const src = item.path || item.name;
      const folder = folderFor(item);
      const dest = [destRoot, folder, newNameFor(item)].filter(Boolean).join('/');
      return { src, dest };
    });
    const { text, filename } = buildScript(plan, kind, mode);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const boxStyle: React.CSSProperties = {
    background: 'rgba(0,0,0,0.25)', padding: '0.5rem', border: '1px solid var(--border-color)',
  };
  const rowBtn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)', color: '#fff',
    cursor: 'pointer', width: '20px', height: '20px', lineHeight: '1', fontSize: '0.7rem', padding: 0,
  };

  const renderOrderedList = (
    title: string,
    slots: Slot[],
    setter: React.Dispatch<React.SetStateAction<Slot[]>>,
  ) => (
    <div style={boxStyle}>
      <h4 style={{ marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.35rem', fontSize: '0.85rem' }}>{title}</h4>
      {slots.map((slot, idx) => (
        <div key={slot.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '2px', fontSize: '0.85rem', opacity: slot.enabled ? 1 : 0.5 }}>
          <button style={{ ...rowBtn, opacity: idx === 0 ? 0.3 : 1 }} onClick={() => move(setter, idx, -1)} disabled={idx === 0} title="Move up">▲</button>
          <button style={{ ...rowBtn, opacity: idx === slots.length - 1 ? 0.3 : 1 }} onClick={() => move(setter, idx, 1)} disabled={idx === slots.length - 1} title="Move down">▼</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', flex: 1 }}>
            <input type="checkbox" checked={slot.enabled} onChange={() => toggle(setter, idx)} />
            {TOKEN_LABELS[slot.key]}
          </label>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', padding: '0.5rem', gap: '0.5rem', overflow: 'hidden' }}>

      {/* Top Controls */}
      <div className="glass-panel" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <button className="btn secondary">Pick Directory...</button>
          <span className="text-secondary">/home/user/Music Samples</span>
          <label style={{ marginLeft: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={flatten} onChange={e => setFlatten(e.target.checked)} />
            Flatten into the picked folder (move files up)
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span className="text-secondary">Destination folder:</span>
          <input type="text" value={destRoot} onChange={e => setDestRoot(e.target.value)}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: 'white', padding: '0.2rem 0.5rem', minWidth: '220px' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="radio" checked={mode === 'copy'} onChange={() => setMode('copy')} /> Copy (keep originals)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="radio" checked={mode === 'move'} onChange={() => setMode('move')} /> Move
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          {/* Subfolders */}
          <div style={boxStyle}>
            <h4 style={{ marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.35rem', fontSize: '0.85rem' }}>Destination subfolders (one level each)</h4>
            {Object.entries(subfolders).map(([key, val]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '2px', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={val} onChange={e => setSubfolders({ ...subfolders, [key]: e.target.checked })} />
                {TOKEN_LABELS[key as TokenKey] || key}
              </label>
            ))}
          </div>

          {renderOrderedList('Prepend to file name (top → first)', prepend, setPrepend)}
          {renderOrderedList('Append to file name (top → first)', append, setAppend)}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="text-secondary" style={{ fontSize: '0.85rem' }}>Generate rename script:</span>
            <button className="btn primary" disabled={analysisResult.length === 0} onClick={() => generate('bash')}>Bash (.sh)</button>
            <button className="btn primary" disabled={analysisResult.length === 0} onClick={() => generate('powershell')}>PowerShell (.ps1)</button>
            <button className="btn primary" disabled={analysisResult.length === 0} onClick={() => generate('python')}>Python (.py)</button>
          </div>
          <div className="text-secondary" style={{ fontSize: '0.9rem' }}>
            {analysisResult.length} files → {mode} into “{destRoot}”
          </div>
        </div>
      </div>

      {/* Preview Table (virtualized) */}
      <div className="glass-panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div ref={scrollRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '32%' }} /><col style={{ width: '25%' }} /><col style={{ width: '43%' }} /></colgroup>
            <thead style={{ position: 'sticky', top: 0, background: '#1A1D24', zIndex: 1 }}>
              <tr>
                <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Old Path</th>
                <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>New Folder</th>
                <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>New File Name</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const total = analysisResult.length;
                const OVER = 12;
                const start = Math.max(0, Math.floor(scrollTop / PREVIEW_ROW_H) - OVER);
                const end = Math.min(total, Math.ceil((scrollTop + viewportH) / PREVIEW_ROW_H) + OVER);
                const cellS: React.CSSProperties = { padding: '0 0.5rem', height: PREVIEW_ROW_H, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
                return (
                  <>
                    {start > 0 && <tr style={{ height: start * PREVIEW_ROW_H }}><td colSpan={3} style={{ padding: 0 }} /></tr>}
                    {analysisResult.slice(start, end).map((item, i) => {
                      const folder = folderFor(item);
                      const name = newNameFor(item);
                      return (
                        <tr key={start + i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', height: PREVIEW_ROW_H }}>
                          <td style={{ ...cellS, color: 'var(--text-secondary)' }} title={item.path}>{item.path}</td>
                          <td style={{ ...cellS, color: 'var(--accent-primary)' }} title={folder}>{folder || '—'}</td>
                          <td style={{ ...cellS, color: '#FCD34D' }} title={name}>{name}</td>
                        </tr>
                      );
                    })}
                    {end < total && <tr style={{ height: (total - end) * PREVIEW_ROW_H }}><td colSpan={3} style={{ padding: 0 }} /></tr>}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
