import { useState } from 'react'
import './index.css'

function App() {
  const [isScanning, setIsScanning] = useState(false)

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
          <button className="btn primary" onClick={handleScan}>
            {isScanning ? 'Scanning...' : 'Start Scan'}
          </button>
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
              <strong>Status:</strong> Waiting for connection to Rust server...
            </p>
          </div>
        </aside>

        {/* 3D WebGL Canvas Area */}
        <section className="main-view glass-panel">
          <div className="cloud-placeholder">
            <div className="cloud-dot"></div>
            <h2 className="text-gradient">WebGL Engine Initializing</h2>
            <p className="text-secondary" style={{ textAlign: 'center', maxWidth: '400px' }}>
              The 3D interactive cloud will render here, powered by Three.js and hardware acceleration.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
