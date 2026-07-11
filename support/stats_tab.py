"""2D Stats tab — per-group deep dive across measurements (GroupStatsMixin).

Pick a name group and explore the spread of its measurements: a 2D scatter of
any measurement against any other, plus a summary table (count / mean / std /
min / median / max) for every measurement in that group.
"""
import tkinter as tk
from tkinter import ttk

import numpy as np
import matplotlib
matplotlib.use("TkAgg")
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

from .config import CLOUD_PALETTE, god_category, god_color, group_color
from .inspector import RecordInspector

class GroupStatsMixin:
    # Numeric measurements available for the deep dive.
    STATS_MEASURES = [
        ("Pitch", "pitch_hz"), ("Length", "length_seconds"), ("Complexity", "complexity"),
        ("Brightness (centroid)", "spectral_centroid_hz"), ("Harmonicity", "harmonicity"),
        ("Sustain", "sustain_ratio"), ("Attack", "attack_seconds"), ("BPM", "beats_per_minute"),
        ("RMS", "root_mean_square_level"), ("ZCR", "zero_crossings_per_second"), ("Roll-off", "spectral_rolloff_hz"),
        ("Flatness", "spectral_flatness"), ("Transients", "transient_count"),
    ]
    STATS_TABLE_COLS = ("n", "mean", "std", "min", "median", "max")

    def _build_stats_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="2D Stats")

        # Progressive Isolation group selectors
        gwrap = ttk.Frame(tab, padding=(6, 4, 6, 0))
        gwrap.pack(fill=tk.X)
        
        self.stats_god_bar = tk.Frame(gwrap, bg="#1e1e1e")
        self.stats_god_bar.pack(fill=tk.X, pady=(0, 2))
        self.stats_god_bar.bind("<Configure>", lambda e: self._reflow_buttons(self.stats_god_bar, self.stats_god_btns))
        self.stats_god = tk.StringVar(value="")
        self.stats_god_btns = {}
        
        self.stats_group_bar = tk.Frame(gwrap, bg="#1e1e1e")
        self.stats_group_bar.pack(fill=tk.X, pady=(0, 2))
        self.stats_group_bar.bind("<Configure>", lambda e: self._reflow_buttons(self.stats_group_bar, self.stats_group_btns))
        self.stats_group = tk.StringVar(value="")
        self.stats_group_btns = {}

        self.stats_sub_bar = tk.Frame(gwrap, bg="#1e1e1e")
        self.stats_sub_bar.pack(fill=tk.X)
        self.stats_sub_bar.bind("<Configure>", lambda e: self._reflow_buttons(self.stats_sub_bar, self.stats_sub_btns))
        self.stats_subgroup = tk.StringVar(value="")
        self.stats_sub_btns = {}

        ctl = ttk.Frame(tab, padding=6)
        ctl.pack(fill=tk.X)
        labels = [l for l, _k in self.STATS_MEASURES]
        ttk.Label(ctl, text="X:").pack(side=tk.LEFT, padx=(0, 4))
        self.stats_x = tk.StringVar(value="Complexity")
        xcb = ttk.Combobox(ctl, textvariable=self.stats_x, state="readonly", width=18, values=labels)
        xcb.pack(side=tk.LEFT, padx=(0, 10))
        ttk.Label(ctl, text="Y:").pack(side=tk.LEFT, padx=(0, 4))
        self.stats_y = tk.StringVar(value="Brightness (centroid)")
        ycb = ttk.Combobox(ctl, textvariable=self.stats_y, state="readonly", width=18, values=labels)
        ycb.pack(side=tk.LEFT)
        for var in (self.stats_x, self.stats_y):
            var.trace_add("write", lambda *_: self._redraw_stats())
        self.stats_play_btn = ttk.Button(ctl, text="▶ Play", width=8, state=tk.DISABLED,
                                         command=self._stats_play)
        self.stats_play_btn.pack(side=tk.LEFT, padx=(12, 4))
        self.stats_sel_label = ttk.Label(ctl, text="click a point to hear it", foreground="#c47a1a")
        self.stats_sel_label.pack(side=tk.LEFT)
        self.stats_summary = ttk.Label(ctl, text="No analysis yet", foreground="#888")
        self.stats_summary.pack(side=tk.RIGHT)

        pane = ttk.Panedwindow(tab, orient=tk.VERTICAL)
        pane.pack(fill=tk.BOTH, expand=True)

        body = ttk.Panedwindow(pane, orient=tk.HORIZONTAL)
        pane.add(body, weight=3)

        self.stats_inspector = RecordInspector(pane, play_cb=lambda p: getattr(self, "_play_file")(p), height=7)
        pane.add(self.stats_inspector, weight=1)

        left = ttk.Frame(body)
        self.stats_fig = Figure(figsize=(4.6, 4.0), dpi=100, facecolor="#1b1b1b")
        self.stats_ax = self.stats_fig.add_subplot(111, facecolor="#0f0f0f")
        self.stats_canvas = FigureCanvasTkAgg(self.stats_fig, master=left)
        cw = self.stats_canvas.get_tk_widget()
        cw.pack(fill=tk.BOTH, expand=True)
        cw.configure(takefocus=True)
        cw.bind("<Enter>", lambda e: cw.focus_set())
        cw.bind("<Up>", lambda e: self._stats_nav(0, 1))
        cw.bind("<Down>", lambda e: self._stats_nav(0, -1))
        cw.bind("<Left>", lambda e: self._stats_nav(-1, 0))
        cw.bind("<Right>", lambda e: self._stats_nav(1, 0))
        self.stats_canvas.mpl_connect("button_press_event", self._stats_click)
        body.add(left, weight=3)

        self.stats_sel_rec = None       # currently selected sample
        self._stats_sel_idx = None      # index of the selected sample
        self._stats_pts = None          # (xs, ys) of plotted points, for picking
        self._stats_recs = []           # records parallel to the plotted points
        self._stats_marker = None       # highlight ring for the picked point

        right = ttk.Frame(body)
        tv = ttk.Treeview(right, columns=self.STATS_TABLE_COLS, show="tree headings", height=14)
        tv.heading("#0", text="Measurement", command=lambda: self._tv_sort(tv, "#0", False))
        tv.column("#0", width=150, stretch=True)
        for c in self.STATS_TABLE_COLS:
            tv.heading(c, text=c, command=lambda cc=c: self._tv_sort(tv, cc, False))
            tv.column(c, width=64, anchor=tk.E)
        tvs = ttk.Scrollbar(right, orient=tk.VERTICAL, command=tv.yview)
        tv.configure(yscrollcommand=tvs.set)
        tvs.pack(side=tk.RIGHT, fill=tk.Y)
        tv.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.stats_tv = tv
        body.add(right, weight=2)

        self._stats_group_keys = None
        self._style_stats_axes()

    def _style_stats_axes(self):
        ax = self.stats_ax
        ax.tick_params(colors="#888", labelsize=7)
        for spine in ax.spines.values():
            spine.set_color("#333")
        ax.set_facecolor("#0f0f0f")
        ax.grid(True, color="#222", linewidth=0.6)

    def _stats_records(self):
        return self.d_rec if self.d_rec else self.records

    def _measure_key(self, label):
        for l, k in self.STATS_MEASURES:
            if l == label:
                return k
        return "complexity"

    def _refresh_stats_groups(self):
        recs = self._stats_records()
        if not recs:
            return
        
        gods = sorted({god_category(r.get("group") or "Other") for r in recs})
        
        if getattr(self, "_stats_god_keys", None) == gods:
            return
        self._stats_god_keys = gods
        
        for b in self.stats_god_btns.values(): b.destroy()
        self.stats_god_btns = {}
        for g in gods:
            b = tk.Button(self.stats_god_bar, text=g, font=("Helvetica", 8), padx=6, pady=1,
                          bg="#2a2a2a", fg=god_color(g), activebackground="#3a3a3a", activeforeground="#fff",
                          relief=tk.RAISED, bd=1, command=lambda gg=g: self._select_stats_god(gg))
            self.stats_god_btns[g] = b
            
        self._reflow_buttons(self.stats_god_bar, self.stats_god_btns)
        if gods and not self.stats_god.get():
            self._select_stats_god(gods[0])
        else:
            self._update_group_buttons()

    def _select_stats_god(self, god):
        self.stats_god.set(god)
        self.stats_group.set("")
        self.stats_subgroup.set("")
        self._highlight_buttons()
        self._update_group_buttons()
        self._redraw_stats()

    def _update_group_buttons(self):
        recs = self._stats_records()
        god = self.stats_god.get()
        
        groups = sorted({r.get("group") or "Other" for r in recs if god_category(r.get("group") or "Other") == god})
        
        for b in self.stats_group_btns.values(): b.destroy()
        self.stats_group_btns = {}
        for g in groups:
            b = tk.Button(self.stats_group_bar, text=g, font=("Helvetica", 8), padx=6, pady=1,
                          bg="#2a2a2a", fg=group_color(g), activebackground="#3a3a3a", activeforeground="#fff",
                          relief=tk.RAISED, bd=1, command=lambda gg=g: self._select_stats_group(gg))
            self.stats_group_btns[g] = b
            
        self._reflow_buttons(self.stats_group_bar, self.stats_group_btns)
        self._update_subgroup_buttons()

    def _select_stats_group(self, group):
        if self.stats_group.get() == group:
            self.stats_group.set("")
        else:
            self.stats_group.set(group)
        self.stats_subgroup.set("")
        self._highlight_buttons()
        self._update_subgroup_buttons()
        self._redraw_stats()

    def _update_subgroup_buttons(self):
        recs = self._stats_records()
        group = self.stats_group.get()
        
        for b in self.stats_sub_btns.values(): b.destroy()
        self.stats_sub_btns = {}
        
        if not group:
            self._reflow_buttons(self.stats_sub_bar, self.stats_sub_btns)
            return
            
        subs = sorted({r.get("subgroup") or group for r in recs if (r.get("group") or "Other") == group})
        if len(subs) <= 1:
            subs = []
            
        for s in subs:
            b = tk.Button(self.stats_sub_bar, text=s, font=("Helvetica", 8), padx=6, pady=1,
                          bg="#2a2a2a", fg=group_color(group, s), activebackground="#3a3a3a", activeforeground="#fff",
                          relief=tk.RAISED, bd=1, command=lambda ss=s: self._select_stats_subgroup(ss))
            self.stats_sub_btns[s] = b
            
        self._reflow_buttons(self.stats_sub_bar, self.stats_sub_btns)

    def _select_stats_subgroup(self, sub):
        if self.stats_subgroup.get() == sub:
            self.stats_subgroup.set("")
        else:
            self.stats_subgroup.set(sub)
        self._highlight_buttons()
        self._redraw_stats()

    def _highlight_buttons(self):
        god = self.stats_god.get()
        grp = self.stats_group.get()
        sub = self.stats_subgroup.get()
        
        for g, b in self.stats_god_btns.items():
            if g == god:
                b.config(bg=god_color(g), fg="#111", relief=tk.SUNKEN)
            else:
                b.config(bg="#2a2a2a", fg=god_color(g), relief=tk.RAISED)
                
        for g, b in self.stats_group_btns.items():
            if g == grp:
                b.config(bg=group_color(g), fg="#111", relief=tk.SUNKEN)
            else:
                b.config(bg="#2a2a2a", fg=group_color(g), relief=tk.RAISED)
                
        for s, b in self.stats_sub_btns.items():
            if s == sub:
                b.config(bg=group_color(grp, s), fg="#111", relief=tk.SUNKEN)
            else:
                b.config(bg="#2a2a2a", fg=group_color(grp, s), relief=tk.RAISED)

    def _reflow_buttons(self, bar, btns_dict):
        if not btns_dict:
            return
        width = bar.winfo_width() or 760
        cols = max(1, width // 88)
        for i, b in enumerate(btns_dict.values()):
            b.grid(row=i // cols, column=i % cols, sticky="ew", padx=1, pady=1)
        for c in range(cols):
            bar.grid_columnconfigure(c, weight=1)

    def _redraw_stats(self):
        if not hasattr(self, "stats_ax"):
            return
        ax = self.stats_ax
        ax.clear()
        self._style_stats_axes()
        self.stats_tv.delete(*self.stats_tv.get_children())
        # Reset picking state (the old artists were just cleared).
        self._stats_marker = None
        self._stats_sel_idx = None
        self.stats_sel_rec = None
        self.stats_play_btn.config(state=tk.DISABLED)
        self.stats_sel_label.config(text="click a point to hear it")
        if hasattr(self, "stats_inspector"):
            self.stats_inspector.clear()

        god = self.stats_god.get()
        grp = self.stats_group.get()
        sub = self.stats_subgroup.get()
        
        recs = self._stats_records()
        
        if god:
            recs = [r for r in recs if god_category(r.get("group") or "Other") == god]
        if grp:
            recs = [r for r in recs if (r.get("group") or "Other") == grp]
        if sub:
            recs = [r for r in recs if (r.get("subgroup") or grp) == sub]

        if not recs:
            ax.set_title("select a group", color="#888", fontsize=9)
            self.stats_summary.config(text="No analysis yet")
            self._stats_pts = None
            self._stats_recs = []
            self.stats_canvas.draw_idle()
            return

        xk = self._measure_key(self.stats_x.get())
        yk = self._measure_key(self.stats_y.get())

        def split_key(r):
            g = r.get("group") or "Other"
            s = r.get("subgroup") or g
            if not grp:
                return g
            return s
            
        splits = sorted({split_key(r) for r in recs})
        
        all_x, all_y, all_recs = [], [], []
        for i, s_key in enumerate(splits):
            pts = [r for r in recs if split_key(r) == s_key]
            xs = [float(r.get(xk, 0) or 0) for r in pts]
            ys = [float(r.get(yk, 0) or 0) for r in pts]
            
            if not grp:
                c = group_color(s_key)
            else:
                c = group_color(grp, s_key if s_key != grp else "")
                
            ax.scatter(xs, ys, s=26, alpha=0.8, edgecolors="none", color=c, label=s_key)
            all_x += xs
            all_y += ys
            all_recs += pts
            
        self._stats_pts = (np.array(all_x, dtype=float), np.array(all_y, dtype=float))
        self._stats_recs = all_recs
        ax.set_xlabel(self.stats_x.get(), color="#aaa", fontsize=8)
        ax.set_ylabel(self.stats_y.get(), color="#aaa", fontsize=8)
        
        title = god if god else "All"
        if grp:
            title += f" · {grp}"
        if sub:
            title += f" · {sub}"
            
        ax.set_title(f"{title} — {len(recs)} samples", color="#f4902c", fontsize=9)
        if len(splits) > 1:
            leg = ax.legend(fontsize=6, facecolor="#1b1b1b", edgecolor="#333", labelcolor="#ccc", framealpha=0.85)
            if leg:
                for t in leg.get_texts():
                    t.set_color("#ccc")
        self.stats_canvas.draw_idle()

        # Summary table: one row per measurement.
        for label, key in self.STATS_MEASURES:
            vals = np.array([float(r.get(key, 0) or 0) for r in recs], dtype=float)
            if len(vals) == 0:
                continue
            self.stats_tv.insert("", "end", text=label, values=(
                len(vals), f"{vals.mean():.3g}", f"{vals.std():.3g}",
                f"{vals.min():.3g}", f"{np.median(vals):.3g}", f"{vals.max():.3g}"))
        self.stats_summary.config(text=f"{title} · {len(recs)} samples")

    # ---- click-to-select + play ------------------------------------------
    def _stats_click(self, event):
        if event.inaxes != self.stats_ax or self._stats_pts is None or event.x is None:
            return
        xs, ys = self._stats_pts
        if len(xs) == 0:
            return
        disp = self.stats_ax.transData.transform(np.column_stack([xs, ys]))
        d2 = (disp[:, 0] - event.x) ** 2 + (disp[:, 1] - event.y) ** 2
        i = int(np.argmin(d2))
        if d2[i] > 625:  # >25 px away — ignore stray clicks
            return
        self._select_stats_point(i)

    def _select_stats_point(self, i):
        if i < 0 or i >= len(self._stats_recs):
            return
        self._stats_sel_idx = i
        rec = self._stats_recs[i]
        self.stats_sel_rec = rec
        self.stats_play_btn.config(state=tk.NORMAL)
        self.stats_sel_label.config(text=rec.get("name", "")[:32])
        xs, ys = self._stats_pts
        if self._stats_marker is not None:
            try:
                self._stats_marker.remove()
            except Exception:
                pass
        self._stats_marker = self.stats_ax.scatter([xs[i]], [ys[i]], s=180, facecolors="none",
                                                    edgecolors="#ffffff", linewidths=1.6)
        self.stats_canvas.draw_idle()
        
        path = self._resolve_path(rec) if hasattr(self, "_resolve_path") else rec.get("path")
        self.stats_inspector.show(rec, path)

    def _stats_play(self):
        rec = getattr(self, "stats_sel_rec", None)
        if not rec:
            return
        path = self._resolve_path(rec) if hasattr(self, "_resolve_path") else rec.get("path")
        if path and hasattr(self, "_play_file"):
            self._play_file(path)
        else:
            self.stats_sel_label.config(text="⚠ file not found")

    def _stats_nav(self, dx, dy):
        if getattr(self, "_stats_sel_idx", None) is None:
            return "break"
        if self._stats_pts is None or len(self._stats_pts[0]) == 0:
            return "break"

        i = self._stats_sel_idx
        xs, ys = self._stats_pts
        disp = self.stats_ax.transData.transform(np.column_stack([xs, ys]))
        px, py = disp[i]

        v = disp - [px, py]
        dot = v[:, 0] * dx + v[:, 1] * dy
        valid = dot > 1e-2

        if not np.any(valid):
            return "break"

        dist2 = v[:, 0]**2 + v[:, 1]**2
        scores = dist2[valid] / dot[valid]
        best_valid_idx = np.argmin(scores)
        best_idx = np.where(valid)[0][best_valid_idx]

        self._select_stats_point(best_idx)
        return "break"
