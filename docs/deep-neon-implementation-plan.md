# Latent Tools — Deep Neon UI Implementation Plan

Source of truth: `Latent Tools.dc.html` (Deep Neon Cinematic mockup, matching Latent Library's theme files in `uploads/css/` and `uploads/html/`). This plan replaces the earlier Nocturne-based plan and covers porting the mockup into the shipped Electron renderer at `src/renderer/`.

## 1. Scope

- Theme swap: adopt Latent Library's **Deep Neon Cinematic** tokens wholesale (`--bg-app:#000000`, `--accent-primary:#66fcf1`, `--accent-secondary:#d870ff`, glass blur panels, Inter). Port `neon.css`, `base.css`, `layout.css`, `components.css` from `uploads/css/` into `src/renderer/styles/` largely as-is — these already match the mockup's palette and component patterns.
- IA unchanged from the prior pass: left sidebar (single-column nav, model select, GPU widget, ALK logo), single-image editor (pipeline stepper + preview + Caption/Export tabs), bulk processor (now a **single scrolling view**, no internal tabs — folders → toggles → thumbnails → export settings → progress → logs).
- Branding: gradient "LT" wordmark in the titlebar (text-gradient trick, no logo squares); ALK partner logo placed under the GPU widget in the sidebar footer, ~150px wide, matching `nav-logo` sizing convention from the reference Vue component.
- Interaction language (must carry over exactly — this was the main revision cycle in this design pass):
  - **Hover-only glow**: default buttons/pills are flat black (`#000000`) on a thin `rgba(255,255,255,0.12)` border, no shadow. On hover, add a two-tone blurred glow via a *double box-shadow* (`-Npx 0 blur -spread cyan, Npx 0 blur -spread purple`) plus border/text brighten. No permanent glow on non-active elements.
  - **Selected/active elements** (nav item, segmented tab): permanent (not hover-gated) two-tone glow shadow + gradient-clipped text (`background:linear-gradient(...);-webkit-background-clip:text;-webkit-text-fill-color:transparent`), black fill background. This is the "black square" motif from Latent Library — reproduce with real background-color, not an overlaid pseudo-element, since it must be inline-style driven per DC constraints.
  - Segmented controls (Caption/Export, Add/Erase) follow the same active/hover rule, scoped to the pill rather than the whole row.
  - Sliders: gradient-filled track (cyan→purple, static `linear-gradient` background since native fill can't be dynamic without JS) with a white-thumb-on-cyan-ring glow. Requires `-webkit-appearance:none`/`-moz-range-track` overrides, ported into a real stylesheet (mockup fakes this in a helmet `<style>` block; production should live in `components.css`).

## 2. File-level plan

| File | Change |
|---|---|
| `src/renderer/styles/theme-neon.css` (new, from `uploads/css/Neon_Theme.css`) | The `:root` token block — copy essentially verbatim. |
| `src/renderer/styles/base.css` (from `uploads/css/base.css.css`) | Resets, scrollbar theming, text-gradient utility. |
| `src/renderer/styles/layout.css` (from `uploads/css/layout.css.css`) | `.app-layout`/`.app-header`/`.app-body`/`.app-sidebar`/`.app-main` shell — matches the mockup's flex structure closely enough to reuse directly. |
| `src/renderer/styles/components.css` (from `uploads/css/components.css.css`, extended) | Buttons, nav-btn, window-close-btn, inputs, checkbox, toggle, **slider (extend with the gradient-track + glow-thumb rules the mockup added)**, progress bar, chips. This file currently encodes the glow via `::before`/`::after` pseudo-elements (`--grad-hover` blurred halo + `--bg-btn-inner` black cover) — that's the real "black square + drop shadow" technique; port it directly instead of the mockup's inline box-shadow approximation, since production CSS isn't constrained to inline styles. |
| `src/renderer/index.html` | Rebuild markup per §3 below, reusing the id set from the prior Nocturne pass where it already matches (main preview canvas, mask toolbar controls, format/quality/compress/metadata selects, bulk toggles) — only the outer chrome, button markup, and bulk-panel structure actually change. |
| `src/renderer/renderer.ts` | No IPC contract changes. Update: (a) nav click handlers now target plain `.nav-btn` elements (no wrapper divs), (b) bulk view loses its 3-tab switcher — all bulk sections render in one scroll, so remove the tab-visibility-toggle logic for bulk entirely, keep it for the single-editor Caption/Export tabs, (c) wire the gradient slider elements (no JS change needed, pure CSS). |
| `src/renderer/assets/alk-logo.png` | Copy from `uploads/ALX Logo Neon.png` (already sized/cropped square asset); reference at ~150px wide under the GPU card, consistent with the `.nav-logo` convention in Latent Library's own `FolderNav.vue`. |

## 3. Component-level porting notes

**Buttons** — reuse `.btn` class from `components.css` for all primary actions (Detect Watermark, Generate Caption ×2, Export Image, Start Bulk Processing). Default state: transparent-over-black via the `::after` black inner layer; hover reveals the `::before` blurred gradient halo. Do not add extra permanent box-shadow — only nav-btn/seg-opt get the persistent "active" variant (`.nav-btn.active-nav-btn`, needs a new `.seg-opt.active` equivalent added to `components.css` mirroring the same `::before`/`::after` pair with `opacity:1` in the base state rather than triggered by `:hover`).

**Nav items** — `.nav-btn` already implements exactly the hover/active split needed (see `active-nav-btn` rules with permanent gradient text + glow). No new CSS required, just wire `activeView` state to toggle the class.

**Segmented tabs (Caption/Export, Add/Erase)** — not present in Latent Library's original component set; add a `.seg-tab` class to `components.css` cloned from `.nav-btn`'s active/hover pattern but sized as a compact pill (padding `0.4rem 0.75rem`, `border-radius:6px`) instead of a full-width row item.

**Sliders** — extend `.slider` in `components.css`: replace the flat `background: var(--bg-input)` with `background: var(--grad-hover)` for the track, keep the accent-ring white thumb from the mockup (`border:2px solid var(--accent-primary); background:#fff`).

**Bulk view** — collapse the 3-tab structure (Setup/Export/Progress) from the prior Nocturne plan into one flowing column: dropzones → watermark/caption toggle cards → dataset thumbnail grid → export format card → progress bar → logs card. Drop the GPU/VRAM/Temp readout from this view (duplicate of the sidebar widget, removed per user direction).

## 4. Risks / open questions

- **Inline-style vs. stylesheet constraint**: the mockup (a Design Component) had to approximate Latent Library's `::before`/`::after` glow trick with inline box-shadow because DCs can't ship pseudo-element rules. Production `index.html` has no such constraint — port the *original* pseudo-element technique from `uploads/css/components.css.css` rather than copying the mockup's box-shadow approximation verbatim; it will look closer to Latent Library's actual glow (soft blurred halo behind a hard black square) than the box-shadow stand-in.
- **Gradient slider track browser support**: `-moz-range-track`/`-webkit-slider-thumb` need separate rules (no unprefixed standard for thumb styling) — already accounted for in `components.css`'s existing `.slider::-webkit-slider-thumb`; add the Firefox track equivalent.
- **`backdrop-filter` perf**: multiple blurred glass panels (header, sidebar, cards) on every screen — confirm acceptable GPU cost in the Electron shell; Latent Library ships this today so precedent exists, but watch on lower-end GPUs during bulk-processing runs when the sidecar is also using the GPU.
- **ALK logo licensing/placement**: confirm final asset (square vs. wordmark crop) and exact target width against the real 230px sidebar column before hardcoding 150px.

## 5. Suggested build order

1. Drop in the four theme CSS files verbatim, no markup changes — sanity check existing DOM re-themes correctly.
2. Rebuild `index.html` shell (titlebar, sidebar, main) per §3.
3. Add `.seg-tab` and slider-track extensions to `components.css`.
4. Wire `renderer.ts`: nav active-class toggling, single-editor Caption/Export tab toggling, remove bulk tab logic (render all bulk sections unconditionally).
5. Manual QA: hover vs. active glow distinction on every interactive element, slider drag across full-range/quality/compress controls, bulk view scroll performance with thumbnail grid populated, GPU widget only appears once (sidebar, not duplicated in bulk).
