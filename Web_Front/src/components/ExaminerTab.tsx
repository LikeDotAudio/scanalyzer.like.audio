import { useState, useRef, useEffect } from 'react';

interface ExaminerTabProps {
  analysisResult: any[];
  audioFiles: File[];
  setAudioFiles: (files: File[]) => void;
}

// In-place iterative radix-2 Cooley–Tukey FFT (length must be a power of two).
function fftRadix2(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = i + k + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] = re[a] + vr; im[a] = im[a] + vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// One-shot averaged spectral trace of the whole file, condensed onto a
// log-frequency grid (bin-max) and peak-normalized to dB. Mirrors the Python
// inspector's compute_spectrum. Returns { fx, fy } in Hz / dB, or null.
function computeSpectrum(mono: Float32Array, sr: number): { fx: number[]; fy: number[] } | null {
  const n = mono.length;
  if (n < 256 || sr <= 0) return null;
  let seg = 1;
  const cap = Math.min(n, 1 << 14);
  while (seg * 2 <= cap) seg *= 2;
  const half = seg >> 1;
  const window = new Float64Array(seg);
  for (let i = 0; i < seg; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (seg - 1));

  const maxSegments = 32;
  const count = Math.min(maxSegments, Math.max(1, Math.floor(n / seg)));
  const power = new Float64Array(half + 1);
  for (let s = 0; s < count; s++) {
    const start = count > 1 ? Math.round((s * (n - seg)) / (count - 1)) : 0;
    const re = new Float64Array(seg);
    const im = new Float64Array(seg);
    for (let i = 0; i < seg; i++) re[i] = mono[start + i] * window[i];
    fftRadix2(re, im);
    for (let k = 0; k <= half; k++) power[k] += re[k] * re[k] + im[k] * im[k];
  }

  let peak = 0;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    mag[k] = Math.sqrt(power[k] / count);
    if (mag[k] > peak) peak = mag[k];
  }
  const low = 20, high = sr / 2;
  if (peak <= 0 || high <= low) return null;
  const db = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) db[k] = 20 * Math.log10(Math.max(mag[k] / peak, 1e-6));

  // Bin-max onto a 360-band geometric (log) frequency grid.
  const bands = 360;
  const edges: number[] = [];
  for (let i = 0; i <= bands; i++) edges.push(low * Math.pow(high / low, i / bands));
  const idxFor = (f: number) => Math.min(half + 1, Math.max(0, Math.ceil((f * seg) / sr)));
  const fx: number[] = [], fy: number[] = [];
  for (let i = 0; i < bands; i++) {
    let a = idxFor(edges[i]);
    let b = idxFor(edges[i + 1]);
    if (a > half) break;
    b = Math.max(Math.min(b, half + 1), a + 1);
    let m = -Infinity;
    for (let k = a; k < b; k++) if (db[k] > m) m = db[k];
    fx.push(Math.sqrt(edges[i] * edges[i + 1]));
    fy.push(m);
  }
  return fx.length ? { fx, fy } : null;
}

