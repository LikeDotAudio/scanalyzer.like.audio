//! The truncated icosahedron used as a 4th dimension for the sample cloud.
//!
//! The 3D cloud places a sample by three acoustic features. That leaves its
//! CATEGORY to be carried by colour alone, which is why the clusters in the
//! current graph overlap: nothing in the geometry keeps two categories apart.
//!
//! Here category becomes geometric. A truncated icosahedron has 32 faces, and
//! each face is one FACIAL RESPONSE — what a character's face does when this
//! sound plays. Every UCS category routes to exactly one face, so a sample is
//! positioned by its acoustics AND pulled toward the face its category answers
//! to. That pull is the fourth dimension: it is not a spatial axis, it is the
//! response class, and it is what separates the clusters on the ball.
//!
//! ## The solid
//!
//!   F = 32  (12 pentagons + 20 hexagons)
//!   E = 90
//!   V = 60  (every vertex meets two hexagons and one pentagon)
//!   V − E + F = 60 − 90 + 32 = 2                        (Euler)
//!
//! It is built by truncating a regular icosahedron, and that construction is
//! what this file actually performs — nothing here is a hardcoded coordinate
//! table. The correspondence is exact:
//!
//!   * each of the icosahedron's 12 VERTICES becomes a PENTAGON
//!   * each of its 20 FACES becomes a HEXAGON
//!   * each of its 30 EDGES becomes a pair of truncated vertices (→ 60)
//!
//! Face adjacency reproduces E = 90 as a check: a pentagon touches the 5
//! hexagons whose icosahedral faces contain its vertex (12 × 5 = 60), and two
//! hexagons touch where their icosahedral faces share an edge (30). 60 + 30 = 90.
//!
//! Circumradius, for reference: R = ¼·√(58 + 18√5)·a for edge length a.

const PHI = (1 + Math.sqrt(5)) / 2;

export type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.sqrt(dot(a, a));
const dist2 = (a: Vec3, b: Vec3) => { const d = sub(a, b); return dot(d, d); };
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The 12 icosahedron vertices, as the three cyclic families (0,±1,±φ).
 *  In these coordinates every edge has length exactly 2. */
function icosahedronVertices(): Vec3[] {
  const v: Vec3[] = [];
  for (const s of [1, -1]) {
    for (const t of [1, -1]) {
      v.push([0, s, t * PHI]);
      v.push([s, t * PHI, 0]);
      v.push([t * PHI, 0, s]);
    }
  }
  return v;
}

const EDGE2 = 4; // squared edge length in the coordinates above
const NEAR = 1e-9;

/** The 30 edges: every vertex pair exactly one edge length apart. */
function icosahedronEdges(v: Vec3[]): [number, number][] {
  const e: [number, number][] = [];
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 1; j < v.length; j++) {
      if (Math.abs(dist2(v[i], v[j]) - EDGE2) < NEAR) e.push([i, j]);
    }
  }
  return e;
}

/** The 20 faces: every mutually adjacent vertex triple. */
function icosahedronFaces(v: Vec3[]): [number, number, number][] {
  const f: [number, number, number][] = [];
  const adjacent = (i: number, j: number) => Math.abs(dist2(v[i], v[j]) - EDGE2) < NEAR;
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 1; j < v.length; j++) {
      if (!adjacent(i, j)) continue;
      for (let k = j + 1; k < v.length; k++) {
        if (adjacent(i, k) && adjacent(j, k)) f.push([i, j, k]);
      }
    }
  }
  return f;
}

export interface Face {
  index: number;
  kind: 'pentagon' | 'hexagon';
  /** Unit direction from the centre of the solid to this face's centre. */
  center: Vec3;
  /** Two unit vectors spanning the face's tangent plane, for laying samples out
   *  ON the face rather than at a single point. */
  tangentU: Vec3;
  tangentV: Vec3;
}

export interface Solid {
  faces: Face[];
  /** The 60 real vertices of the truncated icosahedron, unit length. */
  vertices: Vec3[];
  /** The 90 edges, as index pairs into `vertices`. */
  edges: [number, number][];
  /** Face adjacency, as index pairs into `faces` — also 90 pairs. */
  faceAdjacency: [number, number][];
}

/**
 * Build the solid. Pentagons come first (indices 0–11, from the icosahedron's
 * vertices), then hexagons (12–31, from its faces), and that ordering is the
 * contract `RESPONSES` below relies on.
 */
