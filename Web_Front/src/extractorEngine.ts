// Main-thread client for the Extractor cutting engine. Owns one Web Worker (see
// extractorWorker.ts) that runs the compiled Rust engine (wasm) off the render thread.
//
// The same wasm engine runs in the browser AND inside the Tauri (WebKit) webview on
// desktop, so web and desktop cut identically — there is no second, drifting code path.
// (A native in-process Tauri command could be added later purely as a batch-speed
// optimization; the algorithm would be the same crate either way.)
import type { Region } from './components/examiner/detectRegions';
import { isTauri } from './audioLinking';

/** Detection parameters — field names match `extractor_engine::DetectParams` (Rust), so
 *  this object serializes straight into the engine. */
export interface EngineParams {
  /** Gate opens above this many dB below the file's peak. */
  open_threshold_db: number;
  /** Gate closes only below this lower floor (hysteresis); must be <= open. */
  close_threshold_db: number;
  minimum_silence_seconds: number;
  minimum_region_seconds: number;
  /** Extend region start earlier so onsets aren't clipped. */
  attack_pad_seconds: number;
  /** Extend region end later so decay tails aren't clipped. */
  release_pad_seconds: number;
  /** Snap the start to the true attack (steepest energy rise). */
  transient_aware: boolean;
  /** Snap cut points to the nearest zero crossing — kills clicks. */
  snap_zero_crossing: boolean;
}

export const DEFAULT_ENGINE_PARAMS: EngineParams = {
  open_threshold_db: -40,
  close_threshold_db: -46,
  minimum_silence_seconds: 0.15,
  minimum_region_seconds: 0.05,
  attack_pad_seconds: 0.01,
  release_pad_seconds: 0.03,
  transient_aware: true,
  snap_zero_crossing: true,
};

/** Result of analyzing a chunk: either a full Peak record, or a sentinel. */
export type ChunkAnalysis =
  | { status?: undefined; [k: string]: any } // a Peak record
  | { status: 'too_short' | 'error'; message?: string };

interface Pending {
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

class ExtractorEngine {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readyPromise: Promise<void> | null = null;
  version = '';

  private ensureWorker(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.worker = new Worker(new URL('./extractorWorker.ts', import.meta.url), { type: 'module' });
    this.readyPromise = new Promise((resolve) => {
      this.worker!.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === 'ready') {
          this.version = m.version;
          resolve();
          return;
        }
        if (m.type === 'result') {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error));
          else p.resolve(m.result);
        }
      };
    });
    return this.readyPromise;
  }

  private call(msg: any, transfer?: Transferable[]): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ ...msg, id }, transfer || []);
    });
  }

  // When set (desktop only), engine calls run in-process via Tauri against this file path
  // instead of the WASM worker — the same Rust code, no worker, no re-copy of PCM.
  private nativePath: string | null = null;
  /** Point the engine at a real filesystem path so desktop calls run natively. Pass null
   *  (or on web) to use the WASM worker. */
  setNative(path: string | null) {
    this.nativePath = path;
  }
  private get useNative(): boolean {
    return isTauri() && !!this.nativePath;
  }
  private async invokeNative<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }

  /** Load a file's decoded mono PCM into the engine. A COPY is transferred to the worker,
   *  so the caller's `samples` stays intact for waveform drawing and playback. On the
   *  native path this is a no-op (the commands decode from the file path per call). */
  async load(samples: Float32Array, sampleRate: number): Promise<void> {
    if (this.useNative) return;
    await this.ensureWorker();
    const copy = samples.slice();
    await this.call({ type: 'load', samples: copy.buffer, sampleRate }, [copy.buffer]);
  }

  /** Re-detect regions on the loaded file. Cheap enough to call on every (debounced)
   *  slider change — only the params string crosses the boundary. */
  async detect(params: EngineParams): Promise<Region[]> {
    if (this.useNative) {
      const json = await this.invokeNative<string>('extractor_detect', { path: this.nativePath, paramsJson: JSON.stringify(params) });
      return JSON.parse(json) as Region[];
    }
    await this.ensureWorker();
    const json = await this.call({ type: 'detect', paramsJson: JSON.stringify(params) });
    return JSON.parse(json) as Region[];
  }

  /** 16-bit WAV bytes for one region (its own fade fields are applied). */
  async sliceWav(region: Region): Promise<Uint8Array> {
    if (this.useNative) {
      const buf = await this.invokeNative<ArrayBuffer>('extractor_slice_wav', { path: this.nativePath, regionJson: JSON.stringify(region) });
      return new Uint8Array(buf);
    }
    await this.ensureWorker();
    return this.call({ type: 'sliceWav', regionJson: JSON.stringify(region) });
  }

  /** Run one chunk through the full UCS analyzer. Returns a Peak record, or a
   *  `{status:'too_short'}` sentinel for a chunk too short to analyze. */
  async analyzeChunk(region: Region, name: string, folder: string): Promise<ChunkAnalysis> {
    if (this.useNative) {
      const json = await this.invokeNative<string>('extractor_analyze_chunk', { path: this.nativePath, regionJson: JSON.stringify(region), name, folder });
      return JSON.parse(json) as ChunkAnalysis;
    }
    await this.ensureWorker();
    const json = await this.call({
      type: 'analyzeChunk',
      regionJson: JSON.stringify(region),
      name,
      folder,
    });
    return JSON.parse(json) as ChunkAnalysis;
  }
}

/** One shared engine instance for the app. */
export const extractorEngine = new ExtractorEngine();
