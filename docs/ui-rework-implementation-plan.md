# Latent Tools — UI Rework Implementation Plan

Source of truth for the new look: `Latent Tools.dc.html` (Nocturne design system mockup). This plan covers turning that static mockup into the shipped Electron renderer, replacing `src/renderer/index.html` / `renderer.ts` in place.

## 1. Scope

- Rework `src/renderer/index.html` + `src/renderer/renderer.ts` only. No changes to `src/main`, `src/preload`, or the Python sidecar API surface — every existing IPC channel (`folder:select`, `bulk:process-item`, `image:detect`, `image:inpaint`, `image:caption`, `image:export`, `getGpuStatus`, `onSidecarStateChange`, `minimizeWindow`/`maximizeWindow`/`closeWindow`) keeps its exact name and payload shape.
- Visual system: Nocturne tokens (dark ground `#161826`, accent `#9184d9`, Inter, 8px radius, compact spacing). Replace the current ad-hoc `--accent-color:#6366f1` theme and inline hex values entirely.
- New IA: left sidebar app shell (nav + shared model selector + GPU/sidecar status) replaces top tab bar; right-hand inspector in the Single editor becomes a 2-tab panel (Caption / Export) instead of a long scroll; Bulk view becomes a 3-tab flow (Setup / Export Settings / Progress & Logs).
- New elements not in the current app: pipeline stepper (Detect → Remove → Caption), drag-and-drop folder tiles, dataset thumbnail grid, export presets, theme toggle affordance (dark-only for v1 — see §6).

## 2. File-level plan

