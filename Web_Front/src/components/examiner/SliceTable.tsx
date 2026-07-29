// The per-transient ADSR table — the numbers behind the `transient slices` layer.
//
// The record's file-level envelope_* fields are null whenever a file holds more
// than one transient, because a peak-relative measurement has no defined peak on
// a multi-event file. The real measurements are one-per-slice, and this is where
// they are read. The header states which case the open file is in, so a row of
// blanks upstairs is explained rather than looking like missing data.

import { envelopeSlices, isMultiEvent, type EnvelopeSlice } from '../../envelopeSlices';

interface Props {
  item: any;
}

/** ms under a second, seconds above — an attack reads in ms, a ring in seconds. */
function dur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v >= 1 ? `${v.toFixed(2)} s` : `${Math.round(v * 1000)} ms`;
}

const cell: React.CSSProperties = {
  padding: '2px 4px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.66rem',
  whiteSpace: 'nowrap',
};
const head: React.CSSProperties = {
  ...cell,
  color: 'var(--text-secondary)',
  fontWeight: 600,
  position: 'sticky',
  top: 0,
  background: '#0B0E14',
};

export default function SliceTable({ item }: Props) {
  const slices = envelopeSlices(item);
  if (!slices.length) return null;

  const multi = isMultiEvent(item);
  const loudest = slices.reduce(
    (b, s) => ((s.relative_level ?? 0) > (b.relative_level ?? 0) ? s : b),
    slices[0],
  );

  return (
    <div style={{ borderTop: '1px solid var(--border-color)', padding: '0.5rem 0.6rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
        ADSR per transient · {slices.length} slice{slices.length === 1 ? '' : 's'}
      </div>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 6 }}>
        {multi ? (
          <>
            Multi-event: the file-level ADSR is <b>null</b> by design — there is no
            single peak to measure against. Each slice below is measured against
            its own peak. The loudest ({dur(loudest.start_seconds)} in) is the one
            the classifiers read.
          </>
        ) : (
          <>One-shot: this slice spans the whole file, so the file-level ADSR is this row.</>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: 'left' }}>#</th>
              <th style={{ ...head, textAlign: 'left' }}>start</th>
              <th style={{ ...head, textAlign: 'right' }}>lvl</th>
              <th style={{ ...head, textAlign: 'right' }}>A</th>
              <th style={{ ...head, textAlign: 'right' }}>D</th>
              <th style={{ ...head, textAlign: 'right' }}>S</th>
              <th style={{ ...head, textAlign: 'right' }}>R</th>
              <th style={{ ...head, textAlign: 'left' }}>shape</th>
              <th style={{ ...head, textAlign: 'right' }}>ring</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s: EnvelopeSlice) => {
              const isLoudest = s === loudest;
              return (
                <tr
                  key={s.index}
                  style={{
                    background: isLoudest ? 'rgba(245,158,11,0.12)' : undefined,
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                  }}
                  title={isLoudest ? 'Loudest slice — the file-level representative reading' : undefined}
                >
                  <td style={{ ...cell, color: '#F59E0B' }}>{s.index + 1}</td>
                  <td style={cell}>{s.start_seconds.toFixed(2)}s</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {Math.round((s.relative_level ?? 0) * 100)}%
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>{dur(s.envelope_attack_seconds)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{dur(s.envelope_decay_seconds)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {Math.round((s.envelope_sustain_level ?? 0) * 100)}%
                  </td>
                  <td style={{ ...cell, textAlign: 'right' }}>{dur(s.envelope_release_seconds)}</td>
                  <td style={{ ...cell, color: 'var(--text-secondary)' }}>{s.envelope_shape}</td>
                  <td style={{ ...cell, textAlign: 'right', color: 'var(--text-secondary)' }}>
                    {dur(s.decay_time_seconds_60db)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
