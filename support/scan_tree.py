"""The live scan tree on the SCANALIZE tab (ScanTreeMixin).

Before a run starts, the folder is walked and every audio file it holds is drawn
as an ASCII tree — so the work is visible up front rather than hiding behind a
percentage. As each file comes back from the analyzer its line turns green (or
amber, if the file could not be read). Progress you can point at.

The extension list is the analyzer's own `AUDIO_EXTENSIONS` (decode.rs). If the
two ever drift the tree would promise files the engine never scans, and lines
would sit grey forever looking like a hang.
"""
import os
import tkinter as tk
from tkinter import ttk

AUDIO_EXTENSIONS = {
    "wav", "wave", "mp3", "flac", "aif", "aiff", "aifc", "ogg", "oga", "m4a", "mp4", "aac",
}

PENDING = "#5a5a5a"
DONE    = "#2a7d4f"
SKIPPED = "#c47a1a"
FOLDER  = "#7aa2d0"
CURRENT = "#f4902c"

# Past this many files the tree costs more than it tells you: nobody reads 40,000
# lines, and inserting them freezes the window. Above it, the counters carry the
# progress and the tree says so plainly instead of pretending.
MAX_TREE_FILES = 4000


class ScanTreeMixin:
    def _build_scan_tree(self, parent):
        wrap = ttk.Frame(parent)
        wrap.pack(fill=tk.BOTH, expand=True, pady=(8, 0))

        head = ttk.Frame(wrap)
        head.pack(fill=tk.X)
        self.scan_counts = ttk.Label(head, text="No scan yet", foreground="#888",
                                     font=("Helvetica", 9, "bold"))
        self.scan_counts.pack(side=tk.LEFT)
        self.scan_current = ttk.Label(head, text="", foreground=CURRENT)
        self.scan_current.pack(side=tk.LEFT, padx=12)

        box = ttk.Frame(wrap)
        box.pack(fill=tk.BOTH, expand=True, pady=(4, 0))
        self.scan_text = tk.Text(box, bg="#0f0f0f", fg=PENDING, bd=0, highlightthickness=0,
                                 font=("DejaVu Sans Mono", 9), wrap="none", state=tk.DISABLED,
                                 insertbackground="#eee")
        sb = ttk.Scrollbar(box, orient=tk.VERTICAL, command=self.scan_text.yview)
        self.scan_text.configure(yscrollcommand=sb.set)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        self.scan_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        for tag, colour in (("pending", PENDING), ("done", DONE), ("skipped", SKIPPED),
                            ("folder", FOLDER)):
            self.scan_text.tag_configure(tag, foreground=colour)

        self._tree_lines = {}     # file name -> line number in the widget
        self._tree_total = 0
        self._tree_done = 0
        self._tree_skipped = 0

    # ---- building ---------------------------------------------------------
    def _walk_audio(self, root):
        """Every audio file under `root`, grouped by folder — the same set the
        Rust analyzer will discover."""
        by_folder = {}
        for dirpath, _, files in os.walk(root):
            hits = sorted(f for f in files
                          if f.rsplit(".", 1)[-1].lower() in AUDIO_EXTENSIONS and "." in f)
            if hits:
                by_folder[os.path.relpath(dirpath, root)] = hits
        return by_folder

    def build_scan_tree(self, root):
        """Draw the tree of what is about to be analyzed. Returns the file count."""
        by_folder = self._walk_audio(root)
        total = sum(len(v) for v in by_folder.values())

        self._tree_lines = {}
        self._tree_total = total
        self._tree_done = 0
        self._tree_skipped = 0

        t = self.scan_text
        t.config(state=tk.NORMAL)
        t.delete("1.0", tk.END)

        if total == 0:
            t.insert(tk.END, f"No audio files found under {root}\n", "skipped")
            t.config(state=tk.DISABLED)
            self.scan_counts.config(text="0 files", foreground="#888")
            return 0

        if total > MAX_TREE_FILES:
            t.insert(tk.END,
                     f"{total:,} audio files in {len(by_folder)} folder(s).\n\n"
                     f"The tree is not drawn past {MAX_TREE_FILES:,} files — it would take longer to\n"
                     f"render than the scan takes to run. The counters above track progress.\n",
                     "pending")
            t.config(state=tk.DISABLED)
            self._update_counts()
            return total

        line = 1
        for folder in sorted(by_folder):
            label = "." if folder == "." else folder
            t.insert(tk.END, f"{label}/\n", "folder")
            line += 1
            files = by_folder[folder]
            for i, name in enumerate(files):
                elbow = "└── " if i == len(files) - 1 else "├── "
                t.insert(tk.END, f"{elbow}{name}\n", "pending")
                self._tree_lines[name] = line
                line += 1
        t.config(state=tk.DISABLED)
        self._update_counts()
        return total

    # ---- live updates -----------------------------------------------------
    def mark_scan_file(self, name, skipped=False):
        """Colour one file's line now that the analyzer has returned it."""
        if skipped:
            self._tree_skipped += 1
        else:
            self._tree_done += 1
        self.scan_current.config(text=("⏭ " if skipped else "▶ ") + (name or "")[:70])

        ln = self._tree_lines.get(name)
        if ln is not None:
            t = self.scan_text
            t.config(state=tk.NORMAL)
            start, end = f"{ln}.0", f"{ln}.end"
            t.tag_remove("pending", start, end)
            t.tag_add("skipped" if skipped else "done", start, end)
            t.config(state=tk.DISABLED)
            # Keep the moving edge in view, but not on every single file — the
            # scroll is what makes a fast scan feel like a seizure.
            if (self._tree_done + self._tree_skipped) % 25 == 0:
                t.see(f"{ln}.0")
        self._update_counts()

    def _update_counts(self):
        done, skipped, total = self._tree_done, self._tree_skipped, self._tree_total
        left = max(0, total - done - skipped)
        pct = ((done + skipped) / total * 100) if total else 0
        self.scan_counts.config(
            text=f"{done:,} done · {skipped:,} skipped · {left:,} left  of {total:,}  ({pct:.0f}%)",
            foreground="#2a7" if left == 0 and total else "#ccc")

    def finish_scan_tree(self):
        self.scan_current.config(text="")
        self._update_counts()
