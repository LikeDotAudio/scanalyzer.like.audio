import re

with open("support/stats_tab.py", "r") as f:
    content = f.read()

# Replace UI building
ui_target = """        # Group selector: a wrapping row of buttons to click through, above X / Y.
        gwrap = ttk.Frame(tab, padding=(6, 4, 6, 0))
        gwrap.pack(fill=tk.X)
        ttk.Label(gwrap, text="Group:", foreground="#888").pack(anchor=tk.W)
        self.stats_gbar = tk.Frame(gwrap, bg="#1e1e1e")
        self.stats_gbar.pack(fill=tk.X)
        self.stats_gbar.bind("<Configure>", lambda e: self._reflow_group_buttons(e.width))
        self.stats_group = tk.StringVar()
        self.stats_group_btns = {}   # group -> tk.Button
        self._gbar_cols = None"""

ui_replacement = """        # Progressive Isolation group selectors
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
        self.stats_sub_btns = {}"""
content = content.replace(ui_target, ui_replacement)

# Replace methods from _refresh_stats_groups down to _redraw_stats
methods_target = """    def _refresh_stats_groups(self):
        \"\"\"Keep the group buttons in sync with what's been analyzed. Cheap no-op
        when the group set is unchanged (called on every cloud redraw).\"\"\"
        recs = self._stats_records()
        groups = sorted({(r.get("group") or "Other") for r in recs})
        if groups == self._stats_group_keys:
            return
        self._stats_group_keys = groups
        self._rebuild_group_buttons(groups)
        if self.stats_group.get() not in groups:
            self.stats_group.set(groups[0] if groups else "")
            self._redraw_stats()
        else:
            self._highlight_group_button()

    # ---- group buttons (click through) -----------------------------------
    def _rebuild_group_buttons(self, groups):
        for b in self.stats_group_btns.values():
            b.destroy()
        self.stats_group_btns = {}
        for g in groups:
            b = tk.Button(self.stats_gbar, text=g, font=("Helvetica", 8), padx=6, pady=1,
                          bg="#2a2a2a", fg=group_color(g),
                          activebackground="#3a3a3a", activeforeground="#ffffff",
                          relief=tk.RAISED, bd=1,
                          command=lambda gg=g: self._select_stats_group(gg))
            self.stats_group_btns[g] = b
        self._gbar_cols = None  # force a reflow
        self._reflow_group_buttons(self.stats_gbar.winfo_width())
        self._highlight_group_button()

    def _reflow_group_buttons(self, width):
        \"\"\"Wrap the group buttons into as many columns as fit the current width.\"\"\"
        if not self.stats_group_btns:
            return
        if width <= 1:
            width = self.stats_gbar.winfo_width() or 760
        cols = max(1, width // 88)
        if cols == self._gbar_cols:
            return
        self._gbar_cols = cols
        for i, b in enumerate(self.stats_group_btns.values()):
            b.grid(row=i // cols, column=i % cols, sticky="ew", padx=1, pady=1)
        for c in range(cols):
            self.stats_gbar.grid_columnconfigure(c, weight=1)

    def _select_stats_group(self, g):
        self.stats_group.set(g)
        self._highlight_group_button()
        self._redraw_stats()

    def _highlight_group_button(self):
        sel = self.stats_group.get()
        for g, b in self.stats_group_btns.items():
            if g == sel:
                b.config(bg=group_color(g), fg="#111", relief=tk.SUNKEN)
            else:
                b.config(bg="#2a2a2a", fg=group_color(g), relief=tk.RAISED)"""

methods_replacement = """    def _refresh_stats_groups(self):
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
            bar.grid_columnconfigure(c, weight=1)"""
content = content.replace(methods_target, methods_replacement)

# Replace _redraw_stats internal logic
redraw_target = """        g = self.stats_group.get()
        recs = [r for r in self._stats_records() if (r.get("group") or "Other") == g]
        if not recs:
            ax.set_title("select a group", color="#888", fontsize=9)
            self.stats_summary.config(text="No analysis yet")
            self._stats_pts = None
            self._stats_recs = []
            self.stats_canvas.draw_idle()
            return

        xk = self._measure_key(self.stats_x.get())
        yk = self._measure_key(self.stats_y.get())

        # Colour by curated subgroup (falls back to the group itself). Keep a flat
        # list of every plotted point so clicks can pick the nearest sample.
        def sub_of(r):
            s = self._deeper_sub(r) if hasattr(self, "_deeper_sub") else ""
            return s or g
        subs = sorted({sub_of(r) for r in recs})
        all_x, all_y, all_recs = [], [], []
        for i, s in enumerate(subs):
            pts = [r for r in recs if sub_of(r) == s]
            xs = [float(r.get(xk, 0) or 0) for r in pts]
            ys = [float(r.get(yk, 0) or 0) for r in pts]
            ax.scatter(xs, ys, s=26, alpha=0.8, edgecolors="none",
                       color=group_color(g, s if s != g else ""), label=s)
            all_x += xs
            all_y += ys
            all_recs += pts
        self._stats_pts = (np.array(all_x, dtype=float), np.array(all_y, dtype=float))
        self._stats_recs = all_recs
        ax.set_xlabel(self.stats_x.get(), color="#aaa", fontsize=8)
        ax.set_ylabel(self.stats_y.get(), color="#aaa", fontsize=8)
        ax.set_title(f"{god_category(g)} · {g} — {len(recs)} samples", color="#f4902c", fontsize=9)
        if len(subs) > 1:
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
        self.stats_summary.config(text=f"{god_category(g)} · {g} · {len(recs)} samples")"""

redraw_replacement = """        god = self.stats_god.get()
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
        self.stats_summary.config(text=f"{title} · {len(recs)} samples")"""
content = content.replace(redraw_target, redraw_replacement)

with open("support/stats_tab_new.py", "w") as f:
    f.write(content)

