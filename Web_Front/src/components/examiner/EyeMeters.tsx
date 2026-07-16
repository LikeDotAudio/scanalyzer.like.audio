import { useEffect, useRef } from 'react';

interface EyeMetersProps {
  // Returns the current L/R sample windows (n samples each) at the playhead, or null when
  // nothing is playing / decoded. Polled each frame. Fed from the decoded buffer rather
  // than a live Web Audio graph — see getFrame in ExaminerTab for why.
  getFrame: (n: number) => { left: Float32Array; right: Float32Array } | null;
  // Edge length of the eye the meters flank, in CSS px (bar height = this).
  size: number;
  color: string;
  children: React.ReactNode;
}

// Samples per metering window — a snapshot of the audio just before the playhead.
const FRAME = 1024;

// dBFS of a linear RMS, floored so log(0) is finite.
const dbfs = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-7));
// Map −60..0 dBFS onto a 0..1 meter fill.
const meterFill = (rms: number) => Math.max(0, Math.min(1, (dbfs(rms) + 60) / 60));
// Green below −6 dB, yellow into the last few dB, red at the top.
const vuColor = (fill: number) =>
  fill > 0.9 ? '#ef4444' : fill > 0.75 ? '#f59e0b' : '#22c55e';

// L/R VU meters flanking the audio eye, plus a horizontal stereo-correlation meter
// mounted BELOW it. Everything is driven by the two channel AnalyserNodes on a single
// rAF loop that writes DOM styles directly — the parent never re-renders per frame.
//
// Correlation meter: the needle reads the Pearson correlation of the L/R windows
// directly. +1 (right) = mono / perfectly in phase, 0 (centre) = fully decorrelated
// (wide stereo), −1 (left) = inverted / phase-cancelling. Green while positive, red once
// it crosses into negative territory (a mono-fold problem). It parks at centre and dims
// when the signal is silent. Reading corr straight — rather than the old (1−corr)/2 —
// means the needle actually tracks: the instantaneous window correlation dances across
// the whole range instead of sitting pinned at dead-centre.
export default function EyeMeters({ getFrame, size, color, children }: EyeMetersProps) {
  const vuLRef = useRef<HTMLDivElement>(null);
  const vuRRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<HTMLDivElement>(null);
  const corrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Exponentially-smoothed display values, so the meters glide instead of flickering.
    let dispL = 0, dispR = 0, dispX = 0, dispOp = 0.15;
    let raf = 0;

    const tick = () => {
      const frame = getFrame(FRAME);
      let fillL = 0, fillR = 0, targetX = 0, targetOp = 0.15;

      if (frame) {
        const L = frame.left, R = frame.right;
        const n = Math.min(L.length, R.length);

        let sumL = 0, sumR = 0, sumLR = 0;
        for (let i = 0; i < n; i++) {
          const l = L[i], r = R[i];
          sumL += l * l; sumR += r * r; sumLR += l * r;
        }
        const rmsL = Math.sqrt(sumL / n), rmsR = Math.sqrt(sumR / n);
        fillL = meterFill(rmsL); fillR = meterFill(rmsR);

        const signal = Math.max(rmsL, rmsR);
        const silent = signal < 1e-3; // ~ −60 dBFS: no sound → park at centre
        if (!silent) {
          const corr = sumLR / (Math.sqrt(sumL * sumR) + 1e-9); // −1..+1, read straight
          targetX = Math.max(-1, Math.min(1, corr));
          targetOp = 1;
        }
      }

      // Attack fast, release slow on the VU bars; ease the correlation needle both ways.
      dispL += (fillL - dispL) * (fillL > dispL ? 0.5 : 0.12);
      dispR += (fillR - dispR) * (fillR > dispR ? 0.5 : 0.12);
      dispX += (targetX - dispX) * 0.25;
      dispOp += (targetOp - dispOp) * 0.15;

      if (vuLRef.current) { vuLRef.current.style.height = `${dispL * 100}%`; vuLRef.current.style.background = vuColor(dispL); }
      if (vuRRef.current) { vuRRef.current.style.height = `${dispR * 100}%`; vuRRef.current.style.background = vuColor(dispR); }
      if (needleRef.current) {
        // corr −1..+1 → 0..100% across the track. Red once it folds negative.
        needleRef.current.style.left = `${50 + dispX * 50}%`;
        needleRef.current.style.opacity = `${dispOp}`;
        const c = dispX < -0.02 ? '#ef4444' : color;
        needleRef.current.style.background = c;
        needleRef.current.style.boxShadow = `0 0 6px ${c}`;
      }
      if (corrRef.current) {
        corrRef.current.textContent = (dispX >= 0 ? '+' : '') + dispX.toFixed(2);
        corrRef.current.style.opacity = `${dispOp}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getAnalysers, color]);

  const barW = 12;
  const vuTrack: React.CSSProperties = {
    width: barW, height: size, flexShrink: 0, background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2,
    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden',
  };
  const vuFill: React.CSSProperties = { width: '100%', height: '0%', background: '#22c55e' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      {/* Row: L VU · eye · R VU */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
        {/* Left VU */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={vuTrack}><div ref={vuLRef} style={vuFill} /></div>
          <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>L</span>
        </div>

        {/* The eye */}
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
          {children}
        </div>

        {/* Right VU */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={vuTrack}><div ref={vuRRef} style={vuFill} /></div>
          <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>R</span>
        </div>
      </div>

      {/* Stereo-correlation meter, mounted below the eye */}
      <div style={{ width: size, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.55rem', color: 'var(--text-secondary)' }}>
          <span>−1 · out of phase</span>
          <span>corr <span ref={corrRef} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', opacity: 0.15 }}>+0.00</span></span>
          <span>mono · +1</span>
        </div>
        {/* The track: red→neutral→green so position reads as phase health at a glance. */}
        <div style={{
          position: 'relative', height: 10, borderRadius: 3, overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'linear-gradient(90deg, rgba(239,68,68,0.35) 0%, rgba(255,255,255,0.05) 50%, rgba(34,197,94,0.30) 100%)',
        }}>
          {/* centre (0 correlation) tick */}
          <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.35)' }} />
          {/* the moving correlation needle */}
          <div ref={needleRef} style={{
            position: 'absolute', left: '100%', top: '50%', width: 8, height: 8, borderRadius: '50%',
            transform: 'translate(-50%,-50%)', background: color, boxShadow: `0 0 6px ${color}`, opacity: 0.15,
          }} />
        </div>
      </div>
    </div>
  );
}
