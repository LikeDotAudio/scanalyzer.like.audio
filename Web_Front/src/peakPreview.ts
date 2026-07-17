// Reading the .PEAK's binary waveform preview — the analyzer-computed peak map that
// lets every tab paint a waveform BEFORE (or without) decoding any audio. The section
// holds interleaved signed 8-bit min,max pairs per bin, base64-encoded; the whole design
// is documented in Documentation/Audit/binary_peak_preview_audit.md.

/** The `preview` section decoded to usable arrays (values normalized to ±1). */
export interface DecodedPreview {
  minimums: Float32Array;
  maximums: Float32Array;
  binCount: number;
  samplesPerBin: number;
}

/** Decode a record's `preview` section, or null when absent/foreign. Never throws —
 *  a malformed preview must degrade to the plain decode path, not break selection. */
export function decodePreview(record: any): DecodedPreview | null {
  const p = record?.preview;
  if (!p || typeof p.peak_data_base64 !== 'string' || !p.peak_data_base64) return null;
  if (p.bits_per_value !== 8) return null; // only the shipped encoding; future versions add here
  try {
    const raw = atob(p.peak_data_base64);
    const bins = Math.floor(raw.length / 2);
    if (!bins) return null;
    const minimums = new Float32Array(bins);
    const maximums = new Float32Array(bins);
    for (let i = 0; i < bins; i++) {
      // char code → unsigned byte → two's-complement signed → ±1.
      const lo = raw.charCodeAt(i * 2), hi = raw.charCodeAt(i * 2 + 1);
      minimums[i] = ((lo << 24) >> 24) / 127;
      maximums[i] = ((hi << 24) >> 24) / 127;
    }
    return { minimums, maximums, binCount: bins, samplesPerBin: Number(p.samples_per_bin) || 1 };
  } catch {
    return null;
  }
}

/** The preview as stand-in "samples": min,max interleaved into a Float32Array. Any
 *  renderer that draws per-column min/max over samples (the linear waveform, the radial
 *  eye) reproduces the true envelope exactly from this — no renderer changes needed. */
export function previewShimSamples(p: DecodedPreview): Float32Array {
  const out = new Float32Array(p.binCount * 2);
  for (let i = 0; i < p.binCount; i++) {
    out[i * 2] = p.minimums[i];
    out[i * 2 + 1] = p.maximums[i];
  }
  return out;
}

/** An AudioBuffer-shaped stand-in built from a record's preview, for code paths that
 *  render from an AudioBuffer. Marked `isPeakMapPreview` so renderers can skip the
 *  passes that need real PCM (spectrum, spectrogram). Returns null without a preview. */
export function previewBuffer(record: any): (AudioBuffer & { isPeakMapPreview: true }) | null {
  const decoded = decodePreview(record);
  if (!decoded) return null;
  const samples = previewShimSamples(decoded);
  const duration = Number(record?.metadata?.length_seconds) || (decoded.binCount * decoded.samplesPerBin) / 48000;
  const sampleRate = duration > 0 ? samples.length / duration : 48000;
  return {
    isPeakMapPreview: true,
    numberOfChannels: 1,
    length: samples.length,
    duration,
    sampleRate,
    getChannelData: () => samples,
  } as unknown as AudioBuffer & { isPeakMapPreview: true };
}
