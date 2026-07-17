// Lazy STFT frame computer for the spectrogram layers. Computed once per decoded
// selection, and only when a spectrogram-needing layer is actually visible —
// the Sonic Visualiser dormancy idea: hidden layers cost nothing.

import { fftRadix2 } from '../audioAnalysis';

export interface SpectrogramFrames {
  magnitudes: Float32Array;   // frameCount × bins, row-major (frame-major)
  frameCount: number;
  bins: number;               // fftSize/2 + 1
  fftSize: number;
  hop: number;
  sampleRate: number;
  peak: number;               // global magnitude peak, for peak-normalized dB
}

const FFT_SIZE = 1024;
const MAX_FRAMES = 2048;      // cap the frame count so long files stay cheap

export function computeSpectrogramFrames(mono: Float32Array, sampleRate: number): SpectrogramFrames | null {
  const n = mono.length;
  if (n < FFT_SIZE || sampleRate <= 0) return null;

  // Hop: at least 25% of the window (75% overlap max), stretched so the whole
  // file fits in MAX_FRAMES frames.
  const hop = Math.max(FFT_SIZE >> 2, Math.ceil((n - FFT_SIZE) / (MAX_FRAMES - 1)));
  const frameCount = Math.max(1, Math.floor((n - FFT_SIZE) / hop) + 1);
  const bins = (FFT_SIZE >> 1) + 1;

  const window = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));

  const magnitudes = new Float32Array(frameCount * bins);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  let peak = 0;

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fftRadix2(re, im);
    const row = f * bins;
    for (let k = 0; k < bins; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      magnitudes[row + k] = m;
      if (m > peak) peak = m;
    }
  }
  if (peak <= 0) return null;
  return { magnitudes, frameCount, bins, fftSize: FFT_SIZE, hop, sampleRate, peak };
}
