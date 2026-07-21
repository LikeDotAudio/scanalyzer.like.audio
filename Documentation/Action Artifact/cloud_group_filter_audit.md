# Audit — cloud group filtering: the scope selector vs. the Groups menu

**Question:** the group filtering in the cloud "still isn't working." Why?

**Short answer:** there are **two completely independent filter systems** that both claim to
control "which groups you see," they are computed from **different source arrays**, they have
**different scopes of effect**, and nothing keeps them in sync. What reads as "the filter not
working" is the two disagreeing.

---

## The two systems

### 1. The scope selector — the "group dropdown"
`ScopeBar.tsx` (top of the window, shared by every tab).

- **State (global, in `App.tsx:50-54`):** `scopeGroup`, `scopeSub`, `filterText`, `altRanks`,
  and `scopeLetters` (the AlphabetScrubber window).
- **What it produces:** `filteredData` — a **subset** of `analysisResult`
  (`App.tsx:56-75`), built by:
  - `matchesScope(it, scopeGroup, scopeSub, altRanks)` — category/subcategory membership,
    optionally including UCS runner-up ranks (`groupColors.ts:164-179`);
  - the letter-window (`scopeLetters`), applied **only when no category is picked**
    (`App.tsx:61-67`);
  - the free-text `filterText` over name/category/timbre/etc. (`App.tsx:69-72`).
- **Scope of effect:** `filteredData` is passed to **every** tab — Cloud, 2D/Stats, Examiner,
  Extractor, Rename (`App.tsx:503-513`). It is a true subset: rows not in it don't exist
  downstream.
- **In the cloud:** `CloudTab` sets `const data = filteredData` (`CloudTab.tsx:70`) and hands
  `data` to `SampleCloud`. The cloud only ever lays out and renders these rows.

### 2. The Groups menu — the "groups"
The `📁 Groups` overlay, `GroupsMenu.tsx` (the panel in the screenshot).

- **State (local to `CloudTab`, `CloudTab.tsx:83`):** `hiddenGroups` — a `Set<string>` of
  category names and `subKey(group, sub)` composites.
- **What it produces:** nothing new. It is a **per-point visibility mask** applied *inside*
  `SampleCloud`, not a subset. Hidden instances are drawn at `scale 0.0001`
  (`SampleCloud.tsx:190,198`); the arrow-key neighbour search skips them
  (`SampleCloud.tsx:344-345`).
- **Scope of effect:** **cloud only.** `hiddenGroups` never leaves `CloudTab`. Toggling a
  group here changes nothing in 2D/Stats, Examiner, Extractor, or Rename.
- **Its menu contents:** `groupTree` is built from **`analysisResult`** — the *whole,
  unfiltered library* (`CloudTab.tsx:96-116`), **not** from `data`/`filteredData`.

---

## The delta — where they diverge

| | Scope selector (dropdown) | Groups menu |
|---|---|---|
| Source array | filters `analysisResult` → `filteredData` | masks within `data` (=`filteredData`) |
| Menu/labels computed from | `analysisResult` (`ScopeBar`, `ucsCats`) | `analysisResult` (`groupTree`) |
| Mechanism | **subset** the data | **hide** individual points (scale→0) |
| Affects other tabs? | **Yes**, all of them | **No**, cloud only |
| State location | `App.tsx` (global) | `CloudTab.tsx` (local) |
| Persisted? | lives with the shared scope | resets on remount; not saved |
| Composition order | applied **first** | applied **second**, on the survivors |

### Why it looks broken

1. **The menu describes a different population than the cloud.** `groupTree` counts come from
   the full library (`CloudTab.tsx:96-116`). If the scope dropdown has already narrowed
   `filteredData` to, say, AMBIENCE, the menu still lists **every** category with
   **whole-library** counts (ANIMALS 1,876, …). Hiding a category that the scope already
   excluded is a **no-op** — the click does nothing visible, so the menu feels dead.

2. **They stack instead of agreeing.** Effective visibility is
   `row ∈ filteredData  AND  not in hiddenGroups`. The two are ANDed, but the user sees two
   separate UIs each implying it is *the* control. Selecting AMBIENCE in the dropdown while the
   menu still shows "all visible" reads as a contradiction.

3. **No synchronization, either direction.** Picking a scope does **not** populate
   `hiddenGroups`; "Show none + reveal one" does **not** set `scopeGroup`. Two mental models of
   "what's shown," never reconciled.

4. **Cloud-only masking.** Because `hiddenGroups` is local to `CloudTab`, a user who hides
   groups in the cloud and switches to 2D/Stats sees them all again — the "filter" appears to
   have been forgotten.

5. **A third, hidden dimension.** The AlphabetScrubber feeds `scopeLetters`, folded into
   `filteredData` (`App.tsx:61-67`) — but only when no category is selected. So the "dropdown"
   is really *three* filters (category/sub, letter-window, text) with order-dependent
   interactions, none of which the Groups menu is aware of.

