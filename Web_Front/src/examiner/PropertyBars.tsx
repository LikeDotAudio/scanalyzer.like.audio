import { useMemo, useState } from 'react';

// The six properties shown as horizontal bars, each scaled to that feature's
// real min/max across the dataset (so small values aren't invisible slivers).
export const BAR_PROPS = ['pitch_hz', 'length_seconds', 'complexity', 'spectral_centroid_hz', 'harmonicity', 'attack_seconds'];

export const UCS_PROPS = [
  'stationarity',
  'spectral_entropy',
  'spectral_slope_db_per_octave',
  'band_limit_high_hz',
  'spectral_centroid_slope_hz_per_second',
  'pitch_slope_semitones_per_second',
  'syllabic_modulation_energy',
  'decay_time_seconds_60db',
  'voicing_ratio',
  'ucs_confidence'
];

interface Props {
  item: any;
  analysisResult: any[];
}

export default function PropertyBars({ item, analysisResult }: Props) {
  const [showUcs, setShowUcs] = useState(false);

  const ranges = useMemo(() => {
    const r: Record<string, { min: number; max: number }> = {};
    for (const p of [...BAR_PROPS, ...UCS_PROPS]) {
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
  const sr = Number(item.metadata.sample_rate ?? item.samplerate) || 44100;

  const activeProps = showUcs ? UCS_PROPS : BAR_PROPS;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.25rem' }}>
        <button 
          className="btn secondary" 
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
          onClick={() => setShowUcs(!showUcs)}
        >
          {showUcs ? 'View Main Stats' : 'View UCS values'}
        </button>
      </div>
      {activeProps.map(prop => {
        const val = Number(item[prop]);
        const numVal = Number.isFinite(val) ? val : 0;
        const { min, max } = ranges[prop];
        const pct = max > min ? Math.max(0, Math.min(100, ((numVal - min) / (max - min)) * 100)) : 0;
        // Correct unit per feature: seconds vs Hz vs unitless.
        const isSeconds = prop.includes('seconds');
        const unit = isSeconds ? ' s' : (prop.includes('hz') && !prop.includes('slope')) ? ' Hz' : '';
        // Attack & length are times — also show them in samples.
        const inSamples = isSeconds ? `${Math.round(numVal * sr).toLocaleString()} smp` : null;
        return (
          <div key={prop} style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              <span>{prop}</span>
              <span style={{ color: '#FCD34D' }}>{numVal.toFixed(2)}{unit}{inSamples ? ` · ${inSamples}` : ''}</span>
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
