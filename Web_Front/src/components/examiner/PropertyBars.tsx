import { useMemo, useState } from 'react';
import { getField } from '../../peakSchema';

// A bar: where the value lives in the grouped record, what to call it, and how
// to print it. `seconds` also gets a sample count, so times read in both units.
interface Bar {
  path: string;
  label: string;
  unit?: string;
  seconds?: boolean;
}

// The six properties shown as horizontal bars, each scaled to that feature's
// real min/max across the dataset (so small values aren't invisible slivers).
export const BAR_PROPS: Bar[] = [
  { path: 'musicality.pitch_hz', label: 'pitch_hz', unit: ' Hz' },
  { path: 'metadata.length_seconds', label: 'length_seconds', unit: ' s', seconds: true },
  { path: 'spectral_features.complexity', label: 'complexity' },
  { path: 'spectral_features.spectral_centroid_hz', label: 'spectral_centroid_hz', unit: ' Hz' },
  { path: 'spectral_features.harmonicity', label: 'harmonicity' },
  { path: 'envelope.attack_seconds', label: 'attack_seconds', unit: ' s', seconds: true },
];

export const UCS_PROPS: Bar[] = [
  { path: 'spectral_features.stationarity', label: 'stationarity' },
  { path: 'spectral_features.spectral_entropy', label: 'spectral_entropy' },
  { path: 'spectral_features.spectral_slope_db_per_octave', label: 'spectral_slope_db_per_octave', unit: ' dB/oct' },
  { path: 'spectral_features.band_limit_high_hz', label: 'band_limit_high_hz', unit: ' Hz' },
  { path: 'spectral_features.spectral_centroid_slope_hz_per_second', label: 'spectral_centroid_slope_hz_per_second', unit: ' Hz/s' },
  { path: 'musicality.pitch_slope_semitones_per_second', label: 'pitch_slope_semitones_per_second', unit: ' st/s' },
  { path: 'spectral_features.syllabic_modulation_energy', label: 'syllabic_modulation_energy' },
  { path: 'envelope.decay_time_seconds_60db', label: 'decay_time_seconds_60db', unit: ' s', seconds: true },
  { path: 'spectral_features.voicing_ratio', label: 'voicing_ratio' },
  { path: 'ucs.confidence', label: 'ucs_confidence' },
];

interface Props {
  item: any;
  analysisResult: any[];
}

export default function PropertyBars({ item, analysisResult }: Props) {
  const [showUcs, setShowUcs] = useState(false);

  const ranges = useMemo(() => {
    const r: Record<string, { min: number; max: number }> = {};
    for (const bar of [...BAR_PROPS, ...UCS_PROPS]) {
      let mn = Infinity, mx = -Infinity;
      for (const it of analysisResult) {
        const v = Number(getField(it, bar.path));
        if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
      }
      r[bar.path] = { min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 1 : mx };
    }
    return r;
  }, [analysisResult]);

  if (!item) return null;

  // Sample rate for converting seconds → samples (attack & length).
  const sr = Number(item.metadata?.sample_rate) || 44100;

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
      {activeProps.map(bar => {
        const raw = Number(getField(item, bar.path));
        // A record analyzed before this feature existed simply has no value.
        // Show that, rather than a 0.00 that reads as a real measurement.
        const has = Number.isFinite(raw);
        const { min, max } = ranges[bar.path];
        const pct = has && max > min ? Math.max(0, Math.min(100, ((raw - min) / (max - min)) * 100)) : 0;
        const inSamples = has && bar.seconds ? ` · ${Math.round(raw * sr).toLocaleString()} smp` : '';
        return (
          <div key={bar.path} style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              <span>{bar.label}</span>
              <span style={{ color: has ? '#FCD34D' : 'var(--text-secondary)' }}>
                {has ? `${raw.toFixed(2)}${bar.unit ?? ''}${inSamples}` : '—'}
              </span>
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
