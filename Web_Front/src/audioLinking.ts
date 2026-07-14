// Audio linking via the File System Access API: the user grants one root
// folder, we recurse the whole tree and index every audio file by its relative
// path, so any loaded .PEAK's records resolve to their sibling files.

const AUDIO_RE = /\.(wav|aif|aiff|flac|mp3|ogg|m4a|opus)$/i;

export function fsaSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

// Keep only audio files. The webkitdirectory picker returns EVERY file in the
// tree (images, .DS_Store, .peak, .asd, …), so counts and matching must filter.
export function filterAudioFiles(files: File[]): File[] {
  return files.filter(f => AUDIO_RE.test(f.name));
}

// Simple IndexedDB wrapper for persisting the directory handle
export async function setDirHandle(handle: any) {
  return new Promise((resolve) => {
    const req = indexedDB.open('ScanalyzerDB', 1);
    req.onupgradeneeded = (e: any) => { e.target.result.createObjectStore('handles'); };
    req.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'audioDir');
      tx.oncomplete = () => resolve(true);
    };
  });
}

export async function getDirHandle(): Promise<any> {
  return new Promise((resolve) => {
    const req = indexedDB.open('ScanalyzerDB', 1);
    req.onupgradeneeded = (e: any) => { e.target.result.createObjectStore('handles'); };
    req.onsuccess = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('handles')) return resolve(null);
      const tx = db.transaction('handles', 'readonly');
      const getReq = tx.objectStore('handles').get('audioDir');
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

// Forget the remembered folder. The handle outlives the directory it points at,
// so a folder that has since been moved, renamed or deleted leaves a handle that
// still reads as permission-granted but throws NotFoundError on the first walk.
export async function clearDirHandle() {
  return new Promise((resolve) => {
    const req = indexedDB.open('ScanalyzerDB', 1);
    req.onupgradeneeded = (e: any) => { e.target.result.createObjectStore('handles'); };
    req.onsuccess = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('handles')) return resolve(true);
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete('audioDir');
      tx.oncomplete = () => resolve(true);
    };
    req.onerror = () => resolve(true);
  });
}

export async function scanDirectoryHandle(dirHandle: any): Promise<File[]> {
  const out: File[] = [];
  async function walk(handle: any, prefix: string) {
    for await (const [name, child] of handle.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'file') {
        if (AUDIO_RE.test(name)) {
          const file = await child.getFile();
          (file as any).relPath = path;
          out.push(file);
        }
      } else if (child.kind === 'directory') {
        await walk(child, path);
      }
    }
  }
  await walk(dirHandle, '');
  return out;
}

// Prompt for a directory and return every audio File within, each tagged with
// its relative path (stashed on `relPath` since webkitRelativePath is read-only).
export async function pickDirectoryFiles(readWrite = false): Promise<File[]> {
  const anyWin = window as any;
  if (!fsaSupported()) {
    throw new Error('This browser does not support the File System Access API (use Chrome or Edge).');
  }
  const dir = await anyWin.showDirectoryPicker({ mode: readWrite ? 'readwrite' : 'read' });
  await setDirHandle(dir);
  return scanDirectoryHandle(dir);
}

export async function writePeakSidecar(rootHandle: any, relPath: string, json: any) {
  try {
    const parts = relPath.split('/');
    const fileName = parts.pop()!.replace(/\.[^./]+$/, '.PEAK');
    let dir = rootHandle;
    for (const part of parts) {
      if (!part) continue;
      dir = await dir.getDirectoryHandle(part);
    }
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(json, null, 2));
    await writable.close();
  } catch (err) {
    console.warn('Could not write sidecar for', relPath, err);
  }
}

function relPathOf(f: File): string {
  return (f as any).relPath || f.webkitRelativePath || '';
}

export function isTauri(): boolean {
  return typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' || typeof (window as any).__TAURI__ !== 'undefined';
}

import { convertFileSrc } from '@tauri-apps/api/core';

// The desktop app resolves audio through the asset protocol, which needs an
// ABSOLUTE path. The Rust scanner records one; the web scanner only ever sees
// webkitRelativePath and records something like "Music Samples/kick.wav". So a
// .PEAK produced in the browser needs an absolute root to be joined onto before
// the desktop app can play it — that is what "Link Audio Folder" stores.
const AUDIO_ROOT_KEY = 'scanalyzer_audio_root';

export function getAudioRoot(): string {
  try { return localStorage.getItem(AUDIO_ROOT_KEY) || ''; } catch { return ''; }
}

export function setAudioRoot(dir: string) {
  try { localStorage.setItem(AUDIO_ROOT_KEY, dir); } catch { /* private mode */ }
}

const isAbsolutePath = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);

export function resolveAudioSrc(files: File[], item: any): string | null {
  const recorded = String(item?.metadata?.path || '');

  if (isTauri() && recorded) {
    if (isAbsolutePath(recorded)) return convertFileSrc(recorded);
    // Relative path (a .PEAK scanned in the browser): join it onto the linked root.
    const root = getAudioRoot().replace(/[/\\]+$/, '');
    return root ? convertFileSrc(`${root}/${recorded}`) : null;
  }

  const wantPath = recorded.replace(/^\.?\/+/, '');
  const wantName = String(item?.metadata?.name || '').toLowerCase();
  
  let found: File | undefined;
  if (wantPath) {
    found = files.find(f => {
      const rp = relPathOf(f);
      return rp && (rp === wantPath || rp.endsWith('/' + wantPath) || rp.endsWith(wantPath));
    });
  }
  if (!found) {
    const wantBase = (wantPath.split('/').pop() || wantName).toLowerCase();
    found = files.find(f => f.name.toLowerCase() === wantBase)
        || (wantName ? files.find(f => f.name.toLowerCase() === wantName) : undefined);
  }
  
  return found ? URL.createObjectURL(found) : null;
}
