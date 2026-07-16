import RadialWaveform from '../examiner/RadialWaveform';

interface WaveCircleProps {
  samples: Float32Array | null;
  color: string;
  arcs: { start: number; end: number; color: string }[];
  playing: boolean;
  hasSelection: boolean;
  onPlay: () => void;
  getProgress: () => number | null;
  onScrub: (f: number) => void;
  onHover: (f: number | null) => void;
  // Mouse wheel over the circle steps to the next (+1) / previous (-1) slice.
  onWheel?: (dir: 1 | -1) => void;
  // On mobile the circle sits full-width in the vertical stack rather than as a side column.
  isNarrow?: boolean;
}

// The right-hand "wave circle": the radial waveform with region arcs, a centre play
// button, a sweeping playhead, and click/drag scrub + hover-to-loop. Scrolling the wheel
// over it steps through the slices.
export default function WaveCircle({ samples, color, arcs, playing, hasSelection, onPlay, getProgress, onScrub, onHover, onWheel, isNarrow }: WaveCircleProps) {
  return (
    <div onWheel={onWheel ? (e) => onWheel(e.deltaY > 0 ? 1 : -1) : undefined}
      style={{ ...(isNarrow
        ? { width: '100%', borderTop: '1px solid var(--border-color)' }
        : { width: 340, flexShrink: 0, borderLeft: '1px solid var(--border-color)' }),
        background: '#0B0E14', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1rem' }}>
      {hasSelection ? (
        <RadialWaveform samples={samples} color={color} size={280} regions={arcs}
          onPlay={onPlay} playing={playing} getProgress={getProgress} onScrub={onScrub} onHover={onHover} />
      ) : (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'center' }}>Audio Eye</div>
      )}
    </div>
  );
}
