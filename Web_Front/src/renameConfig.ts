export type TokenKey =
  | 'folderPath' | 'godCategory' | 'group' | 'subgroup' | 'timbre'
  | 'instrumentFamily' | 'rootNote' | 'bpm' | 'lengthTier' | 'envelopeShape'
  | 'distortion' | 'cluster' | 'pitch' | 'brightness' | 'harmonicity';

export const TOKEN_LABELS: Record<TokenKey, string> = {
  folderPath: 'Folder Path',
  godCategory: 'God Category',
  group: 'Group',
  subgroup: 'Subgroup',
  timbre: 'Timbre',
  instrumentFamily: 'Instrument Family',
  rootNote: 'Root Note',
  bpm: 'BPM',
  lengthTier: 'Length Tier',
  envelopeShape: 'Envelope Shape',
  distortion: 'Distortion',
  cluster: 'Cluster',
  pitch: 'Pitch',
  brightness: 'Brightness',
  harmonicity: 'Harmonicity',
};

export const ALL_TOKENS = Object.keys(TOKEN_LABELS) as TokenKey[];

export function tokenValue(item: any, key: TokenKey): string {
  switch (key) {
    case 'folderPath': {
      const p = String(item.path || '');
      const parts = p.split('/').filter(Boolean);
      return parts.length > 1 ? parts.slice(0, -1).join('-') : (parts[0] || '');
    }
    case 'godCategory': return item.god_category || '';
    case 'group': return item.group || '';
    case 'subgroup': return item.subgroup || '';
    case 'timbre': return item.timbre || '';
    case 'instrumentFamily': return item.instrument_family || '';
    case 'rootNote': return item.root_note_name || '';
    case 'bpm': return item.beats_per_minute ? `${item.beats_per_minute}BPM` : '';
    case 'lengthTier': return item.length_tier || '';
    case 'envelopeShape': return item.envelope_shape || '';
    case 'distortion': return item.distortion || '';
    case 'cluster': return item.cluster != null && item.cluster !== -1 ? `C${item.cluster}` : '';
    case 'pitch': return item.pitch_hz ? `${Math.round(item.pitch_hz)}Hz` : '';
    case 'brightness': return item.spectral_centroid_hz ? `${Math.round(item.spectral_centroid_hz)}Hz` : '';
    case 'harmonicity': return item.harmonicity != null ? item.harmonicity.toFixed(2) : '';
    default: return '';
  }
}

export interface Slot { key: TokenKey; enabled: boolean; }

export function buildSlots(enabledDefaults: TokenKey[], order: TokenKey[]): Slot[] {
  const seen = new Set(order);
  const full = [...order, ...ALL_TOKENS.filter(k => !seen.has(k))];
  return full.map(key => ({ key, enabled: enabledDefaults.includes(key) }));
}

export function getSavedSubfolders(): Slot[] {
  const v = localStorage.getItem('scanalyzer_rename_subfolders');
  if (v) try { return JSON.parse(v); } catch {}
  return buildSlots(['godCategory', 'group', 'subgroup'],
      ['godCategory', 'group', 'subgroup', 'timbre', 'instrumentFamily', 'distortion', 'envelopeShape', 'lengthTier', 'cluster']);
}

export function getSavedPrepend(): Slot[] {
  const v = localStorage.getItem('scanalyzer_rename_prepend');
  if (v) try { return JSON.parse(v); } catch {}
  return buildSlots(['godCategory', 'group', 'subgroup', 'timbre'],
      ['folderPath', 'godCategory', 'group', 'subgroup', 'timbre', 'instrumentFamily']);
}

export function getSavedAppend(): Slot[] {
  const v = localStorage.getItem('scanalyzer_rename_append');
  if (v) try { return JSON.parse(v); } catch {}
  return buildSlots(['rootNote', 'bpm', 'envelopeShape'],
      ['rootNote', 'bpm', 'lengthTier', 'envelopeShape', 'distortion', 'cluster']);
}

export function generateNewName(item: any, prependSlots?: Slot[], appendSlots?: Slot[]): string {
  if (!item) return '';
  const base = String(item.name || '').replace(/\.[^.]+$/, '');
  const ext = (String(item.name || '').match(/\.[^.]+$/) || [''])[0];
  const preArr = prependSlots || getSavedPrepend();
  const postArr = appendSlots || getSavedAppend();
  const pre = preArr.filter(s => s.enabled).map(s => tokenValue(item, s.key)).filter(Boolean);
  const post = postArr.filter(s => s.enabled).map(s => tokenValue(item, s.key)).filter(Boolean);
  return [...pre, base, ...post].join('_') + ext;
}
