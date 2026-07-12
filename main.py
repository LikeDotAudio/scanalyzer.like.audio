#!/usr/bin/env python3
"""Sample Analyzer GUI.

The heavy DSP now lives in the Rust binary `oa_sample_analyzer` (see
sample_analyzer_rs/). This script is only the GUI: it picks a folder, launches
the Rust analyzer (30 parallel workers), reads its streamed JSON progress, and
draws a LIVE 3D cloud of the "magic" while the analysis runs — the same cloud
the web front-end shows in SoundBrowse ▸ THE CLOUD:

    X = pitch (Hz)   ·   Y (depth) = name group   ·   Z = complexity / timbre
    point size = sample length   ·   colour = name group (legend)

The Rust process writes `sample_cloud_data.PEAK` with each file's name + folder.

This module is the thin app shell: it wires the shared state, the analysis
subprocess, and file playback. Each notebook tab lives in its own module and is
mixed into AnalyzerApp:

    support.graph_tab.GraphMixin        — 3D cloud
    support.groups_tab.GroupsMixin      — Groups / CSV
    support.examiner_tab.ExaminerMixin  — PEAK Examiner
    support.guess_tab.GuessMixin        — Auto-Guess
    support.rename_tab.RenameMixin      — Flatten / Rename
"""
import os
import sys
import json
import time
import queue
import shutil
import threading
import subprocess
import tkinter as tk
from tkinter import filedialog, ttk, messagebox

from support.config import DEFAULT_DIR, find_binary, find_graph_binary
from support.theme import apply_dark
from support.graph_tab import GraphMixin
from support.groups_tab import GroupsMixin
from support.stats_tab import GroupStatsMixin
from support.examiner_tab import ExaminerMixin
from support.guess_tab import GuessMixin
from support.rename_tab import RenameMixin


