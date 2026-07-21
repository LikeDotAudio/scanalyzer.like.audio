// Small pieces shared across the Extractor's sub-components.
export type { Region as ExtractorRegion } from '../examiner/detectRegions';

// A distinct hue per region, reused by the arcs, the waveform spans and the table.
export const regionColor = (i: number) => `hsl(${(i * 47) % 360} 75% 58%)`;

// px height of the drag tabs on the in/out boundary lines.
export const HANDLE_H = 8;