export function truncatedIcosahedron(): Solid {
  const iv = icosahedronVertices();
  const ie = icosahedronEdges(iv);
  const iface = icosahedronFaces(iv);

  const centers: { kind: 'pentagon' | 'hexagon'; center: Vec3 }[] = [
    ...iv.map((v) => ({ kind: 'pentagon' as const, center: normalize(v) })),
    ...iface.map((f) => ({
      kind: 'hexagon' as const,
      center: normalize(add(add(iv[f[0]], iv[f[1]]), iv[f[2]])),
    })),
  ];

  const faces: Face[] = centers.map((c, index) => {
    // Any vector not parallel to the normal gives a stable tangent basis.
    const seed: Vec3 = Math.abs(c.center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const tangentU = normalize(cross(c.center, seed));
    const tangentV = normalize(cross(c.center, tangentU));
    return { index, kind: c.kind, center: c.center, tangentU, tangentV };
  });

  // Truncated vertices: each icosahedral edge contributes the two points one
  // third and two thirds along it — the cuts that turn each vertex into a
  // pentagon while leaving each face a hexagon.
  const vertices: Vec3[] = [];
  const vertexOfEdgeEnd = new Map<string, number>();
  ie.forEach(([a, b], ei) => {
    const dir = sub(iv[b], iv[a]);
    vertexOfEdgeEnd.set(`${ei}:a`, vertices.length);
    vertices.push(normalize(add(iv[a], scale(dir, 1 / 3))));
    vertexOfEdgeEnd.set(`${ei}:b`, vertices.length);
    vertices.push(normalize(add(iv[a], scale(dir, 2 / 3))));
  });

  // 30 "hexagon-to-hexagon" edges: the two cuts on one icosahedral edge.
  const edges: [number, number][] = ie.map((_, ei) => [
    vertexOfEdgeEnd.get(`${ei}:a`)!,
    vertexOfEdgeEnd.get(`${ei}:b`)!,
  ]);

  // 60 pentagon edges: around each icosahedral vertex, join its 5 nearest cuts
  // into a ring, ordered by angle in that vertex's tangent plane.
  iv.forEach((v, vi) => {
    const normal = normalize(v);
    const seed: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize(cross(normal, seed));
    const w = normalize(cross(normal, u));
    const ring = ie
      .map((e, ei) => {
        if (e[0] === vi) return vertexOfEdgeEnd.get(`${ei}:a`)!;
        if (e[1] === vi) return vertexOfEdgeEnd.get(`${ei}:b`)!;
        return -1;
      })
      .filter((i) => i >= 0)
      .sort((p, q) => {
        const ap = Math.atan2(dot(vertices[p], w), dot(vertices[p], u));
        const aq = Math.atan2(dot(vertices[q], w), dot(vertices[q], u));
        return ap - aq;
      });
    for (let k = 0; k < ring.length; k++) {
      edges.push([ring[k], ring[(k + 1) % ring.length]]);
    }
  });

  // Face adjacency, the independent route to E = 90.
  const faceAdjacency: [number, number][] = [];
  iface.forEach((f, fi) => {
    f.forEach((vi) => faceAdjacency.push([vi, 12 + fi])); // pentagon ↔ hexagon
  });
  for (let a = 0; a < iface.length; a++) {
    for (let b = a + 1; b < iface.length; b++) {
      const shared = iface[a].filter((x) => iface[b].includes(x));
      if (shared.length === 2) faceAdjacency.push([12 + a, 12 + b]); // hexagon ↔ hexagon
    }
  }

  return { faces, vertices, edges, faceAdjacency };
}

/** Circumsphere radius for a given edge length: R = ¼·√(58 + 18√5)·a. */
export function circumradius(edgeLength: number): number {
  return 0.25 * Math.sqrt(58 + 18 * Math.sqrt(5)) * edgeLength;
}

/** Euler check plus the counts, so a regression in the construction is loud
 *  rather than a subtly wrong ball. Returns null when everything holds. */
export function validateSolid(s: Solid): string | null {
  const V = s.vertices.length, E = s.edges.length, F = s.faces.length;
  const pent = s.faces.filter((f) => f.kind === 'pentagon').length;
  const hex = s.faces.filter((f) => f.kind === 'hexagon').length;
  if (V !== 60) return `expected 60 vertices, built ${V}`;
  if (E !== 90) return `expected 90 edges, built ${E}`;
  if (F !== 32) return `expected 32 faces, built ${F}`;
  if (pent !== 12) return `expected 12 pentagons, built ${pent}`;
  if (hex !== 20) return `expected 20 hexagons, built ${hex}`;
  if (s.faceAdjacency.length !== 90) return `expected 90 adjacencies, built ${s.faceAdjacency.length}`;
  if (V - E + F !== 2) return `Euler: ${V} − ${E} + ${F} = ${V - E + F}, expected 2`;
  return null;
}

// ---------------------------------------------------------------- responses

export type ResponseFamily = 'Viseme' | 'Startle' | 'Effort' | 'Aversion' | 'Attend' | 'Ambient';

export interface FacialResponse {
  id: string;
  name: string;
  family: ResponseFamily;
  /** Blendshape / FACS Action Unit targets the amplitude drives. */
  actionUnits: string[];
  /** Peak blendshape weight at full amplitude (0..1). A gunshot flinches hard;
   *  a distant vehicle should barely move the face. */
  intensity: number;
  /** Minimum gap between re-triggers, so a machine-gun's 15 transients do not
   *  make the face flutter. Per-transient triggering reads the ADSR slice array. */
  cooldownMs: number;
  /** UCS categories that route here. */
  categories: string[];
}

/**
 * The 32 responses, in face order: the first 12 land on pentagons (the primary,
 * high-salience reactions) and the remaining 20 on hexagons (secondary and
 * ambient). Pentagons are the rarer face, which is the right home for the rarer
 * and stronger reactions.
 */
export const RESPONSES: FacialResponse[] = [
  // ---- 12 pentagons: primary, strong blendshape drive
  { id: 'speech-viseme', name: 'Speech Viseme', family: 'Viseme',
    actionUnits: ['JawOpen', 'MouthFunnel', 'MouthPucker', 'MouthClose'],
    intensity: 1.0, cooldownMs: 0, categories: ['VOICES'] },
  { id: 'sung-viseme', name: 'Sung Viseme', family: 'Viseme',
    actionUnits: ['JawOpen', 'MouthFunnel', 'BrowInnerUp'],
    intensity: 1.0, cooldownMs: 0, categories: ['VOCALS'] },
  { id: 'creature-vocal', name: 'Creature Vocalisation', family: 'Viseme',
    actionUnits: ['JawOpen', 'MouthUpperUpLeft', 'MouthUpperUpRight', 'NoseSneer'],
    intensity: 0.85, cooldownMs: 120, categories: ['CREATURES', 'ANIMALS', 'BIRDS'] },
  { id: 'gunshot-flinch', name: 'Gunshot Flinch', family: 'Startle',
    actionUnits: ['EyeSquintLeft', 'EyeSquintRight', 'BrowDown', 'MouthPress'],
    intensity: 1.0, cooldownMs: 260, categories: ['GUNS', 'BULLETS', 'WEAPONS'] },
  { id: 'blast-recoil', name: 'Blast Recoil', family: 'Startle',
    actionUnits: ['EyeBlink', 'BrowDown', 'JawOpen', 'CheekSquint'],
    intensity: 1.0, cooldownMs: 400, categories: ['EXPLOSIONS', 'FIREWORKS', 'NATURAL_DISASTER'] },
  { id: 'impact-wince', name: 'Impact Wince', family: 'Startle',
    actionUnits: ['EyeSquintLeft', 'EyeSquintRight', 'MouthFrown', 'BrowDown'],
    intensity: 0.9, cooldownMs: 220, categories: ['DESTRUCTION', 'FIGHT', 'GORE'] },
  { id: 'shatter-squint', name: 'Shatter Squint', family: 'Startle',
    actionUnits: ['EyeSquintLeft', 'EyeSquintRight', 'NoseSneer'],
    intensity: 0.8, cooldownMs: 180, categories: ['GLASS', 'CERAMICS'] },
  { id: 'alarm-startle', name: 'Alarm Startle', family: 'Startle',
    actionUnits: ['EyeWide', 'BrowInnerUp', 'MouthStretch'],
    intensity: 0.85, cooldownMs: 500, categories: ['ALARMS', 'HORNS'] },
  { id: 'exertion-breath', name: 'Exertion Breath', family: 'Effort',
    actionUnits: ['JawOpen', 'MouthStretch', 'BrowDown'],
    intensity: 0.7, cooldownMs: 90, categories: ['HUMAN', 'SPORTS'] },
  { id: 'locomotion-effort', name: 'Locomotion Effort', family: 'Effort',
    actionUnits: ['MouthPress', 'JawForward'],
    intensity: 0.45, cooldownMs: 140, categories: ['FOOTSTEPS', 'MOVEMENT'] },
  { id: 'disgust-recoil', name: 'Disgust Recoil', family: 'Aversion',
    actionUnits: ['NoseSneer', 'MouthUpperUpLeft', 'MouthUpperUpRight', 'EyeSquint'],
    intensity: 0.8, cooldownMs: 300, categories: ['FARTS', 'LIQUID_MUD', 'FOOD_DRINK'] },
  { id: 'thermal-shiver', name: 'Thermal Shiver', family: 'Aversion',
    actionUnits: ['MouthPress', 'CheekSquint', 'BrowInnerUp'],
    intensity: 0.6, cooldownMs: 350, categories: ['SNOW', 'ICE', 'FIRE', 'GEOTHERMAL'] },

  // ---- 20 hexagons: secondary, attentional and ambient
  { id: 'crowd-attend', name: 'Crowd Attend', family: 'Attend',
    actionUnits: ['EyeLookOut', 'BrowInnerUp'],
    intensity: 0.4, cooldownMs: 600, categories: ['CROWDS'] },
  { id: 'comms-attend', name: 'Comms Attend', family: 'Attend',
    actionUnits: ['EyeLookIn', 'BrowInnerUp'],
    intensity: 0.35, cooldownMs: 400, categories: ['COMMUNICATIONS', 'USER_INTERFACE', 'BEEPS'] },
  { id: 'machine-drone', name: 'Machine Drone', family: 'Ambient',
    actionUnits: ['BrowDown'],
    intensity: 0.15, cooldownMs: 1200, categories: ['MACHINES', 'MECHANICAL', 'MOTORS', 'EQUIPMENT'] },
  { id: 'vehicle-pass', name: 'Vehicle Pass', family: 'Ambient',
    actionUnits: ['EyeLookOut'],
    intensity: 0.2, cooldownMs: 900, categories: ['VEHICLES', 'AIRCRAFT', 'BOATS', 'TRAINS'] },
  { id: 'electric-tick', name: 'Electric Tick', family: 'Attend',
    actionUnits: ['EyeBlink', 'BrowInnerUp'],
    intensity: 0.3, cooldownMs: 500, categories: ['ELECTRICITY', 'COMPUTERS', 'ROBOTS'] },
  { id: 'scifi-wonder', name: 'Sci-Fi Wonder', family: 'Attend',
    actionUnits: ['EyeWide', 'BrowOuterUp'],
    intensity: 0.45, cooldownMs: 500, categories: ['SCIFI', 'LASERS', 'MAGIC'] },
  { id: 'designed-abstract', name: 'Designed / Abstract', family: 'Ambient',
    actionUnits: [],
    intensity: 0.1, cooldownMs: 1000, categories: ['DESIGNED', 'SWOOSHES', 'SYNTH', 'LOOPS'] },
  { id: 'toon-react', name: 'Cartoon React', family: 'Attend',
    actionUnits: ['EyeWide', 'MouthSmile', 'BrowOuterUp'],
    intensity: 0.7, cooldownMs: 200, categories: ['CARTOON', 'TOYS', 'GAMES'] },
  { id: 'metal-ring', name: 'Metal Ring', family: 'Attend',
    actionUnits: ['EyeSquint', 'BrowDown'],
    intensity: 0.4, cooldownMs: 300, categories: ['METAL', 'CHAINS', 'BELLS', 'CYMBALS'] },
  { id: 'wood-knock', name: 'Wood Knock', family: 'Attend',
    actionUnits: ['EyeBlink', 'EyeLookOut'],
    intensity: 0.35, cooldownMs: 300, categories: ['WOOD', 'DOORS', 'DRAWERS', 'WINDOWS'] },
  { id: 'soft-handle', name: 'Soft Handling', family: 'Ambient',
    actionUnits: [],
    intensity: 0.12, cooldownMs: 800, categories: ['CLOTH', 'LEATHER', 'RUBBER', 'PAPER', 'PLASTIC', 'ROPE'] },
  { id: 'granular-ground', name: 'Granular Ground', family: 'Ambient',
    actionUnits: ['EyeLookDown'],
    intensity: 0.18, cooldownMs: 700, categories: ['DIRT_SAND', 'ROCKS', 'VEGETATION'] },
  { id: 'water-flow', name: 'Water Flow', family: 'Ambient',
    actionUnits: [],
    intensity: 0.12, cooldownMs: 1000, categories: ['WATER', 'RAIN'] },
  { id: 'ambient-observe', name: 'Ambient / Observe', family: 'Ambient',
    actionUnits: ['EyeLookOut', 'EyeLookIn'],
    intensity: 0.08, cooldownMs: 1500, categories: ['AMBIENCE', 'WIND', 'AIR', 'WEATHER', 'ARCHIVED'] },
  { id: 'tool-work', name: 'Tool Work', family: 'Effort',
    actionUnits: ['BrowDown', 'MouthPress'],
    intensity: 0.35, cooldownMs: 350, categories: ['TOOLS', 'FOLEY', 'OBJECTS', 'CHEMICALS'] },
  { id: 'wing-flutter', name: 'Wing Flutter', family: 'Attend',
    actionUnits: ['EyeBlink', 'EyeLookUp'],
    intensity: 0.3, cooldownMs: 400, categories: ['WINGS'] },
  { id: 'clock-tick', name: 'Clock Tick', family: 'Ambient',
    actionUnits: ['EyeBlink'],
    intensity: 0.15, cooldownMs: 900, categories: ['CLOCKS'] },
  { id: 'whistle-attend', name: 'Whistle Attend', family: 'Attend',
    actionUnits: ['EyeWide', 'BrowInnerUp'],
    intensity: 0.5, cooldownMs: 450, categories: ['WHISTLES'] },
  { id: 'percussive-music', name: 'Percussive Music', family: 'Ambient',
    actionUnits: ['JawOpen'],
    intensity: 0.2, cooldownMs: 250, categories: ['DRUMS', 'PERCUSSION', 'MALLET'] },
  { id: 'melodic-music', name: 'Melodic Music', family: 'Ambient',
    actionUnits: [],
    intensity: 0.12, cooldownMs: 800,
    categories: ['PIANO', 'GUITAR', 'STRINGS', 'BRASS', 'WOODWIND', 'KEYBOARD'] },
];

/** The response a sound with no recognised category falls back to. Deliberately
 *  the most inert one: an unclassified sound must not drive a face. */
export const FALLBACK_RESPONSE_INDEX =
  RESPONSES.findIndex((r) => r.id === 'ambient-observe');

const CATEGORY_TO_FACE: Map<string, number> = (() => {
  const m = new Map<string, number>();
  RESPONSES.forEach((r, i) => r.categories.forEach((c) => m.set(c.toUpperCase(), i)));
  return m;
})();

/** Face index (0–31) for a UCS category name. */
export function faceOfCategory(category: string | undefined | null): number {
  if (!category) return FALLBACK_RESPONSE_INDEX;
  const hit = CATEGORY_TO_FACE.get(category.trim().toUpperCase());
  return hit === undefined ? FALLBACK_RESPONSE_INDEX : hit;
}

/** Face index for a record. */
export function faceOfItem(item: any): number {
  return faceOfCategory(item?.ucs?.category);
}

/** Every category that routes to a face, for legends and hover panels. */
export function categoriesOfFace(faceIndex: number): string[] {
  return RESPONSES[faceIndex]?.categories ?? [];
}

/** Categories the RESPONSES table does not mention — a real gap, since such a
 *  sound silently lands on the inert fallback. Pass the taxonomy's category list. */
export function unmappedCategories(all: string[]): string[] {
  return all.filter((c) => !CATEGORY_TO_FACE.has(c.trim().toUpperCase()));
}

// ------------------------------------------------------- blendshape driving

/**
 * The blendshape weight timeline for one record, one keyframe per transient.
 *
 * This is where the per-slice ADSR earns its keep. A file-level attack/decay is
 * meaningless on a multi-event sound — a 15-round burst has 15 attacks, and
 * animating one envelope across the whole file would make the face wince once,
 * slowly, over three seconds. Each slice drives its own trigger, scaled by that
 * slice's own level, and the response's cooldown suppresses re-triggers that are
 * too close together to read as separate reactions.
 */
export interface BlendshapeKey {
  timeSeconds: number;
  /** 0..1 target weight for this response's action units. */
  weight: number;
  /** Seconds to reach the weight, and to fall back to neutral — taken from the
   *  slice's own measured attack and release. */
  attackSeconds: number;
  releaseSeconds: number;
}

export function blendshapeTimeline(item: any): { response: FacialResponse; keys: BlendshapeKey[] } {
  const faceIndex = faceOfItem(item);
  const response = RESPONSES[faceIndex];
  const slices: any[] = Array.isArray(item?.envelope?.slices) ? item.envelope.slices : [];
  const keys: BlendshapeKey[] = [];
  let lastTriggerMs = -Infinity;

  for (const s of slices) {
    const t = Number(s.start_seconds) || 0;
    const tMs = t * 1000;
    if (tMs - lastTriggerMs < response.cooldownMs) continue; // too soon to read as separate
    lastTriggerMs = tMs;
    const level = Math.max(0, Math.min(1, Number(s.relative_level ?? 1)));
    keys.push({
      timeSeconds: t,
      weight: level * response.intensity,
      attackSeconds: Math.max(0.01, Number(s.envelope_attack_seconds) || 0.02),
      releaseSeconds: Math.max(0.05, Number(s.envelope_release_seconds) || 0.15),
    });
  }
  return { response, keys };
}
