// Group / god-category colour system — a faithful TypeScript port of the
// Python support/config.py so the web 3D cloud colours groups identically to
// the desktop app (same god categories, same palette, same shade maths).

export const GOD_CATEGORIES: [string, string[]][] = [
  ['Percussive', ['Clap', 'Cymbal', 'Hi-Hat', 'Kick', 'Perc', 'Ride', 'Rim', 'Snare', 'Tom']],
  ['Impulsive with Tail', ['IR']],
  ['Tonal', ['Bass', 'Guitar', 'Horn', 'Note', 'Sax', 'Strings', 'Vocal']],
  ['Keyboards', ['Keyboards']],
  ['Complex', ['DJ', 'FX', 'Loops/Patterns', 'Scratch']],
  ['Unassigned', ['Unclassified']],
];

export const CATEGORY_ORDER = GOD_CATEGORIES.map(([cat]) => cat);

const GROUP_TO_CATEGORY: Record<string, string> = {};
for (const [cat, groups] of GOD_CATEGORIES) for (const g of groups) GROUP_TO_CATEGORY[g] = cat;

// Every named group in taxonomy order — used to build the legend.
export const ALL_GROUPS: string[] = GOD_CATEGORIES.flatMap(([, groups]) => groups);

export function godCategory(group: string): string {
  return GROUP_TO_CATEGORY[group] ?? 'Unassigned';
}

// Composite key for a group+subgroup (used for show/hide sets). The unit-
// separator (0x1F) can't occur in a real name, so there are no collisions.
export function subKey(group: string, subgroup: string): string {
  return group + String.fromCharCode(31) + subgroup;
}

// Same palette the desktop cloud uses.
export const CLOUD_PALETTE = [
  '#f4902c', '#8ab4f8', '#4caf50', '#e57373', '#ba68c8', '#4dd0e1',
  '#ffd54f', '#a1887f', '#90a4ae', '#f06292', '#aed581', '#7986cb',
  '#ff8a65', '#4db6ac', '#dce775', '#9575cd', '#ffffff',
];

const GOD_HUES: Record<string, number | null> = {
  Percussive: 0.02,
  'Impulsive with Tail': 0.12,
  Tonal: 0.36,
  Keyboards: 0.55,
  Complex: 0.74,
  Unassigned: null,
};

const CATEGORY_GROUPS: Record<string, string[]> = {};
for (const [cat, groups] of GOD_CATEGORIES) CATEGORY_GROUPS[cat] = groups;

const KNOWN_SUBGROUPS = [
  'Hi', 'Mid', 'Lo', 'Disco', 'Crash', 'Gong', 'Conga', 'Bongo', 'Cowbell',
  'Clave', 'Shaker', 'Block', 'Bell', 'Chime', 'Kalimba', 'Taiko', 'Tabla',
  'Slap', 'Triangle', 'Piano', 'Electric Piano', 'Organ', 'Clav', 'Synth',
  'Beat', 'Groove', 'Guitar', 'Loop', 'Drum',
];

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
  const hx = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

function subgroupNudge(subgroup: string): number {
  if (!subgroup) return 0;
  const idx = KNOWN_SUBGROUPS.indexOf(subgroup);
  if (idx >= 0) return (idx % 9) - 4;
  return (crc32(subgroup) % 9) - 4;
}

export function godColor(category: string): string {
  const hue = GOD_HUES[category];
  if (hue == null) return '#9a9a9a';
  return hsv(hue, 0.78, 0.95);
}

// Deterministic shade for a name group (+ optional subgroup) — identical to the
// desktop app's group_color().
export function groupColor(group: string, subgroup = ''): string {
  if ((group === 'Perc' || group === 'Loops/Patterns') && subgroup) {
    const idx = KNOWN_SUBGROUPS.indexOf(subgroup);
    const i = idx >= 0 ? idx : crc32(subgroup);
    return CLOUD_PALETTE[i % CLOUD_PALETTE.length];
  }
  const cat = godCategory(group);
  const hue = GOD_HUES[cat];
  const members = CATEGORY_GROUPS[cat] ?? [];
  const gi = members.indexOf(group) >= 0 ? members.indexOf(group) : crc32(group || '') % 8;
  const n = Math.max(members.length, 2);
  const t = (gi % n) / (n - 1);
  const sj = subgroupNudge(subgroup);
  if (hue == null) return hsv(0.0, 0.0, 0.5 + 0.35 * t + 0.03 * sj);
  return hsv(hue + (t - 0.5) * 0.09 + 0.005 * sj, 0.85 - 0.3 * t, 0.92 - 0.18 * t + 0.045 * sj);
}
