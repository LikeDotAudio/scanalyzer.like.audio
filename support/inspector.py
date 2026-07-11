"""Reusable record inspector: raw-JSON "exploder" + waveform preview + Play.

One widget, shared by the PEAK Examiner, Groups / CSV, and Auto-Guess tabs so
every table gets the same drill-down: select a row → full record JSON on the
left, waveform with a Play button on the right.
"""
import json
import os
import wave
import tkinter as tk
from tkinter import ttk

import numpy as np
import matplotlib
matplotlib.use("TkAgg")
from matplotlib.figure import Figure
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg


class RecordInspector(ttk.Panedwindow):
    """JSON view (left) + waveform preview with a Play button (right).

    `play_cb(path)` is invoked when Play is pressed (wire it to the app's
    `_play_file`). Call `show(rec, path)` on row selection; `clear()` to reset.
    """

    def __init__(self, master, play_cb=None, height=9):
        super().__init__(master, orient=tk.HORIZONTAL)
        self._play_cb = play_cb
        self.sel_path = None

        self.detail = tk.Text(self, height=height, bg="#0f0f0f", fg="#cfcf9f",
                              insertbackground="#ccc", font=("Courier", 9), wrap=tk.NONE)
        self.add(self.detail, weight=1)

        wavf = ttk.Frame(self)
        wctl = ttk.Frame(wavf, padding=(4, 2))
        wctl.pack(fill=tk.X)
        self.play_btn = ttk.Button(wctl, text="▶ Play", width=8, state=tk.DISABLED,
                                   command=self._play)
        self.play_btn.pack(side=tk.LEFT)
        self.status = ttk.Label(wctl, text="select a sample", foreground="#888")
        self.status.pack(side=tk.LEFT, padx=8)
        self.fig = Figure(figsize=(4.4, 1.6), dpi=100, facecolor="#1b1b1b")
        self.wax = self.fig.add_subplot(111, facecolor="#0f0f0f")
        self.fig.subplots_adjust(left=0.02, right=0.99, top=0.92, bottom=0.12)
        self._style_axes()
        self.canvas = FigureCanvasTkAgg(self.fig, master=wavf)
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)
        self.add(wavf, weight=2)

    # ---- public API --------------------------------------------------------
    def show(self, rec, path):
        """Display one record: full JSON + waveform preview."""
        self.detail.delete("1.0", tk.END)
        if not rec:
            self.clear()
            return
        self.detail.insert(tk.END, json.dumps(rec, indent=2))
        self.sel_path = path
        self._draw_waveform(path, rec)

    def clear(self):
        self.detail.delete("1.0", tk.END)
        self.sel_path = None
        self.play_btn.config(state=tk.DISABLED)
        self.status.config(text="select a sample")
        self.wax.clear()
        self._style_axes()
        self.canvas.draw_idle()

    # ---- internals ---------------------------------------------------------
    def _play(self):
        if self.sel_path and self._play_cb:
            self._play_cb(self.sel_path)
        else:
            self.status.config(text="⚠ file not found")

    def _style_axes(self):
        ax = self.wax
        ax.tick_params(colors="#666", labelsize=6)
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_color("#333")
        ax.set_facecolor("#0f0f0f")

    @staticmethod
    def read_wav_preview(path, max_points=2400):
        """Return (times, mono_samples in [-1,1]) downsampled for plotting."""
        with wave.open(path, "rb") as w:
            n, sr, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
            raw = w.readframes(n)
        if sw == 3:  # 24-bit little-endian PCM
            a = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
            data = a[:, 0] | (a[:, 1] << 8) | (a[:, 2] << 16)
            data = np.where(data & 0x800000, data - 0x1000000, data).astype(np.float64)
            full = 2 ** 23
        else:
            dtype = {1: np.int8, 2: np.int16, 4: np.int32}.get(sw)
            if dtype is None:
                raise ValueError(f"unsupported sample width {sw}")
            data = np.frombuffer(raw, dtype=dtype).astype(np.float64)
            full = float(np.iinfo(dtype).max) or 1.0
            if sw == 1:  # 8-bit PCM is unsigned, centred at 128
                data = data - 128.0
                full = 128.0
        if ch > 1:
            data = data.reshape(-1, ch).mean(axis=1)
        if full:
            data = data / full
        duration = (n / sr) if sr else (len(data) / 44100.0)
        if len(data) > max_points:
            step = len(data) // max_points
            data = data[::step]
        times = np.linspace(0, duration, len(data)) if len(data) else np.array([])
        return times, data

    def _draw_waveform(self, path, rec):
        ax = self.wax
        ax.clear()
        self._style_axes()
        if not path or not os.path.isfile(path):
            ax.set_title("file not found — can't preview", color="#c33", fontsize=8)
            self.play_btn.config(state=tk.DISABLED)
            self.status.config(text="⚠ file not found")
            self.canvas.draw_idle()
            return
        try:
            times, data = self.read_wav_preview(path)
            ax.plot(times, data, color="#f4902c", linewidth=0.6)
            ax.set_ylim(-1.05, 1.05)
            ax.set_xlim(0, times[-1] if len(times) else 1)
            ax.set_title(rec.get("name", "")[:48], color="#aaa", fontsize=8)
            self.play_btn.config(state=tk.NORMAL)
            self.status.config(text=f"{rec.get('length_seconds', 0):.2f} s · {rec.get('sample_rate', '')} Hz")
        except Exception as e:
            ax.set_title("preview unavailable", color="#c33", fontsize=8)
            self.play_btn.config(state=tk.NORMAL)  # still playable via system player
            self.status.config(text=str(e)[:40])
        self.canvas.draw_idle()
