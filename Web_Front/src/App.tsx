import { useState, useEffect, Suspense } from 'react'
import initWasm, { analyze_audio_buffer } from 'wasm_analyzer'
import './index.css'
import SampleCloud from './SampleCloud'

function App() {
  const [isScanning, setIsScanning] = useState(false)
  const [wasmReady, setWasmReady] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<any>(null)

  useEffect(() => {
    // Initialize the WebAssembly module when the app loads
    initWasm().then(() => setWasmReady(true)).catch(console.error)
  }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !wasmReady) return
    
    // Read the file as raw bytes
    const arrayBuffer = await file.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Pass the bytes directly to the Rust WebAssembly module!
    const jsonResult = analyze_audio_buffer(uint8Array)
    setAnalysisResult(JSON.parse(jsonResult))
  }

  const handleScan = () => {
    setIsScanning(true)
    setTimeout(() => setIsScanning(false), 3000)
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header glass-panel">
        <h1>
          Scan<span className="accent-gradient">alyzer</span>
        </h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn">Settings</button>
          <label className="btn primary" style={{ cursor: 'pointer' }}>
            {wasmReady ? 'Upload .wav File' : 'Loading Engine...'}
            <input type="file" accept=".wav" style={{ display: 'none' }} onChange={handleFileUpload} />
          </label>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main">
        {/* Sidebar Controls */}
        <aside className="sidebar glass-panel">
          <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '0.5rem' }}>
            View Controls
          </h3>
          
          <div className="control-group">
            <label>Color Mapping</label>
            <select className="btn" style={{ width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.05)' }}>
              <option>God Category</option>
              <option>Instrument Family</option>
              <option>Timbre</option>
            </select>
          </div>

          <div className="control-group">
            <label>X-Axis</label>
            <select className="btn" style={{ width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.05)' }}>
              <option>Pitch (Hz)</option>
              <option>Spectral Centroid</option>
              <option>Length</option>
            </select>
          </div>
          
          <div className="control-group">
            <label>Y-Axis</label>
            <select className="btn" style={{ width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.05)' }}>
              <option>Envelope Shape</option>
              <option>Complexity</option>
            </select>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
            <p className="text-secondary" style={{ fontSize: '0.85rem', lineHeight: '1.5' }}>
              <strong>WASM Status:</strong> {wasmReady ? '🟢 Engine Online' : '🔴 Offline'}
            </p>
            {analysisResult && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
                <h4 style={{ color: 'var(--accent-secondary)', marginBottom: '0.5rem' }}>WASM DSP Result:</h4>
                <pre style={{ fontSize: '0.75rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(analysisResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </aside>

        {/* 3D WebGL Canvas Area */}
        <section className="main-view glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <Suspense fallback={<div style={{ color: 'white' }}>Loading 3D Engine...</div>}>
            <SampleCloud />
          </Suspense>
          
          {/* Overlay UI elements on top of the 3D canvas */}
          <div style={{ position: 'absolute', bottom: '2rem', right: '2rem', zIndex: 10 }}>
             <p className="text-secondary" style={{ background: 'rgba(0,0,0,0.5)', padding: '0.5rem 1rem', borderRadius: '8px', backdropFilter: 'blur(4px)' }}>
               Left Click: Orbit • Right Click: Pan • Scroll: Zoom
             </p>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
