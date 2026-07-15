// Last-resort audio decoder for the visual preview, backed by the Rust/symphonia
// analyzer compiled to WASM.
//
// The desktop webview (WebKitGTK) can't decode compressed formats through Web Audio's
// decodeAudioData — its GStreamer path is missing plug-ins — and decodeWav only handles
// plain WAV. That left MP3/OGG/M4A/AAC/FLAC/AIFF files with a blank waveform + circular
// preview. symphonia already decodes all of them for the analyzer, and it's already linked
// into wasm_analyzer, so we reuse it here rather than bundle a second JS decoder.
//
// This runs on the main thread (the analyzer worker is a separate WASM instance dedicated
// to scanning). Decoding one selected file is quick; playback still goes through <audio>.

import initWasm, { decode_audio_buffer } from 'wasm_analyzer';
import wasmUrl from 'wasm_analyzer/wasm_analyzer_bg.wasm?url';

let readyPromise: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  // Instantiate from bytes (not instantiateStreaming) for the same MIME reason as wasmWorker.
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        const bytes = await (await fetch(wasmUrl)).arrayBuffer();
        await initWasm(bytes);
      } catch (e: any) {
        if (e?.message && e.message.includes('already')) {
          // Already initialized by another component, ignore.
        } else {
          console.error("WASM init failed:", e);
          throw e;
        }
      }
    })();
  }
  return readyPromise;
}

/// Decode `data` to an AudioBuffer via the WASM analyzer. `name` supplies the extension
/// hint (a blob URL with none still works — WAV is caught by magic bytes, the rest is
/// content-probed). Returns null if the bytes can't be decoded or WASM init fails, so the
/// caller can leave the preview blank rather than crash.
export async function decodeViaWasm(
  data: ArrayBuffer,
  name: string,
  ctx: BaseAudioContext,
): Promise<AudioBuffer | null> {
  let decoded: { channels: number; sample_rate: number; samples: Float32Array; free: () => void } | undefined;
  try {
    await ensureWasm();
    decoded = decode_audio_buffer(new Uint8Array(data), name);
    if (!decoded) {
      console.warn("WASM decode_audio_buffer returned null for:", name);
      return null;
    }

    const channels = decoded.channels || 1;
    const sampleRate = decoded.sample_rate;
    const interleaved = decoded.samples; // copied into JS heap; safe after free()
    const frames = Math.floor(interleaved.length / channels);
    if (frames <= 0 || !sampleRate) {
      console.warn("WASM decoded invalid frames/sampleRate for:", name, frames, sampleRate);
      return null;
    }

    const buffer = ctx.createBuffer(channels, frames, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const out = buffer.getChannelData(ch);
      for (let i = 0; i < frames; i++) out[i] = interleaved[i * channels + ch];
    }
    return buffer;
  } catch (e) {
    console.error("decodeViaWasm failed for:", name, e);
    return null;
  } finally {
    decoded?.free(); // release the Rust-side struct held in WASM memory
  }
}
