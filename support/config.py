"""Shared constants + helpers for the Sample Analyzer GUI.

Kept in its own module so every tab mixin can import it without creating an
import cycle with the main app module.
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
# Project root: this module lives in <root>/support/, the Rust crate in <root>/.
ROOT = os.path.dirname(HERE)

# Folder pre-selected on startup (Browse to change).
DEFAULT_DIR = "/home/anthony/Documents/Music Samples"

# Envelope-based "god categories" — the top-level containers over each name
# group (and its subgroups). Keyed on the ADSR shape a group tends to have.
GOD_CATEGORIES = [
    ("Transient / Percussive", ["Clap", "HiHat", "Kick", "Perc", "Rim", "Snare", "Tom"]),
    ("Impulsive with Tail", ["Cymbal", "IR", "Ride"]),
    ("Sustained / Tonal", ["Bass", "Guitar", "Keyboards", "Strings", "Vocal"]),
    ("Complex / Continuous", ["DJ", "FX", "Loops/Patterns", "Scratch"]),
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
