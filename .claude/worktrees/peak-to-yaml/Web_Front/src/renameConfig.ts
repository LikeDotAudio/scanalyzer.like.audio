export type TokenKey =
  | 'folderPath' | 'musicProductionCategory' | 'group' | 'subgroup' | 'timbre'
  | 'instrumentFamily' | 'rootNote' | 'bpm' | 'lengthTier' | 'envelopeShape'
  | 'distortion' | 'cluster' | 'pitch' | 'brightness' | 'harmonicity';

export const TOKEN_LABELS: Record<TokenKey, string> = {
  folderPath: 'Folder Path',
  musicProductionCategory: 'Music Production',
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
      const p = String(item.metadata.path || '');
      const parts = p.split('/').filter(Boolean);
      return parts.length > 1 ? parts.slice(0, -1).join('-') : (parts[0] || '');
    }
    case 'musicProductionCategory': return item.classification?.music_production_category || '';
    case 'group': return item.classification?.group || '';
    case 'subgroup': return item.classification?.subgroup || '';
    case 'timbre': return item.classification.timbre || '';
    case 'instrumentFamily': return item.classification.instrument_family || '';
    case 'rootNote': return item.musicality.root_note_name || '';
    case 'bpm': return item.musicality.beats_per_minute ? `${item.musicality.beats_per_minute}BPM` : '';
    case 'lengthTier': return item.classification?.length_class || '';
    case 'envelopeShape': return item.envelope.envelope_shape || '';
    case 'distortion': return item.spectral_features.distortion || '';
    case 'cluster': return item.unsupervised.cluster != null && item.unsupervised.cluster !== -1 ? `C${item.unsupervised.cluster}` : '';
    case 'pitch': return item.musicality.pitch_hz ? `${Math.round(item.musicality.pitch_hz)}Hz` : '';
    case 'brightness': return item.spectral_features.spectral_centroid_hz ? `${Math.round(item.spectral_features.spectral_centroid_hz)}Hz` : '';
    case 'harmonicity': {
      const h = item.spectral_features?.harmonicity;
      return h != null ? h.toFixed(2) : '';
    }
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
  return buildSlots(['musicProductionCategory', 'group', 'subgroup'],
      ['musicProductionCategory', 'group', 'subgroup', 'timbre', 'instrumentFamily', 'distortion', 'envelopeShape', 'lengthTier', 'cluster']);
}

export function getSavedPrepend(): Slot[] {
  const v = localStorage.getItem('scanalyzer_rename_prepend');
  if (v) try { return JSON.parse(v); } catch {}
  return buildSlots(['musicProductionCategory', 'group', 'subgroup', 'timbre'],
      ['folderPath', 'musicProductionCategory', 'group', 'subgroup', 'timbre', 'instrumentFamily']);
}

export function getSavedAppend(): Slot[] {
  const v = localStorage.getItem('scanalyzer_rename_append');
  if (v) try { return JSON.parse(v); } catch {}
  return buildSlots(['rootNote', 'bpm', 'envelopeShape'],
      ['rootNote', 'bpm', 'lengthTier', 'envelopeShape', 'distortion', 'cluster']);
}

export function generateNewName(item: any, prependSlots?: Slot[], appendSlots?: Slot[]): string {
  if (!item) return '';
  const base = String(item.metadata.name || '').replace(/\.[^.]+$/, '');
  const ext = (String(item.metadata.name || '').match(/\.[^.]+$/) || [''])[0];
  const preArr = prependSlots || getSavedPrepend();
  const postArr = appendSlots || getSavedAppend();
  const pre = preArr.filter(s => s.enabled).map(s => tokenValue(item, s.key)).filter(Boolean);
  const post = postArr.filter(s => s.enabled).map(s => tokenValue(item, s.key)).filter(Boolean);
  return [...pre, base, ...post].join('_') + ext;
}
