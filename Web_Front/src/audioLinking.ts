// Audio linking via the File System Access API: the user grants one root
// folder, we recurse the whole tree and index every audio file by its relative
// path, so any loaded .PEAK's records resolve to their sibling files.

const AUDIO_RE = /\.(wav|aif|aiff|flac|mp3|ogg)$/i;

export function fsaSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

// Prompt for a directory and return every audio File within, each tagged with
// its relative path (stashed on `relPath` since webkitRelativePath is read-only).
export async function pickDirectoryFiles(): Promise<File[]> {
  const anyWin = window as any;
  if (!fsaSupported()) {
    throw new Error('This browser does not support the File System Access API (use Chrome or Edge).');
  }
  const dir = await anyWin.showDirectoryPicker();
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
  await walk(dir, '');
  return out;
}

function relPathOf(f: File): string {
  return (f as any).relPath || f.webkitRelativePath || '';
}

// Resolve a .PEAK record to its audio File — full relative-path match first
// (robust across identically-named files in different folders), then basename.
export function findAudioFile(files: File[], item: any): File | undefined {
  const wantPath = String(item?.path || '').replace(/^\.?\/+/, '');
  const wantName = String(item?.name || '');
  if (wantPath) {
    const byPath = files.find(f => {
      const rp = relPathOf(f);
      return rp && (rp === wantPath || rp.endsWith('/' + wantPath) || rp.endsWith(wantPath));
    });
    if (byPath) return byPath;
  }
  return wantName ? files.find(f => f.name === wantName) : undefined;
}
