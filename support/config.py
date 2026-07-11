"""Shared constants + helpers for the Sample Analyzer GUI.

Kept in its own module so every tab mixin can import it without creating an
import cycle with the main app module.
"""
import colorsys
import os
import shutil
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
# Project root: this module lives in <root>/support/, the Rust crate in <root>/.
ROOT = os.path.dirname(HERE)

# Folder pre-selected on startup (Browse to change).
DEFAULT_DIR = "/home/anthony/Documents/Music Samples"

# Envelope-based "god categories" — the top-level containers over each name
# group (and its subgroups). Keyed on the ADSR shape a group tends to have.
GOD_CATEGORIES = [
    # Cymbals and rides are drums — percussive, tail and all.
    ("Percussive", ["Clap", "Cymbal", "Hi-Hat", "Kick", "Perc", "Ride", "Rim", "Snare", "Tom"]),
    ("Impulsive with Tail", ["IR"]),
    ("Tonal", ["Bass", "Guitar", "Horn", "Note", "Sax", "Strings", "Vocal"]),
    # Keyboards are their own top-level container: a keyboard with no BPM tag
    # is tonal by nature and never falls through to the envelope guess.
    ("Keyboards", ["Keyboards"]),
    ("Complex", ["DJ", "FX", "Loops/Patterns", "Scratch"]),
    ("Unassigned", ["Unclassified"]),
]
CATEGORY_ORDER = [cat for cat, _groups in GOD_CATEGORIES]
_GROUP_TO_CATEGORY = {g: cat for cat, groups in GOD_CATEGORIES for g in groups}


def god_category(group):
    """Map a name group to its envelope 'god category' (else 'Unassigned')."""
    return _GROUP_TO_CATEGORY.get(group, "Unassigned")


# Same palette the web cloud uses, so the two graphs colour groups identically.
CLOUD_PALETTE = [
    "#f4902c", "#8ab4f8", "#4caf50", "#e57373", "#ba68c8", "#4dd0e1",
    "#ffd54f", "#a1887f", "#90a4ae", "#f06292", "#aed581", "#7986cb",
    "#ff8a65", "#4db6ac", "#dce775", "#9575cd", "#ffffff",
]

# ---- god-category colour system ------------------------------------------
# One base hue per god category; every group in a category is a shade of its
# category's hue (a subgroup nudges the shade further), so the same colours
# read across the 3D cloud, the 2D stats, and every table.
GOD_HUES = {
    "Percussive": 0.02,  # red-orange
    "Impulsive with Tail":    0.12,  # gold
    "Tonal":      0.36,  # green
    "Keyboards":  0.55,  # cyan-blue
    "Complex":   0.74,  # violet
    "Unassigned":             None,  # grey ramp
}
_CATEGORY_GROUPS = {cat: groups for cat, groups in GOD_CATEGORIES}


def _hsv(h, s, v):
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, min(max(s, 0.0), 1.0), min(max(v, 0.0), 1.0))
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"


def god_color(category):
    """The category's own display colour (the mid shade of its ramp)."""
    hue = GOD_HUES.get(category)
    if hue is None:
        return "#9a9a9a"
    return _hsv(hue, 0.78, 0.95)


# Curated subgroups get fixed, guaranteed-distinct shade positions; anything
# unknown falls back to a stable hash.
_KNOWN_SUBGROUPS = ["Hi", "Mid", "Lo", "Disco",
                    "Crash", "Gong",
                    "Conga", "Bongo", "Cowbell", "Clave", "Shaker", "Block",
                    "Bell", "Chime", "Kalimba", "Taiko", "Tabla", "Slap", "Triangle",
                    "Piano", "Electric Piano", "Organ", "Clav", "Synth",
                    "Beat", "Groove", "Guitar", "Loop", "Drum"]


def _subgroup_nudge(subgroup):
    if not subgroup:
        return 0
    if subgroup in _KNOWN_SUBGROUPS:
        return (_KNOWN_SUBGROUPS.index(subgroup) % 9) - 4
    return zlib.crc32(subgroup.encode()) % 9 - 4


def group_color(group, subgroup=""):
    """Deterministic shade for a name group (+ optional subgroup): the god
    category fixes the hue, the group picks a shade within it, the subgroup
    nudges that shade — identical everywhere in the app."""
    cat = god_category(group)
    hue = GOD_HUES.get(cat)
    members = _CATEGORY_GROUPS.get(cat, [])
    gi = members.index(group) if group in members else zlib.crc32((group or "").encode()) % 8
    n = max(len(members), 2)
    t = (gi % n) / (n - 1)
    sj = _subgroup_nudge(subgroup)  # −4..+4 subgroup shade nudge
    if hue is None:  # Unassigned — a grey ramp
        return _hsv(0.0, 0.0, 0.5 + 0.35 * t + 0.03 * sj)
    return _hsv(hue + (t - 0.5) * 0.09 + 0.005 * sj,
                0.85 - 0.30 * t,
                0.92 - 0.18 * t + 0.045 * sj)


def find_binary():
    """Locate the built Rust analyzer binary (build it if missing)."""
    exe = "oa_sample_analyzer" + (".exe" if os.name == "nt" else "")
    candidates = [
        os.path.join(ROOT, "sample_analyzer_rs", "target", "release", exe),
        os.path.join(ROOT, "sample_analyzer_rs", "target", "debug", exe),
        shutil.which("oa_sample_analyzer"),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def find_graph_binary():
    """Locate the built graph-layout binary (the 3D-cloud placement engine)."""
    exe = "oa_graph_layout" + (".exe" if os.name == "nt" else "")
    candidates = [
        os.path.join(ROOT, "graphing_rs", "target", "release", exe),
        os.path.join(ROOT, "graphing_rs", "target", "debug", exe),
        shutil.which("oa_graph_layout"),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None
