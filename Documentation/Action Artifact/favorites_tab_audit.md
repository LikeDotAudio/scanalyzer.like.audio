# Audit — the Favorites tab: F-to-flag, orange marking, `favorites.json`

**Ask:** while listening, press **F** and the sample becomes a favorite; favorites render
**orange** everywhere; a new tab — "another Examiner, but it's only a list of filtered
favorites" — lists them; and a favorites manifest is written to the **library root, parallel
to the manifest**: `favorites.json` next to `sample_cloud_manifest.json`.

This is a design audit: what the feature should ride on, the decisions with trade-offs, and a
minimal implementation map. Nothing here is built yet.

---

## 1. What already exists to ride on

The app already has every rail this feature needs — the design below adds almost no new
machinery.

| Need | Existing rail | Where |
|---|---|---|
| "What am I listening to right now?" | `currentSound` / `footerItem` — every tab reports its playing sample up via `onSound`, App resolves the full record | `App.tsx:81-84` |
| A list UI with virtualized rows, DIG, transport | `ExaminerTab` — 24 px virtualized rows, ↑/↓ keys, DIG-through-list, footer transport registration | `ExaminerTab.tsx` |
| Writing a sibling-of-the-manifest file (web) | `writeRootFile(handle, name, text)` — exactly how the manifest itself is written | `audioLinking.ts:157`, `ScanalyzeTab.tsx:267` |
| Reading it back on open/reopen | `readRootFile` — the manifest fast path | `audioLinking.ts:145`, `App.tsx:215` |
| Global keyboard precedents | cloud arrow keys, Examiner ↑/↓ — both guard `INPUT`/`SELECT`/`TEXTAREA` targets | `SampleCloud.tsx`, `ExaminerTab.tsx:261` |
| The orange | `var(--accent-primary)` `#f4902c` — the app's own accent | `index.css` |
| Scoping/filter pipeline | `scopedData`/`filteredData` computed once in App, fed to every tab | `App.tsx:60-74` |

**Two gaps** the design has to close:

1. **Desktop has no generic root-file write.** The Tauri command surface
   (`lib.rs:454-468`) is specialized — `open_manifest`, `build_manifest`, pagers — nothing
   writes arbitrary text at the root. `fs:default` from `@tauri-apps/plugin-fs` is enabled but
   unscoped. Cleanest: add two tiny commands, `read_root_text(directory, file_name)` and
   `write_root_text(directory, file_name, text)`, mirroring the manifest pattern.
2. **Web folder handles are read-only.** Both the silent re-link and the reopen flow request
   `{ mode: 'read' }` (`App.tsx:122, 203`). Writing `favorites.json` needs a `readwrite`
   grant. A keydown counts as user activation in Chromium, so the **first F press can lazily
   upgrade the grant** (`handle.requestPermission({ mode: 'readwrite' })`). Denied → keep
   favorites in memory + a `localStorage` mirror, and surface one dismissible banner:
   *"Favorites live in this session only — allow folder write access to keep them."*

---

## 2. Identity: what a favorite points at

