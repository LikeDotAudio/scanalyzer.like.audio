// The Sonic Visualiser value→colour chain, ported per the layers audit
// (Documentation/Audit/layers_rendering_audit.md §5):
//   value → peak-normalize → threshold cut (below → index 0 = reserved background)
//         → dB log map → proportion ∈ [0,1] → palette index 1..255 → RGB
// Index 0 bypasses the palette entirely — thresholding is structural, not cosmetic.
// Palette: the Sunset formulas quoted from ColourMapper.cpp:289-427.

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Sunset: piecewise-linear channels — r=(n−0.24)·2.38, g=(n−0.64)·2.777, b triangular.
function sunset(n: number): [number, number, number] {
  const r = clamp01((n - 0.24) * 2.38);
  const g = clamp01((n - 0.64) * 2.777);
  let b = 3.6 * n;
  if (n > 0.277) b = 2.0 - b;
  return [Math.round(r * 255), Math.round(g * 255), Math.round(255 * clamp01(b))];
}

export interface ColourScale {
  // magnitude (linear, same units as peak) → palette index 0..255
  pixelFor(magnitude: number): number;
  // 256 × 4 RGBA lookup table; index 0 is fully transparent (reserved background)
  table: Uint8ClampedArray;
  floorDb: number;
}

/** Build a peak-normalized dB colour scale. `floorDb` is the threshold below which
 *  values map to the reserved background index 0 (SV pixel 0). */
export function makeColourScale(peak: number, floorDb = -80): ColourScale {
  const table = new Uint8ClampedArray(256 * 4);
  // index 0 stays transparent black
  for (let p = 1; p <= 255; p++) {
    const [r, g, b] = sunset((p - 1) / 254);
    const i = p * 4;
    table[i] = r; table[i + 1] = g; table[i + 2] = b; table[i + 3] = 255;
  }
  const safePeak = peak > 0 ? peak : 1;
  const pixelFor = (magnitude: number): number => {
    if (!(magnitude > 0)) return 0;
    const db = 20 * Math.log10(magnitude / safePeak);
    if (db <= floorDb) return 0;                       // threshold → background
    const proportion = (db - floorDb) / -floorDb;       // linear in dB space
    return 1 + Math.min(254, Math.floor(proportion * 254));
  };
  return { pixelFor, table, floorDb };
}

/** Colour for a normalized 0..1 value straight off the Sunset map (legends, ridgelines). */
export function sunsetCss(n: number): string {
  const [r, g, b] = sunset(clamp01(n));
  return `rgb(${r},${g},${b})`;
}
