import { useState, useRef, useEffect } from 'react';

interface ExaminerTabProps {
  analysisResult: any[];
  audioFiles: File[];
  setAudioFiles: (files: File[]) => void;
}

export default function ExaminerTab({ analysisResult, audioFiles, setAudioFiles }: ExaminerTabProps) {
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationRef = useRef<number>(0);

  // Cleanup audio context on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const drawVisualizer = () => {
    if (!analyserRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#1A1D24';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = `hsl(${280 + (i / bufferLength) * 60}, 80%, 60%)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  };

  const handlePlay = async (item: any) => {
    setSelectedItem(item);
    
    const file = audioFiles.find(f => f.name === item.name || f.webkitRelativePath.endsWith(item.path));
    if (!file) {
        // If they just want to view stats without playing
        return;
    }

    if (audioRef.current) {
        audioRef.current.src = URL.createObjectURL(file);
        audioRef.current.play();

        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 512;
            sourceRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
            sourceRef.current.connect(analyserRef.current);
            analyserRef.current.connect(audioContextRef.current.destination);
            drawVisualizer();
        }
        
        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }
    }
  };

  const handleLinkFolder = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
          setAudioFiles(Array.from(e.target.files));
      }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      
      {/* Top Half: Data Table */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', background: '#111318' }}>
              <button className="btn secondary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}>Open .PEAK...</button>
              <input type="text" placeholder="Filter:" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px' }} />
              <div style={{ flex: 1 }} />
              <label className="btn primary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', cursor: 'pointer' }}>
                  Link Audio Folder
                  <input type="file" webkitdirectory="true" directory="true" style={{ display: 'none' }} onChange={handleLinkFolder} />
              </label>
              <div className="text-secondary" style={{ fontSize: '0.8rem' }}>{analysisResult.length} shown</div>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#1A1D24', zIndex: 1 }}>
                      <tr>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>File</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Group</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Reason</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Timbre</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Clust</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Root</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Pitch</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Len</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Tr</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Cntrd</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Harm</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>BPM</th>
                      </tr>
                  </thead>
                  <tbody>
                      {analysisResult.slice(0, 100).map((item, idx) => {
                          const isSelected = selectedItem === item;
                          return (
                              <tr key={idx} 
                                  onClick={() => handlePlay(item)}
                                  style={{ 
                                      cursor: 'pointer',
                                      background: isSelected ? 'rgba(59, 130, 246, 0.2)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'),
                                      borderBottom: '1px solid rgba(255,255,255,0.05)'
                                  }}>
                                  <td style={{ padding: '0.3rem 0.5rem', color: isSelected ? 'white' : 'var(--accent-secondary)' }}>{item.name}</td>
                                  <td style={{ padding: '0.3rem 0.5rem', color: 'var(--accent-primary)' }}>{item.group}</td>
                                  <td style={{ padding: '0.3rem 0.5rem', color: 'var(--text-secondary)' }}>{item.reason?.[0] || ''}</td>
                                  <td style={{ padding: '0.3rem 0.5rem' }}>{item.timbre}</td>
                                  <td style={{ padding: '0.3rem 0.5rem', color: '#10B981' }}>{item.cluster !== -1 ? item.cluster : ''}</td>
                                  <td style={{ padding: '0.3rem 0.5rem', color: '#8B5CF6' }}>{item.root_note_name}</td>
                                  <td style={{ padding: '0.3rem 0.5rem' }}>{item.pitch_hz ? Math.round(item.pitch_hz) : 0}</td>
                                  <td style={{ padding: '0.3rem 0.5rem' }}>{item.length_seconds?.toFixed(2)}</td>
                                  <td style={{ padding: '0.3rem 0.5rem', color: '#F59E0B' }}>{item.transient_count}</td>
                                  <td style={{ padding: '0.3rem 0.5rem' }}>{item.spectral_centroid_hz ? Math.round(item.spectral_centroid_hz) : 0}</td>
                                  <td style={{ padding: '0.3rem 0.5rem' }}>{item.harmonicity?.toFixed(2)}</td>
                                  <td style={{ padding: '0.3rem 0.5rem' }}>{item.beats_per_minute || 0}</td>
                              </tr>
                          );
                      })}
                  </tbody>
              </table>
          </div>
      </div>

      {/* Bottom Half: Details, Bar Chart, Waveform */}
      <div style={{ height: '350px', display: 'flex', background: '#0B0E14' }}>
          
          {/* Bottom Left: Field/Value Table */}
          <div style={{ width: '300px', borderRight: '1px solid var(--border-color)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#1A1D24' }}>
                      <tr>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Field</th>
                          <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>Value</th>
                      </tr>
                  </thead>
                  <tbody>
                      {selectedItem ? Object.entries(selectedItem).map(([k, v]: [string, any]) => {
                          if (Array.isArray(v)) v = v.join(', ');
                          if (typeof v === 'number') v = v.toFixed(2);
                          return (
                              <tr key={k} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                  <td style={{ padding: '0.3rem 0.5rem', color: '#3B82F6' }}>{k}</td>
                                  <td style={{ padding: '0.3rem 0.5rem', color: '#FCD34D' }}>{v?.toString()}</td>
                              </tr>
                          );
                      }) : (
                          <tr><td colSpan={2} style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Select a sample</td></tr>
                      )}
                  </tbody>
              </table>
          </div>

          {/* Bottom Middle: Horizontal Bar Chart properties */}
          <div style={{ width: '250px', borderRight: '1px solid var(--border-color)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
              {selectedItem ? (
                  ['pitch_hz', 'length_seconds', 'complexity', 'spectral_centroid_hz', 'harmonicity', 'attack_seconds'].map(prop => (
                      <div key={prop} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'right' }}>{prop}</div>
                          <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)' }}>
                              <div style={{ width: `${Math.min(100, (selectedItem[prop] || 0) / 100)}%`, height: '100%', background: '#10B981' }} />
                          </div>
                      </div>
                  ))
              ) : null}
          </div>

          {/* Bottom Right: Waveform and FFT */}
          <div style={{ flex: 1, position: 'relative', background: '#1A1D24', padding: '1rem' }}>
              {selectedItem ? (
                  <>
                      <div style={{ color: '#FCD34D', fontSize: '0.9rem', marginBottom: '0.5rem' }}>{selectedItem.name}</div>
                      <canvas ref={canvasRef} style={{ width: '100%', height: '220px', background: '#0B0E14', border: '1px solid rgba(255,255,255,0.1)' }} />
                      <audio ref={audioRef} style={{ display: 'none' }} />
                      <div style={{ position: 'absolute', bottom: '1.5rem', right: '1.5rem', display: 'flex', gap: '0.5rem' }}>
                          <button className="btn secondary" onClick={() => audioRef.current?.play()}>▶ Play</button>
                          <label className="btn secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <input type="checkbox" defaultChecked /> auto-play
                          </label>
                      </div>
                  </>
              ) : (
                  <div style={{ display: 'flex', height: '100%', justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)' }}>
                      No sample selected
                  </div>
              )}
          </div>

      </div>
    </div>
  );
}
