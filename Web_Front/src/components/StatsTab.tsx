import React from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts'

interface StatsTabProps {
  analysisResult: any[];
}

export default function StatsTab({ analysisResult }: StatsTabProps) {
  return (
    <div style={{ height: '500px', width: '100%', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
      {analysisResult.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis type="number" dataKey="pitch_hz" name="Pitch" unit="Hz" stroke="var(--text-secondary)" tick={{fill: 'var(--text-secondary)'}} />
                  <YAxis type="number" dataKey="complexity" name="Complexity" stroke="var(--text-secondary)" tick={{fill: 'var(--text-secondary)'}} />
                  <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
                  <Scatter name="Samples" data={analysisResult} fill="var(--accent-primary)">
                      {analysisResult.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={`hsl(${((entry.pitch_hz || 0) / 10) % 360}, 70%, 50%)`} />
                      ))}
                  </Scatter>
              </ScatterChart>
          </ResponsiveContainer>
      ) : (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-secondary)' }}>No data to graph</div>
      )}
    </div>
  );
}
