# Pad Browser — drum-machine-style quick audition (roadmap)

Status: **proposed, not started** (filed 2026-07-17).

## The idea

A browser view that lays the current scoped set of files onto a grid of pads, like an
MPC / drum machine: every pad is one file, tapping a pad fires it instantly, and many
pads can sound **at the same time**. Today auditioning is strictly one-at-a-time —
click a row, the footer transport plays it, click the next. The pad browser flips
that: you play the library like an instrument, layering kicks under snares under
textures to hear how files sit together, and burning through candidates far faster
than a click-wait-listen loop allows.

## Why the current transports can't do it

- The global footer is a single `<audio>` element (`App.tsx:724`, `footerAudioRef`) —
  monophonic by construction, and every trigger pays a blob-URL + `src` swap + load
  round-trip. Fine for browse-and-listen; wrong for rapid-fire retriggering.
- Examiner / Extractor take over playback via `registerTransport` (`App.tsx:203`),
  but they inherit the same one-voice model.

## UX sketch

- A new tab (working name: **PADS**) fed by the same global `scopedData` /
  `ScopeBar` as every other tab — the scope chips and the filter decide what lands
  on the pads, nothing new to learn.
- A pad bank: 8×4 on desktop, 4×4 when `useIsNarrow`. Pads carry the file name,
  category emoji, and group color (`categoryEmoji.ts` / `groupColors.ts` already
  supply both).
- Bank paging steps through the scoped set 32 (or 16) files at a time; a QWERTY
  grid mapping (`1234…` / `qwer…` rows) mirrors the pads for keyboard triggering.
- Polyphony by default — pads layer freely. An optional per-bank **choke** toggle
  (new trigger cuts the previous voice) for testing one-shots MPC-style.
- A pad press also reports through `onSound`, so the footer shows the last-fired
  file and the existing push-to-Examiner / push-to-Extractor flow keeps working.
- Favorites (`favorites.ts`) as a natural bank: page one could be "favorites as
  pads" — the digging workflow's keepers, playable together.

## Technical notes

- **Web Audio, not `<audio>`**: one shared `AudioContext`; on bank load, resolve
  each pad's file (the `audioLinking.ts` relative-path index) and
  `decodeAudioData` it to an `AudioBuffer` — the same decode pattern
  ExaminerTab / StatsTab / ExtractorTab already use (`decodeCtxRef`). Each trigger
  spawns a throwaway `AudioBufferSourceNode` → zero-latency retrigger and true
  polyphony for free. All voices run through one master `GainNode` (and likely a
  `DynamicsCompressorNode` as a safety limiter — 32 simultaneous one-shots can sum
  hot).
- **Memory budget**: decoded stereo 44.1 kHz float32 is ~20 MB/min, so decode only
  the visible bank (16–32 files) and evict on page-away. Long ambience files
  should either decode a capped head (first ~10 s) or use the regions detector's
  first region as the pad's one-shot.
- **Client-side only**: everything above is in-browser Web Audio — no server, no
  third-party calls, consistent with the app's constraint.

## Open questions

- Choke groups derived from UCS category (all DRUM-KICK pads share a choke)?
- Pad ordering within a bank: scoped order, alphabetical, or similarity
  (`unsupervised` cluster neighbors on adjacent pads)?
- Is a v1 without any recording/sequencing acceptable? (Assumed yes — this is a
  *browser*, not a groovebox; sequencing is explicitly out of scope.)
