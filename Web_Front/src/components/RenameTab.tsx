import { useState } from 'react';

interface RenameTabProps {
  analysisResult: any[];
}

export default function RenameTab({ analysisResult }: RenameTabProps) {
  const [flatten, setFlatten] = useState(false);
  
  // Destination subfolders
  const [subfolders, setSubfolders] = useState<any>({
      godCategory: true,
      group: true,
      subgroup: true,
      timbre: false,
      instrumentFamily: false,
      distortion: false,
      envelopeShape: false,
      lengthTier: false,
      cluster: false
  });

  // Prepend
  const [prepend, setPrepend] = useState<any>({
      folderPath: false,
      godCategory: true,
      group: true,
      subgroup: true,
      timbre: true,
      instrumentFamily: false
  });

  // Append
  const [append, setAppend] = useState<any>({
      rootNote: true,
      bpm: true,
      lengthTier: false,
      envelopeShape: true,
      distortion: false,
      cluster: false
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', padding: '1rem', gap: '1rem', overflow: 'hidden' }}>
        
        {/* Top Controls */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button className="btn secondary">Pick Directory...</button>
                <span className="text-secondary">/home/user/Music Samples</span>
                
                <label style={{ marginLeft: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={flatten} onChange={e => setFlatten(e.target.checked)} />
                    Flatten into the picked folder (move files up)
                </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button className="btn secondary">Destination...</button>
                <span className="text-secondary" style={{ color: 'var(--accent-primary)' }}>COPY into destination (keep originals)</span>
                <span className="text-secondary">/home/user/Renamed Samples</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2rem', marginTop: '1rem' }}>
                {/* Subfolders */}
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>Destination subfolders (one level each)</h4>
                    {Object.entries(subfolders).map(([key, val]) => (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={val as boolean} onChange={e => setSubfolders({...subfolders, [key]: e.target.checked})} />
                            {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        </label>
                    ))}
                </div>

                {/* Prepend */}
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>Prepend to file name</h4>
                    {Object.entries(prepend).map(([key, val]) => (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={val as boolean} onChange={e => setPrepend({...prepend, [key]: e.target.checked})} />
                            {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        </label>
                    ))}
                </div>

                {/* Append */}
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>Append to file name</h4>
                    {Object.entries(append).map(([key, val]) => (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={val as boolean} onChange={e => setAppend({...append, [key]: e.target.checked})} />
                            {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        </label>
                    ))}
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="btn primary" disabled={analysisResult.length === 0}>Apply Rename & Convert</button>
                <div className="text-secondary" style={{ fontSize: '0.9rem' }}>
                    {analysisResult.length} files to rename
                </div>
            </div>
        </div>

        {/* Preview Table */}
        <div className="glass-panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#1A1D24', zIndex: 1 }}>
                        <tr>
                            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Old Path</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>New Folder</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>God Category</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Group</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Subgroup</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Timbre</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Original Name</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>ROOT note</th>
                        </tr>
                    </thead>
                    <tbody>
                        {analysisResult.slice(0, 50).map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>{item.path}</td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>{item.god_category}/{item.group}</td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>{item.god_category}</td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>{item.group}</td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>{item.subgroup}</td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>{item.timbre}</td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>{item.name}</td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>{item.root_note_name || 'N/A'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>

    </div>
  );
}
