// Region types shared across the Extractor UI. Detection itself lives in the Rust
// `extractor_engine` crate, run as WASM in a worker (see `src/extractorEngine.ts`) — the
// single source of truth, so there is no TypeScript detector to drift from it. These
// interfaces are just the wire shape the engine returns and the UI edits.

export interface Region {
  index: number;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  peak_amplitude: number;
  name: string;
  // Per-slice fade envelope, in seconds. Applied when exporting the sliced audio.
  fade_in_seconds?: number;
  fade_out_seconds?: number;
}

export interface RegionParams {
  threshold_decibels: number;   // silence floor, dB below the file's loudest frame
  minimum_silence_seconds: number;
  minimum_region_seconds: number;
}

export const DEFAULT_REGION_PARAMS: RegionParams = {
  threshold_decibels: -40,
  minimum_silence_seconds: 0.15,
  minimum_region_seconds: 0.05,
};

const MAX_REGIONS = 512;

// RMS amplitude envelope at ~200 fps — the same ~5 ms hop the Rust
// `amplitude_envelope` uses (hop = sampleRate / 200), so frame→seconds matches.
export function amplitudeEnvelope(samples: Float32Array, sampleRate: number): { envelope: Float64Array; rateHz: number } {
  const hop = Math.max(1, Math.floor(sampleRate / 200));
  const rateHz = sampleRate / hop;
  const n = Math.floor(samples.length / hop) + (samples.length % hop ? 1 : 0);
  const envelope = new Float64Array(Math.max(0, n));
  let w = 0;
  for (let i = 0; i < samples.length; i += hop) {
    const end = Math.min(i + hop, samples.length);
    let s = 0;
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    envelope[w++] = Math.sqrt(s / (end - i));
  }
  return { envelope, rateHz };
}

// Detect regions from a precomputed RMS envelope. `lengthSeconds` clamps the last
// out-point. Returns regions with empty names (the user fills those in).
export function detectRegionsFromEnvelope(
  envelope: Float64Array,
  rateHz: number,
  lengthSeconds: number,
  params: RegionParams = DEFAULT_REGION_PARAMS,
): Region[] {
  const n = envelope.length;
  if (n === 0 || rateHz <= 0) return [];
  let peak = 0;
  for (let i = 0; i < n; i++) if (envelope[i] > peak) peak = envelope[i];
  if (peak <= 1e-9) return [];

  const threshold = peak * Math.pow(10, params.threshold_decibels / 20);
  const minSilenceFrames = Math.round(params.minimum_silence_seconds * rateHz);

  // Contiguous above-threshold runs: [start, endExclusive, peak].
  const runs: [number, number, number][] = [];
  let i = 0;
  while (i < n) {
    if (envelope[i] >= threshold) {
      const start = i;
      let pk = 0;
      while (i < n && envelope[i] >= threshold) { if (envelope[i] > pk) pk = envelope[i]; i++; }
      runs.push([start, i, pk]);
    } else i++;
  }

  // Bridge runs split by a gap shorter than the minimum silence.
  const merged: [number, number, number][] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < minSilenceFrames) {
      last[1] = r[1];
      last[2] = Math.max(last[2], r[2]);
    } else merged.push([...r] as [number, number, number]);
  }

  const regions: Region[] = [];
  for (const [startFrame, endFrame, pk] of merged) {
    const start_seconds = startFrame / rateHz;
    let end_seconds = endFrame / rateHz;
    if (lengthSeconds > 0 && end_seconds > lengthSeconds) end_seconds = lengthSeconds;
    const duration_seconds = end_seconds - start_seconds;
    if (duration_seconds < params.minimum_region_seconds) continue;
    regions.push({ index: regions.length, start_seconds, end_seconds, duration_seconds, peak_amplitude: pk, name: '' });
    if (regions.length >= MAX_REGIONS) break;
  }
  return regions;
}

// Convenience: decode → envelope → regions in one call.
export function detectRegions(
  samples: Float32Array,
  sampleRate: number,
  lengthSeconds: number,
  params: RegionParams = DEFAULT_REGION_PARAMS,
): Region[] {
  const { envelope, rateHz } = amplitudeEnvelope(samples, sampleRate);
  return detectRegionsFromEnvelope(envelope, rateHz, lengthSeconds, params);
}
