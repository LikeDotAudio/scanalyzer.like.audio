"""3D-cloud (graph) tab for the Sample Analyzer.

    X / Y / Z / size are all user-selectable (dropdowns). By default:
      X = pitch (Hz)   ·   Y = name-group depth   ·   Z = complexity
      size = sample length   ·   colour = name group (legend)

    Isolate one group (hide the rest) and the view deep-dives it: size encodes
    timbre and Z switches to complexity, so Y is free to spread a single feature.

The heavy "math and placement" (axis values, sizes, colours, ticks) is computed
by the standalone `oa_graph_layout` Rust binary — this module just draws it.
All methods here become part of AnalyzerApp via the GraphMixin.
"""
import json
import subprocess
from math import sqrt

import tkinter as tk
from tkinter import ttk

import numpy as np
import matplotlib
matplotlib.use("TkAgg")
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from mpl_toolkits.mplot3d import Axes3D, proj3d  # noqa: F401 (registers the 3d projection)
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

from .config import CLOUD_PALETTE, CATEGORY_ORDER, god_category


class GraphMixin:
    # Features selectable on the X / Y / Z axes. `None` = hierarchical group /
    # subgroup depth; "timbre" is categorical; the rest are numeric.
    ISO_FEATURES = [
        ("Group", None), ("Length", "length_seconds"), ("Timbre", "timbre"),
        ("Complexity", "complexity"), ("Brightness (centroid)", "spectral_centroid_hz"),
        ("Harmonicity", "harmonicity"), ("Sustain", "sustain_ratio"), ("Attack", "attack_seconds"),
        ("Pitch", "pitch_hz"), ("BPM", "beats_per_minute"), ("RMS", "root_mean_square_level"), ("ZCR", "zero_crossings_per_second"),
        ("Roll-off", "spectral_rolloff_hz"), ("Flatness", "spectral_flatness"),
    ]

    # One-click axis presets: (button, X, Y, Z, Size). Labels must exist in
    # ISO_FEATURES; the axis pickers + axis labels follow automatically.
    CLOUD_PRESETS = [
        ("A", "Pitch", "Group", "Complexity", "Length"),               # the classic default
        ("B", "Pitch", "Group", "Brightness (centroid)", "Length"),    # brightness per group
        ("C", "Attack", "Sustain", "Harmonicity", "RMS"),              # envelope space
        ("D", "Brightness (centroid)", "Flatness", "Harmonicity", "Length"),  # tonal vs noisy
        ("E", "Pitch", "Harmonicity", "Sustain", "RMS"),               # musicality
        ("F", "Length", "Group", "Attack", "RMS"),                     # percussive layout
        ("G", "ZCR", "Brightness (centroid)", "Roll-off", "Length"),   # noise / brightness
        ("H", "Complexity", "Flatness", "Brightness (centroid)", "RMS"),  # texture
        ("I", "BPM", "Group", "Length", "RMS"),                        # loops / tempo
        ("J", "RMS", "Attack", "Sustain", "Length"),                   # dynamics
    ]

    def _build_cloud_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="3D Cloud")

        views = ttk.Frame(tab, padding=(10, 4))
        views.pack(fill=tk.X)
        ttk.Label(views, text="View:", foreground="#888").pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(views, text="Top", width=7, command=lambda: self._set_view(90, -90)).pack(side=tk.LEFT, padx=2)
        ttk.Button(views, text="Front", width=7, command=lambda: self._set_view(0, -90)).pack(side=tk.LEFT, padx=2)
        ttk.Button(views, text="Side", width=7, command=lambda: self._set_view(0, 0)).pack(side=tk.LEFT, padx=2)
        ttk.Button(views, text="Iso", width=7, command=lambda: self._set_view(22, -60)).pack(side=tk.LEFT, padx=2)
        ttk.Label(views, text="   (scroll to zoom · drag to orbit · click a point)", foreground="#555").pack(side=tk.LEFT, padx=6)
        self.play_btn = ttk.Button(views, text="▶ Play", width=8, state=tk.DISABLED, command=self._play_selected)
        self.play_btn.pack(side=tk.RIGHT)
        self.sel_label = ttk.Label(views, text="Click a point to inspect", foreground="#c47a1a")
        self.sel_label.pack(side=tk.RIGHT, padx=8)

        # --- axis pickers: X / Y / Z / Size are all drop-downable ---
        axrow = ttk.Frame(tab, padding=(10, 0, 10, 4))
        axrow.pack(fill=tk.X)
        xyz_opts = [lbl for lbl, _k in self.ISO_FEATURES]
        size_opts = [lbl for lbl, k in self.ISO_FEATURES if k is not None]
        self.axis_x = tk.StringVar(value="Pitch")
        self.axis_y = tk.StringVar(value="Group")
        self.axis_z = tk.StringVar(value="Complexity")
        self.axis_size = tk.StringVar(value="Length")
        for text, var, opts in (
            ("X:", self.axis_x, xyz_opts), ("Y:", self.axis_y, xyz_opts),
            ("Z:", self.axis_z, xyz_opts), ("Size:", self.axis_size, size_opts),
        ):
            ttk.Label(axrow, text=text, foreground="#888").pack(side=tk.LEFT, padx=(0, 3))
            ttk.Combobox(axrow, textvariable=var, state="readonly", width=13, values=opts).pack(side=tk.LEFT, padx=(0, 10))
            var.trace_add("write", lambda *_: self._redraw_cloud())

        # --- one-click axis presets (A…J) ---
        ttk.Label(axrow, text="Presets:", foreground="#888").pack(side=tk.LEFT, padx=(6, 3))
        for name, px, py, pz, ps in self.CLOUD_PRESETS:
            ttk.Button(axrow, text=name, width=2,
                       command=lambda x=px, y=py, z=pz, s=ps: self._apply_cloud_preset(x, y, z, s)
                       ).pack(side=tk.LEFT, padx=1)

        body = ttk.Frame(tab)
        body.pack(fill=tk.BOTH, expand=True)

        # --- left sidebar: show/hide groups ---
        side = ttk.Frame(body, width=196)
        side.pack(side=tk.LEFT, fill=tk.Y)
        side.pack_propagate(False)

        ttk.Label(side, text="Groups (show / hide)", font=("Helvetica", 9, "bold")).pack(anchor=tk.W, padx=6, pady=(4, 0))
        ttk.Label(side, text="hide all but one to deep-dive it", foreground="#888", font=("Helvetica", 8)).pack(anchor=tk.W, padx=6)
        btns = ttk.Frame(side)
        btns.pack(fill=tk.X, padx=6, pady=(2, 4))
        ttk.Button(btns, text="All", width=5, command=lambda: self._set_all_groups(True)).pack(side=tk.LEFT)
        ttk.Button(btns, text="None", width=5, command=lambda: self._set_all_groups(False)).pack(side=tk.LEFT, padx=3)

        # Scrollable checkbox list fills the rest (canvas + scrollbar in their
        # own container so LEFT/RIGHT packing never collides with the sidebar).
        listwrap = ttk.Frame(side)
        listwrap.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=6, pady=(2, 4))
        gc = tk.Canvas(listwrap, highlightthickness=0, bg="#1e1e1e")
        gsb = ttk.Scrollbar(listwrap, orient=tk.VERTICAL, command=gc.yview)
        gc.configure(yscrollcommand=gsb.set)
        gsb.pack(side=tk.RIGHT, fill=tk.Y)
        gc.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.group_box = ttk.Frame(gc)
        self._gc_win = gc.create_window((0, 0), window=self.group_box, anchor="nw")
        self.group_box.bind("<Configure>", lambda e: gc.configure(scrollregion=gc.bbox("all")))
        gc.bind("<Configure>", lambda e: gc.itemconfigure(self._gc_win, width=e.width))

        # --- right: the 3D cloud, fills the rest ---
        right = ttk.Frame(body)
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.fig = Figure(figsize=(7, 4.4), dpi=100, facecolor="#1b1b1b")
        self.ax = self.fig.add_subplot(111, projection="3d", facecolor="#0f0f0f")
        self.fig.subplots_adjust(left=0.0, right=1.0, bottom=0.0, top=1.0)
        self._style_axes()
        self.scatter = self.ax.scatter([], [], [], depthshade=True)
        self.canvas = FigureCanvasTkAgg(self.fig, master=right)
        cw = self.canvas.get_tk_widget()
        cw.pack(fill=tk.BOTH, expand=True, padx=0, pady=0)
        self.canvas.mpl_connect("scroll_event", self._on_scroll)
        self.canvas.mpl_connect("button_press_event", self._on_click_point)
        # Arrow keys orbit the camera (widget grabs focus on hover/click).
        cw.configure(takefocus=True)
        cw.bind("<Enter>", lambda e: cw.focus_set())
        cw.bind("<Left>", lambda e: self._orbit(-12, 0))
        cw.bind("<Right>", lambda e: self._orbit(12, 0))
        cw.bind("<Up>", lambda e: self._orbit(0, 12))
        cw.bind("<Down>", lambda e: self._orbit(0, -12))
        self.selected_rec = None

    def _apply_cloud_preset(self, x, y, z, size):
        """Set all four axes at once; the final set triggers the one redraw."""
        self._suspend_redraw = True
        self.axis_x.set(x)
        self.axis_y.set(y)
        self.axis_z.set(z)
        self._suspend_redraw = False
        self.axis_size.set(size)

    def _style_axes(self):
        self.ax.set_xlabel("Pitch (Hz)", color="#aaa", labelpad=8)
        self.ax.set_ylabel("Name group", color="#aaa", labelpad=12)
        self.ax.set_zlabel("Complexity / Timbre", color="#aaa", labelpad=6)
        self.ax.set_title("Live 3D sample cloud — size = length", color="#f4902c")
        self.ax.tick_params(colors="#888")
        try:
            self.ax.set_facecolor("#0f0f0f")
            for pane in (self.ax.xaxis, self.ax.yaxis, self.ax.zaxis):
                pane.set_pane_color((0.06, 0.06, 0.06, 1.0))
                pane._axinfo["grid"]["color"] = (0.2, 0.2, 0.2, 1.0)
        except Exception:
            pass
        self._apply_zoom()

    def _color_for(self, groups, g):
        return CLOUD_PALETTE[max(0, groups.index(g)) % len(CLOUD_PALETTE)]

    def _feat_key(self, label):
        for l, k in self.ISO_FEATURES:
            if l == label:
                return k
        return None

    @staticmethod
    def _deeper_sub(r):
        """The record's subgroup when it's a *curated* level (Perc→Conga) rather
        than one that just echoes the group. "" when there's no deeper level."""
        g = (r.get("group") or "").strip()
        sg = (r.get("subgroup") or "").strip()
        gl, sgl = g.lower(), sg.lower()
        if sg and sgl != gl and not sgl.startswith(gl) and not gl.startswith(sgl):
            return sg
        return ""

    def _apply_zoom(self):
        # Modern matplotlib: box_aspect(zoom=...); fall back to camera distance.
        try:
            self.ax.set_box_aspect(None, zoom=self._zoom)
        except Exception:
            try:
                self.ax.dist = 10.0 / max(0.2, self._zoom)
            except Exception:
                pass

    def _on_scroll(self, event):
        step = 1.15 if getattr(event, "button", "up") == "up" else 1.0 / 1.15
        self._zoom = max(0.4, min(6.0, self._zoom * step))
        self._apply_zoom()
        self.canvas.draw_idle()

    def _set_view(self, elev, azim):
        self.ax.view_init(elev=elev, azim=azim)
        self.canvas.draw_idle()

    def _orbit(self, d_azim, d_elev):
        try:
            elev = max(-89, min(89, (self.ax.elev or 0) + d_elev))
            azim = (self.ax.azim or 0) + d_azim
            self.ax.view_init(elev=elev, azim=azim)
            self.canvas.draw_idle()
        except Exception:
            pass
        return "break"

    def _sync_group_checkboxes(self):
        """(Re)build the show/hide list as a 3-level tree: envelope god-category →
        name group → curated subgroup. Rebuilds only when the structure changes."""
        tree = {}
        for r in self.d_rec:
            g = r.get("group", "Other") or "Other"
            tree.setdefault(g, set()).add(self._deeper_sub(r))
        # group each name group under its god-category, keeping category order.
        by_cat = {}
        for g in sorted(tree):
            subs = tuple(sorted(s for s in tree[g] if s))
            by_cat.setdefault(god_category(g), []).append((g, subs))
        cats = [c for c in CATEGORY_ORDER if c in by_cat] + \
               [c for c in sorted(by_cat) if c not in CATEGORY_ORDER]
        structure = tuple((c, tuple(by_cat[c])) for c in cats)
        if structure == self._group_box_keys:
            return
        for w in self.group_box.winfo_children():
            w.destroy()
        for cat, groups in structure:
            cvar = self.category_vars.get(cat)
            if cvar is None:
                cvar = tk.BooleanVar(value=True)
                self.category_vars[cat] = cvar
            tk.Checkbutton(self.group_box, text=cat, variable=cvar, anchor="w",
                           bg="#2a2a2a", activebackground="#2a2a2a",
                           fg="#f4b04c", activeforeground="#f4b04c", selectcolor="#101010",
                           font=("Helvetica", 9, "bold"),
                           command=lambda c=cat: self._toggle_category(c)).pack(fill=tk.X, anchor="w")
            for g, subs in groups:
                var = self.group_vars.get(g)
                if var is None:
                    var = tk.BooleanVar(value=True)
                    self.group_vars[g] = var
                tk.Checkbutton(self.group_box, text="  " + g, variable=var, anchor="w",
                               bg="#1e1e1e", activebackground="#1e1e1e",
                               fg="#e8e8e8", activeforeground="#e8e8e8", selectcolor="#101010",
                               font=("Helvetica", 9, "bold" if subs else "normal"),
                               command=self._redraw_cloud).pack(fill=tk.X, anchor="w")
                for s in subs:
                    sv = self.subgroup_vars.get((g, s))
                    if sv is None:
                        sv = tk.BooleanVar(value=True)
                        self.subgroup_vars[(g, s)] = sv
                    tk.Checkbutton(self.group_box, text="     ↳ " + s, variable=sv, anchor="w",
                                   bg="#1e1e1e", activebackground="#1e1e1e",
                                   fg="#b8b8b8", activeforeground="#b8b8b8", selectcolor="#101010",
                                   command=self._redraw_cloud).pack(fill=tk.X, anchor="w")
        self._group_box_keys = structure

    def _toggle_category(self, cat):
        """A category checkbox is a master switch for its groups + subgroups."""
        on = self.category_vars[cat].get()
        for g in [grp for c, groups in self._group_box_keys if c == cat for grp, _s in groups]:
            if g in self.group_vars:
                self.group_vars[g].set(on)
            for (gg, s), sv in self.subgroup_vars.items():
                if gg == g:
                    sv.set(on)
        self._redraw_cloud()

    def _set_all_groups(self, on):
        for var in self.category_vars.values():
            var.set(on)
        for var in self.group_vars.values():
            var.set(on)
        for var in self.subgroup_vars.values():
            var.set(on)
        self._redraw_cloud()

    def _rec_visible(self, r):
        """True when both the record's group and (if any) its curated subgroup
        are checked in the show/hide list."""
        g = r.get("group", "Other") or "Other"
        gv = self.group_vars.get(g)
        if gv is not None and not gv.get():
            return False
        s = self._deeper_sub(r)
        if s:
            sv = self.subgroup_vars.get((g, s))
            if sv is not None and not sv.get():
                return False
        return True

    # ---- click-to-inspect + play -----------------------------------------
    def _on_click_point(self, event):
        if event.inaxes != self.ax or self._pts is None or event.x is None:
            return
        xs, ys, zs = self._pts
        if len(xs) == 0:
            return
        # Project the 3D points to display pixels and pick the nearest.
        xp, yp, _ = proj3d.proj_transform(xs, ys, zs, self.ax.get_proj())
        disp = self.ax.transData.transform(np.column_stack([xp, yp]))
        d2 = (disp[:, 0] - event.x) ** 2 + (disp[:, 1] - event.y) ** 2
        i = int(np.argmin(d2))
        if d2[i] > 900:  # >30 px away — treat as an orbit drag, not a pick
            return
        self._select_point(i)

    def _select_point(self, i):
        if i < 0 or i >= len(self._pt_recs):
            return
        rec = self._pt_recs[i]
        self.selected_rec = rec
        self.play_btn.config(state=tk.NORMAL)
        self.sel_label.config(text=rec.get("name", "")[:40])

        # Overlay the PEAK record to the side of the graph.
        ch = rec.get("channels")
        title = rec.get("name", "") + (" (mono)" if ch == 1 else "")
        lines = [title]
        fld = rec.get("folder", "")
        if fld:
            lines.append("dir: " + fld)
        lines.append("")
        for k, label, fmt in (
            ("group", "group", "{}"), ("reason", "reason", "{}"), ("timbre", "timbre", "{}"),
            ("cluster", "cluster", "{}"), ("root_note_name", "root_note_name", "{}"), ("pitch_hz", "pitch_hz", "{:.0f} Hz"),
            ("spectral_centroid_hz", "high_band_energy", "{:.0f} Hz"), ("harmonicity", "harmonicity", "{:.2f}"),
            ("complexity", "complexity", "{:.1f}"), ("attack_seconds", "attack_seconds", "{:.3f} s"),
            ("length_seconds", "length_seconds", "{:.2f} s"), ("transient_count", "transient_count", "{}"),
            ("beats_per_minute", "beats_per_minute", "{:.1f}"), ("sample_rate", "sample rate", "{} Hz"), ("bit_depth", "bits", "{}"),
        ):
            v = rec.get(k)
            if v in (None, "", 0) and k in ("beats_per_minute", "cluster"):
                continue
            try:
                lines.append(f"{label}: " + fmt.format(v))
            except Exception:
                lines.append(f"{label}: {v}")
        lines.append("channels: " + ("mono" if ch == 1 else "stereo" if ch == 2 else str(ch)))
        if rec.get("sustained"):
            lines.append("* sustained single note")
        if rec.get("audit"):
            lines.append("! generic 'drum' tag — needs audit")
        text = "\n".join(lines)

        if self._sel_txt is not None:
            try:
                self._sel_txt.remove()
            except Exception:
                pass
        # Pinned to the window's top-right corner (figure coords), not the cube.
        self._sel_txt = self.fig.text(
            0.995, 0.995, text, ha="right", va="top",
            fontsize=8, color="#f2f2d8", family="monospace", zorder=30,
            bbox=dict(boxstyle="round,pad=0.6", facecolor="#080808", edgecolor="#f4902c",
                      alpha=1.0, linewidth=1.3))

        # Highlight the picked point.
        xs, ys, zs = self._pts
        if self._sel_marker is not None:
            try:
                self._sel_marker.remove()
            except Exception:
                pass
        self._sel_marker = self.ax.scatter([xs[i]], [ys[i]], [zs[i]], s=260,
                                           facecolors="none", edgecolors="#ffffff", linewidths=1.8, depthshade=False)
        self.canvas.draw_idle()
        self._play_selected()

    # ---- layout engine (Rust) --------------------------------------------
    def _compute_layout(self, req):
        """Call the oa_graph_layout binary; returns the parsed placement or None."""
        binary = getattr(self, "graph_binary", None)
        if not binary:
            return None
        try:
            out = subprocess.run([binary], input=json.dumps(req),
                                 capture_output=True, text=True, timeout=20)
            if out.returncode != 0 or not out.stdout.strip():
                return None
            return json.loads(out.stdout)
        except Exception:
            return None

    @staticmethod
    def _ticks_tuple(d):
        return (d["positions"], d["names"]) if d else None

    def _apply_axis(self, setlim, setticks, setlabels, setlabel, vals, label, ticks):
        setlabel(label, color="#aaa", labelpad=10)
        if ticks is not None:
            positions, names = ticks
            setlim(-0.5, max(0.5, len(positions) - 0.5))
            setticks(positions)
            setlabels(names, fontsize=7, color="#bbb")
        else:
            vmin = float(vals.min()) if len(vals) else 0.0
            vmax = float(vals.max()) if len(vals) else 1.0
            lo = min(0.0, vmin * 1.1)
            hi = max(vmax * 1.1, lo + 1e-6)
            setlim(lo, hi)
            ticks = np.linspace(lo, hi, 5)
            setticks(ticks)
            setlabels([f"{v:.2g}" for v in ticks], fontsize=7, color="#bbb")

    def _redraw_cloud(self):
        if not self.d_rec:
            return
        # Preserve the user's current view angle across live updates.
        elev, azim = self.ax.elev, self.ax.azim

        def grp(r):
            return r.get("group", "Other") or "Other"

        self._sync_group_checkboxes()
        all_groups = sorted(set(grp(r) for r in self.d_rec))
        recs = [r for r in self.d_rec if self._rec_visible(r)]

        if not recs:
            self.scatter._offsets3d = ([], [], [])
            self._pts = (np.array([]), np.array([]), np.array([]))
            self._pt_recs = []
            self.ax.set_title("(all groups hidden)", color="#888", fontsize=9)
            self.canvas.draw_idle()
            return

        isolated = len({grp(r) for r in recs}) == 1
        x_key = self._feat_key(self.axis_x.get())
        y_key = self._feat_key(self.axis_y.get())
        if isolated:
            # Deep-dive a single group: timbre → size, Z → complexity, and give
            # Y a real feature if it's still on the (now-degenerate) group depth.
            z_key, size_key = "complexity", "timbre"
            if y_key is None:
                y_key = "length_seconds"
        else:
            z_key = self._feat_key(self.axis_z.get())
            size_key = self._feat_key(self.axis_size.get()) or "length_seconds"

        req = {
            "axes": {"x": x_key, "y": y_key, "z": z_key},
            "size": size_key,
            "feature_labels": {k: l for l, k in self.ISO_FEATURES if k},
            "records": recs,
        }
        p = self._compute_layout(req)
        if p is None:
            self.ax.set_title("layout engine unavailable — build graphing_rs (cargo build --release)",
                              color="#c33", fontsize=9)
            self.canvas.draw_idle()
            return

        groups = p["groups"]
        xs = np.array(p["x"]["vals"], dtype=float)
        ys = np.array(p["y"]["vals"], dtype=float)
        zs = np.array(p["z"]["vals"], dtype=float)
        sizes = np.array(p["sizes"], dtype=float)
        colors = [CLOUD_PALETTE[ci % len(CLOUD_PALETTE)] for ci in p["color_idx"]]

        self._pts = (xs, ys, zs)
        self._pt_recs = recs
        self.scatter._offsets3d = (xs, ys, zs)
        self.scatter.set_sizes(sizes)
        self.scatter.set_color(colors)
        self.scatter.set_edgecolor("none")

        self._apply_axis(self.ax.set_xlim, self.ax.set_xticks, self.ax.set_xticklabels,
                         self.ax.set_xlabel, xs, p["x"]["label"], self._ticks_tuple(p["x"].get("ticks")))
        self._apply_axis(self.ax.set_ylim, self.ax.set_yticks, self.ax.set_yticklabels,
                         self.ax.set_ylabel, ys, p["y"]["label"], self._ticks_tuple(p["y"].get("ticks")))
        self._apply_axis(self.ax.set_zlim, self.ax.set_zticks, self.ax.set_zticklabels,
                         self.ax.set_zlabel, zs, p["z"]["label"], self._ticks_tuple(p["z"].get("ticks")))

        self._draw_legends(groups, p.get("size_legend", []), p.get("size_label", ""))

        n = len(recs)
        size_label = p.get("size_label", "")
        extra = (f" · ISOLATED {groups[0]}: Y={p['y']['label']}, Z={p['z']['label']}"
                 if isolated else "")
        self.ax.set_title(
            f"{n} shown  ·  {len(groups)}/{len(all_groups)} groups  ·  size = {size_label}{extra}",
            color="#f4902c", fontsize=9)

        self.ax.view_init(elev=elev, azim=azim)
        self.canvas.draw_idle()

        # Keep the 2D-Stats group picker in sync with what's been analyzed.
        if hasattr(self, "_refresh_stats_groups"):
            self._refresh_stats_groups()

    def _draw_legends(self, groups, size_legend, size_label):
        """Colour legend (name groups) + a separate bubble-size legend."""
        color_handles = [Line2D([0], [0], marker="o", linestyle="", markersize=6,
                                markerfacecolor=self._color_for(groups, g), markeredgecolor="none", label=g)
                         for g in groups]
        # Pin to the window's top-left corner (figure coords), off the cube.
        leg1 = self.ax.legend(handles=color_handles, loc="upper left", fontsize=7, ncol=1,
                              facecolor="#101010", edgecolor="#333", labelcolor="#ccc",
                              framealpha=0.95, bbox_to_anchor=(0.004, 0.996),
                              bbox_transform=self.fig.transFigure, title="Name group")
        if leg1 and leg1.get_title():
            leg1.get_title().set_color("#888")
            leg1.get_title().set_fontsize(7)
        self.ax.add_artist(leg1)

        if size_legend:
            size_handles = [Line2D([0], [0], marker="o", linestyle="", markeredgecolor="none",
                                   markerfacecolor="#cccccc", markersize=max(3.0, sqrt(e["size"])),
                                   label=e["label"])
                            for e in size_legend]
            # Pin to the window's bottom-left corner.
            leg2 = self.ax.legend(handles=size_handles, loc="lower left", fontsize=7, ncol=1,
                                  facecolor="#101010", edgecolor="#333", labelcolor="#ccc",
                                  framealpha=0.95, bbox_to_anchor=(0.004, 0.004),
                                  bbox_transform=self.fig.transFigure,
                                  title=f"size = {size_label}", labelspacing=1.1, borderpad=0.8)
            if leg2 and leg2.get_title():
                leg2.get_title().set_color("#888")
                leg2.get_title().set_fontsize(7)
