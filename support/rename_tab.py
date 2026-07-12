"""Flatten / Rename tab for the Sample Analyzer (RenameMixin).

Previews and applies a flatten + rename of a folder tree: encodes each file's
relative path into a flat name, optionally appends BPM, prepends the group /
subgroup, removes repeated words, sorts into subfolders, and auto-suffixes name
clashes so every target stays unique.
"""
import os
import re
import json
import shutil
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from .config import DEFAULT_DIR
from .inspector import RecordInspector


class PartList(ttk.LabelFrame):
    """Ordered checkbox list: each row is one candidate part with an
    include-checkbox and ▲/▼ buttons to reorder it. `enabled_keys()` returns
    the checked keys in their current order."""

    def __init__(self, master, title, parts, on_change):
        super().__init__(master, text=title, padding=(6, 2))
        # parts: [(key, label, checked_by_default)]
        self.parts = [{"key": k, "label": lbl, "var": tk.BooleanVar(value=on)} for k, lbl, on in parts]
        self.on_change = on_change
        self._rows = ttk.Frame(self)
        self._rows.pack(fill=tk.BOTH, expand=True)
        self._rebuild()

    def _rebuild(self):
        for w in self._rows.winfo_children():
            w.destroy()
        last = len(self.parts) - 1
        for i, p in enumerate(self.parts):
            row = ttk.Frame(self._rows)
            row.pack(fill=tk.X)
            for txt, d in (("▼", +1), ("▲", -1)):  # packed RIGHT: ▲ ends up left of ▼
                b = tk.Button(row, text=txt, font=("Helvetica", 7), padx=3, pady=0,
                              bg="#2a2a2a", fg="#e8e8e8", activebackground="#3a3a3a",
                              activeforeground="#ffffff", bd=0, highlightthickness=0,
                              command=lambda i=i, d=d: self._move(i, d))
                if (d < 0 and i == 0) or (d > 0 and i == last):
                    b.config(state=tk.DISABLED, fg="#555")
                b.pack(side=tk.RIGHT, padx=1)
            tk.Checkbutton(row, text=p["label"], variable=p["var"], anchor="w",
                           bg="#0e0e0e", activebackground="#0e0e0e",
                           fg="#e8e8e8", activeforeground="#e8e8e8", selectcolor="#101010",
                           bd=0, highlightthickness=0, font=("Helvetica", 9),
                           command=self.on_change).pack(side=tk.LEFT, fill=tk.X, expand=True)

    def _move(self, i, d):
        j = i + d
        if 0 <= j < len(self.parts):
            self.parts[i], self.parts[j] = self.parts[j], self.parts[i]
            self._rebuild()
            self.on_change()

    def enabled_keys(self):
        return [p["key"] for p in self.parts if p["var"].get()]

    def enabled_labels(self):
        return [p["label"] for p in self.parts if p["var"].get()]

    def label_for(self, key):
        return next((p["label"] for p in self.parts if p["key"] == key), key)