class AnalyzerApp(GraphMixin, GroupsMixin, GroupStatsMixin, ExaminerMixin, GuessMixin, RenameMixin):
    def __init__(self, root):
        self.root = root
        self.root.title("Scanalyzer")
        self.root.geometry("820x640")
        apply_dark(self.root)  # near-black theme, bright text

        _default = DEFAULT_DIR if os.path.isdir(DEFAULT_DIR) else "No directory selected"
        self.directory = tk.StringVar(value=_default)
        self.binary = find_binary()
        self.graph_binary = find_graph_binary()
        self.is_analyzing = False
        self.q = queue.Queue()
        self.proc = None

        # blink states
        self._blink_flags = {}
        self._blink_state = False
        self._blink_loop_running = False

        # live cloud data — one entry per analyzed file
        self.d_pitch = []   # X
        self.d_cx = []      # Z (complexity)
        self.d_len = []     # size
        self.d_group = []   # name group -> Y depth + colour
        self.d_rec = []     # full streamed record per point (for click/inspect)
        self.n_loops = 0
        self._legend_groups = None  # last group set drawn in the legend
        self._zoom = 1.0            # scroll-wheel zoom factor
        self._pts = None            # (xs, ys, zs) of current cloud, for picking
        self._sel_txt = None        # overlay annotation for the selected point
        self._sel_marker = None     # highlight marker for the selected point

        self.category_vars = {}     # god-category -> BooleanVar (master show/hide)
        self.group_vars = {}        # group name -> BooleanVar (visible?)
        self.subgroup_vars = {}     # (group, subgroup) -> BooleanVar (visible?)
        self._group_box_keys = None # last group/subgroup structure drawn as checkboxes
        self._pt_recs = []          # records parallel to the plotted points

        # full records (from the .PEAK file) for the Groups / Examiner tabs
        self.records = []
        self.records_by_path = {}   # abs path -> record, for the renamer columns
        self.peak_path = None
        self.root_dir = None        # scanned root, to resolve sample paths

        self._build_ui()
        self.root.after(60, self._drain_queue)

    def _build_ui(self):
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill=tk.BOTH, expand=True)

        scan_tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(scan_tab, text="SCANALIZE")

        top = ttk.Frame(scan_tab, padding=(0, 0, 0, 10))
        top.pack(fill=tk.X)
        ttk.Label(top, text="Directory:", font=("Helvetica", 10, "bold")).pack(side=tk.LEFT, padx=(0, 8))
        ttk.Label(top, textvariable=self.directory, foreground="#c47a1a", wraplength=520).pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(top, text="Browse…", command=self.browse).pack(side=tk.RIGHT)

        row = ttk.Frame(scan_tab, padding=(0, 0, 0, 10))
        row.pack(fill=tk.X)
        self.progress = ttk.Progressbar(row, orient=tk.HORIZONTAL, mode="determinate")
        self.progress.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8))
        self.action_btn = ttk.Button(row, text="Start Analysis", command=self.start, state=tk.DISABLED)
        self.action_btn.pack(side=tk.RIGHT)

        self.status = ttk.Label(scan_tab, text=("Rust binary: " + (self.binary or "NOT BUILT — run: cargo build --release in sample_analyzer_rs/")),
                                foreground=("#2a7" if self.binary else "#c33"), padding=(0, 4))
        self.status.pack(fill=tk.X)

        self._build_cloud_tab()
        self._build_stats_tab()   # 2D stats live right beside the 3D cloud
        self._build_groups_tab()
        self._build_examiner_tab()
        self._build_guess_tab()
        self._build_rename_tab()

        # Enable Start if the default directory is valid and the binary is built.
        if self.binary and os.path.isdir(self.directory.get()):
            self.action_btn.config(state=tk.NORMAL)

    # ---- shared: file resolution + playback -------------------------------
    def _resolve_path(self, rec):
        if rec.get("path") and os.path.isfile(rec["path"]):
            return rec["path"]
        root = self.root_dir or (self.directory.get() if os.path.isdir(self.directory.get()) else None)
        if root:
            p = os.path.join(root, rec.get("folder", ""), rec.get("name", ""))
            if os.path.isfile(p):
                return p
        return None

    def _play_selected(self):
        if not self.selected_rec:
            return
        path = self._resolve_path(self.selected_rec)
        if path:
            self._play_file(path)
        else:
            self.sel_label.config(text="⚠ file not found")

    def set_tab_blinking(self, tab_name, is_blinking):
        for i in range(self.notebook.index("end")):
            txt = self.notebook.tab(i, "text").replace("🔴 ", "")
            if txt == tab_name:
                self._blink_flags[i] = {"blinking": is_blinking, "base": txt}
                if not is_blinking:
                    self.notebook.tab(i, text=txt)
        if any(f["blinking"] for f in self._blink_flags.values()):
            if not self._blink_loop_running:
                self._blink_loop_running = True
                self._run_blink_loop()
                
    def _run_blink_loop(self):
        active = any(f["blinking"] for f in self._blink_flags.values())
        if not active:
            self._blink_loop_running = False
            return
        self._blink_state = not self._blink_state
        for i, f in self._blink_flags.items():
            if f["blinking"]:
                prefix = "🔴 " if self._blink_state else ""
                self.notebook.tab(i, text=prefix + f["base"])
        self.root.after(600, self._run_blink_loop)

    def _stop_playback(self):
        """Stop the sample currently playing (if any) so plays never overlap."""
        proc = getattr(self, "_player_proc", None)
        self._player_proc = None
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass

    def _play_file(self, path):
        self._stop_playback()
        try:
            if sys.platform == "darwin":
                self._player_proc = subprocess.Popen(
                    ["afplay", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            elif os.name == "nt":
                import winsound
                # SND_ASYNC playback is replaced by the next PlaySound call.
                winsound.PlaySound(path, winsound.SND_FILENAME | winsound.SND_ASYNC)
            else:
                player = shutil.which("paplay") or shutil.which("aplay") or shutil.which("ffplay")
                if not player:
                    self.sel_label.config(text="⚠ no audio player (install pulseaudio/alsa)")
                    return
                cmd = [player, "-nodisp", "-autoexit", path] if player.endswith("ffplay") else [player, path]
                self._player_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            self.sel_label.config(text="⚠ " + str(e)[:30])

    # ---- analysis subprocess + streamed results ---------------------------
    def browse(self):
        if self.is_analyzing:
            return
        d = filedialog.askdirectory(title="Select Folder to Analyze")
        if d:
            self.directory.set(d)
            self.action_btn.config(state=(tk.NORMAL if self.binary else tk.DISABLED))

    def start(self):
        if self.is_analyzing or not self.binary:
            return
        directory = self.directory.get()
        if not os.path.isdir(directory):
            messagebox.showerror("Error", "Invalid directory.")
            return
        self.is_analyzing = True
        self.root_dir = directory
        # The Start button becomes the Stop button for the duration of the run.
        self.action_btn.config(text="■ Stop Analysis", command=self.stop_analysis)
        self.set_tab_blinking("SCANALIZE", True)
        self.progress["value"] = 0
        self.d_pitch, self.d_cx, self.d_len, self.d_group, self.d_rec = [], [], [], [], []
        self.n_loops = 0
        self._legend_groups = None
        self._pts = None
        self.selected_rec = None
        self._sel_txt = None
        self._sel_marker = None
        self.play_btn.config(state=tk.DISABLED)
        self.ax.clear(); self._style_axes()
        self.scatter = self.ax.scatter([], [], [], depthshade=True)
        self.scatter.set_clip_on(False)
        if self.ax.get_legend():
            self.ax.get_legend().remove()
        self.canvas.draw_idle()
        threading.Thread(target=self._run, args=(directory,), daemon=True).start()
        # Switch to the 3D Cloud tab so the user can watch it populate live
        self.notebook.select(1)

    def stop_analysis(self):
        """Terminate the Rust analyzer. Per-file sidecars written so far are
        kept, and (version permitting) reused on the next run."""
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
            except Exception:
                pass
        self.status.config(text="Analysis stopped — already-written sidecars will be reused next run.",
                           foreground="#c47a1a")

    def _run(self, directory):
        try:
            self.proc = subprocess.Popen(
                [self.binary, directory, "--workers", "30"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1,
            )
            for line in self.proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    self.q.put(json.loads(line))
                except json.JSONDecodeError:
                    pass
            self.proc.wait()
        except Exception as e:
            self.q.put({"type": "error", "msg": str(e)})
        finally:
            self.q.put({"type": "finished"})

    def _drain_queue(self):
        redraw = False
        try:
            for _ in range(2000):
                msg = self.q.get_nowait()
                t = msg.get("type")
                if t == "start":
                    self.progress.config(maximum=max(1, msg.get("total", 1)))
                elif t in ("result", "skip"):
                    self.progress["value"] = msg.get("done", 0)
                    if t == "result":
                        self.d_pitch.append(msg.get("pitch_hz", 0.0) or 0.0)
                        self.d_cx.append(msg.get("complexity", 0.0) or 0.0)
                        self.d_len.append(msg.get("length_seconds", 0.1) or 0.1)
                        self.d_group.append(msg.get("group", "Other") or "Other")
                        self.d_rec.append(msg)
                        if (msg.get("transient_count", 1) or 1) > 1:
                            self.n_loops += 1
                        redraw = True
                elif t == "done":
                    out = msg.get("out", "")
                    self.status.config(text=f"Done — {msg.get('count', 0)} samples → {out}", foreground="#2a7")
                    self._load_records(out)
                elif t == "error":
                    self.status.config(text="Error: " + msg.get("msg", ""), foreground="#c33")
                elif t == "finished":
                    self.is_analyzing = False
                    self.action_btn.config(text="Start Analysis", command=self.start, state=tk.NORMAL)
                    self.set_tab_blinking("SCANALIZE", False)
        except queue.Empty:
            pass
        if redraw and self.d_pitch:
            # Throttle live redraws: matplotlib's 3D scatter is CPU-bound, so
            # during analysis repaint at most ~once a second. The final state
            # is always drawn by _load_records() when the run completes.
            now = time.monotonic()
            if now - getattr(self, "_last_cloud_draw", 0.0) > 1.0 or not self.is_analyzing:
                self._last_cloud_draw = now
                self._redraw_cloud()
        self.root.after(120, self._drain_queue)

    def _load_records(self, out_path):
        """Load the full .PEAK records (all fields) for the Groups + Examiner tabs."""
        try:
            with open(out_path, encoding="utf-8") as f:
                data = json.load(f)
            self.records = data if isinstance(data, list) else []
            self.records_by_path = {r.get("path"): r for r in self.records if r.get("path")}
            self.peak_path = out_path
            # Prefer the authoritative full records for click-inspect too.
            if self.records and len(self.records) == len(self.d_rec):
                self.d_rec = self.records
            self._rebuild_groups()
            # Auto-load the same file into the examiner.
            self.exam_records = self.records
            self.exam_path = out_path
            self._populate_examiner()
            # Point the Flatten/Rename tab at the analyzed directory.
            if self.root_dir and os.path.isdir(self.root_dir):
                self.rename_dir.set(self.root_dir)
                self._rename_scan()
        except Exception as e:
            self.status.config(text="Loaded but could not read PEAK: " + str(e), foreground="#c33")


def main():
    script_path = os.path.abspath(__file__)
    print(f"Python script path: {script_path}")
    
    root = tk.Tk()
    style = ttk.Style()
    if "clam" in style.theme_names():
        style.theme_use("clam")
    AnalyzerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