| File | Change |
|---|---|
| `src/renderer/styles/tokens.css` (new) | Port Nocturne `:root` variables (colors, ramps, spacing, radius, shadow) as plain CSS custom properties — no build-time Sass/PostCSS needed. Load Inter via the same Google Fonts `@import` used in the mockup, or vendor the woff2 files if the app must run fully offline (recommended — see §6). |
| `src/renderer/styles/components.css` (new) | Port the Nocturne component layer verbatim (`.btn`, `.tag`, `.field/.input`, `.seg/.seg-opt`, `.card`, `.hr`, focus/selection states) from the DS `styles.css`. |
| `src/renderer/styles/app.css` (new) | App-shell layout only: titlebar, sidebar, main scroll region, grid/flex layouts for the editor and bulk screens, toggle-switch component (not in Nocturne, custom-built to match tokens), dropzone styling, thumbnail grid, log box, progress bar. |
| `src/renderer/index.html` | Rewritten to the new DOM structure (see §3). Keep all existing element `id`s used by `renderer.ts` (see §4 mapping table); add new ones for the new controls. |
| `src/renderer/renderer.ts` | Extend, don't rewrite from scratch — most handlers (sidecar status listener, GPU polling, titlebar buttons, model selector, mask undo/redo stack, canvas brush logic) are reused as-is against renamed/relocated DOM nodes. Add: tab-switching (mode nav, single-panel tabs, bulk tabs), toggle-switch wiring, dropzone drag handlers, preset select → field population, thumbnail grid population from `folder:select` result. |
| `src/renderer/window.d.ts` | No change expected; confirm no new preload APIs are required (dataset thumbnails can be generated client-side from the selected folder's file list already returned by `folder:select`, or via a lightweight `fs`-free `<img>` `file://` src — confirm with main-process file listing before assuming). |

## 3. New DOM structure (replaces current single `.container`)

```
#app-root (flex column, 100vh)
├─ #titlebar (flex row) — logo mark, wordmark, version tag, sidecar status pill | theme toggle, min/max/close
└─ #shell (flex row, flex:1, min-height:0)
   ├─ #sidebar (flex column)
   │  ├─ nav: #nav-single, #nav-bulk (buttons, replaces #tab-single/#tab-bulk)
   │  ├─ shared model selector (#model-select, #model-browse-btn, #model-path-text — same ids, new markup)
   │  └─ footer: GPU mini widget (#gpu-name-text, #gpu-vram-text, #gpu-temp-text — same ids, relocated)
   └─ #main (flex:1, overflow-y:auto)
      ├─ #single-view
      │  ├─ header (title + Select Image button, #file-input)
      │  ├─ pipeline bar: #detect-btn, #inpaint-btn, #caption-btn (same ids, restyled as numbered steps)
      │  ├─ grid: preview card (mask toolbar + #preview-container/#preview/#mask-canvas/#brush-cursor, all same ids) | inspector card
      │  └─ inspector tabs: #panel-tab-caption / #panel-tab-export (new) toggling #caption-panel / #export-panel (contain existing #system-prompt-input, #caption-text, #format-select, #quality-range, #lossless-checkbox, #compress-select, #flatten-color, #metadata-select, #export-btn — same ids)
      └─ #bulk-view
         ├─ header (title + #bulk-start-btn / #bulk-cancel-btn)
         ├─ bulk tabs: #bulk-tab-setup / #bulk-tab-export / #bulk-tab-progress (new)
         ├─ #bulk-setup-panel: disclaimer card, #bulk-input-btn/#bulk-input-path + #bulk-output-btn/#bulk-output-path as dropzones, #bulk-remove-watermark/#bulk-generate-captions as toggle switches, #bulk-system-prompt, new dataset thumbnail grid (#bulk-thumb-grid)
         ├─ #bulk-export-panel: #bulk-format-select, #bulk-quality-range, #bulk-lossless-checkbox, #bulk-compress-select, #bulk-flatten-color, #bulk-metadata-select
         └─ #bulk-progress-panel: #bulk-progress-text, #progress-bar-fill, GPU telemetry box (#gpu-name-text dupe → give distinct id #gpu-name-text-2 etc. or move the single sidebar widget into this panel via a shared render function), #bulk-log-box
```

## 4. Existing → new element id mapping (for `renderer.ts` diff)

Keep the left column ids; only right column (new) ids are additions. No id is deleted — `renderer.ts`'s existing `getElementById` calls keep working once the elements exist under their same ids in the new markup.

- `tab-single`/`tab-bulk` → replaced by `nav-single`/`nav-bulk`; **update the 2 event-listener lookups in renderer.ts**, everything else unchanged.
- `mask-toolbar` card → becomes the toolbar row inside the preview card (same children ids: `brush-add-btn`, `brush-erase-btn`, `brush-size`, `brush-size-val`, `zoom-val`, `reset-zoom-btn`, `undo-btn`, `redo-btn`, `clear-mask-btn`, `reset-mask-btn`).
- Export settings block: unchanged ids, now lives inside `#export-panel` gated by the new inspector tabs instead of always-visible.
- Bulk options block: unchanged ids, now split across `#bulk-setup-panel` / `#bulk-export-panel`; **add** a `change` handler so switching away from a panel doesn't hide required-but-unrendered inputs from getElementById calls made before first paint — panels should be `display:none` toggled, not removed from DOM, so all lookups in `renderer.ts` continue to resolve.

## 5. New behavior to implement in `renderer.ts`

1. **Sidebar nav** — `nav-single`/`nav-bulk` click handlers toggle `#single-view`/`#bulk-view` display (same logic as current tab handler, just renamed).
2. **Inspector tabs (single view)** — 2-state toggle, `display:flex`/`none` on `#caption-panel`/`#export-panel`, active-state class on the two tab buttons (reuse `.seg-opt` styling, driven by real `<input type=radio>` so no JS is even required beyond CSS `:has()` — confirm Electron's bundled Chromium supports `:has()` before relying on it, given the current architecture already uses recent CSS; add a JS fallback class-toggle if not).
3. **Bulk tabs** — same pattern, 3 states.
4. **Toggle switches** (watermark removal / captioning / lossless WEBP) — replace native checkboxes visually; keep an actual `<input type="checkbox">` under the hood (already present) so no state logic changes, just re-skin with the sidebar/track-and-knob CSS from the mockup and drive the knob position off `:checked`.
5. **Dropzones** — add `dragover`/`drop` handlers on `#bulk-input-btn`'s and `#bulk-output-btn`'s wrapping tiles that call the same `window.api.selectFolder()` flow when a folder is dropped (Electron can resolve a dropped folder's path via `webUtils.getPathForFile` on the drop event's `DataTransfer` — verify against installed Electron version) — falls back to click-to-browse (already implemented) when drag isn't available.
6. **Dataset thumbnail grid** — after `bulk-input-path` is set, list image files in that folder (either a new tiny preload API `folder:listImages`, or reuse existing folder-select return value if it already includes file list) and render up to ~12 `<img src="file://...">` thumbnails + a "+N more" tile; lazy-load with `loading="lazy"`.
7. **Export presets** — a `<select>` of named preset objects (`{format, quality, losslessWebp, compressLevel, metadata}`) that, on change, programmatically sets the existing format/quality/compress/metadata controls and re-fires their existing `change` listeners (`dispatchEvent(new Event('change'))`) so no duplicate logic is needed. Ship 3 starter presets (LoRA Dataset, Archive, Web) matching the mockup; "Save current as preset" persists to `localStorage` (renderer-only, no IPC needed).
8. **Theme toggle** — v1 ships dark-only (Nocturne has no light-mode tokens defined); render the control but disable it with a tooltip ("Light theme coming soon") rather than wiring a non-functional light palette. Revisit only if the design system gains light tokens.

## 6. Risks / open questions

- **Offline font requirement**: README markets the app as 100% local/offline; Google Fonts `@import` for Inter would break that guarantee on a machine with no internet. Action: vendor Inter (400/500/600/700 woff2, ~120KB total) into `src/renderer/assets/fonts/` and `@font-face` them locally instead of importing from Google Fonts.
- **`:has()` / modern CSS selectors**: confirm the Electron/Chromium version pinned in `package.json` supports `:has()` (used by Nocturne's `.seg-opt` active state and toggle styling shortcuts). If the pinned version predates it, add explicit JS class toggling as a fallback — already planned in §5.2/5.3.
- **Dataset thumbnail source**: needs either a new IPC call to list a folder's image files, or confirmation the existing `folder:select` handler already returns one. Needs a decision before implementing §5.6.
- **Toggle-switch and dropzone components are not part of Nocturne** — they're custom-built against Nocturne tokens (accent color, radii, spacing) per the design system's "extend with tokens, don't invent colors" rule. Flag for design review once implemented, to confirm they read as in-system.
- **Frameless titlebar drag region**: preserve `-webkit-app-region: drag` on the new titlebar and `no-drag` on its interactive children exactly as today — regression-prone if missed during the markup rewrite.

## 7. Suggested implementation order

1. Port token/component CSS (§2 rows 1–2) with zero markup changes — sanity check nothing visually breaks against current DOM.
2. Rewrite `index.html` markup per §3, preserving every existing id.
3. Patch `renderer.ts` for the renamed nav ids (§4) and panel-visibility gating (§5.1–5.3) — app should be functionally identical to today at this point, just restyled.
4. Layer in new interactive affordances in order of value: toggle switches (5.4) → presets (5.7) → dropzones (5.5) → thumbnail grid (5.6) → theme toggle stub (5.8).
5. Full regression pass against `tests/ipc-handlers.test.ts` and `tests/sidecar-client.test.ts` — no IPC contract should have changed, so these should pass unmodified.
6. Manual QA checklist: sidecar status transitions (starting/online/offline), GPU telemetry color thresholds (VRAM ≥89% red, ≥70% amber; temp ≥80° red, ≥65° amber), undo/redo history depth, format-dependent field visibility (quality/lossless/compress/flatten), bulk cancel mid-run.