class RenameMixin:
    AUDIO_EXTS = (".wav", ".aif", ".aiff", ".aifc", ".mp3", ".flac", ".ogg", ".m4a")

    def _configure_rename_columns(self, part_specs, with_folder):
        """One preview column per enabled name part, in build order — the row
        IS the proposed file name — plus the old path, the destination folder
        (when folder levels are on) and the auto-number note."""
        tv = self.rename_tv
        cols = (["old"] + (["folder"] if with_folder else [])
                + [f"part{i}" for i in range(len(part_specs))] + ["note"])
        tv.configure(columns=cols)

        def head(cid, label, width, stretch=False):
            tv.heading(cid, text=label, command=lambda c=cid: self._tv_sort(tv, c, False))
            tv.column(cid, width=width, anchor=tk.W, stretch=stretch)

        head("old", "Old path  (relative)", 240)
        if with_folder:
            head("folder", "→ Folder", 150)
        for i, (key, label) in enumerate(part_specs):
            head(f"part{i}", label, 200 if key == "original" else 120)
        head("note", "Note", 90)

    def _build_rename_tab(self):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text="Flatten / Rename")

        top = ttk.Frame(tab, padding=6)
        top.pack(fill=tk.X)
        ttk.Button(top, text="Pick Directory…", command=self._rename_pick).pack(side=tk.LEFT)
        self.rename_dir = tk.StringVar(value=DEFAULT_DIR if os.path.isdir(DEFAULT_DIR) else "No directory selected")
        ttk.Label(top, textvariable=self.rename_dir, foreground="#c47a1a", wraplength=360).pack(side=tk.LEFT, padx=8)

        opt = ttk.Frame(tab, padding=(6, 0))
        opt.pack(fill=tk.X)
        self.rename_flatten = tk.BooleanVar(value=True)
        ttk.Checkbutton(opt, text="Flatten into the picked folder (move files up)",
                        variable=self.rename_flatten, command=self._rename_scan).pack(side=tk.LEFT)
        self.rename_audio_only = tk.BooleanVar(value=False)
        ttk.Checkbutton(opt, text="Audio files only", variable=self.rename_audio_only,
                        command=self._rename_scan).pack(side=tk.LEFT, padx=12)

        drow = ttk.Frame(tab, padding=(6, 0))
        drow.pack(fill=tk.X)
        ttk.Button(drow, text="Destination…", command=self._rename_pick_dest).pack(side=tk.LEFT)
        import datetime
        ts = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        self.rename_dest = tk.StringVar(value=f"/home/anthony/Documents/Renamed Samples_{ts}")
        try:
            os.makedirs(self.rename_dest.get(), exist_ok=True)  # so the default routes on first preview
        except OSError:
            pass
        self.rename_copy = tk.BooleanVar(value=True)
        ttk.Checkbutton(drow, text="COPY into destination (keep originals)",
                        variable=self.rename_copy).pack(side=tk.LEFT, padx=6)
        ttk.Label(drow, textvariable=self.rename_dest, foreground="#2a7", wraplength=300).pack(side=tk.LEFT, padx=6)
        ttk.Button(drow, text="Clear", command=lambda: (self.rename_dest.set(""), self._rename_scan())).pack(side=tk.RIGHT)

        # --- comprehensive name builder: three ordered checkbox tables.
        # New name = [prepend parts] - <original name> - [append parts], and the
        # destination folder is built one level per checked folder part.
        build = ttk.Frame(tab, padding=(6, 4))
        build.pack(fill=tk.X)
        self.folder_parts = PartList(build, "Destination subfolders (one level each)", [
            ("god_category", "God category", True),
            ("group", "Group", True),
            ("subgroup", "Subgroup", True),
            ("timbre", "Timbre", False),
            ("instrument_family", "Instrument family", False),
            ("distortion", "Distortion", False),
            ("envelope_shape", "Envelope shape", False),
            ("length_class", "Length tier", False),
            ("cluster", "Cluster", False),
        ], self._rename_scan)
        self.folder_parts.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 3))
        self.prepend_parts = PartList(build, "Prepend to file name", [
            ("path", "Folder path (flattened)", False),
            ("god_category", "God category", True),
            ("group", "Group", True),
            ("subgroup", "Subgroup", True),
            ("timbre", "Timbre", True),
            ("instrument_family", "Instrument family", False),
        ], self._rename_scan)
        self.prepend_parts.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=3)
        self.append_parts = PartList(build, "Append to file name", [
            ("root", "ROOT note", True),
            ("bpm", "BPM (when > 10)", True),
            ("length_class", "Length tier", False),
            ("envelope_shape", "Envelope shape", True),
            ("distortion", "Distortion", False),
            ("cluster", "Cluster", False),
        ], self._rename_scan)
        self.append_parts.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(3, 0))

        grow2 = ttk.Frame(tab, padding=(6, 0))
        grow2.pack(fill=tk.X)
        self.rename_strip_group = tk.BooleanVar(value=True)
        ttk.Checkbutton(grow2, text="Strip group/subgroup words from the original name",
                        variable=self.rename_strip_group,
                        command=self._rename_scan).pack(side=tk.LEFT)
        self.rename_dedup = tk.BooleanVar(value=True)
        ttk.Checkbutton(grow2, text="Remove repeated words", variable=self.rename_dedup,
                        command=self._rename_scan).pack(side=tk.LEFT, padx=(16, 4))

        format_row = ttk.LabelFrame(tab, text="Audio Conversion Settings", padding=(6, 4))
        format_row.pack(fill=tk.X, padx=4, pady=(6, 0))
        
        # Format
        ttk.Label(format_row, text="Format:").pack(side=tk.LEFT)
        self.conv_format = tk.StringVar(value="FLAC")
        ttk.Radiobutton(format_row, text="WAV", variable=self.conv_format, value="WAV").pack(side=tk.LEFT, padx=2)
        ttk.Radiobutton(format_row, text="FLAC", variable=self.conv_format, value="FLAC").pack(side=tk.LEFT, padx=2)

        ttk.Separator(format_row, orient=tk.VERTICAL).pack(side=tk.LEFT, padx=8, fill=tk.Y)

        # Channels
        ttk.Label(format_row, text="Channels:").pack(side=tk.LEFT)
        self.conv_channels = tk.StringVar(value="Preserve")
        ttk.Radiobutton(format_row, text="Preserve", variable=self.conv_channels, value="Preserve").pack(side=tk.LEFT, padx=2)
        ttk.Radiobutton(format_row, text="Mono", variable=self.conv_channels, value="Mono").pack(side=tk.LEFT, padx=2)
        ttk.Radiobutton(format_row, text="Stereo", variable=self.conv_channels, value="Stereo").pack(side=tk.LEFT, padx=2)

        ttk.Separator(format_row, orient=tk.VERTICAL).pack(side=tk.LEFT, padx=8, fill=tk.Y)

        # Sample Rate
        ttk.Label(format_row, text="Sample Rate:").pack(side=tk.LEFT)
        self.conv_samplerate = tk.StringVar(value="48000")
        rates = ["Preserve", "44100", "48000", "88200", "96000"]
        ttk.Combobox(format_row, textvariable=self.conv_samplerate, values=rates, width=10, state="readonly").pack(side=tk.LEFT, padx=4)

        # Progress status and bar
        self.conv_status = ttk.Label(format_row, text="", foreground="#888", width=30, anchor="e")
        self.conv_status.pack(side=tk.LEFT, padx=(16, 8))
        self.conv_progress = ttk.Progressbar(format_row, orient=tk.HORIZONTAL, mode="determinate")
        self.conv_progress.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))

        ctl = ttk.Frame(tab, padding=(6, 4))
        ctl.pack(fill=tk.X)
        self.rename_btn_apply = ttk.Button(ctl, text="Apply Rename & Convert", command=self._rename_apply)
        self.rename_btn_apply.pack(side=tk.LEFT, padx=(8, 4))
        self.rename_btn_stop = ttk.Button(ctl, text="Stop", command=self._rename_stop, state=tk.DISABLED)
        self.rename_btn_stop.pack(side=tk.LEFT, padx=(0, 8))
        ttk.Button(ctl, text="Rescan", command=self._rename_scan).pack(side=tk.LEFT)
        self.rename_summary = ttk.Label(ctl, text="Pick a directory to preview.", foreground="#888")
        self.rename_summary.pack(side=tk.RIGHT)

        body = ttk.Panedwindow(tab, orient=tk.VERTICAL)
        body.pack(fill=tk.BOTH, expand=True)

        wrap = ttk.Frame(body)
        tv = ttk.Treeview(wrap, columns=("old", "note"), show="headings")
        self.rename_tv = tv
        # The columns mirror the enabled name parts — configured on every scan.
        self._configure_rename_columns([("original", "Original name")], with_folder=False)
        vs = ttk.Scrollbar(wrap, orient=tk.VERTICAL, command=tv.yview)
        hs = ttk.Scrollbar(wrap, orient=tk.HORIZONTAL, command=tv.xview)
        tv.configure(yscrollcommand=vs.set, xscrollcommand=hs.set)
        vs.pack(side=tk.RIGHT, fill=tk.Y)
        hs.pack(side=tk.BOTTOM, fill=tk.X)
        tv.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        tv.tag_configure("suffixed", foreground="#6fa8ff")  # auto-numbered (info, not an error)
        tv.tag_configure("noop", foreground="#9a9a9a")
        tv.bind("<<TreeviewSelect>>", self._rename_select)
        self.rename_tv = tv
        self.rename_map = []
        self.rename_item_rec = {}  # tree item id -> (record or None, abspath)
        body.add(wrap, weight=3)

        # Same inspector as the PEAK Examiner: full JSON + waveform + Play.
        self.rename_inspector = RecordInspector(body, play_cb=lambda p: self._play_file(p))
        body.add(self.rename_inspector, weight=1)

    def _rename_select(self, event):
        sel = self.rename_tv.selection()
        if not sel:
            return
        rec, abspath = self.rename_item_rec.get(sel[0], (None, None))
        if abspath:
            self.rename_inspector.show(rec or {"name": os.path.basename(abspath)}, abspath)

    def _peak_for(self, abspath):
        """Find the analysis record for a file: prefer its sidecar <stem>.PEAK,
        else fall back to the loaded aggregate records (matched by path).
        Returns a dict or None (guards against a .PEAK file matching itself,
        whose contents are a list, and other non-record JSON)."""
        side = os.path.splitext(abspath)[0] + ".PEAK"
        if side != abspath and os.path.isfile(side):
            try:
                with open(side, encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
        r = self.records_by_path.get(abspath)
        return r if isinstance(r, dict) else None

    @staticmethod
    def _safe_folder(name):
        return re.sub(r'[\\/:*?"<>|]+', "_", str(name)).strip() or "Unsorted"

    # Name/keyword → (group, subgroup) rules, mirroring the Rust analyzer's
    # categorize() so the renamer can still sort by name (e.g. "Bass Drum" → Kick)
    # when a file has no .PEAK record. (group, subgroup, phrases, abbrev-tokens).
    _NAME_RULES = [
        ("IR", "", ["impulse response", "impulse", "convolution", "convol", "cabinet", "guitar cab", "reverb ir"], ["ir", "cab", "conv"]),
        # Kick before Bass: ANY "bass drum" spelling is a Kick, plain "bass" is Bass.
        ("Kick", "", ["kick", "kik", "bass drum", "bassdrum", "bassdrm", "bass drm", "bdrum"],
                     ["bd", "kk", "kik", "kic", "kck", "bassd", "bdr"]),
        ("Snare", "", ["snare"], ["sd", "sn", "snr"]),
        ("Hi-Hat", "", ["hihat", "hi hat", "closed hat", "open hat", "pedal hat", "hats", "hat"], ["hh", "chh", "ohh", "ch", "oh", "ph"]),
        ("Ride", "", ["ride bell", "ride cymbal", "ride"], ["rd", "rdcym"]),
        # Cymbals: crashes and gongs are curated subgroups; china/sizzle/swish
        # and the big cymbal brands count too, so packs don't land Unclassified.
        ("Cymbal", "Crash", ["crash cymbal", "crash"], ["crsh"]),
        ("Cymbal", "Gong", ["gong", "tam tam", "tamtam"], []),
        ("Cymbal", "", ["splash cymbal", "cymbal", "splash", "china", "sizzle", "swish",
                        "zildjian", "sabian", "paiste"], ["cy", "cym"]),
        ("Clap", "", ["handclap", "hand clap", "clap"], ["cp", "clp"]),
        ("Rim", "", ["rimshot", "rim shot", "cross stick", "crossstick", "rim"], ["rs", "rm"]),
        # Toms are ONE instrument at different pitches: one group, Hi/Mid/Lo subgroups.
        ("Tom", "Hi", ["high tom", "hi tom", "rack tom 1", "tom 1", "hitom"], ["ht", "hitom"]),
        ("Tom", "Mid", ["mid tom", "middle tom", "rack tom 2", "tom 2", "midtom"], ["mt", "midtom"]),
        ("Tom", "Lo", ["low tom", "floor tom", "tom 3", "lotom"], ["lt", "ft", "lotom"]),
        ("Tom", "Disco", ["disco tom", "discotom", "disco"], []),
        ("Tom", "", ["tom"], ["tm"]),
        # Cowbell before Bell so "cowbell" never falls through to plain Bell.
        ("Perc", "Cowbell", ["cowbell", "cow bell", "cow"], ["cb", "cow", "cowb"]),
        ("Perc", "Conga", ["conga", "tumba", "quinto"], ["cg", "con", "cng"]),
        ("Perc", "Bongo", ["bongo"], ["bng"]),
        ("Perc", "Clave", ["claves", "clave"], ["cv", "clv"]),
        ("Perc", "Shaker", ["shaker", "maracas", "cabasa"], ["shk", "sh"]),
        ("Perc", "Block", ["woodblock", "wood block", "block"], ["wb"]),
        ("Perc", "Bell", ["bell"], []),
        ("Perc", "Chime", ["chime"], []),
        ("Perc", "Kalimba", ["kalimba", "mbira", "thumb piano"], []),
        ("Perc", "Taiko", ["taiko"], []),
        ("Perc", "Tabla", ["tabla"], []),
        ("Perc", "Triangle", ["triangle"], []),
        # Slap bass is a Bass technique — guard it before the Slap percussion rule.
        ("Bass", "", ["slap bass", "bass slap"], []),
        ("Perc", "Slap", ["slap"], []),
        ("Perc", "", ["percussion", "auxiliary", "perc"], ["prc"]),
        ("Guitar", "", ["guitar", "gtr", "acoustic gt", "electric gt"], ["gtr", "gt"]),
        ("Strings", "", ["strings", "string", "violin", "viola", "cello", "orchestra", "ensemble", "pizz", "arco"], []),
        # Horns and saxes — Tonal wind groups.
        ("Horn", "", ["horn"], ["hrn"]),
        ("Sax", "", ["saxophone", "sax"], []),
        ("Bass", "", ["bass", "sub bass"], ["sub"]),
        ("Vocal", "", ["vocal", "voice", "vox"], ["vx"]),
        ("Keyboards", "Electric Piano", ["electric piano", "rhodes", "wurlitzer", "wurli", "e-piano", "epiano"], ["ep"]),
        ("Keyboards", "Organ", ["organ", "hammond"], ["org"]),
        ("Keyboards", "Clav", ["clavinet", "clav"], []),
        ("Keyboards", "Piano", ["grand piano", "upright piano", "piano"], ["pno"]),
        ("Keyboards", "Synth", ["synthesizer", "synth"], ["syn"]),
        ("Keyboards", "", ["keyboard", "keys"], ["kb", "keyb"]),
        # Generic single tonal notes — after every named instrument, so
        # "Piano Note C3" stays a Piano.
        ("Note", "", ["note"], []),
        ("Scratch", "", ["scratches", "scratch"], ["scr"]),
        ("DJ", "", ["turntable", "deck"], ["dj"]),
        ("FX", "", ["sound effect", "foley", "atmosphere", "atmos", "riser", "sweep", "laser", "noise",
                    "impact", "boom", "zap", "glitch", "drone", "whoosh", "reverse", "downlifter",
                    "uplifter", "sfx", "fx"], ["fx", "sfx"]),
        ("Loops/Patterns", "", ["loop", "groove", "beat"], ["lp"]),
    ]

    @staticmethod
    def _normalize_name(name):
        """Lower-case, non-alnum runs → spaces, split letter↔digit boundaries
        ('Tom2' → 'tom 2') — mirrors the Rust analyzer's normalize_name."""
        out, prev = [], 0  # prev: 0=sep, 1=alpha, 2=digit
        for c in name.lower():
            kind = 1 if (c.isascii() and c.isalpha()) else 2 if (c.isascii() and c.isdigit()) else 0
            if kind == 0:
                if out and out[-1] != " ":
                    out.append(" ")
            else:
                if prev not in (0, kind):
                    out.append(" ")
                out.append(c)
            prev = kind
        return "".join(out)

    @classmethod
    def _classify_name(cls, text):
        """Fallback (group, subgroup) from a file path's keywords."""
        norm = cls._normalize_name(text)
        if "cym" in norm:
            if "crash" in norm:
                return ("Cymbal", "Crash")
            if "gong" in norm:
                return ("Cymbal", "Gong")
            return ("Cymbal", "")
        if "hh" in norm:
            return ("Hi-Hat", "")
        if "hat" in norm:
            return ("Hi-Hat", "")
        if "sfx" in norm:
            return ("FX", "")
        toks = set(norm.split())
        for group, sub, phrases, abbrevs in cls._NAME_RULES:
            if any(p in norm for p in phrases) or any(a in toks for a in abbrevs):
                return (group, sub)
        return ("Unclassified", "")

    @staticmethod
    def _dedup_words(stem):
        """Drop later word repeats (case-insensitive) by prefix/stem: a word is
        dropped when an already-seen word (>=3 chars) is a prefix of it, so
        'Snare' also swallows 'Snaredrums' and 'SNAREDRUM'. Splits on ' - ', '_',
        spaces and '-', so 'BASSDRUM - Bassdrum-01' keeps the trailing '01'; a
        kept word keeps the delimiter that originally followed it."""
        tokens = re.split(r'( - | |_|-)', stem)
        words = tokens[0::2]
        delims = tokens[1::2]              # delims[i] sits between words[i] and words[i+1]
        seen = []                          # kept words, lowercased, in order
        out_words, out_delims, pending = [], [], None
        for i, w in enumerate(words):
            following = delims[i] if i < len(delims) else None
            key = w.strip().lower()
            dup = key and any(key == s or (len(s) >= 3 and key.startswith(s)) for s in seen)
            if w and dup:
                continue                  # drop the repeat; keep `pending` for the next kept word
            if key:
                seen.append(key)
            if out_words:
                out_delims.append(pending if pending is not None else " - ")
            out_words.append(w)
            pending = following
        result = out_words[0] if out_words else ""
        for d, w in zip(out_delims, out_words[1:]):
            result += d + w
        return re.sub(r'^(?: - | |_|-)+|(?: - | |_|-)+$', "", result)

    def _tv_sort(self, tv, col, reverse):
        """Sort a Treeview by a clicked column (numeric-aware, toggles order)."""
        if col == "#0":
            items = [(tv.item(iid, "text"), iid) for iid in tv.get_children("")]
        else:
            items = [(tv.set(iid, col), iid) for iid in tv.get_children("")]

        def keyf(pair):
            v = pair[0]
            try:
                return (0, float(v))
            except (TypeError, ValueError):
                return (1, str(v).lower())
        items.sort(key=keyf, reverse=reverse)
        for idx, (_v, iid) in enumerate(items):
            tv.move(iid, "", idx)
        tv.heading(col, command=lambda: self._tv_sort(tv, col, not reverse))

    def _rename_pick(self):
        d = filedialog.askdirectory(title="Select folder to flatten / rename")
        if d:
            self.rename_dir.set(d)
            self._rename_scan()

    def _rename_pick_dest(self):
        d = filedialog.askdirectory(title="Select destination folder for renamed files")
        if d:
            self.rename_dest.set(d)
            self._rename_scan()

    def _strip_group_words(self, stem, egroup, esub):
        """Remove the detected group/subgroup words (and that group's known
        keyword aliases, e.g. 'bd'/'kik' for Kick) from the original stem, so
        'Kick_01' under a Kick prefix/folder becomes just '01'. Falls back to
        the untouched stem when everything would be stripped."""
        words = set()
        for g in (egroup, esub):
            if g and g != "Unclassified":
                words.update(self._normalize_name(g).split())
        for group, sub, phrases, abbrevs in self._NAME_RULES:
            if group == egroup or (sub and sub == esub):
                for p in phrases:
                    words.update(p.split())
                words.update(abbrevs)
        # Never strip plain numbers — they're the sample's index ("Tom 2"),
        # even when a rule phrase (like "tom 2") contains one.
        words = {w for w in words if not w.isdigit()}
        if not words:
            return stem
        tokens = re.split(r'( - | |_|-)', stem)
        kept, pending = [], None
        for i in range(0, len(tokens), 2):
            w = tokens[i]
            parts = self._normalize_name(w).split()
            drop = bool(parts) and all(
                t in words or any(len(gw) >= 3 and t.startswith(gw) for gw in words)
                for t in parts)
            delim = tokens[i + 1] if i + 1 < len(tokens) else None
            if drop:
                continue
            if kept and pending is not None:
                kept.append(pending)
            kept.append(w)
            pending = delim
        out = re.sub(r'^(?: - | |_|-)+|(?: - | |_|-)+$', "", "".join(kept))
        return out or stem

    def _rename_scan(self):
        tv = self.rename_tv
        tv.delete(*tv.get_children())
        self.rename_map = []
        self.rename_item_rec = {}
        root = self.rename_dir.get()
        if not os.path.isdir(root):
            return
        flatten = self.rename_flatten.get()
        audio_only = self.rename_audio_only.get()
        dest = self.rename_dest.get()
        dest_ok = bool(dest) and os.path.isdir(dest)
        folder_keys = self.folder_parts.enabled_keys()
        prepend_keys = self.prepend_parts.enabled_keys()
        append_keys = self.append_parts.enabled_keys()
        strip_group = self.rename_strip_group.get()
        dedup = self.rename_dedup.get()
        # The preview columns mirror the enabled parts, in build order.
        name_specs = ([(k, self.prepend_parts.label_for(k)) for k in prepend_keys]
                      + [("original", "Original name")]
                      + [(k, self.append_parts.label_for(k)) for k in append_keys])
        self._configure_rename_columns(name_specs, with_folder=bool(folder_keys))
        targets = {}   # new_abs -> count (collision detection)
        rows = []
        for dirpath, _dirs, files in os.walk(root):
            for fn in sorted(files):
                if fn.startswith("."):
                    continue
                if fn.lower().endswith(".peak"):
                    continue  # analysis sidecars aren't samples
                if audio_only and not fn.lower().endswith(self.AUDIO_EXTS):
                    continue
                abspath = os.path.join(dirpath, fn)
                rec = self._peak_for(abspath)
                # Effective group/subgroup: prefer the PEAK record, else fall back
                # to a name-based classification of the path, so e.g. "Bass Drum"
                # sorts to Kick even when the file has no analysis record.
                egroup = (rec.get("group") if rec else "") or ""
                esub = (rec.get("subgroup") if rec else "") or ""
                if not egroup or egroup == "Unclassified":
                    fg, fsg = self._classify_name(os.path.relpath(abspath, root))
                    if fg != "Unclassified" or not egroup:
                        egroup = fg
                    if not esub:
                        esub = fsg

                def part_value(key):
                    """Resolve one builder token to its text for this file."""
                    if key == "path":
                        relf = os.path.relpath(dirpath, root).replace("\\", "/")
                        return " - ".join(p for p in relf.split("/") if p and p != ".")
                    if key == "group":
                        return egroup
                    if key == "subgroup":
                        return esub
                    if key == "root":
                        v = (rec.get("root_note_name") if rec else "") or ""
                        return f"ROOT-{v}" if v else ""
                    if key == "bpm":
                        v = (rec.get("beats_per_minute") or 0) if rec else 0
                        return f"{round(v)}BPM" if v > 10 else ""
                    if key == "cluster":
                        v = rec.get("cluster", -1) if rec else -1
                        return f"Cluster {v}" if isinstance(v, int) and v >= 0 else ""
                    val = (rec.get(key) if rec else "") or ""
                    if isinstance(val, list):
                        return ", ".join(str(x) for x in val)
                    return str(val)

                def clean(v):
                    return re.sub(r'[\\/:*?"<>|]+', "_", v).strip()

                # File name: [prepend parts] - <original stem> - [append parts].
                # One value per enabled part (kept aligned with the preview
                # columns); metadata parts collapse repeats among themselves
                # ("Snare - Snare Medium" → "Snare - Medium") regardless of
                # the dedup option.
                stem0, ext = os.path.splitext(fn)
                orig = self._strip_group_words(stem0, egroup, esub) if strip_group else stem0
                display_vals, meta_seen = [], []
                for key, _lbl in name_specs:
                    if key == "original":
                        display_vals.append(orig)
                        continue
                    v = clean(part_value(key))
                    if v and key != "path" and meta_seen:
                        joined = " - ".join(meta_seen)
                        combined = self._dedup_words(joined + " - " + v)
                        v = combined[len(joined):].lstrip(" -_")
                    if v and key != "path":
                        meta_seen.append(v)
                    display_vals.append(v)
                stem = " - ".join(v for v in display_vals if v) or stem0
                if dedup:
                    stem = self._dedup_words(stem)
                new_name = (stem or stem0) + ext

                # Destination folder: one level per checked folder part, each
                # level stripped of words the previous level already carries
                # (Loop/"Loop Guitar" → Loop/Guitar).
                base = dest if dest_ok else (root if flatten else dirpath)
                sub_parts = []
                for key in folder_keys:
                    v = part_value(key)
                    lvl = self._safe_folder(v) if v not in (None, "") else "Unsorted"
                    if sub_parts:
                        combined = self._dedup_words(sub_parts[-1] + " - " + lvl)
                        stripped = combined[len(sub_parts[-1]):].lstrip(" -_")
                        if not stripped or stripped.lower() == sub_parts[-1].lower():
                            continue
                        lvl = stripped
                    sub_parts.append(lvl)
                if sub_parts:
                    dest_dir = os.path.join(base, *sub_parts)
                    disp_new = os.path.join(*sub_parts, new_name)
                else:
                    dest_dir = base
                    disp_new = new_name
                new_abs = os.path.join(dest_dir, new_name)
                rel = os.path.relpath(abspath, root)
                rows.append([abspath, rel, disp_new, new_abs, rec, "/".join(sub_parts), display_vals])
                targets[new_abs] = targets.get(new_abs, 0) + 1

        n_change = n_noop = n_suffixed = 0
        used = set()
        for r in rows:                       # pre-seed no-op targets so we don't clobber them
            if r[3] == r[0]:
                used.add(r[3])
        show_folder = bool(folder_keys)
        for r in rows:
            abspath, rel, disp_new, new_abs, rec, folder_disp, display_vals = r
            note = ""
            if new_abs == abspath:
                tags = ("noop",); n_noop += 1
            else:
                if targets[new_abs] > 1:
                    # Two files reduce to the same name: append a numeric suffix
                    # (-2, -3, …) so each target stays unique. This is resolved
                    # automatically — it is NOT an error.
                    uniq = self._dedupe(new_abs, used)
                    if uniq != new_abs:
                        uname = os.path.basename(uniq)
                        parent = os.path.dirname(disp_new)
                        disp_new = os.path.join(parent, uname) if parent else uname
                        new_abs = uniq
                        r[2], r[3] = disp_new, new_abs   # keep rename_map in sync for apply
                        note = "auto-numbered"; n_suffixed += 1
                used.add(new_abs)
                tags = ("suffixed",) if note else ()
                n_change += 1
            vals = [rel] + ([folder_disp] if show_folder else []) + list(display_vals) + [note]
            iid = tv.insert("", "end", values=vals, tags=tags)
            self.rename_item_rec[iid] = (rec, abspath)
        self.rename_map = rows
        self.rename_summary.config(
            text=f"{len(rows)} files · {n_change} to rename · {n_noop} unchanged · "
                 f"{n_suffixed} auto-numbered to keep names unique")

    def _rename_apply(self):
        if not self.rename_map:
            messagebox.showinfo("Apply Rename", "Nothing to rename — pick a directory first.")
            return
        flatten = self.rename_flatten.get()
        todo = [r for r in self.rename_map if r[3] != r[0]]
        if not todo:
            messagebox.showinfo("Apply Rename", "All files are already named correctly.")
            return
        dest = self.rename_dest.get()
        copy = self.rename_copy.get()
        verb = "COPIED" if copy else "MOVED"
        if dest and os.path.isdir(dest):
            where = f"Files will be {verb} to:\n{dest}\n"
        elif flatten:
            where = f"Files will be {verb} up into the picked folder.\n"
        else:
            where = ("Renamed copies made in place.\n" if copy else "Files renamed in place.\n")
        if self.folder_parts.enabled_keys():
            where += "Sorted into subfolders by " + " / ".join(self.folder_parts.enabled_labels()) + ".\n"
        if not messagebox.askyesno(
                "Apply Rename",
                f"{'Copy' if copy else 'Rename'} {len(todo)} file(s)?\n\n" + where + "This modifies files on disk. Continue?"):
            return

        fmt = getattr(self, "conv_format", tk.StringVar(value="WAV")).get()
        chans = getattr(self, "conv_channels", tk.StringVar(value="Preserve")).get()
        sr = getattr(self, "conv_samplerate", tk.StringVar(value="Preserve")).get()

        used = set()
        # Pre-seed with files that keep their name (no-ops) so we don't clobber them.
        for abspath, rel, _disp, new_abs, *_rest in self.rename_map:
            if new_abs == abspath:
                used.add(new_abs)
        
        jobs = []
        for abspath, rel, _disp, new_abs, *_rest in todo:
            if fmt == "FLAC":
                base, _ext = os.path.splitext(new_abs)
                new_abs = base + ".flac"
            target = self._dedupe(new_abs, used)
            used.add(target)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            metadata = {}
            rec = self._peak_for(abspath)
            if rec:
                metadata["TITLE"] = rec.get("name", "")
                metadata["GENRE"] = rec.get("group", "")
                metadata["ALBUM"] = "Sample Analysis"
                
                if rec.get("instrument_family"):
                    metadata["INSTRUMENT_FAMILY"] = ", ".join(rec["instrument_family"]) if isinstance(rec["instrument_family"], list) else str(rec["instrument_family"])
                if rec.get("god_category"):
                    metadata["GOD_CATEGORY"] = rec["god_category"]
                if rec.get("timbre"):
                    metadata["TIMBRE"] = rec["timbre"]
                if rec.get("envelope_shape"):
                    metadata["ENVELOPE_SHAPE"] = rec["envelope_shape"]
                if rec.get("root_note_name"):
                    metadata["ROOT_NOTE"] = rec["root_note_name"]
                if rec.get("beats_per_minute", 0) > 0:
                    metadata["BPM"] = str(round(rec["beats_per_minute"]))

            jobs.append({
                "source_path": abspath,
                "target_path": target,
                "target_format": fmt,
                "target_channels": chans,
                "target_sample_rate": sr,
                "metadata": metadata
            })

        manifest_path = os.path.join(root, "job_manifest.json") if 'root' in locals() else "job_manifest.json"
        with open(manifest_path, "w") as f:
            json.dump(jobs, f)

        if hasattr(self, 'rename_btn_apply'):
            self.rename_btn_apply.config(state=tk.DISABLED)
        if hasattr(self, 'set_tab_blinking'):
            self.set_tab_blinking("Flatten / Rename", True)
        if hasattr(self, 'rename_btn_stop'):
            self.rename_btn_stop.config(state=tk.NORMAL)
        self.conv_progress["maximum"] = len(jobs)
        self.conv_process = None
        self.conv_progress["value"] = 0

        def run_jobs():
            import subprocess
            import os
            import signal
            ok = fail = 0
            errors = []
            try:
                proc = subprocess.Popen(
                    ["/home/anthony/Documents/GitProjects/Sample Analysis/Sample_Conversion_rs/target/release/Sample_Conversion_rs", manifest_path],
                    stdout=subprocess.PIPE, text=True, preexec_fn=os.setsid
                )
                self.conv_process = proc
                for line in proc.stdout:
                    try:
                        msg = json.loads(line)
                        if msg.get("status") == "success":
                            ok += 1
                            if not copy:
                                # They requested a move, so delete original
                                src = next((j["source_path"] for j in jobs if j["target_path"] == msg.get("file")), None)
                                if src and os.path.exists(src):
                                    os.remove(src)
                        elif msg.get("status") == "error":
                            fail += 1
                            errors.append(msg.get("error", "Unknown error"))
                        
                        def update_ui(v=ok+fail, fname=os.path.basename(msg.get("file", ""))):
                            self.conv_progress["value"] = v
                            self.conv_status.config(text=f"Processed {v} of {len(jobs)}: {fname}")
                        self.rename_btn_apply.after(0, update_ui)

                    except:
                        pass
                proc.wait()
                msg_txt = f"Processed {ok} file(s)."
                if fail:
                    short_errors = [e[:120] + ("..." if len(e) > 120 else "") for e in errors[:5]]
                    msg_txt += f"\n{fail} failed (first few errors):\n" + "\n".join(short_errors)
                
                # Cleanup empty folders if it was a move and flatten
                if not copy and flatten:
                    pass # Optional cleanup
                    
                self.rename_btn_apply.after(0, lambda: messagebox.showinfo("Apply Rename", msg_txt))
                self.rename_btn_apply.after(0, self._rename_scan)
            except Exception as e:
                self.rename_btn_apply.after(0, lambda: messagebox.showerror("Error", str(e)))
            finally:
                if os.path.exists(manifest_path):
                    os.remove(manifest_path)
                if hasattr(self, 'rename_btn_apply'):
                    self.rename_btn_apply.after(0, lambda: self.rename_btn_apply.config(state=tk.NORMAL))
                if hasattr(self, 'rename_btn_stop'):
                    self.rename_btn_apply.after(0, lambda: self.rename_btn_stop.config(state=tk.DISABLED))
                self.rename_btn_apply.after(0, lambda: self.conv_status.config(text=""))
                if hasattr(self, 'set_tab_blinking'):
                    self.rename_btn_apply.after(0, lambda: self.set_tab_blinking("Flatten / Rename", False))
                self.conv_process = None

        import threading
        threading.Thread(target=run_jobs, daemon=True).start()

    def _rename_stop(self):
        if hasattr(self, 'conv_process') and self.conv_process:
            import os
            import signal
            try:
                os.killpg(os.getpgid(self.conv_process.pid), signal.SIGTERM)
            except Exception:
                pass
            self.conv_process = None
            self.conv_status.config(text="Stopping conversion...")
            self.rename_btn_stop.config(state=tk.DISABLED)
            if hasattr(self, 'set_tab_blinking'):
                self.set_tab_blinking("Flatten / Rename", False)

    @staticmethod
    def _dedupe(path, used):
        if path not in used and not os.path.exists(path):
            return path
        base, ext = os.path.splitext(path)
        i = 2
        while True:
            cand = f"{base}-{i}{ext}"
            if cand not in used and not os.path.exists(cand):
                return cand
            i += 1
