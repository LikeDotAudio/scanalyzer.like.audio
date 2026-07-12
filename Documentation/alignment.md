# Python vs Web Audit

## Introduction
This document outlines the feature deltas between the Python desktop GUI and the Web (React/WASM) front-end for the Sample Analysis tool. The core DSP engine (Rust) is shared identically across both, but the front-ends have diverged in their UI capabilities.

## Current Deltas (Missing from Web)

### 1. Auto-Guess Feature
- **Python**: Features a dedicated `Guess` tab that fingerprints named groups and guesses the classification of "Unclassified" sounds using acoustic proximity (with a confidence score).
- **Web**: Completely missing.
- **Action**: Implement an `AutoGuessTab.tsx` in the Web app that runs the same centroid/feature-matching logic to suggest classifications.

### 2. Groups / CSV Export
- **Python**: Features a robust `Groups` tab allowing grouping along any dimension (up to two levels deep), complete with a full CSV export of every field, and a shared inspector.
- **Web**: `GroupsTab.tsx` is currently a barebones mockup and has been hidden from the main navigation. 
- **Action**: Build a robust grouping pivot-table in the Web app and implement a client-side `Blob`-based CSV export feature.

### 3. 3D Cloud Presets
- **Python**: The 3D cloud provides ten one-click presets (A–J: classic, brightness, envelope space, tonal-vs-noisy, musicality, percussive, noise, texture, tempo, dynamics) to quickly configure the X, Y, Z, and Size axes.
- **Web**: Provides manual axis dropdowns, but no quick presets.
- **Action**: Add a preset dropdown or button row to `CloudTab.tsx` that instantly snaps the axes to these curated analytical views.

### 4. Shared Inspector
- **Python**: The rich inspector (showing JSON metadata + waveform + envelope + spectral trace + play) is shared across the Groups, Examiner, Guess, and Rename tabs.
- **Web**: The rich visualizer (`FieldValueTable`, `PropertyBars`, and Canvas preview) is currently confined strictly to the `ExaminerTab.tsx`. The Rename tab only has a simple textual table.
- **Action**: Abstract the bottom half of `ExaminerTab.tsx` into a reusable `InspectorPanel.tsx` component and mount it in the Rename tab and future Groups/Guess tabs.

### 5. File Renaming Execution (Constraint)
- **Python**: Directly executes file copies/moves on the native filesystem.
- **Web**: Generates executable rename scripts (`.sh`, `.ps1`, `.py`) because browsers cannot reliably execute bulk arbitrary file moves natively.
- **Action**: This is an acceptable constraint due to browser sandboxing. However, we could explore using the File System Access API to write newly named files directly to a destination directory if the user grants write permissions.

## Web-Exclusive Features (Web > Python)
The Web app has recently received quality-of-life updates that make it superior in some UX aspects:
- **Universal Scope & Text Filtering**: A highly responsive `ScopeBar` component is universally integrated across the Examiner, 3D Cloud, 2D Stats, and Rename tabs, allowing users to drill down by group/subgroup and search text seamlessly everywhere.
- **Dynamic Examiner Columns**: The Web Examiner features a robust column toggle overlay, persisting user preferences to local storage.
- **Responsive Layout**: The Web app utilizes modern CSS flex/grid layouts and collapsible overlays (e.g., in the 3D Cloud), adapting cleanly to mobile and desktop viewports.

## Next Steps for Web Alignment
To make the Web front-end the definitive version, we should prioritize the following:
1. Abstract the `ExaminerTab`'s visualizer into a reusable `InspectorPanel` and add it to the Rename tab.
2. Implement the 3D Cloud axis presets (A-J).
3. Rebuild the `GroupsTab` with full pivot/grouping capabilities and a CSV exporter.
4. Implement the Auto-Guess acoustic fingerprinting logic in the browser.
