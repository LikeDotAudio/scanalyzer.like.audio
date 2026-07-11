"""PEAK Examiner tab for the Sample Analyzer (ExaminerMixin)."""
import json
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from .config import group_color
from .inspector import RecordInspector


class ExaminerMixin:
    EXAM_COLS = ("group", "reason", "timbre", "cluster", "root_note_name", "pitch_hz", "length_seconds", "tr",
                 "spectral_centroid_hz", "harm", "beats_per_minute", "sr", "bits")

    def _build_examiner_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="PEAK Examiner")

        ctl = ttk.Frame(tab, padding=6)
        ctl.pack(fill=tk.X)
        ttk.Button(ctl, text="Open .PEAK…", command=self._open_peak_file).pack(side=tk.LEFT)
        ttk.Label(ctl, text="Filter:").pack(side=tk.LEFT, padx=(12, 4))
        self.exam_filter = tk.StringVar()
        ent = ttk.Entry(ctl, textvariable=self.exam_filter, width=24)
        ent.pack(side=tk.LEFT)
        ent.bind("<KeyRelease>", lambda e: self._populate_examiner())
        self.exam_summary = ttk.Label(ctl, text="No PEAK loaded", foreground="#888")
        self.exam_summary.pack(side=tk.RIGHT)

        body = ttk.Panedwindow(tab, orient=tk.VERTICAL)
        body.pack(fill=tk.BOTH, expand=True)

        wrap = ttk.Frame(body)
        tv = ttk.Treeview(wrap, columns=self.EXAM_COLS, show="tree headings")
        tv.heading("#0", text="File", command=lambda: self._tv_sort(tv, "#0", False))
        tv.column("#0", width=220, stretch=True)
        heads = {"group": ("Group", 80), "reason": ("Reason", 150), "timbre": ("Timbre", 80),
                 "cluster": ("Clust", 48), "root_note_name": ("Root", 46), "pitch_hz": ("Pitch", 55), "length_seconds": ("Len", 50),
                 "tr": ("Tr", 40), "spectral_centroid_hz": ("Cntrd", 60), "harm": ("Harm", 50),
                 "beats_per_minute": ("BPM", 50), "sr": ("SR", 55), "bits": ("Bits", 40)}
        for c in self.EXAM_COLS:
            label, w = heads[c]
            tv.heading(c, text=label, command=lambda cc=c: self._tv_sort(tv, cc, False))
            tv.column(c, width=w, anchor=tk.W)
        vs = ttk.Scrollbar(wrap, orient=tk.VERTICAL, command=tv.yview)
        tv.configure(yscrollcommand=vs.set)
        vs.pack(side=tk.RIGHT, fill=tk.Y)
        tv.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        tv.bind("<<TreeviewSelect>>", self._examiner_select)
        self.exam_tv = tv
        body.add(wrap, weight=3)

        # Lower area: shared inspector (raw JSON + waveform preview + Play).
        self.exam_inspector = RecordInspector(body, play_cb=lambda p: self._play_file(p))
        body.add(self.exam_inspector, weight=1)

    def _open_peak_file(self):
        path = filedialog.askopenfilename(
            title="Open .PEAK file",
            filetypes=[("PEAK / JSON", "*.PEAK *.peak *.json"), ("All", "*.*")])
        if not path:
            return
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            self.exam_records = data if isinstance(data, list) else []
            self.exam_path = path
            self._populate_examiner()
        except Exception as e:
            messagebox.showerror("Open PEAK", str(e))

    def _populate_examiner(self):
        tv = self.exam_tv
        tv.delete(*tv.get_children())
        recs = getattr(self, "exam_records", [])
        flt = (self.exam_filter.get() or "").lower()
        shown = 0
        tinted = set()
        for r in recs:
            if flt and flt not in (r.get("name", "") + " " + r.get("folder", "") + " "
                                   + str(r.get("group", "")) + " " + str(r.get("timbre", ""))).lower():
                continue
            # Rows carry the god-category colour of their group (same as the cloud).
            color = group_color(r.get("group") or "", r.get("subgroup") or "")
            tag = "c" + color.lstrip("#")
            if tag not in tinted:
                tv.tag_configure(tag, foreground=color)
                tinted.add(tag)
            tv.insert("", "end", text=r.get("name", ""), tags=(tag,), values=(
                r.get("group", ""), r.get("reason", ""), r.get("timbre", ""), r.get("cluster", ""),
                r.get("root_note_name", ""), f"{r.get('pitch_hz', 0):.0f}", f"{r.get('length_seconds', 0):.2f}", r.get("transient_count", ""),
                f"{r.get('spectral_centroid_hz', 0):.0f}", f"{r.get('harmonicity', 0):.2f}",
                f"{r.get('beats_per_minute', 0):.0f}", r.get("sample_rate", ""), r.get("bit_depth", "")))
            shown += 1
        groups = len({r.get("group") for r in recs})
        self.exam_summary.config(text=f"{getattr(self, 'exam_path', '')}  —  {shown}/{len(recs)} shown · {groups} groups")

    def _examiner_select(self, event):
        tv = self.exam_tv
        sel = tv.selection()
        if not sel:
            return
        name = tv.item(sel[0], "text")
        rec = next((r for r in getattr(self, "exam_records", []) if r.get("name") == name), None)
        if rec:
            path = self._resolve_path(rec) if hasattr(self, "_resolve_path") else rec.get("path")
            self.exam_inspector.show(rec, path)
