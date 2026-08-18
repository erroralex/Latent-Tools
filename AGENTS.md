# Agent Instructions

<!-- ===== PROJECT (fill in, delete unused lines) ===== -->
## Project

- **Name:** Latent Tools
- **Purpose:** Local-first Electron desktop app for bulk image-dataset prep: watermark removal (AI detection + inpainting), format conversion (JPEG/PNG/WEBP), and uncensored image captioning, running entirely on-device. Bulk (folder) processing is first-class, not an afterthought.
- **Stack:** Electron (TypeScript, strict) renderer + main process; Python sidecar (FastAPI — Florence-2 detection, IOPaint/LaMa inpainting, Qwen2-VL captioning) over localhost HTTP. Target hardware: discrete GPU. See `docs/implementation-plan.md` for the full architecture. **See `HANDOVER.md` for exactly where the project stands right now.**

- **Build:** `npm run build` (TypeScript, at repo root). Packaging standalone `.exe`: `npm run dist` (`electron-builder`). Sidecar has no build step — `cd sidecar && pip install -e ".[dev]"` into a venv (see Run locally). PyInstaller compilation: `pyinstaller --noconfirm --onedir --name sidecar --entrypoint run.py` (handled automatically by `.github/workflows/build.yml`).
- **Test:** `npm test` (Vitest, repo root) for the Electron/TS side. `cd sidecar && <venv>/Scripts/python -m pytest tests/ -v` for the Python side (GPU-marked tests are excluded by default via `pyproject.toml`'s `addopts`).
- **Run locally:** One-time sidecar setup: `cd sidecar && python -m venv .venv && .venv/Scripts/python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128 && .venv/Scripts/python -m pip install -e ".[dev]"` — **cu128 torch must install before `-e ".[dev]"`, not after**: `-e .` pulls in a CPU-only torch transitively (via iopaint/transformers), and if that version happens to match what's available at the cu128 index, a later `pip install torch --index-url ...` reports "already satisfied" and silently keeps the CPU build. Then from repo root: `npm install && npm start`.

## Workflow

- Before non-trivial changes: state your plan in 2–5 bullet points, then implement.
  If requirements are ambiguous, ask — don't guess.
- Work in small, verifiable steps. One logical change at a time.
- Write or update the test for a behavior change **before or with** the code,
  never "later".
- Before claiming anything works: run the test/build command and show the result.
  "Should work" is not done — verified is done.
- **Performance work needs exclusive GPU access.** One discrete GPU serves the
  Electron app, the sidecar, and any benchmark you run. Before measuring, confirm
  `nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader` lists no
  other python/electron process, and stop the app first. A second model-loading
  process exhausts a 16 GiB card and degrades *both* by 10–100x, producing timings
  that look exactly like real bugs. Attribute a slowdown only after reproducing it
  on a verified-idle GPU.
- When a task touches unfamiliar code, read the surrounding files first and follow
  the patterns already there.
- Check `.agents/skills/` for an applicable skill before starting specialized work
  (framework setup, UI design, reviews); use it if its description matches the task.

## Engineering rules

- **YAGNI:** build what the task needs, nothing speculative. No extra config options,
  abstraction layers, or "flexibility" that wasn't asked for.
- **DRY, but not premature:** extract shared code on the third occurrence, not the
  second. Duplication is cheaper than the wrong abstraction.
- **Single responsibility:** one reason to change per class/module/function. If a file
  needs "and" to describe what it does, split it.
- **Depend on interfaces at boundaries** (service ↔ persistence, domain ↔ external
  APIs); don't interface-ify everything else.
- Keep functions short and files focused. A file approaching ~300 lines is a signal
  to split.
- Prefer boring, idiomatic solutions over clever ones. Optimize only with a
  measurement in hand.
- Fail fast: validate inputs at system boundaries, throw early with specific messages,
  never swallow exceptions silently.

## Testing

- Every bugfix gets a regression test that fails before the fix and passes after.
- Test behavior through public interfaces, not implementation details.
- Never delete, skip, or weaken a test to make a change pass. If a test seems wrong,
  say so and ask.
- Tests must be deterministic: no sleeps for synchronization, no order dependence,
  no shared mutable state between tests.

## Git

- Small commits, one logical change each. Imperative subject line ≤ 72 chars;
  body explains *why* when it isn't obvious.
- **No AI attribution anywhere in git:** no `Co-Authored-By` trailers naming an AI,
  no "Generated with ..." lines in commit messages, PR descriptions, or code
  comments. Commits carry the human author's identity only.
- Never commit secrets, credentials, or generated artifacts.
- Never force-push or rewrite history on shared branches.

## Security

- No secrets in code or config files — use environment variables or a secret manager.
- All user input is untrusted: validate at the boundary, use parameterized
  queries/bound parameters, escape output in templates.
- Don't add dependencies for trivial tasks; when adding one, prefer well-maintained,
  widely-used libraries.

<!-- ===== ADDONS: append per-tech sections from starter-kit/addons/ below ===== -->
## TypeScript

- `strict: true` in `tsconfig.json`, non-negotiable — and don't claw it back with
  per-file opt-outs. New projects also enable `noUncheckedIndexedAccess`.
- **No `any`.** Untyped input is `unknown`, then narrow (type guards, `instanceof`,
  discriminated checks). `any` in a signature is a bug report waiting to file itself.
- Suppressions: `@ts-expect-error` with a reason comment on the same line; never bare
  `@ts-ignore` (it keeps suppressing after the underlying error is gone).
- Model variants as **discriminated unions** with a literal `kind`/`type` field and
  exhaustive `switch` (use a `never` check in `default`). Don't encode variants as
  optional-field soup.
- Derive types from values you already have: `typeof` on consts, `ReturnType`,
  inferred generics, schema-inferred types (e.g. `z.infer`). Hand-maintained
  duplicate types drift.
- `satisfies` for typed configuration/literal objects — it validates without widening;
  `as const` for literal data. Avoid `as` casts elsewhere: a cast is an unchecked
  claim, prefer narrowing or fixing the type.
- No `enum` in new code — union of string literals (or `as const` object) gives the
  same safety without the runtime artifact and import quirks.
- `import type` / `export type` for type-only references — keeps emitted output and
  bundlers honest.
- Public API boundaries (exported functions, component props, store contracts) get
  explicit types; locals rely on inference. Annotating everything buries the signal.
- Don't fight the compiler with deep conditional-type gymnastics in app code — if a
  type needs three levels of `infer`, simplify the design instead.

## Frontend core (HTML / CSS / JavaScript)

> Skills: `.agents/skills/frontend-design/` for building distinctive UI;
> `.agents/skills/web-design-guidelines/` for auditing existing UI.

- Semantic HTML first: native elements (`button`, `nav`, `dialog`, `details`) before
  div+JS reimplementations. Heading levels in order; one `h1` per page.
- Accessibility is not optional: every input has a `label`; interactive elements are
  keyboard-reachable with visible focus; images have meaningful `alt` (or empty for
  decorative); color contrast ≥ WCAG AA; ARIA only when no native element fits.
- Responsive = mobile-first: base styles for small screens, `min-width` media queries
  upward; relative units (`rem`, `%`) over fixed px for layout; test at 320px,
  768px, 1280px.
- CSS: design tokens as custom properties (colors, spacing, type scale) defined once;
  prefer flexbox/grid over floats and absolute positioning; avoid `!important` and
  deep selector chains; co-locate component styles.
- JavaScript: ES modules; `const`/`let`, never `var`; `async/await` with explicit
  error handling over raw promise chains; `fetch` with status checks (a 404 does not
  reject); no jQuery in new code.
- Forms: validate client-side for UX, **always** revalidate server-side; disable the
  submit button while a request is in flight; show field-level errors.
- Escape user content rendered into the DOM — `textContent` over `innerHTML`;
  if HTML insertion is unavoidable, sanitize.
- Performance basics: `defer` scripts; set width/height (or aspect-ratio) on images;
  lazy-load below-the-fold images; don't ship a framework for a static page.
