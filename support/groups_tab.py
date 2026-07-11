"""Groups / CSV tab for the Sample Analyzer (GroupsMixin)."""
import csv
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from .config import god_color, group_color
from .inspector import RecordInspector


class GroupsMixin:
    GROUP_COLS = ("folder", "group", "subgroup", "family", "reason", "god", "shape", "timbre", "cluster", "pitch_hz", "length_seconds", "tr")
    # Dimensions offered in the "Group by" / "then by" pickers.
    GROUP_DIMS = ["God category", "Name group", "Timbre", "Env shape",
                  "Acoustic", "Sound design", "Family", "Distortion", "Cluster"]

    def _build_groups_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="Groups / CSV")

        ctl = ttk.Frame(tab, padding=6)
        ctl.pack(fill=tk.X)
        ttk.Label(ctl, text="Group by:").pack(side=tk.LEFT, padx=(0, 4))
        # Default: the envelope "god categories" on top, name groups nested under.
        self.group_by = tk.StringVar(value="God category")
        cb = ttk.Combobox(ctl, textvariable=self.group_by, state="readonly", width=13,
                          values=self.GROUP_DIMS)
        cb.pack(side=tk.LEFT, padx=4)
        cb.bind("<<ComboboxSelected>>", lambda e: self._rebuild_groups())

        ttk.Label(ctl, text="then by:").pack(side=tk.LEFT, padx=(10, 4))
        self.subgroup_by = tk.StringVar(value="Name group")
        scb = ttk.Combobox(ctl, textvariable=self.subgroup_by, state="readonly", width=13,
                           values=["(none)"] + self.GROUP_DIMS)
        scb.pack(side=tk.LEFT, padx=4)
        scb.bind("<<ComboboxSelected>>", lambda e: self._rebuild_groups())

        ttk.Button(ctl, text="Expand all", command=lambda: self._groups_expand(True)).pack(side=tk.LEFT, padx=(10, 2))
        ttk.Button(ctl, text="Collapse all", command=lambda: self._groups_expand(False)).pack(side=tk.LEFT, padx=2)
        ttk.Button(ctl, text="Export CSV…", command=self._export_csv).pack(side=tk.LEFT, padx=(10, 2))
        self.groups_summary = ttk.Label(ctl, text="No analysis yet", foreground="#888")
        self.groups_summary.pack(side=tk.RIGHT)

        body = ttk.Panedwindow(tab, orient=tk.VERTICAL)
        body.pack(fill=tk.BOTH, expand=True)

        wrap = ttk.Frame(body)
        tv = ttk.Treeview(wrap, columns=self.GROUP_COLS, show="tree headings")
        tv.heading("#0", text="Group / File", command=lambda: self._sort_groups_tree(tv, "#0", False))
        tv.column("#0", width=260, stretch=True)
        heads = {"folder": ("Folder", 160), "group": ("Group", 100), "subgroup": ("Subgroup", 100), "family": ("Instrument Family", 180), "reason": ("Reason in group", 180),
                 "god": ("God category", 140), "shape": ("Envelope", 80), "timbre": ("Timbre", 90),
                 "cluster": ("Clust", 50), "pitch_hz": ("Pitch", 60), "length_seconds": ("Len s", 60), "tr": ("Trans", 50)}
        for c in self.GROUP_COLS:
            label, w = heads[c]
            tv.heading(c, text=label, command=lambda cc=c: self._sort_groups_tree(tv, cc, False))
            tv.column(c, width=w, anchor=tk.W)
        vs = ttk.Scrollbar(wrap, orient=tk.VERTICAL, command=tv.yview)
        tv.configure(yscrollcommand=vs.set)
        vs.pack(side=tk.RIGHT, fill=tk.Y)
        tv.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        tv.bind("<<TreeviewSelect>>", self._groups_select)
        self.groups_tv = tv
        self.groups_item_rec = {}  # tree item id -> full record (file rows only)
        self._tint_tags = set()    # colour tags already configured on the tree
        body.add(wrap, weight=3)

        # Same inspector as the PEAK Examiner: full JSON + waveform + Play.
        self.groups_inspector = RecordInspector(body, play_cb=lambda p: self._play_file(p))
        body.add(self.groups_inspector, weight=1)

    def _groups_select(self, event):
        sel = self.groups_tv.selection()
        if not sel:
            return
        rec = self.groups_item_rec.get(sel[0])
        if rec:
            path = self._resolve_path(rec) if hasattr(self, "_resolve_path") else rec.get("path")
            self.groups_inspector.show(rec, path)

    def _key_for(self, rec, by):
        """Bucket key for a record along one grouping dimension."""
        if by == "Timbre":
            return rec.get("timbre") or "Other"
        if by == "Cluster":
            return "Cluster " + str(rec.get("cluster", -1))
        if by == "God category":
            return rec.get("god_category") or "Unassigned"
        if by == "Env shape":
            return rec.get("envelope_shape") or "Other"
        if by == "Acoustic":
            # Multi-label: the combination is the bucket ("Harmonic+Impulsive").
            return "+".join(rec.get("acoustic_types") or []) or "Other"
        if by == "Sound design":
            return "+".join(rec.get("sound_design_roles") or []) or "(no role)"
        if by == "Family":
            fam = rec.get("instrument_family")
            if isinstance(fam, list):
                return ", ".join(fam) if fam else "Unknown"
            return fam or "Unknown"
        if by == "Distortion":
            return rec.get("distortion") or "Unknown"
        return rec.get("group") or "Other"

    def _group_key(self, rec):
        return self._key_for(rec, self.group_by.get())

    def _subgroup_key(self, rec):
        return self._key_for(rec, self.subgroup_by.get())

    def _sub_active(self):
        sub = self.subgroup_by.get()
        return sub != "(none)" and sub != self.group_by.get()

    def _row_tint(self, color):
        """One Treeview tag per colour: rows are tinted with the same god-
        category shades the 3D cloud uses."""
        tag = "c" + color.lstrip("#")
        if tag not in self._tint_tags:
            self.groups_tv.tag_configure(tag, foreground=color)
            self._tint_tags.add(tag)
        return tag

    def _header_tint(self, dim, key):
        """Header rows carry the same colour system: god categories their base
        colour, name groups their shade; other dimensions stay neutral."""
        if dim == "God category":
            return self._row_tint(god_color(key))
        if dim == "Name group":
            return self._row_tint(group_color(key))
        return self._row_tint("#e8e8e8")

    def _insert_file_row(self, parent, r):
        tint = self._row_tint(group_color(r.get("group") or "", r.get("subgroup") or ""))
        reason = r.get("reason", [])
        if isinstance(reason, list):
            reason = reason[0] if reason else ""
        family = r.get("instrument_family", [])
        if isinstance(family, list):
            family = ", ".join(family)
        iid = self.groups_tv.insert(parent, "end", text=r.get("name", ""), tags=(tint,), values=(
            r.get("folder", ""), r.get("group", ""), r.get("subgroup", ""), family, reason,
            r.get("god_category", ""), r.get("envelope_shape", ""), r.get("timbre", ""),
            r.get("cluster", ""), f"{r.get('pitch_hz', 0):.0f}",
            f"{r.get('length_seconds', 0):.2f}", r.get("transient_count", "")))
        self.groups_item_rec[iid] = r

    def _rebuild_groups(self):
        tv = self.groups_tv
        tv.delete(*tv.get_children())
        self.groups_item_rec = {}
        buckets = {}
        for r in self.records:
            buckets.setdefault(self._group_key(r), []).append(r)

        sub_active = self._sub_active()
        sub_total = 0
        for g in sorted(buckets):
            rows = buckets[g]
            parent = tv.insert("", "end", text=f"{g}  ({len(rows)})", open=False,
                               tags=(self._header_tint(self.group_by.get(), g),),
                               values=[""] * len(self.GROUP_COLS))
            if sub_active:
                subs = {}
                for r in rows:
                    subs.setdefault(self._subgroup_key(r), []).append(r)
                sub_total += len(subs)
                for sg in sorted(subs):
                    srows = subs[sg]
                    snode = tv.insert(parent, "end", text=f"{sg}  ({len(srows)})", open=False,
                                      tags=(self._header_tint(self.subgroup_by.get(), sg),),
                                      values=[""] * len(self.GROUP_COLS))
                    for r in sorted(srows, key=lambda x: x.get("name", "")):
                        self._insert_file_row(snode, r)
            else:
                for r in sorted(rows, key=lambda x: x.get("name", "")):
                    self._insert_file_row(parent, r)

        summary = f"{len(self.records)} files · {len(buckets)} groups"
        if sub_active:
            summary += f" · {sub_total} sub-groups"
        self.groups_summary.config(text=summary)

    def _groups_expand(self, opened):
        def walk(item):
            self.groups_tv.item(item, open=opened)
            for child in self.groups_tv.get_children(item):
                walk(child)
        for item in self.groups_tv.get_children():
            walk(item)

    def _export_csv(self):
        if not self.records:
            messagebox.showinfo("Export CSV", "No analysis loaded yet.")
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".csv", initialfile="sample_groups.csv",
            filetypes=[("CSV", "*.csv"), ("All", "*.*")])
        if not path:
            return
        sub_active = self._sub_active()
        head = ["group_dimension", "group"]
        if sub_active:
            head += ["subgroup_dimension", "subgroup"]
        detail_cols = ["name", "folder", "reason", "god_category", "envelope_shape",
                       "acoustic_types", "sound_design_roles", "instrument_family", "timbre", "cluster",
                       "pitch_hz", "complexity", "spectral_centroid_hz", "harmonicity", "attack_seconds",
                       "envelope_attack_seconds", "envelope_decay_seconds", "envelope_sustain_level", "envelope_release_seconds",
                       "envelope_skewness", "spectral_flux", "inharmonicity",
                       "distortion", "total_harmonic_distortion", "clipping_density", "crest_factor", "length_seconds",
                       "transient_count", "beats_per_minute", "sample_rate", "bit_depth"]
        by = self.group_by.get()
        sub_by = self.subgroup_by.get()
        try:
            with open(path, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(head + detail_cols)
                if sub_active:
                    keyfn = lambda x: (self._group_key(x), self._subgroup_key(x), x.get("name", ""))
                else:
                    keyfn = lambda x: (self._group_key(x), x.get("name", ""))
                for r in sorted(self.records, key=keyfn):
                    row = [by, self._group_key(r)]
                    if sub_active:
                        row += [sub_by, self._subgroup_key(r)]
                    # Multi-label list fields flatten to "A+B" in CSV cells.
                    cells = [r.get(c, "") for c in detail_cols]
                    cells = ["+".join(v) if isinstance(v, list) else v for v in cells]
                    w.writerow(row + cells)
            messagebox.showinfo("Export CSV", f"Wrote {len(self.records)} rows to:\n{path}")
        except Exception as e:
            messagebox.showerror("Export CSV", str(e))

    def _sort_groups_tree(self, tv, col, reverse):
        """Recursively sort a Treeview by a clicked column (numeric-aware, toggles order)."""
        def sort_node(node):
            if col == "#0":
                items = [(tv.item(iid, "text"), iid) for iid in tv.get_children(node)]
            else:
                items = [(tv.set(iid, col), iid) for iid in tv.get_children(node)]

            def keyf(pair):
                v = pair[0]
                try:
                    return (0, float(v))
                except (TypeError, ValueError):
                    return (1, str(v).lower())
            
            items.sort(key=keyf, reverse=reverse)
            for idx, (_v, iid) in enumerate(items):
                tv.move(iid, node, idx)
                sort_node(iid)
                
        sort_node("")
        tv.heading(col, command=lambda: self._sort_groups_tree(tv, col, not reverse))
