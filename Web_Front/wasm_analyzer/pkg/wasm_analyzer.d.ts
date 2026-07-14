/* tslint:disable */
/* eslint-disable */

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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly analyze_audio_buffer: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly analyzer_version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