*(Keys themselves are consistent: both sides derive `[g, sg]` via `taxonomyKeys` and composite
via `subKey` — `groupColors.ts:10,154`. The bug is architectural, not a key mismatch.)*

---

## Options to reconcile (not yet applied)

- **A — Make the menu reflect the cloud.** Build `groupTree` from `data`/`filteredData`
  instead of `analysisResult` (`CloudTab.tsx:96`). Counts then match what's on screen and
  scope-excluded rows drop out of the list. Smallest change; kills symptom #1.
- **B — One filter model.** Drive `hiddenGroups` from the scope (or vice-versa) so the menu's
  checkboxes and the dropdown are the same state. Eliminates #2–#4.
- **C — Promote or drop the split deliberately.** If per-point hide is genuinely cloud-only by
  design, label it that way ("hide in cloud") so it doesn't read as a global filter; otherwise
  lift `hiddenGroups` into the shared scope in `App.tsx`.

Recommended first step: **A** (menu from `filteredData`) — it's one line of source change and
removes the most confusing symptom, the menu that lists categories the scope already hid.

---

## Fix applied — Option A

`CloudTab.tsx` `groupTree` now iterates **`data` (= `filteredData`)** instead of
`analysisResult` (deps changed to `[data, taxonomy]`). Effects:

- The Groups menu lists **only the categories currently on screen**, with counts that match
  the scoped/filtered view — no more whole-library totals next to a narrowed cloud.
