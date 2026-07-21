// Generates the Scanalyzer logo + favicon as SVG: a magnifying glass inspecting
// a wave file. Orange (#f4902c = rgb 244,144,44) lens + handle, blue (#0ea5e9)
// waveform, on a transparent background. Run:  node scripts/gen-logo.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ORANGE = '#f4902c';
const BLUE = '#0ea5e9';
const DARK = '#0b0e14';

// A wave "file" polyline within the lens: a sum of sines under a raised-cosine
// envelope so it tapers to the rim. Returns an SVG path `d`.
function wavePath(cx, cy, r, samples = 48) {
  const span = r - 4;            // horizontal half-width of the trace
  const height = r - 6;          // max vertical amplitude
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);            // 0..1
    const x = cx - span + t * 2 * span;
    const env = Math.sin(t * Math.PI);      // 0 at edges, 1 in the middle
    const w = 0.6 * Math.sin(t * Math.PI * 7) + 0.4 * Math.sin(t * Math.PI * 15);
    const y = cy - env * height * w;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return 'M' + pts.join(' L');
}

function logoSvg({ size = 64, stroke = 4, handle = 6, waveWidth = 2.2 } = {}) {
  const cx = 25, cy = 25, r = 17;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="Scanalyzer logo">
  <defs>
    <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${ORANGE}"/>
      <stop offset="1" stop-color="${BLUE}"/>
    </linearGradient>
    <clipPath id="lens"><circle cx="${cx}" cy="${cy}" r="${r - stroke / 2}"/></clipPath>
  </defs>
  <!-- handle -->
  <line x1="${cx + r * 0.62}" y1="${cy + r * 0.62}" x2="56" y2="56" stroke="${ORANGE}" stroke-width="${handle}" stroke-linecap="round"/>
  <!-- lens fill -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${DARK}"/>
  <!-- waveform inside the lens -->
  <g clip-path="url(#lens)">
    <line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="${BLUE}" stroke-opacity="0.25" stroke-width="1"/>
    <path d="${wavePath(cx, cy, r)}" fill="none" stroke="url(#wave)" stroke-width="${waveWidth}" stroke-linejoin="round" stroke-linecap="round"/>
  </g>
  <!-- lens rim -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ORANGE}" stroke-width="${stroke}"/>
</svg>
`;
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public');
mkdirSync(outDir, { recursive: true });

// Site logo (finer detail) and favicon (bolder strokes so it reads at 16px).
writeFileSync(join(outDir, 'logo.svg'), logoSvg({ stroke: 4, handle: 6, waveWidth: 2.2 }));
writeFileSync(join(outDir, 'favicon.svg'), logoSvg({ stroke: 5, handle: 7, waveWidth: 3 }));
console.log('Wrote public/logo.svg and public/favicon.svg');
