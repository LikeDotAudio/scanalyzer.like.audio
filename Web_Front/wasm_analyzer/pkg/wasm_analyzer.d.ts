/* tslint:disable */
/* eslint-disable */

/**
 * PCM decoded from a compressed/lossy file, handed back to JS so the Examiner and
 * Extractor can draw a waveform preview on the desktop webview (WebKitGTK), whose
 * Web Audio `decodeAudioData` rejects MP3/OGG/M4A/AAC/FLAC/AIFF. `samples` is
 * interleaved f32 (frame-major); JS de-interleaves into an AudioBuffer.
 */
export class DecodedAudio {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly channels: number;
    readonly sample_rate: number;
    /**
     * Interleaved samples, copied into a JS-owned Float32Array.
     */
    readonly samples: Float32Array;
}

export function analyze_audio_buffer(buffer: Uint8Array, name: string, folder: string): string;

/**
 * The version stamp this engine writes into every record: crate version + a
 * hash of the extractor sources.
 *
 * The scanner uses it to decide whether a `.PEAK` sidecar sitting next to an
 * audio file can be *absorbed* instead of recomputed. A sidecar carrying this
 * exact version was produced by identical extractor code, so re-analyzing the
 * file is guaranteed to reproduce it bit for bit — the only thing a re-scan
 * would buy is the time it costs. Any other version means the code moved and
 * the record must be recomputed.
 *
 * This is the same constant the native binary stamps, so a library analyzed on
 * the desktop is absorbed by the web front for free, and vice versa.
 */
export function analyzer_version(): string;

/**
 * Decode `buffer` to interleaved PCM. `name` supplies the extension hint (may be
 * empty — WAV is caught by magic bytes and the rest is content-probed). Returns
 * `undefined` when the bytes can't be decoded by any supported codec.
 */
export function decode_audio_buffer(buffer: Uint8Array, name: string): DecodedAudio | undefined;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_decodedaudio_free: (a: number, b: number) => void;
    readonly analyze_audio_buffer: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly analyzer_version: () => [number, number];
    readonly decode_audio_buffer: (a: number, b: number, c: number, d: number) => number;
    readonly decodedaudio_channels: (a: number) => number;
    readonly decodedaudio_sample_rate: (a: number) => number;
    readonly decodedaudio_samples: (a: number) => [number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
