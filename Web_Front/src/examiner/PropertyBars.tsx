import { useMemo } from 'react';

// The six properties shown as horizontal bars, each scaled to that feature's
// real min/max across the dataset (so small values aren't invisible slivers).
export const BAR_PROPS = ['pitch_hz', 'length_seconds', 'complexity', 'spectral_centroid_hz', 'harmonicity', 'attack_seconds'];

interface Props {
  item: any;
  analysisResult: any[];
}

export default function PropertyBars({ item, analysisResult }: Props) {
  const ranges = useMemo(() => {
    const r: Record<string, { min: number; max: number }> = {};
    for (const p of BAR_PROPS) {
      let mn = Infinity, mx = -Infinity;
      for (const it of analysisResult) {
        const v = Number(it[p]);
        if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
      }
      r[p] = { min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 1 : mx };
    }
    return r;
  }, [analysisResult]);

  if (!item) return null;

  // Sample rate for converting seconds → samples (attack & length).
  const sr = Number(item.sample_rate ?? item.samplerate) || 44100;

  return (
    <>
      {BAR_PROPS.map(prop => {
        const val = Number(item[prop]) || 0;
        const { min, max } = ranges[prop];
        const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
        // Attack & length are times — also show them in samples.
        const inSamples = (prop === 'attack_seconds' || prop === 'length_seconds')
          ? `${Math.round(val * sr).toLocaleString()} smp` : null;
        return (
          <div key={prop} style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              <span>{prop}</span>
              <span style={{ color: '#FCD34D' }}>{val.toFixed(2)}s{inSamples ? ` · ${inSamples}` : ''}</span>
            </div>
            <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#10B981' }} />
            </div>
          </div>
        );
      })}
    </>
  );
}
