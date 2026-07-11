
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, PieChart, Pie, Legend, BarChart, Bar, Tooltip } from 'recharts'

interface StatsTabProps {
  analysisResult: any[];
}

export default function StatsTab({ analysisResult }: StatsTabProps) {
  if (analysisResult.length === 0) {
      return (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-secondary)' }}>No data to graph. Scan a folder or load a .PEAK file.</div>
      )
  }

  // Calculate Group Distribution
  const groupCounts: { [key: string]: number } = {};
  const categoryCounts: { [key: string]: number } = {};
  
  analysisResult.forEach(item => {
      const g = item.group || 'Unknown';
      const c = item.god_category || 'Unknown';
      groupCounts[g] = (groupCounts[g] || 0) + 1;
      categoryCounts[c] = (categoryCounts[c] || 0) + 1;
  });

  const groupData = Object.keys(groupCounts).map(k => ({ name: k, value: groupCounts[k] })).sort((a,b) => b.value - a.value);
  const categoryData = Object.keys(categoryCounts).map(k => ({ name: k, value: categoryCounts[k] })).sort((a,b) => b.value - a.value);

  const COLORS = ['#F43F5E', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#6366F1'];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '1.5rem', height: '100%', width: '100%' }}>
      
      {/* Category Pie Chart */}
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '1rem', color: 'var(--accent-primary)' }}>God Categories</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={categoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value">
                {categoryData.map((_entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
      </div>

      {/* Group Bar Chart */}
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '1rem', color: 'var(--accent-secondary)' }}>Identified Groups</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={groupData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
              <XAxis type="number" stroke="var(--text-secondary)" />
              <YAxis type="category" dataKey="name" stroke="var(--text-secondary)" width={100} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
              <Bar dataKey="value" fill="var(--accent-secondary)">
                {groupData.map((_entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
      </div>

      {/* Pitch vs Centroid Scatter */}
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gridColumn: '1 / -1' }}>
          <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Pitch vs Spectral Centroid</h3>
          <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis type="number" dataKey="pitch_hz" name="Pitch" unit="Hz" stroke="var(--text-secondary)" domain={[0, 'dataMax']} />
                  <YAxis type="number" dataKey="spectral_centroid_hz" name="Centroid" unit="Hz" stroke="var(--text-secondary)" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
                  <Scatter name="Samples" data={analysisResult} fill="var(--accent-primary)">
                      {analysisResult.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={`hsl(${((entry.pitch_hz || 0) / 10) % 360}, 70%, 50%)`} />
                      ))}
                  </Scatter>
              </ScatterChart>
          </ResponsiveContainer>
      </div>

    </div>
  );
}