**Key on the relative path, not the bare name.** The Extractor's sidecar pairing learned this
the hard way (`stem()` in `ScanalyzeTab.tsx:18-21` — "a library has a `Kick.wav` in every drum
folder"). The favorite key is:

```
metadata.path || metadata.name        // demo pack / dropped .PEAKs have name-only paths — fine
```

The in-memory shape is `Set<string>` — O(1) row paint, one identity, no per-tab copies.

Keying on the path makes `favorites.json` **portable with the folder**: sync the library
through Dropbox or move the drive and the flags travel, because everything is relative to the
root the file sits in — the same contract the manifest already has.

---

## 3. State: one set, owned by App

`favorites` must live in `App.tsx`, not in a tab:

- **F works from any tab** — the handler needs `footerItem`, which App owns.
- **Orange renders in four places** — Examiner rows, Extractor's `FileGroups`, the footer, and
  the new tab. One source of truth or they drift.
- **One writer** — persistence (debounced write of `favorites.json`) has a single owner; tabs
  never touch disk.

```tsx
const [favorites, setFavorites] = useState<Set<string>>(new Set());
const toggleFavorite = (item: any) => { /* flip key, schedule debounced persist */ };
```

## 4. The F key

Global `keydown` listener in App:

- **Target guard** — bail when `e.target` is `INPUT`/`SELECT`/`TEXTAREA` (house pattern; the
  filter box and the Extractor's region-name inputs must keep their F).
- **`e.repeat` guard** — holding F must not machine-gun the flag.
- **What gets flagged: `footerItem`** — the sample the footer is on, whether or not audio is
  mid-play. "Only while actually playing" reads as unpredictable the moment a 0.2 s hi-hat
  finishes before the finger lands; the footer readout is what the user believes they're
  listening to. During **DIG** this is exactly the crate-digging loop the ask describes:
  samples stream by, F taps flag them, digging never pauses.
- **Touch parity** — phones have no F key. The footer gets a **★ button** next to
  Play/DIG showing live state (hollow ★ / orange ★), which is also the discoverability story
  for the key (`title="Favorite — F"`).

## 5. The orange

- **Examiner rows** (and the Favorites tab): the name cell renders in
  `var(--accent-primary)` with a `★` prefix. Selection highlight already owns the row
  background, so favorite-ness colors the *text*, and the two states compose instead of
  fighting.
- **Footer**: the ★ button is the state indicator itself.
- **Extractor `FileGroups` / Rename list**: same orange-name treatment, same one-line change.
- **The 3D cloud: deliberately unchanged.** Point hue is UCS category — semantic. Painting
  favorites orange would collide with every orange-hued category and silently lie about
  taxonomy. If the cloud ever marks favorites it should be a *shape* treatment (halo ring like
  the selection wireframe), not a hue change — out of scope here.

## 6. `favorites.json` — sibling of the manifest, never inside it

**Why a separate file:** the manifest is a *rebuildable cache* — every re-scan regenerates it
(web and desktop both), and the desktop analyzer writes it without any knowledge of UI state.
Favorites are *user data*. Folding them into the manifest means every re-scan wipes them.
Parallel file, parallel lifecycle:

```
<library root>/
├── sample_cloud_manifest.json     ← rebuildable cache (scan output)
├── favorites.json                 ← user data (never touched by scans)
└── ... samples + .PEAK sidecars
```

**Schema** — full-English field names per project convention, version-stamped like every other
artifact this project writes:

```json
{
  "favorites_version": 1,
  "generated_unix": 1789000000,
  "favorites": [
    { "path": "Drums/Kicks/Kick 03.wav", "name": "Kick 03.wav", "favorited_unix": 1789000000 },
    { "path": "HiHat 20.wav",            "name": "HiHat 20.wav", "favorited_unix": 1789000212 }
  ]
}
```

Array-of-objects rather than bare paths: `favorited_unix` gives the Favorites tab a
"recently favorited" sort for free, and future per-favorite fields (rating, color tag, note)
land without a version bump.

**Write policy:** debounce ~500 ms after the last toggle, serialize the whole file,
last-write-wins. The file is tiny (a 500-favorite library is ~50 KB); atomicity games are not
worth it. **Read policy:** on every folder open/reopen — all three paths (web manifest fast
path, web sidecar walk, desktop reopen) — read `favorites.json`, intersect nothing, just load
the set. Unknown paths are **kept, not pruned**: a missing file may be a not-yet-relinked
folder, and pruning on load would destroy data for the crime of opening the app. The Favorites
tab renders entries whose record is missing as dimmed "not in this scan" rows.

**No root at all** (demo pack, drag-dropped `.PEAK`s): favorites work in-memory with a
`localStorage` mirror under a demo key; the banner explains nothing will be written.

## 7. The tab itself: reuse the Examiner, don't fork it

Three ways to get "another Examiner but only favorites":

| Option | Shape | Verdict |
|---|---|---|
| **A. Fork** — copy `ExaminerTab` → `FavoritesTab`, filter inside | ~950 duplicated lines | ✗ two Examiners to fix every bug in; the fork rots immediately |
| **B. Reuse** — mount `<ExaminerTab>` a second time under `#/favorites`, feeding it pre-filtered rows | `filteredData.filter(it => favorites.has(keyOf(it)))` | ✓ **recommended** — zero fork, DIG/columns/eye/meters all inherited |
| **C. Filter toggle** — a "★ only" chip in the scope bar, no new tab | one checkbox | ✗ alone it fails the ask (no dedicated place), but it composes with B and is worth adding later |

Option B specifics:

- App mounts `{activeTab === 'favorites' && <ExaminerTab filteredData={favoriteRows} ...>}`
  inside the existing `Suspense`. Only the active tab mounts, so the
  `registerTransport` singleton and the shared `COLS_KEY` column prefs don't collide — the
  second mount **is** an Examiner, so sharing column layout is a feature, not a bug.
- `tabOwnsAudio` in App extends to `activeTab === 'favorites'` (it owns audio exactly like the
  Examiner it is).
- **DIG inside Favorites digs favorites only** — free, because DIG advances through the rows
  it was given, and the rows are the favorites.
- **Scope bar composes** — the favorites rows derive from `filteredData`, so the category
  chips and text filter narrow the Favorites tab like every other tab. "All" shows every
  favorite. Consistent mental model, zero special cases.
- **Empty state** replaces the table when the set is empty:
  *"No favorites yet — press F while a sample plays, or tap ★ in the footer."*
- Tab strip: `{ id: 'favorites', label: '★ Favorites' }` after Examiner; add to `TAB_IDS`
  for hash routing.

## 8. Edge cases and their rulings

| Case | Ruling |
|---|---|
| F while typing in any text field | ignored (target guard) |
| F held down | one toggle (`e.repeat` guard) |
| F with nothing selected/playing | no-op — nothing to flag |
| F on an already-favorite sample | un-favorite (toggle); the orange turning off is the confirmation |
| Rename tab renames a favorited file | re-key the entry as part of the rename commit — same pass that rewrites the sidecar; otherwise the favorite orphans |
| Favorite's file missing at load | keep the entry, render dimmed; never auto-prune user data |
| "Unload sounds" full reset | favorites set clears from memory; `favorites.json` stays on disk and reloads with the folder |
| Two sessions on the same folder | last write wins — acceptable for a single-user library tool; noted, not solved |
| Duplicate filenames across folders | non-issue — keys are relative paths |
| Write permission denied (web) | in-memory + localStorage fallback, one banner, no nagging |
| Manifest regenerated / library re-scanned | `favorites.json` untouched by design — separate file, separate lifecycle |

## 9. Implementation map (est. ~170 lines total)

| File | Change |
|---|---|
| `favorites.ts` **(new)** | `FAVORITES_FILE = 'favorites.json'`, schema types, `buildFavorites()` / `parseFavorites()` (~40 lines, mirrors `manifest.ts`) |
| `App.tsx` | `favorites` state + `toggleFavorite` + F-key listener + load-on-open (3 paths) + debounced persist + props to tabs + `favorites` tab mount + `tabOwnsAudio` (~70) |
| `ExaminerTab.tsx` | `favorites?: Set<string>`, `onToggleFavorite?` props → ★ + orange name in the name cell; empty-state message when favorites-mode and empty (~20) |
| `SampleFooter.tsx` | ★ toggle button, orange when active, `title="Favorite — F"` (~10) |
| `FileGroups.tsx` (Extractor) | orange name for favorites (~5) |
| `audioLinking.ts` | `ensureReadwrite(handle)` helper for the lazy grant upgrade (~10) |
| `src-tauri/lib.rs` | `read_root_text` / `write_root_text` commands + handler registration (~20) |

## 10. Verification plan (when built)

Headless drive per `Web_Front/.claude/skills/verify/SKILL.md`: load demo pack → play a sample
→ press F → row turns orange + footer ★ fills → Favorites tab lists exactly the flagged
samples → DIG inside Favorites advances through favorites only → F again un-favorites live.
Persistence needs an FSA-picked real folder (or desktop): favorite two files, reload, reopen —
flags return; inspect `favorites.json` sits beside `sample_cloud_manifest.json` and survives a
re-scan.

---

## Implemented — 2026-07-16, same day, as designed (Option B)

Shipped exactly per sections 3–9: `favorites.ts` (schema/keys/parse/build), App-owned
`Map<path, favorited_unix>` with the F listener (target + repeat guards), load-on-open for
all entry paths with a `localStorage` mirror fallback, debounced 500 ms persist (FSA
readwrite lazy-upgrade on web / new `read_root_text`+`write_root_text` commands on desktop),
orange ★ names in Examiner rows and the Extractor file list, footer ★ button, and the
`★ Favorites` tab mounting a second `ExaminerTab` over `filteredData ∩ favorites` with the
empty-state message. Header, tab strip, scope bar and playout footer are all shared chrome in
App, so the tab inherited them with zero extra work.

Verified headless (demo pack): F flags/unflags live, guarded in text fields; the tab lists
exactly the flagged rows with full chrome; DIG inside Favorites stays within favorites;
the last un-favorite shows the empty state; favorites survive a reload via the mirror.
Disk `favorites.json` (FSA write grant, Tauri commands) compile-verified — headless Chrome
can't exercise a real folder pick; first manual run on a real library should confirm the file
appears beside `sample_cloud_manifest.json`.
