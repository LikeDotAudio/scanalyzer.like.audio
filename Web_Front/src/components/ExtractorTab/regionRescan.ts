//! Re-detecting region counts for records whose stored count predates the current
//! cutting engine.
//!
//! Why this exists. The Extractor's "multiple regions only" filter reads
//! `item.regions.count` — a number written by whichever engine last analyzed the
//! file. When the detector changes, every stored count is stale, and the filter
//! silently reports "0 file(s)" for a library full of segmented material. That is
//! exactly what happened: a fix to the silence gate took a 72-second recording
//! from 1 region to 27, and nothing in the app noticed that the 70,000 counts on
//! disk were now wrong. A record loaded from the cloud database is worse still —
//! it carries no region information at all, so its count reads as absent.
//!
//! Re-detecting is far cheaper than re-analyzing. A region count needs the decoded
//! audio, an RMS envelope and the gate; it does not need the STFT, MFCCs, pitch
//! tracking, UCS scoring or any of the rest of the pipeline. So this recovers the
//! one number the Extractor actually filters on without the multi-hour rescan a
//! full re-analysis costs.

import { resolveAudioUrl } from '../../audioLinking';
import { toMono } from '../examiner/audioAnalysis';
import { decodeWav } from '../examiner/decodeWav';
import { decodeViaWasm } from '../examiner/wasmDecode';
import { extractorEngine, DEFAULT_ENGINE_PARAMS } from '../../extractorEngine';

/** Why a record's region count cannot be trusted. */
export type StaleReason = 'never-counted' | 'contradicts-transients';

/**
 * Is this record's region count out of date?
 *
 * `never-counted` — no count at all. A record from the cloud database before the
 * `region_count` column existed, or a `.PEAK` written before regions were a thing.
 *
 * `contradicts-transients` — the record says one region but its own transient
 * counter found several events. The record is arguing with itself, and the region
 * count is the side that is wrong: the firemen recording stored `count: 1`
 * alongside `transient_count: 43`.
 *
 * Deliberately NOT an analyzer-version comparison. The Extractor's cutting engine
 * and the analyzer that stamps `analyzer_version` are separate crates with
 * separate versions, so any difference between them would be meaningless; and on
 * desktop the stamp comes from the native binary while this code is WASM. The
 * internal contradiction needs no version at all, and it points straight at the
 * files that are actually wrong instead of at every file after any rebuild.
 */
export function staleReason(item: any): StaleReason | null {
  const count = item?.regions?.count;
  if (typeof count !== 'number') return 'never-counted';
  const transients = item?.envelope?.transient_count;
  if (count <= 1 && typeof transients === 'number' && transients > 1) {
    return 'contradicts-transients';
  }
  return null;
}

export interface RescanProgress {
  done: number;
  total: number;
  updated: number;
  failed: number;
  current: string;
}

export interface RescanResult {
  /** name → freshly measured region count. */
  counts: Map<string, number>;
  failed: number;
  cancelled: boolean;
}

/** Decode one file to mono PCM, trying the same three routes the Extractor uses:
 *  Web Audio, then the WAV reader, then the WASM decoder for compressed formats.
 *  WebKitGTK's Web Audio fails intermittently on plain WAV and outright on
 *  compressed formats, which is why all three exist rather than just the first. */
async function decodeMono(
  src: string,
  name: string,
  ctx: BaseAudioContext,
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  let bytes: ArrayBuffer;
  try {
    bytes = await (await fetch(src)).arrayBuffer();
  } catch {
    return null;
  }
  const asMono = (buf: AudioBuffer | null) =>
    buf ? { samples: toMono(buf), sampleRate: buf.sampleRate } : null;

  try {
    // decodeAudioData detaches its input, so hand it a copy and keep `bytes` for
    // the fallbacks below.
    const decoded = await ctx.decodeAudioData(bytes.slice(0));
    const mono = asMono(decoded);
    if (mono) return mono;
  } catch {
    /* fall through */
  }
  try {
    const mono = asMono(decodeWav(bytes, ctx));
    if (mono) return mono;
  } catch {
    /* fall through */
  }
  try {
    const mono = asMono(await decodeViaWasm(bytes, name, ctx));
    if (mono) return mono;
  } catch {
    /* give up */
  }
  return null;
}

/**
 * Measure region counts for `items`, in order, reporting progress as it goes.
 *
 * Runs on the main thread's decode path one file at a time deliberately: decoding
 * is the expensive step and doing several at once on a 70,000-file library buys
 * little and can exhaust memory. `shouldStop` is polled between files so the UI
 * can cancel a long run — the counts gathered so far are still returned and are
 * still correct.
 */
export async function rescanRegionCounts(
  items: any[],
  audioFiles: File[],
  onProgress: (p: RescanProgress) => void,
  shouldStop: () => boolean,
): Promise<RescanResult> {
  const counts = new Map<string, number>();
  let failed = 0;
  let cancelled = false;
  // One context for the whole run: a fresh AudioContext per file exhausts the
  // browser's hardware-context limit within a few dozen files.
  const ctx: BaseAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

  try {
  for (let i = 0; i < items.length; i++) {
    if (shouldStop()) {
      cancelled = true;
      break;
    }
    const item = items[i];
    const name = item?.metadata?.name || '';
    onProgress({ done: i, total: items.length, updated: counts.size, failed, current: name });

    let url: string | null = null;
    try {
      url = await resolveAudioUrl(audioFiles, item);
      if (!url) {
        failed++;
        continue;
      }
      const decoded = await decodeMono(url, name, ctx);
      if (!decoded || !decoded.samples.length) {
        failed++;
        continue;
      }
      // The engine is a single shared worker session, so load-then-detect has to
      // stay paired per file.
      extractorEngine.setNative(null);
      await extractorEngine.load(decoded.samples, decoded.sampleRate);
      const regions = await extractorEngine.detect({ ...DEFAULT_ENGINE_PARAMS });
      counts.set(name, regions.length);
    } catch {
      failed++;
    } finally {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  }
  } finally {
    void (ctx as AudioContext).close?.();
  }

  onProgress({ done: items.length, total: items.length, updated: counts.size, failed, current: '' });
  return { counts, failed, cancelled };
}

/** Apply measured counts onto the record set, leaving untouched records alone. */
export function applyCounts(records: any[], counts: Map<string, number>): any[] {
  if (!counts.size) return records;
  return records.map((r) => {
    const c = counts.get(r?.metadata?.name || '');
    if (c === undefined) return r;
    // Preserve any per-region detail the record already had; only the count is
    // being corrected here.
    return { ...r, regions: { ...(r.regions || {}), count: c } };
  });
}
