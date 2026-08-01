# Latent Tools — Modernized Deep Neon Implementation Plan

Supersedes `docs/deep-neon-implementation-plan.md`. Source of truth: current `Latent Tools.dc.html` (modernized pass — restrained glow, charcoal-navy ground, solid gradient CTAs, tighter type). Production already has a first Deep Neon pass shipped at `src/renderer/styles/{tokens,app,components}.css` + `src/renderer/index.html` — this plan is a **token/detail update to that existing implementation**, not a from-scratch build.

## 1. What changed vs. the shipped v1 Deep Neon pass

| Aspect | Shipped v1 | New mockup |
|---|---|---|
| Ground | Pure black `#000000` | Charcoal-navy `#0a0b10`, softer radial tint (0.045–0.05 opacity vs ~0.07) |
| Cards | `rgba(15,15,15,0.6)` + heavy `backdrop-filter: blur(16px)` on every card | Solid `#12141b` + 1px border, blur reserved for titlebar/sidebar only (perf + clarity) |
| Glow | Dual-sided blurred box-shadow (`--glow-hover/-nav/-seg`) on every button/nav/seg, always symmetric halo | Single soft `box-shadow: 0 0 0 3px rgba(accent,0.08)` ring on hover only; active nav/seg uses a 2.5px gradient left bar instead of a halo |
| Active state | Black fill + persistent dual-glow + gradient text | Tinted fill (`rgba(79,216,201,0.07)`) + left accent bar + gradient text — no persistent shadow |
| Primary CTA (Export/Start Bulk) | Black + border + glow-on-hover | Solid `linear-gradient(135deg,#4fd8c9,#9b7cf0)` fill, dark text, `filter:brightness(1.08)` on hover |
| Sliders | Same gradient track/thumb concept | Thinner track (3px vs 4px), thumb ring instead of blurred glow |
| Typography | Inter only, headings 22–24px/800 | Inter + JetBrains Mono for numeric readouts (VRAM, zoom %, temp); headings 24px/700, micro-labels uppercase 10px/700 |
| Accent hues | `#66fcf1` / `#d870ff` (high-saturation cyan/magenta) | `#4fd8c9` / `#9b7cf0` (slightly deeper teal/violet — same identity, less radioactive) |

## 2. File-level changes

| File | Change |
|---|---|
| `src/renderer/styles/tokens.css` | Update `--color-bg` → `#0a0b10`; `--accent-primary` → `#4fd8c9`; `--accent-secondary` → `#9b7cf0`; `--color-surface` → `#12141b` (solid, drop the rgba/alpha approach); add `--color-surface-alt: rgba(255,255,255,0.03)` for inputs; replace `--glow-hover/-nav/-seg` (dual box-shadow strings) with a single `--glow-ring: 0 0 0 3px rgba(79,216,201,0.08)`; add `--font-mono: 'JetBrains Mono', monospace`. |
| `src/renderer/styles/app.css` | Titlebar: reduce height 56→52px, tighten padding. `.nav-btn`: remove `--glow-nav` box-shadow on hover/active, add `::before` 2.5px gradient left bar shown only when `.is-active`, hover becomes flat `background:rgba(255,255,255,0.045)` (no shadow). `.gpu-card`/`.preview-card`/`.inspector-card`/`.bulk-card`: drop `backdrop-filter`, switch background to solid `var(--color-surface)`, keep 1px border + a plain `box-shadow:0 1px 3px rgba(0,0,0,0.3)` (remove `--shadow-card`'s heavier spread). `.status-pill`: add `white-space:nowrap;flex:none` (regression fix already applied in the mockup — carry into production CSS). `.sidebar-footer-logo img`: 150px → 120px. |
| `src/renderer/styles/components.css` | `.btn`/`.btn-primary` hover: replace `var(--glow-hover)` with `var(--glow-ring)`. Add `.btn-cta` variant (solid gradient fill, dark text, `filter:brightness(1.08)` hover) and apply it to Export Image / Start Bulk Processing in `index.html` (currently both use `.btn-primary`). `.seg-opt.is-active`/`.nav-btn.is-active`: replace box-shadow glow with the left-bar treatment (add a shared `.active-bar::before` rule). `.lt-slider`/`input[type=range]`: track height 4px→3px, thumb loses `box-shadow` glow, gains `box-shadow:0 0 0 3px rgba(79,216,201,0.18)` ring. Add `font-family: var(--font-mono)` utility class `.mono` for numeric readouts. |
| `src/renderer/index.html` | No structural change — same ids, same DOM. Only: swap `.btn-primary` → `.btn-cta` on the two primary-action buttons (Export Image, Start Bulk Processing, Generate Caption); wrap VRAM/temp/zoom-% text nodes in `<span class="mono">`; add `.active-bar` marker span inside `.nav-btn` (empty span before the icon, matching the mockup's `{{ navBarStyle }}` span). |
| `src/renderer/renderer.ts` | No logic change required — this is a pure CSS/markup token update. Confirm the nav active-class toggle still adds/removes `.is-active` (unchanged from v1 plan) and that it also now controls the new bar span's visibility (handled by CSS `:not(.is-active) .active-bar { background: transparent }`, no JS needed since it's the same class). |

## 3. Rationale (ties back to design feedback)

- **"Glow felt gimmicky"** → glow is now hover-only and single-directional (a ring, not a dual-color halo); permanence is reserved for a small accent bar + gradient text, a pattern common in modern dense-UI apps (Linear, Raycast) rather than a constant glow.
- **"Typography hierarchy weak"** → introduced a second typeface (JetBrains Mono) exclusively for numeric/telemetry readouts, widening the perceived hierarchy between "data" and "labels/prose" without adding more weights of Inter.
- **"Spacing inconsistent/cramped"** → card padding and gap values were normalized to a tighter, consistent set (12/16/22px) rather than the mixed 8–24px spread in v1; sidebar width trimmed 230→222px to match the denser type scale.
- **"Icons feel placeholder-ish"** → out of scope for this CSS-token pass; flag separately (see §5).

## 4. Suggested rollout order

1. Update `tokens.css` values only — every screen re-themes automatically (colors, radii unaffected structurally).
2. Update `components.css` button/seg/slider rules — visually confirm hover/active states against the mockup screenshots.
3. Update `app.css` card/nav/titlebar rules — remove backdrop-filter from cards, add the active-bar treatment.
4. Patch `index.html` for the `.btn-cta` swap and `.mono` span wraps (small, mechanical diff).
5. Regression: `tests/ipc-handlers.test.ts` / `tests/sidecar-client.test.ts` should be unaffected (no IPC or DOM-id changes). Manual QA: hover vs. active visual distinction on nav/segmented controls, GPU status pill stays one line at minimum window width, slider drag still smooth with thinner track/thumb.

## 5. Open item (not covered by this pass)

Icon set still uses ad-hoc inline SVGs of varying stroke weight/style. A follow-up pass should standardize on one icon family (e.g., Phosphor or Lucide, stroke-width 1.75 throughout) — flagged per user feedback ("icons/graphics feel placeholder-ish") but deferred since it's a content/asset change, not a token change.
