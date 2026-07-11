import React, { Suspense } from 'react';
import SampleCloud from '../SampleCloud';

interface CloudTabProps {
  analysisResult: any[];
}

export default function CloudTab({ analysisResult }: CloudTabProps) {
  return (
    <div style={{ display: 'flex', flex: 1, width: '100%', height: '100%' }}>
        {/* Sidebar Controls */}
        <aside className="sidebar glass-panel" style={{ width: '300px', margin: '1rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto' }}>
          <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>Cloud Controls</h3>
          
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
            <label>Y-Axis (Depth)</label>
            <select className="btn" style={{ width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.05)' }}>
              <option>Name Group</option>
              <option>Category</option>
            </select>
          </div>

          <div className="control-group">
            <label>Z-Axis</label>
            <select className="btn" style={{ width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.05)' }}>
              <option>Complexity / Timbre</option>
              <option>Transient Count</option>
            </select>
          </div>
        </aside>

        {/* 3D WebGL Canvas Area */}
        <section className="main-view glass-panel" style={{ margin: '1rem 1rem 1rem 0', padding: 0, overflow: 'hidden', flex: 1, position: 'relative' }}>
          <Suspense fallback={<div style={{ color: 'white', padding: '2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>Initializing 3D Engine...</div>}>
            <SampleCloud data={analysisResult} />
          </Suspense>
          
          {/* Overlay UI elements on top of the 3D canvas */}
          <div style={{ position: 'absolute', bottom: '1.5rem', right: '1.5rem', zIndex: 10 }}>
             <p className="text-secondary" style={{ background: 'rgba(0,0,0,0.6)', padding: '0.75rem 1.25rem', borderRadius: '8px', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)' }}>
               🖱️ Left Click: Orbit • Right Click: Pan • Scroll: Zoom
             </p>
          </div>
        </section>
    </div>
  );
}