- Hiding a category the scope already excluded is now **impossible** (it isn't in the list),
  so the "dead click" symptom (#1) is gone.
- `Show all` / `Show none` / `Expand all` operate on the visible set, because they read
  `groupTree`.

Still true after the fix (deliberately not addressed here — they need a design decision,
options **B**/**C** above):

- `hiddenGroups` remains **cloud-only** (#4) — 2D/Stats/Examiner/Extractor don't honour it.
  In a WebGL-off environment the Groups menu therefore has no visible effect anywhere.
- The two controls still aren't **synced** (#2, #3): the scope bar and the menu are separate
  state; picking a scope doesn't tick menu boxes and vice-versa.
- `hiddenGroups` can retain a group that later leaves `filteredData`; it stays hidden if it
  re-enters. Harmless, but a scope change won't "reset" hides.

---

*Note: the screenshot shows "3D view unavailable" (WebGL couldn't start), so none of the
cloud masking is visible in that environment at all — only the 2D/Stats path (which honors the
scope selector but never `hiddenGroups`) is live there.*

---

## Re-audit — the real root cause (supersedes the framing above)

The original audit was investigating the wrong control. It repeatedly calls the scope selector
"the group dropdown." **There is no dropdown.** The only category control in `ScopeBar` is an
`AlphabetScrubber` (`ScopeBar.tsx:70`), and it emits *two* independent outputs:

- `onSelect(g)` → `scopeGroup` — the explicit category filter (what everyone assumes is "the filter").
- `onActiveLettersChange(letters)` → `scopeLetters` — a letter-window that **also filters the data**.

### What actually broke the cloud

The scrubber's window defaults to the first `windowSize` letters and its mount effect fires
immediately:

1. `progress = 0`, `windowSize = 5` → `activeLetters = ['A','B','C','D','E']` (`AlphabetScrubber.tsx:81-82`).
2. Mount effect → `onActiveLettersChange(['A'…'E'])` → `setScopeLetters(['A'…'E'])` (`AlphabetScrubber.tsx:84-86`).
3. `filteredData` then drops every record whose UCS category doesn't start with **A–E**
   (old `App.tsx` letter block).

So the app **booted with a hidden filter already on** — only categories A–E, on *every* tab
(`ScopeBar` is rendered once at `App.tsx`, above all tabs; `filteredData` feeds Cloud, Examiner,
Extractor, Stats, Rename). Nobody set it. That is the "group filtering is fucked up" the user saw.

The earlier audit **listed this exact mechanism as symptom #5** ("a third, hidden dimension") and
then dismissed it as a footnote, shipping Option A (which only changed where `groupTree` reads its
list). Option A never touched the boot-filter, which is why it "still didn't work."

### Fix applied — decouple the scrubber from the data

The alphabet scrubber now *only pages the category chips*; it no longer filters data. Only an
explicit category click (`scopeGroup`) or the free-text box filters `filteredData`.

- `App.tsx`: removed the `scopeLetters` state, the letter-window block in `filteredData`, its dep,
  and the `setScopeLetters` prop; dropped the now-unused `taxonomyKeys` import.
- `ScopeBar.tsx`: removed the `setScopeLetters` prop and the `onActiveLettersChange` wiring.
- `AlphabetScrubber.tsx`: unchanged — `onActiveLettersChange` stays an optional prop (now unused),
  and `visibleItems` still windows which chips are shown (the legitimate paging behaviour).

Result: on load, **everything is visible**. Picking a category filters the cloud and all tabs;
scrubbing the alphabet just changes which chips you can click.

### Follow-up fixes (the two open items)

**1. `hiddenGroups` lifted to a global filter (was cloud-only, #4).** The hide/show set now lives
in `App.tsx`, not `CloudTab`. App derives two arrays:

- `scopedData` — scope bar + text filter only.
- `filteredData` — `scopedData` minus `hiddenGroups` (via `taxonomyKeys` + `subKey`).

Every tab except the cloud renders `filteredData`, so hiding a category now removes it from
Examiner / Extractor / Stats / Rename too — it does something even when WebGL is off. The cloud
still receives `scopedData` (pre-hide) and masks hidden points itself, so the Groups menu can
list a hidden category to toggle it back (building the menu from post-hide data would drop the
control for its own hidden entries). Bonus: because the state is in App, hides now survive tab
switches (previously reset on `CloudTab` remount).

**2. `GroupsTab` rebuilt on UCS.** It bucketed on the removed `classification.group` field and
ignored every filter. It now counts `filteredData` by UCS **category → subcategory**
(`GroupsTab.tsx`), so it matches the current scoped/filtered/hidden view and speaks the same
taxonomy as the rest of the app.

### Still open (deliberately)

- Scope bar (category chips) and the Groups menu (hide set) are still **separate controls** (#2,
  #3): both filter by category globally now, but picking a scope doesn't tick menu boxes and
  vice-versa. Unifying them into one control is a larger UX decision, not done here.

---

## Re-audit #3 — selecting a single group crashed the cloud (2026-07-16)

**Symptom:** with **All** groups the cloud renders; select any single category chip and the 3D
view dies, showing *"3D view unavailable — WebGL couldn't start"*. Returning to **All** does not
bring it back.

**That message was a lie.** WebGL was fine. Two separate defects compounded:

### 1. The actual crash — a Rules-of-Hooks violation in `ShapeMesh`

`SampleCloud.tsx` draws one `ShapeMesh` (instanced mesh) per shape — sphere, cylinder, disc,
pyramid, torus, … Nine of them render on every pass, each with its own bucket of points. The
component had:

```tsx
if (sData.positions.length === 0) return null;   // empty bucket → bail early
...
useEffect(() => () => { document.body.style.cursor = 'auto'; }, []);  // AFTER the return
```

A hook after a conditional return means the component renders **6 hooks when its bucket has
points and 5 when it doesn't**. With All selected, every bucket is non-empty. Narrow the scope
to one category and several shape buckets go empty (COMMUNICATIONS has no drums-cylinders, no
cymbal-discs, …) → those `ShapeMesh`es skip the trailing hook → React throws
**error #300, "Rendered fewer hooks than expected"** → the whole `Canvas` subtree unmounts.

Reproduced on the pre-fix build (headless Chrome + SwiftShader, demo pack): clicking the
AIRCRAFT chip threw React #300 on the spot; the canvas was destroyed and stayed destroyed.

**Fix:** the cursor-cleanup `useEffect` moved above the early return (`SampleCloud.tsx`). The
same violation existed in `ScanalyzeTab.tsx` (an `isTauri()` early return above a `useEffect`) —
latent rather than live, since `isTauri()` never changes at runtime — fixed the same way. The
linter's `react-hooks(rules-of-hooks)` check now passes clean; it would have caught both.

### 2. The mislabel + no recovery — `WebGLBoundary`

The boundary caught **every** error from the 3D subtree and rendered the one fallback it had:
the "WebGL couldn't start" panel. A data-dependent rendering bug was therefore reported as a
GPU problem. And `failed` was never reset, so one crash killed the tab until a full remount.

**Fix:** `WebGLBoundary` now captures the actual `Error` and passes it to a function-form
fallback; `CloudTab` renders a distinct **"The 3D view hit an error"** panel naming the real
message, with a *Try again* button. A `resetKey={data}` prop retries automatically when the
scope changes — a crash on one selection no longer bricks the next. The genuine WebGL-off
pre-check keeps its original message.

### Also fixed while in there

- `InstancedMesh` raycast picking: three.js computes the mesh bounding sphere once, at the
  first raycast, and never again — after a scope change rewrites the instance matrices,
  hover/click picking could go blind or false-hit. `computeBoundingSphere()` now runs after
  every matrix rewrite.

### Verified (headless Chrome, SwiftShader WebGL, demo pack)

| Step | Pre-fix | Post-fix |
|---|---|---|
| All groups | renders | renders |
| Single group (AIRCRAFT) | React #300, canvas destroyed, "WebGL" panel | renders the category's points |
| Back to All | still dead | renders |
| Rapid-cycle 12 chips + subgroup + arrows | — | no errors |
