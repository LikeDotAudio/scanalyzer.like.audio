// Scroll-ahead audio buffering for the Examiner list.
//
// Selecting a track resolves its audio the slow way: on the desktop that means
// reading the whole file over IPC (read_audio_bytes) and wrapping the bytes in a
// blob: URL. Doing that only at click time makes the first play of each sample
// lag. This hook pre-reads a WINDOW of rows around where the user is looking so
// the next few selections are already in memory.
//
// The window is biased toward the scroll direction: heading DOWN buffers LEAD
// rows below the anchor and TRAIL rows above it, and fetches nearest-first on the
// side you are scrolling toward, so the tracks you are about to reach load first.
//
// The cache is the single owner of every URL it hands out — it revokes on
// eviction and on unmount. Callers must NOT revoke a URL that came from here; the
// currently-playing item is pinned so a scroll never evicts the blob under the
// <audio> element mid-play.

import { useCallback, useEffect, useRef } from 'react';
import { resolveAudioUrl } from '../audioLinking';

// Rows to keep buffered ahead of / behind the anchor. "10 up and down", with the
// larger LEAD spent on whichever side the user is scrolling toward.
const LEAD = 10;
const TRAIL = 10;

// Cap simultaneous reads so a fast scroll doesn't fire 20 whole-file IPC reads at
// once; the direction-ordered queue drains through this many workers.
const MAX_CONCURRENT = 4;

export interface AudioPrefetch {
  /** Synchronous cache hit, or null if not buffered yet. */
  get: (item: any) => string | null;
  /** Get-or-fetch a single item's URL (used by the click path to await a miss). */
  ensure: (item: any) => Promise<string | null>;
  /** Buffer the window around `anchorIndex`, biased toward `direction` (+1 down, -1 up). */
  prefetchWindow: (anchorIndex: number, direction: 1 | -1) => void;
  /** Protect an item from eviction — the one currently loaded in the <audio> element. */
  pin: (item: any) => void;
}

export function useAudioPrefetch(rows: any[], audioFiles: File[]): AudioPrefetch {
  const cache = useRef(new Map<any, string>());              // item -> URL (this cache owns it)
  const inflight = useRef(new Map<any, Promise<string | null>>());
  const pinned = useRef<any>(null);
  // Direction-ordered work queue drained by MAX_CONCURRENT workers.
  const queue = useRef<any[]>([]);
  const running = useRef(0);

  const revoke = (url: string | null | undefined) => {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  };

  // Free every buffered URL when the Examiner unmounts.
  useEffect(() => () => {
    for (const url of cache.current.values()) revoke(url);
    cache.current.clear();
    inflight.current.clear();
    queue.current = [];
  }, []);

  // A new scan / re-filter / re-sort replaces the row objects. Drop buffers for
  // items no longer shown (keeping the pinned one, which may still be playing).
  useEffect(() => {
    const live = new Set(rows);
    for (const [item, url] of cache.current) {
      if (!live.has(item) && item !== pinned.current) {
        revoke(url);
        cache.current.delete(item);
      }
    }
    queue.current = queue.current.filter(it => live.has(it));
  }, [rows]);

  const fetchInto = useCallback((item: any): Promise<string | null> => {
    const hit = cache.current.get(item);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.current.get(item);
    if (pending) return pending;
    const p = resolveAudioUrl(audioFiles, item)
      .then(url => {
        inflight.current.delete(item);
        if (!url) return null;
        // Lost a race and it is already cached — drop the duplicate URL.
        if (cache.current.has(item)) { revoke(url); return cache.current.get(item)!; }
        cache.current.set(item, url);
        return url;
      })
      .catch(() => { inflight.current.delete(item); return null; });
    inflight.current.set(item, p);
    return p;
  }, [audioFiles]);

  const pump = useCallback(() => {
    while (running.current < MAX_CONCURRENT && queue.current.length) {
      const item = queue.current.shift();
      if (cache.current.has(item) || inflight.current.has(item)) continue;
      running.current++;
      fetchInto(item).finally(() => { running.current--; pump(); });
    }
  }, [fetchInto]);

  const get = useCallback((item: any) => cache.current.get(item) ?? null, []);
  const ensure = useCallback((item: any) => fetchInto(item), [fetchInto]);
  const pin = useCallback((item: any) => { pinned.current = item; }, []);

  const prefetchWindow = useCallback((anchorIndex: number, direction: 1 | -1) => {
    if (!rows.length) return;
    const anchor = Math.max(0, Math.min(rows.length - 1, anchorIndex));
    const ahead = direction >= 0 ? LEAD : TRAIL;
    const behind = direction >= 0 ? TRAIL : LEAD;
    const lo = Math.max(0, anchor - behind);
    const hi = Math.min(rows.length - 1, anchor + ahead);

    const wanted = new Set<any>();
    for (let i = lo; i <= hi; i++) wanted.add(rows[i]);

    // Evict buffers outside the window (never the pinned/playing one).
    for (const [item, url] of cache.current) {
      if (!wanted.has(item) && item !== pinned.current) {
        revoke(url);
        cache.current.delete(item);
      }
    }

    // Rebuild the queue nearest-first, stepping outward but taking the scroll-
    // direction side at each radius so the rows you are heading into load first.
    const q: any[] = [];
    const maxR = Math.max(hi - anchor, anchor - lo);
    for (let r = 0; r <= maxR; r++) {
      const fwd = anchor + direction * r;
      const back = anchor - direction * r;
      if (fwd >= lo && fwd <= hi) q.push(rows[fwd]);
      if (r !== 0 && back >= lo && back <= hi) q.push(rows[back]);
    }
    queue.current = q.filter(it => !cache.current.has(it) && !inflight.current.has(it));
    pump();
  }, [rows, pump]);

  return { get, ensure, prefetchWindow, pin };
}
