//! The 4D tab: the response ball plus the blendshape inspector.
//!
//! Two halves of one idea. The ball shows WHICH facial response each sound
//! routes to (the 4th dimension, as geometry). The inspector shows WHAT that
//! response does over time for the selected sound — and that timeline is driven
//! by the per-transient ADSR slices, one trigger per hit, because a single
//! file-level envelope would make a 15-round burst wince once, slowly.
import { useMemo, useState } from 'react';
import FaceBall, { AXIS_NAMES } from './FaceBall';
import { WebGLBoundary, webglAvailable } from '../CloudTab/WebGLBoundary';
import { RESPONSES, faceOfItem, blendshapeTimeline } from '../../facialResponse';

interface Props {
  filteredData: any[];
  selectedItem?: any;
  onSound?: (name: string) => void;
}

const PREF = 'scanalyzer_faceball_';
const getPref = (k: string, d: string) => localStorage.getItem(PREF + k) || d;
const setPref = (k: string, v: string) => localStorage.setItem(PREF + k, v);

const panel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  padding: '0.5rem 0.7rem',
};

export default function FaceBallTab({ filteredData, selectedItem, onSound }: Props) {
  const [pull, setPull] = useState(() => Number(getPref('pull', '0.85')));
  const [axisX, setAxisX] = useState(() => getPref('x', 'Brightness'));
  const [axisY, setAxisY] = useState(() => getPref('y', 'Harmonicity'));
  const [axisZ, setAxisZ] = useState(() => getPref('z', 'Transients'));
  const [soloFace, setSoloFace] = useState<number | null>(null);
  const [picked, setPicked] = useState<any>(null);

  const item = picked ?? selectedItem;
  const visibleFaces = useMemo(
    () => (soloFace == null ? new Set<number>() : new Set([soloFace])),
    [soloFace],
  );

  // How many samples land on each face — the population of each response class.
  const counts = useMemo(() => {
    const c = new Array(RESPONSES.length).fill(0);
    for (const it of filteredData) c[faceOfItem(it)]++;
    return c;
  }, [filteredData]);

  const timeline = useMemo(() => (item ? blendshapeTimeline(item) : null), [item]);

  const axisSelect = (value: string, set: (v: string) => void, prefKey: string, label: string) => (
    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label}
      <select
        className="btn"
        value={value}
        onChange={(e) => { set(e.target.value); setPref(prefKey, e.target.value); }}
        style={{ fontSize: '0.75rem', padding: '0.15rem 0.3rem' }}
      >
        {AXIS_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );

  if (!webglAvailable()) {
    return (
      <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>
        The 4D view needs WebGL, which this browser or webview can't start.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%' }}>
      {/* ---- the ball */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-end', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
          {axisSelect(axisX, setAxisX, 'x', 'Across face')}
          {axisSelect(axisY, setAxisY, 'y', 'Up face')}
          {axisSelect(axisZ, setAxisZ, 'z', 'Off face')}
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 190 }}>
            Category pull — {(pull * 100).toFixed(0)}%
            <input
              type="range" min={0} max={1} step={0.01} value={pull}
              onChange={(e) => { const v = Number(e.target.value); setPull(v); setPref('pull', String(v)); }}
            />
          </label>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', maxWidth: 300, lineHeight: 1.35 }}>
            0 % is the plain 3-feature scatter. 100 % seats every sample on its
            response face. A sample that resists the pull is one whose sound
            disagrees with its category.
          </div>
          {soloFace != null && (
            <button className="btn" onClick={() => setSoloFace(null)} style={{ fontSize: '0.72rem' }}>
              Show all 32 faces
            </button>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <WebGLBoundary
            resetKey={`${filteredData.length}:${soloFace}`}
            fallback={(err, retry) => (
              <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>
                The 4D view hit an error: <code>{err.message}</code>{' '}
                <button className="btn" onClick={retry}>Try again</button>
              </div>
            )}
          >
            <FaceBall
              data={filteredData}
              selectedItem={item}
              onSelect={(it) => { setPicked(it); onSound?.(it?.metadata?.name); }}
              pull={pull}
              axes={[axisX, axisY, axisZ]}
              visibleFaces={visibleFaces}
            />
          </WebGLBoundary>
        </div>
      </div>

      {/* ---- the response side panel */}
      <aside style={{ width: 300, borderLeft: '1px solid var(--border-color)', overflowY: 'auto', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          32 response faces
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          12 pentagons carry the primary reactions, 20 hexagons the secondary and
          ambient ones. Click one to isolate it.
        </div>

        {timeline && item && (
          <div style={{ ...panel, borderColor: '#4dd0e1' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Selected</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, overflowWrap: 'anywhere' }}>
              {item?.metadata?.name}
            </div>
            <div style={{ fontSize: '0.75rem', marginTop: 4 }}>
              → <b>{timeline.response.name}</b>{' '}
              <span style={{ opacity: 0.6 }}>({timeline.response.family})</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              {timeline.response.actionUnits.length
                ? timeline.response.actionUnits.join(', ')
                : 'decoupled — drives no blendshape'}
            </div>
            <div style={{ fontSize: '0.7rem', marginTop: 6, color: 'var(--text-secondary)' }}>
              {timeline.keys.length} trigger{timeline.keys.length === 1 ? '' : 's'} from{' '}
              {item?.envelope?.slices?.length ?? 0} transient slice
              {(item?.envelope?.slices?.length ?? 0) === 1 ? '' : 's'}
              {timeline.response.cooldownMs > 0 && ` · ${timeline.response.cooldownMs} ms cooldown`}
            </div>
            <BlendshapeStrip keys={timeline.keys} duration={item?.metadata?.length_seconds ?? 0} />
          </div>
        )}

        {RESPONSES.map((r, i) => (
          <button
            key={r.id}
            className="btn"
            onClick={() => setSoloFace(soloFace === i ? null : i)}
            style={{
              ...panel,
              textAlign: 'left',
              cursor: 'pointer',
              opacity: counts[i] ? 1 : 0.4,
              outline: soloFace === i ? '1px solid var(--accent-primary)' : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{r.name}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{counts[i]}</span>
            </div>
            <div style={{ fontSize: '0.64rem', color: 'var(--text-secondary)', marginTop: 2 }}>
              {i < 12 ? 'pentagon' : 'hexagon'} · {r.family}
            </div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: 2, overflowWrap: 'anywhere' }}>
              {r.categories.join(' · ')}
            </div>
          </button>
        ))}
      </aside>
    </div>
  );
}

/** The blendshape weight over time: one spike per surviving transient trigger,
 *  each rising over that slice's measured attack and falling over its release. */
function BlendshapeStrip({ keys, duration }: { keys: { timeSeconds: number; weight: number; attackSeconds: number; releaseSeconds: number }[]; duration: number }) {
  if (!keys.length || duration <= 0) return null;
  const W = 260, H = 46;
  const x = (t: number) => (t / duration) * W;
  const y = (w: number) => H - w * (H - 4) - 2;

  const path = keys
    .map((k) => {
      const x0 = x(k.timeSeconds);
      const x1 = x(k.timeSeconds + k.attackSeconds);
      const x2 = x(k.timeSeconds + k.attackSeconds + k.releaseSeconds);
      return `M ${x0.toFixed(1)} ${y(0)} L ${x1.toFixed(1)} ${y(k.weight)} L ${x2.toFixed(1)} ${y(0)}`;
    })
    .join(' ');

  return (
    <svg width={W} height={H} style={{ marginTop: 6, display: 'block', maxWidth: '100%' }}>
      <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="rgba(255,255,255,0.18)" />
      <path d={path} fill="none" stroke="#4dd0e1" strokeWidth={1.4} />
    </svg>
  );
}
