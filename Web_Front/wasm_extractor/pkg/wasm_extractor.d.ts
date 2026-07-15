/* tslint:disable */
/* eslint-disable */

/**
 * One loaded audio buffer the Extractor edits. Constructed once per file from browser-
 * decoded mono PCM; every detect/slice/analyze call reuses it.
 */
export class ExtractorSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Slice → WAV → full UCS analysis. Returns the `Peak` JSON, or `{"status":"too_short"}`
     * when the chunk is too short for the analyzer to extract features (do NOT fabricate a
     * Peak for a sub-window blip).
     */
    analyze_chunk(region_json: string, name: string, folder: string): string;
    /**
     * Detect regions with the given parameters (`params_json` is a `DetectParams`; empty
     * or invalid JSON falls back to the improved defaults). Returns a JSON array of
     * `Region`.
     */
    detect(params_json: string): string;
    /**
     * Take ownership of the decoded mono PCM. The Float32Array crosses the boundary once
     * here, not on every re-detect.
     */
    constructor(samples: Float32Array, sample_rate: number);
    /**
     * Slice one region (a JSON `Region`, carrying its own fade fields) to 16-bit PCM WAV
     * bytes for download / write-to-disk.
     */
    slice_wav(region_json: string): Uint8Array;
}

/**
 * The version this engine reports. Bumping the crate version invalidates any cached
 * client assumptions the way `analyzer_version()` does for the analyzer.
 */
export function extractor_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_extractorsession_free: (a: number, b: number) => void;
    readonly extractor_version: () => [number, number];
    readonly extractorsession_analyze_chunk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly extractorsession_detect: (a: number, b: number, c: number) => [number, number];
    readonly extractorsession_new: (a: number, b: number, c: number) => number;
    readonly extractorsession_slice_wav: (a: number, b: number, c: number) => [number, number];
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
