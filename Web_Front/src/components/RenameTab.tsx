import { useState, useRef, useEffect, useMemo } from 'react';
import { buildScript, type RenamePlan, type ScriptKind, type Mode, type BitDepth } from '../renameScript';
import { TOKEN_LABELS, type Slot, getSavedSubfolders, getSavedPrepend, getSavedAppend, tokenValue, generateNewName } from '../renameConfig';
import ScopeBar from './ScopeBar';
import { taxonomyKeys } from '../groupColors';

interface RenameTabProps {
  analysisResult: any[];
  audioFiles: File[];
}

const PREVIEW_ROW_H = 26; // virtualized preview row height (px)

export default function RenameTab({ analysisResult, audioFiles }: RenameTabProps) {
  const [scopeGroup, setScopeGroup] = useState<string | null>(null);
  const [scopeSub, setScopeSub] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  useEffect(() => {
    setScopeGroup(null);
    setScopeSub(null);
    setFilterText('');
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    setDestRoot(`Renamed_Samples_${ts}`);
  }, [analysisResult]);

  const data = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return analysisResult.filter(it => {
      // The ScopeBar scopes by UCS category -> subcategory; match what it renders.
      const [role, g] = taxonomyKeys(it, 'UCS');
      if (scopeGroup && role !== scopeGroup) return false;
      if (scopeSub && g !== scopeSub) return false;
      if (q && !`${it.metadata?.name || ''} ${it.classification?.group || ''} ${it.classification?.subgroup || ''} ${it.classification?.timbre || ''} ${it.musicality?.root_note_name || ''} ${it.classification?.reason?.[0] || ''}`
        .toLowerCase().includes(q)) return false;
      return true;
    });
  }, [analysisResult, scopeGroup, scopeSub, filterText]);

  const [flatten, setFlatten] = useState(false);

  // Destination subfolders (ordered tokens)
  const [subfolders, setSubfolders] = useState<Slot[]>(getSavedSubfolders);
  const [prepend, setPrepend] = useState<Slot[]>(getSavedPrepend);
  const [append, setAppend] = useState<Slot[]>(getSavedAppend);

  useEffect(() => {
    localStorage.setItem('scanalyzer_rename_subfolders', JSON.stringify(subfolders));
    localStorage.setItem('scanalyzer_rename_prepend', JSON.stringify(prepend));
    localStorage.setItem('scanalyzer_rename_append', JSON.stringify(append));
  }, [subfolders, prepend, append]);

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

  const [destRoot, setDestRoot] = useState(() => {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return `Renamed_Samples_${ts}`;
  });
  const [mode, setMode] = useState<Mode>('copy');
  const [resample, setResample] = useState(false);
  const [sampleRate, setSampleRate] = useState(48000);
  const [bitDepth, setBitDepth] = useState<BitDepth>('keep');

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



  // Destination subfolder path for a record, from the enabled subfolder tokens.
  const folderFor = (item: any): string =>
    subfolders.filter(s => s.enabled)
      .map(s => tokenValue(item, s.key)).filter(Boolean).join('/');

  // Build the source→destination plan and download a rename script.
  const generate = (kind: ScriptKind) => {
    const plan: RenamePlan = data.map(item => {
      const src = item.metadata.path || item.metadata.name;
      const folder = folderFor(item);
      const dest = [destRoot, folder, generateNewName(item, prepend, append)].filter(Boolean).join('/');
      return { src, dest };
    });
    const { text, filename } = buildScript(plan, kind, mode, { enabled: resample, sampleRate, bitDepth });
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

      <div className="glass-panel" style={{ padding: '0.5rem 1rem' }}>
        <ScopeBar 
          analysisResult={analysisResult} group={scopeGroup} sub={scopeSub} setGroup={setScopeGroup} setSub={setScopeSub} 
          filterText={filterText} setFilterText={setFilterText}
          rightContent={
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              {data.length} / {analysisResult.length} files
              {audioFiles.length > 0 && ` · ${audioFiles.length} audio linked`}
            </span>
          }
        />
      </div>

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

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={resample} onChange={e => setResample(e.target.checked)} /> Resample on export
          </label>
          {resample && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Rate
                <select value={sampleRate} onChange={e => setSampleRate(Number(e.target.value))}
                  style={{ background: '#fff', color: '#000', border: '1px solid var(--border-color)', borderRadius: 0, padding: '0.15rem 0.3rem' }}>
                  {[22050, 44100, 48000, 88200, 96000, 192000].map(r => <option key={r} value={r}>{r} Hz</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Bit depth
                <select value={bitDepth} onChange={e => setBitDepth(e.target.value as BitDepth)}
                  style={{ background: '#fff', color: '#000', border: '1px solid var(--border-color)', borderRadius: 0, padding: '0.15rem 0.3rem' }}>
                  <option value="keep">Keep</option>
                  <option value="16">16-bit</option>
                  <option value="24">24-bit</option>
                  <option value="32f">32-bit float</option>
                </select>
              </label>
              <span className="text-secondary" style={{ fontSize: '0.72rem' }}>requires ffmpeg on PATH</span>
            </>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          {renderOrderedList('Destination subfolders (one level each)', subfolders, setSubfolders)}

          {renderOrderedList('Prepend to file name (top → first)', prepend, setPrepend)}
          {renderOrderedList('Append to file name (top → first)', append, setAppend)}
        </div>

        <div style={{ background: 'rgba(244, 144, 44, 0.1)', border: '1px solid var(--accent-primary)', padding: '0.6rem 0.75rem', fontSize: '0.82rem', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--accent-primary)' }}>⚠ Run these scripts at your own risk.</strong> The browser can't touch your
          local files, so the script must be run <strong>on your own machine</strong>. Test it on a <strong>small folder first</strong>.
          By default it <strong>copies</strong> files from their original location to the new location (creating the destination
          folders as needed) — your originals are left untouched unless you chose “Move”.
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="text-secondary" style={{ fontSize: '0.85rem' }}>Generate rename script:</span>
            <button className="btn primary" disabled={data.length === 0} onClick={() => generate('bash')} title="For macOS / Linux">Bash (.sh) — Mac</button>
            <button className="btn primary" disabled={data.length === 0} onClick={() => generate('powershell')} title="For Windows">PowerShell (.ps1) — Windows</button>
            <button className="btn primary" disabled={data.length === 0} onClick={() => generate('python')} title="Cross-platform — runs anywhere Python does">Python (.py) — anything</button>
          </div>
          <div className="text-secondary" style={{ fontSize: '0.9rem' }}>
            {data.length} files → {mode} into “{destRoot}”
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
                const total = data.length;
                const OVER = 12;
                const start = Math.max(0, Math.floor(scrollTop / PREVIEW_ROW_H) - OVER);
                const end = Math.min(total, Math.ceil((scrollTop + viewportH) / PREVIEW_ROW_H) + OVER);
                const cellS: React.CSSProperties = { padding: '0 0.5rem', height: PREVIEW_ROW_H, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
                return (
                  <>
                    {start > 0 && <tr style={{ height: start * PREVIEW_ROW_H }}><td colSpan={3} style={{ padding: 0 }} /></tr>}
                    {data.slice(start, end).map((item, i) => {
                      const folder = folderFor(item);
                      const name = generateNewName(item, prepend, append);
                      return (
                        <tr key={start + i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', height: PREVIEW_ROW_H }}>
                          <td style={{ ...cellS, color: 'var(--text-secondary)' }} title={item.metadata.path}>{item.metadata.path}</td>
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
