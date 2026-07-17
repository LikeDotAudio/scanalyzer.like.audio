---
name: verify
description: Build, launch and drive the Web_Front app headlessly to verify changes at the real UI.
---

# Verifying Web_Front changes

## Build + serve
```bash
cd Web_Front
npm run build                              # tsc -b && vite build → dist/
npm run preview -- --port 4599 --strictPort  # serves dist/ (run in background)
```

## Drive it (Playwright + system Chrome, WebGL via SwiftShader)
`playwright` npm package + `/usr/bin/google-chrome`. Launch flags that make the 3D cloud work headless:
`--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader --autoplay-policy=no-user-gesture-required --mute-audio`

Standard flow: `goto http://localhost:4599/` → click the "Sample samples for sampling" button
(loads the 60-sample demo pack with precomputed .PEAK) → `waitForURL(/#\/cloud/)` → tabs via
`nav button` with text SCANALYZE / 3D / 2D / Examiner / Extractor / Rename.

## Gotchas learned the hard way
- **Scope-bar category chips**: locate the exact-text `All` button, then its
  `xpath=following-sibling::button[N]` siblings. Re-query per click — the chip window shifts.
  Uppercase-text button locators match the TAB bar first; don't use them.
- **Selecting a sample**: clicking cloud points and hovering blocks does NOT register under
  SwiftShader (raycast pointer events never fire headless). Select via the Examiner table
  (`tbody tr td`) instead, then switch back to 3D — selection persists (footerItem).
- **Cloud crash detection**: `page.getByText('3D view unavailable')` (WebGL-off pre-check) and
  `page.getByText('The 3D view hit an error')` (real crash caught by WebGLBoundary), plus
  `page.on('pageerror')` for React #300s. Canvas count 1 = alive, 0 = destroyed.
- **Play buttons are ambiguous**: the footer has ▶ Play and the EYE/RadialWaveform centre button
  is `button[title="Play"|"Stop"]` — disambiguate by boundingBox position, not selector.
- **Audio timing** (loop/gap behavior): `page.evaluate` polling `document.querySelectorAll('audio')`
  for `{currentTime, paused, loop}` works fine headless with the autoplay/mute flags above.
- **Narrow / mobile mode**: just use a narrow viewport (e.g. 480×900); `useIsNarrow` reacts to it.
