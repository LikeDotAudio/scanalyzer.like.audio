"""Near-black theme for the Sample Analyzer.

One call — `apply_dark(root)` — styles every ttk widget class the app uses:
near-black backgrounds with bright text, matching the matplotlib panels
(#0f0f0f / #1b1b1b) that were already dark.
"""
from tkinter import ttk

BG = "#0e0e0e"      # window / frame background (near black)
PANEL = "#1b1b1b"   # raised controls (buttons, headings, tabs)
FIELD = "#101010"   # data fields (trees, entries, text)
FG = "#e8e8e8"      # bright primary text
ACCENT = "#f4902c"  # the app's existing orange
SEL = "#2f4a63"     # selection background


def apply_dark(root):
    root.configure(bg=BG)
    style = ttk.Style(root)
    style.theme_use("clam")

    style.configure(".", background=BG, foreground=FG, fieldbackground=FIELD,
                    bordercolor="#333", lightcolor=PANEL, darkcolor=BG,
                    troughcolor=PANEL, focuscolor=ACCENT,
                    selectbackground=SEL, selectforeground="#ffffff",
                    insertcolor=FG)
    style.configure("TFrame", background=BG)
    style.configure("TLabel", background=BG, foreground=FG)

    style.configure("TButton", background=PANEL, foreground=FG, padding=(8, 3))
    style.map("TButton", background=[("active", "#2c2c2c"), ("disabled", "#141414")],
              foreground=[("disabled", "#666")])
    style.configure("TCheckbutton", background=BG, foreground=FG)
    style.map("TCheckbutton", background=[("active", BG)],
              indicatorcolor=[("selected", ACCENT), ("!selected", FIELD)])

    style.configure("TEntry", fieldbackground=FIELD, foreground=FG, insertcolor=FG)
    style.configure("TCombobox", fieldbackground=FIELD, background=PANEL,
                    foreground=FG, arrowcolor=FG)
    style.map("TCombobox",
              fieldbackground=[("readonly", FIELD)],
              foreground=[("readonly", FG)],
              selectbackground=[("readonly", FIELD)],
              selectforeground=[("readonly", FG)])
    # The combobox dropdown is a plain tk Listbox — style it via options.
    root.option_add("*TCombobox*Listbox.background", PANEL)
    root.option_add("*TCombobox*Listbox.foreground", FG)
    root.option_add("*TCombobox*Listbox.selectBackground", SEL)
    root.option_add("*TCombobox*Listbox.selectForeground", "#ffffff")

    style.configure("Treeview", background=FIELD, fieldbackground=FIELD,
                    foreground=FG, bordercolor="#333")
    style.configure("Treeview.Heading", background=PANEL, foreground=FG, relief="flat")
    style.map("Treeview", background=[("selected", SEL)], foreground=[("selected", "#ffffff")])
    style.map("Treeview.Heading", background=[("active", "#2c2c2c")])

    style.configure("TNotebook", background=BG, bordercolor="#333")
    style.configure("TNotebook.Tab", background=PANEL, foreground=FG, padding=(12, 5))
    style.map("TNotebook.Tab", background=[("selected", "#262626")],
              foreground=[("selected", ACCENT)])

    style.configure("TPanedwindow", background=BG)
    style.configure("Sash", sashthickness=6, gripcount=0)
    style.configure("Horizontal.TProgressbar", background=ACCENT, troughcolor=PANEL,
                    bordercolor="#333", lightcolor=ACCENT, darkcolor=ACCENT)
    for orient in ("Vertical", "Horizontal"):
        style.configure(f"{orient}.TScrollbar", background=PANEL, troughcolor=BG,
                        arrowcolor=FG, bordercolor="#333")
        style.map(f"{orient}.TScrollbar", background=[("active", "#2c2c2c")])
    style.configure("TLabelframe", background=BG, foreground=FG, bordercolor="#333")
    style.configure("TLabelframe.Label", background=BG, foreground=FG)
