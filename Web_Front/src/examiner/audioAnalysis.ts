// Pure audio-analysis helpers for the Examiner preview: FFT, averaged spectral
// trace, and note→frequency conversion. No DOM/React here.

// Shared plot geometry passed to every drawing routine.
export interface PlotGeo {
  w: number; h: number;
  plotTop: number; plotBottom: number; plotH: number;
  mid: number; halfH: number; padTop: number;
}

export interface Spectrum { fx: number[]; fy: number[] }

// In-place iterative radix-2 Cooley–Tukey FFT (length must be a power of two).
export function fftRadix2(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = i + k + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] = re[a] + vr; im[a] = im[a] + vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// One-shot averaged spectral trace of the whole file, condensed onto a
// log-frequency grid (bin-max) and peak-normalized to dB. Returns null if the
// buffer is too short. Mirrors the Python inspector's compute_spectrum.
export function computeSpectrum(mono: Float32Array, sr: number): Spectrum | null {
  const n = mono.length;
  if (n < 256 || sr <= 0) return null;
  let seg = 1;
  const cap = Math.min(n, 1 << 14);
  while (seg * 2 <= cap) seg *= 2;
  const half = seg >> 1;
  const window = new Float64Array(seg);
  for (let i = 0; i < seg; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (seg - 1));

  const maxSegments = 32;
  const count = Math.min(maxSegments, Math.max(1, Math.floor(n / seg)));
  const power = new Float64Array(half + 1);
  for (let s = 0; s < count; s++) {
    const start = count > 1 ? Math.round((s * (n - seg)) / (count - 1)) : 0;
    const re = new Float64Array(seg);
    const im = new Float64Array(seg);
    for (let i = 0; i < seg; i++) re[i] = mono[start + i] * window[i];
    fftRadix2(re, im);
    for (let k = 0; k <= half; k++) power[k] += re[k] * re[k] + im[k] * im[k];
  }

  let peak = 0;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    mag[k] = Math.sqrt(power[k] / count);
    if (mag[k] > peak) peak = mag[k];
  }
  const low = 20, high = sr / 2;
  if (peak <= 0 || high <= low) return null;
  const db = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) db[k] = 20 * Math.log10(Math.max(mag[k] / peak, 1e-6));

  const bands = 360;
  const edges: number[] = [];
  for (let i = 0; i <= bands; i++) edges.push(low * Math.pow(high / low, i / bands));
  const idxFor = (f: number) => Math.min(half + 1, Math.max(0, Math.ceil((f * seg) / sr)));
  const fx: number[] = [], fy: number[] = [];
  for (let i = 0; i < bands; i++) {
    const a = idxFor(edges[i]);
    let b = idxFor(edges[i + 1]);
    if (a > half) break;
    b = Math.max(Math.min(b, half + 1), a + 1);
    let m = -Infinity;
    for (let k = a; k < b; k++) if (db[k] > m) m = db[k];
    fx.push(Math.sqrt(edges[i] * edges[i + 1]));
    fy.push(m);
  }
  return fx.length ? { fx, fy } : null;
}

// Mix an AudioBuffer down to a single mono channel.
export function toMono(buffer: AudioBuffer): Float32Array {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const chans: Float32Array[] = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += chans[c][i];
    mono[i] = s / ch;
  }
  return mono;
}

// Scientific-pitch note name (e.g. "C1", "F#2", "A4") → frequency in Hz.
export function noteToFreq(name: any): number | null {
  if (!name || typeof name !== 'string') return null;
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const letters: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let semi = letters[m[1].toUpperCase()];
  if (semi == null) return null;
  if (m[2] === '#') semi += 1; else if (m[2] === 'b') semi -= 1;
  const midi = (parseInt(m[3], 10) + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}