export default function ExaminerTab({ analysisResult, audioFiles, setAudioFiles }: ExaminerTabProps) {
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationRef = useRef<number>(0);
  // Pre-rendered whole-file waveform (static) that the playhead is drawn over.
  const waveformImageRef = useRef<HTMLCanvasElement | null>(null);
  const durationRef = useRef<number>(0);

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

  // Render the whole-file waveform (amplitude over time) into an offscreen
  // canvas once per selected sample, with the ADSR envelope overlaid — same
  // idea as the Python inspector's _draw_waveform.
  const renderWaveformImage = (buffer: AudioBuffer, item: any) => {
    const visible = waveformCanvasRef.current;
    const w = Math.max(1, Math.floor(visible?.clientWidth || 800));
    const h = Math.max(1, Math.floor(visible?.clientHeight || 200));

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0B0E14';
    ctx.fillRect(0, 0, w, h);

    // Leave room for note-frequency labels (top) and time labels (bottom).
    const padTop = 24, padBottom = 16;
    const plotTop = padTop;
    const plotBottom = h - padBottom;
    const plotH = Math.max(1, plotBottom - plotTop);
    const mid = (plotTop + plotBottom) / 2;
    const half = plotH / 2;

    // Mix channels down to mono once (used by both the waveform and the FFT).
    const ch = buffer.numberOfChannels;
    const len = buffer.length;
    const chans: Float32Array[] = [];
    for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let c = 0; c < ch; c++) s += chans[c][i];
      mono[i] = s / ch;
    }
    const duration = buffer.duration;
    const sr = buffer.sampleRate;

    // Zero-crossing baseline.
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    // ---- Averaged FFT spectral trace + top note axis (drawn under the wave) ----
    const spec = computeSpectrum(mono, sr);
    if (spec) {
      const { fx, fy } = spec;
      const lf0 = Math.log(fx[0]);
      const lf1 = Math.log(fx[fx.length - 1]);
      const xFreq = (f: number) => ((Math.log(f) - lf0) / (lf1 - lf0)) * w;
      const yDb = (db: number) => plotBottom - Math.max(0, Math.min(1, (db + 90) / 90)) * plotH;

      // Filled trace.
      ctx.beginPath();
      ctx.moveTo(xFreq(fx[0]), plotBottom);
      for (let i = 0; i < fx.length; i++) ctx.lineTo(xFreq(fx[i]), yDb(fy[i]));
      ctx.lineTo(xFreq(fx[fx.length - 1]), plotBottom);
      ctx.closePath();
      ctx.fillStyle = 'rgba(77,208,225,0.15)';
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < fx.length; i++) {
        const X = xFreq(fx[i]), Y = yDb(fy[i]);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.strokeStyle = 'rgba(77,208,225,0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Top axis: A-octave note series (A4 = 440 Hz), note above / frequency below.
      const f0 = fx[0], f1 = fx[fx.length - 1];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = '9px sans-serif';
      for (let oct = 0; oct < 10; oct++) {
        const f = 27.5 * Math.pow(2, oct);
        if (f < f0 || f > f1) continue;
        const X = xFreq(f);
        if (oct % 2 === 0) {
          ctx.strokeStyle = 'rgba(211,211,211,0.10)';
          ctx.beginPath();
          ctx.moveTo(X, plotTop);
          ctx.lineTo(X, plotBottom);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(127,214,226,0.5)';
        ctx.beginPath();
        ctx.moveTo(X, plotTop);
        ctx.lineTo(X, plotTop - 4);
        ctx.stroke();
        const flabel = f >= 1000 ? `${+(f / 1000).toPrecision(3)}k` : `${Math.round(f)}`;
        ctx.fillStyle = '#7fd6e2';
        ctx.fillText(`A${oct}`, X, 2);
        ctx.fillStyle = 'rgba(127,214,226,0.7)';
        ctx.fillText(flabel, X, 12);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(127,214,226,0.8)';
      ctx.fillText('spectrum', w - 4, 2);
    }

    // ---- Waveform: min/max amplitude per pixel column ----
    const samplesPerCol = len / w;
    ctx.strokeStyle = '#C026D3';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const start = Math.floor(x * samplesPerCol);
      const end = Math.min(len, Math.floor((x + 1) * samplesPerCol));
      let min = 1.0;
      let max = -1.0;
      for (let i = start; i < end; i++) {
        const v = mono[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (min > max) { min = 0; max = 0; }
      ctx.moveTo(x + 0.5, mid - max * half * 0.95);
      ctx.lineTo(x + 0.5, mid - min * half * 0.95);
    }
    ctx.stroke();

    // ---- ADSR envelope overlay (white dashed line, matching the Python view) ----
    const att = Number(item?.envelope_attack_seconds ?? item?.attack_seconds ?? 0) || 0;
    const dec = Number(item?.envelope_decay_seconds ?? 0) || 0;
    const sus = Number(item?.envelope_sustain_level ?? 0) || 0;
    const rel = Number(item?.envelope_release_seconds ?? 0) || 0;
    if (duration > 0 && (att || dec || sus || rel)) {
      const t1 = Math.min(duration, att);
      const t2 = Math.min(duration, t1 + dec);
      const t3 = Math.max(t2, duration - rel);
      const pts: [number, number][] = [
        [0, 0], [t1, 1], [t2, sus], [t3, sus], [duration, 0],
      ];
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      pts.forEach(([t, v], i) => {
        const px = (t / duration) * w;
        const py = mid - v * half * 0.95;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      pts.forEach(([t, v]) => {
        const px = (t / duration) * w;
        const py = mid - v * half * 0.95;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // ---- Bottom axis: time in seconds ----
    if (duration > 0) {
      const nTicks = 6;
      ctx.font = '9px sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#888';
      for (let i = 0; i <= nTicks; i++) {
        const X = (i / nTicks) * w;
        const t = (i / nTicks) * duration;
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(X, plotBottom);
        ctx.lineTo(X, plotBottom + 4);
        ctx.stroke();
        ctx.textAlign = i === 0 ? 'left' : i === nTicks ? 'right' : 'center';
        ctx.fillText(`${t.toFixed(2)}s`, Math.max(2, Math.min(w - 2, X)), h - 2);
      }
    }

    waveformImageRef.current = off;
    durationRef.current = duration;
    // Paint it immediately so the waveform shows even before playback starts.
    drawWaveformFrame();
  };

  // Blit the cached waveform and draw the playhead for the current position.
  const drawWaveformFrame = () => {
    const canvas = waveformCanvasRef.current;
    const img = waveformImageRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = Math.max(1, Math.floor(canvas.clientWidth || 800));
    const h = Math.max(1, Math.floor(canvas.clientHeight || 120));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    ctx.fillStyle = '#0B0E14';
    ctx.fillRect(0, 0, w, h);
    if (img) ctx.drawImage(img, 0, 0, w, h);

    const dur = durationRef.current;
    const t = audioRef.current?.currentTime ?? 0;
    if (dur > 0) {
      const px = Math.min(w, (t / dur) * w);
      ctx.strokeStyle = '#FCD34D';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, 0);
      ctx.lineTo(px + 0.5, h);
      ctx.stroke();
    }
  };

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

      // Advance the whole-file waveform playhead in the same frame.
      drawWaveformFrame();
    };
    draw();
  };

  const handlePlay = async (item: any) => {
    setSelectedItem(item);

    const file = audioFiles.find(f => f.name === item.name || f.webkitRelativePath.endsWith(item.path));
    if (!file) {
        // No linked audio — clear the waveform so it doesn't show a stale sample.
        waveformImageRef.current = null;
        durationRef.current = 0;
        drawWaveformFrame();
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

        // Decode the whole file and render the static waveform preview.
        try {
            const buf = await file.arrayBuffer();
            const decoded = await audioContextRef.current.decodeAudioData(buf);
            renderWaveformImage(decoded, item);
        } catch {
            waveformImageRef.current = null;
            durationRef.current = 0;
            drawWaveformFrame();
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
      <div style={{ height: '400px', display: 'flex', background: '#0B0E14' }}>
          
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
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Waveform (amplitude · time) + FFT spectrum (note · frequency)</div>
                      <canvas ref={waveformCanvasRef} style={{ width: '100%', height: '210px', background: '#0B0E14', border: '1px solid rgba(255,255,255,0.1)', display: 'block' }} />
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: '0.3rem 0 0.2rem' }}>Live spectrum analyzer</div>
                      <canvas ref={canvasRef} style={{ width: '100%', height: '70px', background: '#0B0E14', border: '1px solid rgba(255,255,255,0.1)', display: 'block' }} />
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
