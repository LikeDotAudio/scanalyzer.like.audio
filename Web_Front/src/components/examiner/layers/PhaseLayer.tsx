// Phase layer: per-column normalized inter-channel correlation in [−1, +1] —
// +1 (in-phase) at the top of its band, −1 (mono-fold cancellation risk) at the
// bottom. Stereo only: auto-hidden for mono files via needsStereo.

import type { PlotGeo } from '../audioAnalysis';
import { drawPhase } from '../drawOverlays';
import type { ExaminerLayer, LayerData } from './types';

export const PHASE_COLOUR = '#FB7185';

export const PhaseLayer: ExaminerLayer = {
  id: 'phase',
  label: 'phase',
  legendColour: () => PHASE_COLOUR,
  domain: 'time',
  defaultPlacement: 'bottom',
  rowHeightWeight: 1,
  needsStereo: true,

  draw(ctx: CanvasRenderingContext2D, geo: PlotGeo, data: LayerData) {
    if (data.right) drawPhase(ctx, data.left, data.right, geo, PHASE_COLOUR);
  },
};
