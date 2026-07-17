// The favorites manifest — user data, written at the library root as a SIBLING of
// sample_cloud_manifest.json, never inside it. The manifest is a rebuildable cache that
// every re-scan regenerates; favorites must survive every scan, so they live in their own
// file with their own lifecycle. See Documentation/Audit/favorites_tab_audit.md.

export const FAVORITES_FILE = 'favorites.json';
export const FAVORITES_VERSION = 1;

// localStorage mirror: the fallback when there is no writable root (demo pack, dropped
// .PEAKs, a denied write grant) and the recovery source when the disk file is absent.
export const FAVORITES_STORAGE_KEY = 'scanalyzer_favorites_v1';

/** The identity a favorite points at: the file's relative path, never the bare name —
 *  every drum folder has a `Kick.wav`. Demo-pack / dropped records carry name-only paths,
 *  which is fine: they are unique within that pseudo-library. */
export function favoriteKeyOf(item: any): string {
  return String(item?.metadata?.path || item?.metadata?.name || '');
}

/** In memory favorites are `Map<path, favorited_unix>` — O(1) row paint plus the
 *  timestamp that gives the Favorites tab a "recently favorited" sort for free. */
export type Favorites = Map<string, number>;

/** Serialize the set into the versioned, full-English favorites.json document. */
export function buildFavorites(favorites: Favorites): string {
  const entries = Array.from(favorites.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([path, favorited_unix]) => ({
      path,
      name: path.split('/').pop() || path,
      favorited_unix,
    }));
  return JSON.stringify({
    favorites_version: FAVORITES_VERSION,
    generated_unix: Math.floor(Date.now() / 1000),
    favorites: entries,
  }, null, 2);
}

/** Parse a favorites.json text back into the Map. Unknown/newer versions and junk parse
 *  to an empty map rather than throwing — a broken favorites file must never block a
 *  library from opening. */
export function parseFavorites(text: string | null | undefined): Favorites {
  const map: Favorites = new Map();
  if (!text) return map;
  try {
    const doc = JSON.parse(text);
    if (!doc || !Array.isArray(doc.favorites)) return map;
    for (const entry of doc.favorites) {
      const path = String(entry?.path || '');
      if (!path) continue;
      map.set(path, Number(entry?.favorited_unix) || 0);
    }
  } catch { /* unreadable — favorites simply start empty */ }
  return map;
}
