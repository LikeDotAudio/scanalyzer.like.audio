"""Reusable record inspector: raw-JSON "exploder" + waveform preview + Play.

One widget, shared by the PEAK Examiner, Groups / CSV, and Auto-Guess tabs so
every table gets the same drill-down: select a row → full record JSON on the
left, waveform with a Play button on the right. A one-shot spectral trace
(whole-file averaged FFT, log-frequency) is overlaid on top of the waveform.
"""
import colorsys
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

from .config import group_color

class RecordInspector(ttk.Panedwindow):
    """JSON view (left) + waveform preview with a Play button (right).

    `play_cb(path)` is invoked when Play is pressed (wire it to the app's
    `_play_file`). Call `show(rec, path)` on row selection; `clear()` to reset.
    """

    def __init__(self, master, play_cb=None, height=9):
        super().__init__(master, orient=tk.HORIZONTAL)
        self._play_cb = play_cb
        self.sel_path = None

        wrap = ttk.Frame(self)
        self.detail = ttk.Treeview(wrap, columns=("value",), show="headings", height=height)
        self.detail.heading("value", text="Value")
        # Wait, if we use show="headings", we can just use 2 columns instead of the tree column!
        self.detail.configure(columns=("field", "value"))
        self.detail.heading("field", text="Field")
        self.detail.column("field", width=160, stretch=False)
        self.detail.heading("value", text="Value")
        self.detail.column("value", width=300, stretch=True)
        vs = ttk.Scrollbar(wrap, orient=tk.VERTICAL, command=self.detail.yview)
        self.detail.configure(yscrollcommand=vs.set)
        vs.pack(side=tk.RIGHT, fill=tk.Y)
        self.detail.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.add(wrap, weight=1)

        wavf = ttk.Frame(self)
        self.fig = Figure(figsize=(8.0, 1.6), dpi=100, facecolor="#1b1b1b")
        self.wax = self.fig.add_subplot(111, facecolor="#0f0f0f")
        # Twin x-axis over the same plot area: time along the bottom for the
        # waveform, log-frequency along the top for the spectral trace.
        self.spec_ax = self.wax.twiny()
        self.fig.subplots_adjust(left=0.02, right=0.99, top=0.78, bottom=0.12)
        self._style_axes()
        self.canvas = FigureCanvasTkAgg(self.fig, master=wavf)
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)

        wctl = ttk.Frame(self.canvas.get_tk_widget(), padding=(4, 2))
        wctl.place(relx=0.98, rely=0.85, anchor=tk.SE)
        
        self.play_btn = ttk.Button(wctl, text="▶ Play", width=8, state=tk.DISABLED,
                                   command=self._play)
        self.play_btn.pack(side=tk.LEFT, padx=(0, 6))
        self.autoplay = tk.BooleanVar(value=True)
        ttk.Checkbutton(wctl, text="auto-play", variable=self.autoplay).pack(
            side=tk.LEFT, padx=(0, 6))
        self.status = ttk.Label(wctl, text="—", foreground="#888")
        self.status.pack(side=tk.LEFT)
        # Middle pane: Feature fingerprint bar chart
        barf = ttk.Frame(self)
        self.bar_fig = Figure(figsize=(4.0, 1.6), dpi=100, facecolor="#1b1b1b")
        self.bar_ax = self.bar_fig.add_subplot(111, facecolor="#0f0f0f")
        self.bar_fig.subplots_adjust(left=0.45, right=0.98, top=0.95, bottom=0.15)
        self.bar_canvas = FigureCanvasTkAgg(self.bar_fig, master=barf)
        self.bar_canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)
        self.add(barf, weight=1)

        self.add(wavf, weight=2)

    # ---- public API --------------------------------------------------------
    def show(self, rec, path):
        """Display one record: key/value table + waveform preview."""
        self.detail.delete(*self.detail.get_children())
        if not rec:
            self.clear()
            return
        gcolor = group_color(rec.get("group") or "", rec.get("subgroup") or "")
        tag = "c" + gcolor.lstrip("#")
        self.detail.tag_configure(tag, foreground=gcolor)
        
        OMIT_FROM_BARS = {
            "length_seconds", "transient_count", "partial_count", 
            "sample_rate", "bit_depth", "envelope_attack_seconds", 
            "envelope_decay_seconds", "envelope_sustain_level", 
            "envelope_release_seconds", "envelope_temporal_centroid", 
            "envelope_skewness", "envelope_kurtosis", "envelope_shape",
            "analyzer_version"
        }
        
        for k, v in rec.items():
            # Omit values that are already visually represented in the graphs
            is_numeric = isinstance(v, (int, float)) and not isinstance(v, bool)
            is_bar_graphed = is_numeric and k not in OMIT_FROM_BARS
            is_env_graphed = k.startswith("envelope_") and k != "envelope_shape"
            if is_bar_graphed or is_env_graphed:
                continue
                
            if isinstance(v, list):
                for i, item in enumerate(v):
                    label = k if i == 0 else ""
                    self.detail.insert("", tk.END, values=(label, str(item)), tags=(tag,))
            else:
                val_str = json.dumps(v) if isinstance(v, dict) else str(v)
                self.detail.insert("", tk.END, values=(k, val_str), tags=(tag,))
        self.sel_path = path
        self._draw_waveform(path, rec, gcolor)
        self._draw_bars(rec, gcolor)

    def clear(self):
        self.detail.delete(*self.detail.get_children())
        self.sel_path = None
        self.play_btn.config(state=tk.DISABLED)
        self.status.config(text="—")
        self.wax.clear()
        self.spec_ax.clear()
        self.bar_ax.clear()
        self._style_axes()
        self.canvas.draw_idle()
        self.bar_canvas.draw_idle()

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
        sx = self.spec_ax
        sx.set_yticks([])
        sx.set_xticks([])  # only the spectral trace populates the top axis
        sx.tick_params(colors="#3fa9ba", labelsize=6, length=2)
        for spine in sx.spines.values():
            spine.set_color("#333")
        sx.patch.set_visible(False)  # keep the waveform visible underneath

    def _draw_bars(self, rec, gcolor):
        ax = self.bar_ax
        ax.clear()
        
        # Mechanism to omit fields from the chart (envelope fields are already
        # overlaid on the waveform; system stats / constants aren't useful to plot)
        OMIT_FIELDS = {
            "length_seconds", "transient_count", "partial_count", 
            "sample_rate", "bit_depth", "envelope_attack_seconds", 
            "envelope_decay_seconds", "envelope_sustain_level", 
            "envelope_release_seconds", "envelope_temporal_centroid", 
            "envelope_skewness", "envelope_kurtosis", "envelope_shape",
            "analyzer_version"
        }
        
        keys = []
        vals = []
        for k, v in rec.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                if k not in OMIT_FIELDS:
                    # Clean up label names so they fit in the left margin
                    short_k = k.replace("spectral_", "").replace("_hz", "").replace("_energy", "").replace("_mean", "").replace("_deviation", "_dev").replace("root_mean_square", "rms").replace("_seconds", "").replace("zero_crossings_per_second", "zcr")
                    keys.append(short_k)
                    vals.append(max(1e-6, abs(float(v))))
        
        if keys:
            y_pos = np.arange(len(keys))
            ax.barh(y_pos, vals, color=gcolor, alpha=0.8, height=0.7)
            ax.set_yticks(y_pos)
            ax.set_yticklabels(keys, fontsize=6, color="#aaa")
            ax.set_xscale("log")
            ax.tick_params(axis='x', colors="#666", labelsize=6)
            for spine in ax.spines.values():
                spine.set_color("#333")
            ax.invert_yaxis()  # Labels read top-to-bottom
        self.bar_canvas.draw_idle()

    @staticmethod
    def read_wav(path):
        """Decode a WAV to (sample_rate, full-resolution mono samples in [-1,1])."""
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
        return (sr or 44100), data

    @classmethod
    def read_wav_preview(cls, path, max_points=2400):
        """Return (times, mono_samples in [-1,1]) downsampled for plotting."""
        sr, data = cls.read_wav(path)
        duration = len(data) / sr
        if len(data) > max_points:
            step = len(data) // max_points
            data = data[::step]
        times = np.linspace(0, duration, len(data)) if len(data) else np.array([])
        return times, data

    @staticmethod
    def compute_spectrum(data, sample_rate, segment=1 << 16, max_segments=32):
        """One-shot spectral trace of the whole file: averaged-magnitude FFT
        (Hann windows), peak-normalized to dB, condensed onto a log-frequency
        grid (bin-max, so narrow peaks survive). Returns (freqs, dB) or None."""
        n = len(data)
        if n < 256 or sample_rate <= 0:
            return None
        seg = int(min(n, segment))
        window = np.hanning(seg)
        starts = np.linspace(0, n - seg, min(max_segments, max(1, n // seg))).astype(int)
        power = np.zeros(seg // 2 + 1)
        for s in starts:
            power += np.abs(np.fft.rfft(data[s:s + seg] * window)) ** 2
        freqs = np.fft.rfftfreq(seg, 1.0 / sample_rate)
        mag = np.sqrt(power / len(starts))
        peak = mag.max()
        low, high = 20.0, sample_rate / 2.0
        if peak <= 0 or high <= low:
            return None
        db = 20.0 * np.log10(np.maximum(mag / peak, 1e-6))
        edges = np.geomspace(low, high, 361)
        idx = np.searchsorted(freqs, edges)
        fx, fy = [], []
        for i, (a, b) in enumerate(zip(idx[:-1], idx[1:])):
            if a >= len(db):
                break
            b = max(min(b, len(db)), a + 1)
            fx.append(np.sqrt(edges[i] * edges[i + 1]))
            fy.append(db[a:b].max())
        return np.array(fx), np.array(fy)

    def _draw_waveform(self, path, rec, gcolor):
        ax = self.wax
        ax.clear()
        self.spec_ax.clear()
        self._style_axes()
        if not path or not os.path.isfile(path):
            ax.set_title("file not found — can't preview", color="#c33", fontsize=8)
            self.play_btn.config(state=tk.DISABLED)
            self.status.config(text="⚠ file not found")
            self.canvas.draw_idle()
            return
        try:
            sr, full = self.read_wav(path)
            duration = len(full) / sr
            data = full
            if len(data) > 2400:
                data = data[::len(data) // 2400]
            times = np.linspace(0, duration, len(data)) if len(data) else np.array([])
            ax.plot(times, data, color=gcolor, linewidth=0.6)
            ax.set_ylim(-1.05, 1.05)
            ax.set_xlim(0, times[-1] if len(times) else 1)
            
            # Overlay ADSR envelope as a dotted/connected white line
            env_att = float(rec.get("envelope_attack_seconds", 0) or 0)
            env_dec = float(rec.get("envelope_decay_seconds", 0) or 0)
            env_sus = float(rec.get("envelope_sustain_level", 0) or 0)
            env_rel = float(rec.get("envelope_release_seconds", 0) or 0)
            
            t1 = min(duration, env_att)
            t2 = min(duration, t1 + env_dec)
            t3 = max(t2, duration - env_rel)
            
            env_t = [0.0, t1, t2, t3, duration]
            env_y = [0.0, 1.0, env_sus, env_sus, 0.0]
            
            ax.plot(env_t, env_y, color="white", linestyle="--", marker="o", markersize=3, alpha=0.8, linewidth=1.0)

            # Name inside the plot (top-left) so it never collides with the
            # frequency tick labels along the top edge.
            ax.text(0.005, 0.96, rec.get("name", "")[:48], transform=ax.transAxes,
                    ha="left", va="top", color=gcolor, fontsize=8)
            self._draw_spectrum(full, sr, gcolor)
            self.play_btn.config(state=tk.NORMAL)
            self.status.config(text=f"{rec.get('length_seconds', 0) or duration:.2f} s")
            if self.autoplay.get() and self._play_cb:
                self._play_cb(path)
        except Exception as e:
            ax.set_title("preview unavailable", color="#c33", fontsize=8)
            self.play_btn.config(state=tk.NORMAL)  # still playable via system player
            self.status.config(text=str(e)[:40])
        self.canvas.draw_idle()

    def _draw_spectrum(self, full, sr, gcolor):
        """Overlay the one-shot spectral trace: log-frequency along the top
        axis, −90…0 dB mapped onto the waveform's full height."""
        sx = self.spec_ax
        spec = self.compute_spectrum(full, sr)
        if spec is None:
            sx.set_xticks([])
            return
        
        # Calculate complimentary color (shift hue by 180 degrees)
        try:
            h = gcolor.lstrip('#')
            r, g, b = tuple(int(h[i:i+2], 16)/255.0 for i in (0, 2, 4))
            h_hsv, s_hsv, v_hsv = colorsys.rgb_to_hsv(r, g, b)
            r_comp, g_comp, b_comp = colorsys.hsv_to_rgb((h_hsv + 0.5) % 1.0, s_hsv, v_hsv)
            comp_color = f"#{int(r_comp * 255):02x}{int(g_comp * 255):02x}{int(b_comp * 255):02x}"
        except Exception:
            comp_color = "#4dd0e1"

        fx, fy = spec
        y = -1.05 + np.clip((fy + 90.0) / 90.0, 0.0, 1.0) * 2.1
        sx.fill_between(fx, -1.05, y, color=comp_color, alpha=0.18, linewidth=0)
        sx.plot(fx, y, color=comp_color, linewidth=0.7, alpha=0.9)
        sx.set_xscale("log")
        sx.set_xlim(fx[0], fx[-1])
        # 12-tone equal temperament minor ticks (sub-divisions for each note)
        minor_ticks = [27.5 * 2 ** (octave + semitone / 12.0) for octave in range(0, 10) for semitone in range(1, 12)]
        minor_ticks = [f for f in minor_ticks if fx[0] <= f <= fx[-1]]
        sx.set_xticks(minor_ticks, minor=True)
        sx.set_xticklabels([], minor=True)
        # Major Ticks on the A-octave series so every frequency carries its note of
        # the scale, note above, frequency below (A4 = 440 Hz).
        ticks = [(f"A{octave}", 27.5 * 2 ** octave) for octave in range(0, 10)]
        ticks = [(n, f) for n, f in ticks if fx[0] <= f <= fx[-1]]
        sx.set_xticks([f for _, f in ticks])
        sx.set_xticklabels([f"{n}\n{f / 1000:.3g}k" if f >= 1000 else f"{n}\n{f:g}"
                            for n, f in ticks])
        
        # Vertical grid line for every second note
        for i, (n, f) in enumerate(ticks):
            if i % 2 == 0:
                sx.axvline(f, color="lightgrey", linewidth=0.5, alpha=0.15)
        sx.text(0.995, 0.96, "spectrum", transform=sx.transAxes, ha="right", va="top",
                color=comp_color, fontsize=6, alpha=0.8)
