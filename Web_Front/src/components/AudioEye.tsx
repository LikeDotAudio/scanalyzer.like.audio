import { useState, useRef, useEffect } from 'react';
import RadialWaveform from './examiner/RadialWaveform';
import { toMono } from './examiner/audioAnalysis';
import { decodeWav } from './examiner/decodeWav';
import { decodeViaWasm } from './examiner/wasmDecode';

interface AudioEyeProps {
  // Resolved audio URL of the sample to play, or null to hide the player.
  src: string | null;
  // Filename label shown under the ring.
  name?: string;
  // Ring colour ('#RRGGBB') — usually the sample's UCS colour.
  color?: string;
  // Square edge length of the ring in CSS px.
  size?: number;
  // Start playing as soon as a new src arrives (the pick itself is the user gesture).
  autoPlay?: boolean;
  // Regions to highlight around the outside (start/end fraction 0..1)
  regions?: { start: number; end: number; color: string }[];
  // Bubbles playback state up so the caller can, e.g., pulse the selected point.
  onPlayingChange?: (playing: boolean) => void;
  // External-transport mode: visualize and scrub THIS element instead of owning one.
  // The caller keeps setting its src / starting playback (e.g. the app footer's shared
  // <audio>); the eye only decodes `src` for the ring and steers the element's playhead.
  // Prevents the double-audio problem a second element would cause.
  audioEl?: HTMLAudioElement | null;
  // External mode: what the centre ▶ button does (defaults to play/pause of audioEl).
  onTogglePlay?: () => void;
  // The record's stored peak map as stand-in samples (peakPreview.previewShimSamples):
  // the ring draws this the instant a sample is picked, until the decode lands.
  previewSamples?: Float32Array | null;
  className?: string;
  style?: React.CSSProperties;
}

// A self-contained circular wave PLAYER: give it a resolved audio URL and it decodes
// the file to a radial waveform, plays it through its own (DOM-less) <audio>, and wires
// the ring's centre button, playhead and scrubbing to that playback. Composes the pure
// RadialWaveform widget with the decode+transport that used to live inline in StatsTab.
export default function AudioEye({
  src,
  name = '',
  color = '#f4902c',
  size = 180,
  autoPlay = true,
  regions,
  onPlayingChange,
  audioEl = null,
  onTogglePlay,
  previewSamples = null,
  className,
  style,
}: AudioEyeProps) {
  const [samples, setSamples] = useState<Float32Array | null>(null);
  // Right channel when the file is stereo (null for mono) — the ring then splits into
  // an outer (left) and inner (right, opposite-coloured) band.
  const [samplesRight, setSamplesRight] = useState<Float32Array | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  // Guards against a slow decode of an earlier src painting over a newer one.
  const genRef = useRef(0);
  // onPlayingChange changes identity each render; read it through a ref so the audio
  // element's listeners are wired once and never resubscribe.
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

  // One audio element + decode context for the life of the widget — or, in external
  // mode, listeners on the caller's element (whose src and playback the caller owns).
  useEffect(() => {
    const a = audioEl ?? new Audio();
    const owned = !audioEl;
    audioRef.current = a;
    const emit = (p: boolean) => { setPlaying(p); onPlayingChangeRef.current?.(p); };
    const onPlay = () => emit(true);
    const onStop = () => emit(false);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onStop);
    a.addEventListener('ended', onStop);
    // An external element may already be mid-playback when the eye mounts.
    emit(!a.paused && !a.ended);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onStop);
      a.removeEventListener('ended', onStop);
      if (owned) {
        a.pause();
        if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src);
      }
      ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, [audioEl]);

  // A new src: (re)point the audio, optionally play, and decode for the ring.
  // In external mode the caller drives its element's src/playback — only decode.
  useEffect(() => {
    const gen = ++genRef.current;
    setSamples(null);
    setSamplesRight(null);
    const a = audioRef.current;
    if (!a || !src) return;

    if (!audioEl) {
      if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src);
      a.src = src;
      a.currentTime = 0;
      if (autoPlay) a.play().catch(() => { /* autoplay may be blocked — the ▶ button still works */ });
    }

    (async () => {
      try {
        if (!ctxRef.current) {
          ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const buf = await (await fetch(src)).arrayBuffer();
        if (gen !== genRef.current) return;
        let decoded: AudioBuffer | null | undefined = null;
        try {
          const decodePromise = ctxRef.current.decodeAudioData(buf.slice(0));
          if (decodePromise) {
            decoded = await Promise.race([
              decodePromise,
              new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 150))
            ]);
          }
        } catch (e) {
          // decodeAudioData rejected or timed out
        }

        if (!decoded) {
          decoded =
            decodeWav(buf, ctxRef.current) ??
            (await decodeViaWasm(buf, name, ctxRef.current));
        }
        if (gen !== genRef.current) return;
        if (!decoded) return;
        if (decoded.numberOfChannels >= 2) {
          setSamples(decoded.getChannelData(0));
          setSamplesRight(decoded.getChannelData(1));
        } else {
          setSamples(toMono(decoded));
          setSamplesRight(null);
        }
      } catch {
        /* undecodable — leave the ring empty, playback may still work */
      }
    })();
  }, [src, autoPlay, audioEl]);

  const togglePlay = () => {
    if (onTogglePlay) { onTogglePlay(); return; }
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };

  // Playhead position as a fraction of the file, polled by RadialWaveform each frame.
  const getProgress = () => {
    const a = audioRef.current;
    if (!a || !a.duration || !Number.isFinite(a.duration)) return null;
    return a.currentTime / a.duration;
  };

  const onScrub = (fraction: number) => {
    const a = audioRef.current;
    if (a && a.duration && Number.isFinite(a.duration)) a.currentTime = fraction * a.duration;
  };

  if (!src) return null;

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', ...style }}
    >
      <RadialWaveform
        samples={samples ?? previewSamples}
        samplesRight={samplesRight}
        color={color}
        size={size}
        regions={regions}
        onPlay={togglePlay}
        playing={playing}
        getProgress={getProgress}
        onScrub={onScrub}
      />
      {name && (
        <div
          title={name}
          style={{
            fontSize: '0.75rem', maxWidth: size + 40, textAlign: 'center', color: '#fff',
            textShadow: '0 1px 3px rgba(0,0,0,0.9)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{name}</div>
      )}
    </div>
  );
}
