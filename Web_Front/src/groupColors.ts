// Colour system for the sample cloud. There is one taxonomy now — UCS CATEGORY ->
// SUBCATEGORY — and this file maps a record to its colour and answers the scope queries
// the cloud, its legend and the scope bars run. (The old music-production role taxonomy,
// generated from MUSICPROD.json, was removed once every instrument became a first-class
// UCS category with subcategories.)

// Composite key for a category+subcategory (used for show/hide sets). The unit-
// separator (0x1F) can't occur in a real name, so there are no collisions.
export function subKey(group: string, subgroup: string): string {
  return group + String.fromCharCode(31) + subgroup;
}

// CRC-32 (matches Python's zlib.crc32) for stable hashing of unknown names.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(str: string): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < str.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  return (crc ^ -1) >>> 0;
}

function hsv(h: number, s: number, v: number): string {
  h = ((h % 1) + 1) % 1;
  s = Math.min(Math.max(s, 0), 1);
  v = Math.min(Math.max(v, 0), 1);
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  // TRUNCATE, do not round: Python's colorsys path uses int(x * 255), and this
  // file's whole purpose is to agree with it exactly. Math.round() drifted every
  // channel by up to 1/255 against the desktop app.
  const hx = (x: number) => Math.floor(x * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// Complementary colour (hue rotated 180°) of a hex colour — used to paint the
// spectrum trace opposite the group-coloured waveform, matching the desktop app.
export function complementColor(hex: string): string {
  const m = hex.replace('#', '');
  if (m.length < 6) return '#4dd0e1';
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const s = max === 0 ? 0 : d / max;
  return hsv(h + 0.5, s, max);
}

// ---- UCS colour system ------------------------------------------------------
// The second taxonomy, and a faithful port of support/config.py so the web cloud
// and the desktop cloud colour a UCS category identically.
//
// Unrelated to the music-production roles above: those say what part a sample
// plays in a production. These are the 82 UCS categories the analyzer scores
// every file against. The UCS CATEGORY fixes the hue; the UCS SUBCATEGORY picks
// a shade within it, so a category reads as one colour family.
//
// Hues are spread by the golden ratio over the category's index, which keeps 82
// of them maximally far apart instead of clumping.
// Mirrors UCS/categories/index.json — regenerate if a category is ever added.
export const UCS_CATEGORIES: string[] = [
  'AIR', 'AIRCRAFT', 'ALARMS', 'AMBIENCE', 'ANIMALS', 'ARCHIVED', 'BEEPS', 'BELLS',
  'BIRDS', 'BOATS', 'BULLETS', 'CARTOON', 'CERAMICS', 'CHAINS', 'CHEMICALS', 'CLOCKS',
  'CLOTH', 'COMMUNICATIONS', 'COMPUTERS', 'CREATURES', 'CROWDS', 'DESIGNED', 'DESTRUCTION',
  'DIRT & SAND', 'DOORS', 'DRAWERS', 'ELECTRICITY', 'EQUIPMENT', 'EXPLOSIONS', 'FARTS',
  'FIGHT', 'FIRE', 'FIREWORKS', 'FOLEY', 'FOOD & DRINK', 'FOOTSTEPS', 'GAMES',
  'GEOTHERMAL', 'GLASS', 'GORE', 'GUNS', 'HORNS', 'HUMAN', 'ICE', 'LASERS', 'LEATHER',
  'LIQUID & MUD', 'MACHINES', 'MAGIC', 'MECHANICAL', 'METAL', 'MOTORS', 'MOVEMENT',
  'MUSICAL', 'NATURAL DISASTER', 'OBJECTS', 'PAPER', 'PLASTIC', 'RAIN', 'ROBOTS', 'ROCKS',
  'ROPE', 'RUBBER', 'SCIFI', 'SNOW', 'SPORTS', 'SWOOSHES', 'TOOLS', 'TOYS', 'TRAINS',
  'USER INTERFACE', 'VEGETATION', 'VEHICLES', 'VOICES', 'WATER', 'WEAPONS', 'WEATHER',
  'WHISTLES', 'WIND', 'WINDOWS', 'WINGS', 'WOOD',
  // Music-instrument explosion — the fine-grained top-level categories that replace
  // the coarse MUSICAL/MUSICPROD lumps. Appended (not inserted) so every existing
  // category keeps its index and therefore its hue.
  'DRUMS', 'CYMBALS', 'PERCUSSION', 'MALLET', 'STRINGS', 'GUITAR', 'BRASS', 'WOODWIND',
  'KEYBOARD', 'PIANO', 'SYNTH', 'VOCALS', 'LOOPS'
];

const UCS_INDEX: Record<string, number> = {};
UCS_CATEGORIES.forEach((c, i) => { UCS_INDEX[c] = i; });

const GOLDEN_RATIO = 0.6180339887498949;

function ucsHue(category: string): number | null {
  const i = UCS_INDEX[category];
  return i === undefined ? null : (i * GOLDEN_RATIO) % 1;
}

/** The UCS parent category's own colour. */
export function ucsColor(category: string): string {
  const hue = ucsHue(category);
  if (hue == null) return '#9a9a9a'; // unclassified
  return hsv(hue, 0.72, 0.95);
}

/**
 * A shade of the parent category's hue, picked by the subcategory.
 * The subcategory is hashed rather than indexed: MISC exists in ~70 of the 82
 * categories, so a subcategory name only means anything inside its parent.
 */
export function ucsSubColor(category: string, subcategory = ''): string {
  const hue = ucsHue(category);
  if (!subcategory) return ucsColor(category);
  const t = (crc32(subcategory) % 9) / 8;
  if (hue == null) return hsv(0, 0, 0.45 + 0.35 * t);
  return hsv(hue + (t - 0.5) * 0.045, 0.88 - 0.32 * t, 0.96 - 0.22 * t);
}

/** Composite key for a UCS category+subcategory (show/hide sets, filter trees). */
export function ucsSubKey(category: string, subcategory: string): string {
  return category + String.fromCharCode(31) + subcategory;
}

/**
 * The two axes the analyzer actually computes, behind one accessor, so the cloud,
 * its legend, the scope bars and the hide/show filters all read a record the same
 * way. These are the only two taxonomies:
 *
 *   'Music production' — music_production_category -> group   (what ROLE it plays)
 *   'UCS'              — ucs.category -> ucs.subcategory      (what the sound IS)
 *
 * The standalone "Name groups" taxonomy is gone: the drum-pack group (Kick, Snare,
 * Guitar, …) is now the SECOND level under its music-production role, so nothing
 * is lost — a role opens into its groups.
 */
export type Taxonomy = 'UCS' | 'Music production';

export function taxonomyOf(colorBy: string): Taxonomy {
  return colorBy.startsWith('UCS') ? 'UCS' : 'Music production';
}

/** [top, sub] for a record under the given taxonomy. */
export function taxonomyKeys(item: any, taxonomy: Taxonomy): [string, string] {
  if (taxonomy === 'UCS') {
    return [item.ucs?.category || '(unclassified)', (item.ucs?.subcategory || '').trim()];
  }
  const group = (item.classification?.group || 'Unclassified').trim();
  // A record analyzed before MUSICPROD has no role — derive it from the group.
  const role = item.classification?.music_production_category || musicProdCategory(group);
  return [role, group];
}

export function taxonomyColor(top: string, sub: string, taxonomy: Taxonomy): string {
  if (taxonomy === 'UCS') return ucsSubColor(top, sub);
  // The role fixes the hue; the group under it is a shade of that hue.
  return sub ? groupColor(sub, '') : musicProdColor(top);
}

// --- UCS-Prod-as-a-top-level-scope ---------------------------------------------------
// The 17 music-production roles (MUSICPROD.json) sit ALONGSIDE the UCS categories at the
// top of the scope, not under MUSICAL. Every record has both a ucs.category and a role,
// and the two name sets are disjoint (no UCS category is called "PERCUSSION"), so a chip's
// name alone says which axis it scopes — no extra state, no taxonomy switch.

/** The music-production role names — the top-level MUSICPROD categories. */
export const PROD_ROLES: ReadonlySet<string> = new Set(CATEGORY_ORDER);

/** True when a scope chip is a production role rather than a UCS category. */
export function isProdRole(name: string): boolean {
  return PROD_ROLES.has(name);
}

/** A record's production role, deriving it from the group for pre-MUSICPROD records. */
export function prodRoleOf(item: any): string {
  return item?.classification?.music_production_category
    || musicProdCategory(item?.classification?.group || '');
}

/** Does a record fall in the selected scope? `group` may be a UCS category OR a
 *  production role; the sub level is the UCS subcategory under a category, or the
 *  filename group under a role. */
export function matchesScope(item: any, group: string | null, sub: string | null): boolean {
  if (!group) return true;
  if (isProdRole(group)) {
    if (prodRoleOf(item) !== group) return false;
    if (sub && (item?.classification?.group || 'Unclassified').trim() !== sub) return false;
    return true;
  }
  const [g, sg] = taxonomyKeys(item, 'UCS');
  if (g !== group) return false;
  if (sub && sg !== sub) return false;
  return true;
}

/** The sub-level chips available under a selected top-level scope. */
export function scopeSubgroups(items: any[], group: string): string[] {
  const s = new Set<string>();
  if (isProdRole(group)) {
    for (const it of items) {
      if (prodRoleOf(it) !== group) continue;
      const g = (it?.classification?.group || '').trim();
      if (g && g !== 'Unclassified') s.add(g);
    }
  } else {
    for (const it of items) {
      const [g, sg] = taxonomyKeys(it, 'UCS');
      if (g === group && sg) s.add(sg);
    }
  }
  return Array.from(s).sort();
}

/** Colour for a top-level scope chip, whichever axis it belongs to. */
export function scopeChipColor(name: string): string {
  return isProdRole(name) ? musicProdColor(name) : ucsColor(name);
}

/** Colour for a sub-level scope chip under a selected top-level scope. */
export function scopeSubColor(group: string, sub: string): string {
  return isProdRole(group) ? groupColor(sub, '') : ucsSubColor(group, sub);
}

/** One candidate placement for a record: the matcher's winner, or a runner-up. */
export interface Candidate {
  category: string;
  subcategory: string;
  /** false for a runner-up — the UI greys these out. */
  primary: boolean;
  probability: number;
}

/**
 * Every UCS category a record could plausibly be filed under: the winner plus the
 * runners-up the matcher scored. Scoping and search look at all of them, so a
 * sample whose SECOND guess was METAL still turns up under METAL — just marked as
 * a maybe rather than a hit.
 *
 * Only meaningful for the UCS taxonomy; the music-production role has no runners-up.
 */
export function ucsCandidates(item: any): Candidate[] {
  const out: Candidate[] = [{
    category: item.ucs?.category || '(unclassified)',
    subcategory: (item.ucs?.subcategory || '').trim(),
    primary: true,
    probability: Number(item.ucs?.confidence) || 0,
  }];
  for (const a of (item.ucs?.alternatives || [])) {
    // Records written before alternatives were structured hold a packed string
    // ("DSGNMisc 0.003"); there is no category name in it, so skip those rather
    // than invent one.
    if (!a || typeof a !== 'object' || !a.category) continue;
    out.push({
      category: a.category,
      subcategory: (a.subcategory || '').trim(),
      primary: false,
      probability: Number(a.probability) || 0,
    });
  }
  return out;
}

/**
 * Does a record belong in [group, sub] under this taxonomy, and did it get there
 * on its primary classification or only via an alternative?
 */
export function taxonomyMatch(
  item: any,
  taxonomy: Taxonomy,
  group: string | null,
  sub: string | null,
): { match: boolean; viaAlternative: boolean } {
  if (taxonomy !== 'UCS') {
    const [top, s] = taxonomyKeys(item, taxonomy);
    const match = (!group || top === group) && (!sub || s === sub);
    return { match, viaAlternative: false };
  }
  const hits = ucsCandidates(item).filter(c =>
    (!group || c.category === group) && (!sub || c.subcategory === sub));
  if (!hits.length) return { match: false, viaAlternative: false };
  // A primary hit beats an alternative hit — only grey it out if that is all it has.
  return { match: true, viaAlternative: !hits.some(c => c.primary) };
}
