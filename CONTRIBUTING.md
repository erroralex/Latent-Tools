# Contributing to Latent Tools

Thanks for considering a contribution. This project is a local-first desktop
app with an Electron/TypeScript frontend and a Python GPU sidecar — read
below before opening a PR.

## Before you start

For anything non-trivial, open an issue or start a discussion first. It
saves rework if the approach needs adjusting before code is written.

## Project layout

- `src/` — Electron main process, preload, and renderer (TypeScript, strict).
- `sidecar/` — Python FastAPI service (Florence-2 detection, IOPaint/LaMa
  inpainting, Qwen2-VL captioning) over a `127.0.0.1`-only HTTP loopback.
- `docs/implementation-plan.md` — full architecture, IPC/HTTP contract, and
  phased milestones. `docs/` is gitignored (local reference only), so this file
  exists on disk but won't come from a fresh clone.
- `HANDOVER.md` — current project status; read this to see what's built and
  what's in progress.
- `AGENTS.md` — the canonical engineering rules for this repo (also read by
  AI coding agents working here). The summary below mirrors it; AGENTS.md is
  the source of truth if they ever diverge.

## Setup

```bash
# Sidecar (one-time)
cd sidecar
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"
.venv/Scripts/python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128

# Electron app
cd ..
npm install
npm run build
npm start
```

Plain `pip install torch` gives a CPU-only wheel on Windows — the explicit
`cu128` index URL above is required for GPU acceleration.

## Making changes

- **State your plan before non-trivial changes.** A few bullet points on
  approach before touching code; ask if requirements are ambiguous rather
  than guessing.
- **Small, verifiable steps.** One logical change per commit/PR where
  practical.
- **Write or update tests with the code, not after.** Every bugfix needs a
  regression test that fails before the fix and passes after. Test through
  public interfaces, not implementation details.
- **Verify before claiming something works.** Run the build/test commands
  below and check the actual output — "should work" isn't done.
- **GPU exclusivity for performance work.** This project targets one
  discrete GPU shared by the Electron app, the sidecar, and any benchmark.
  Before measuring anything, confirm no other python/electron process holds
  the GPU (`nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader`)
  and stop the app first — a second model-loading process can degrade both
  by 10–100x and produce timings that look like real bugs.
- Follow the coding rules in `AGENTS.md` (TypeScript strictness, no `any`,
  YAGNI/DRY balance, frontend accessibility basics, etc.) — read it before
  your first PR.

## Tests

```bash
# Electron / TypeScript (Vitest)
npm test

# Python sidecar (Pytest) — GPU-marked tests are excluded by default
cd sidecar
.venv/Scripts/python -m pytest tests/ -v
```

## Commits and PRs

- Imperative subject line, ≤ 72 chars; body explains *why* when it isn't
  obvious.
- No AI attribution in commits, PR descriptions, or code comments (no
  `Co-Authored-By` trailers naming an AI, no "Generated with ..." lines) —
  commits carry the human author's identity only, including for
  AI-assisted contributions.
- Never commit secrets, credentials, or generated artifacts (`dist/`,
  `release/`, model weights, `.venv/`).

## Scope and responsible use

Watermark removal in this project is intended for marks you have the rights
to remove — your own, or images you're licensed to edit. Watermarks and
credit lines can constitute Copyright Management Information (CMI) under
17 U.S.C. § 1202, and removing CMI without the rightsholder's authority can
carry legal liability independent of copyright infringement. Contributions
that specifically aim to defeat copyright/ownership/CMI marks on others'
work, or that weaken the tool's fitness for legitimate use in favor of that,
will be declined. See the README's disclaimer for the full statement.

## Reporting bugs / requesting features

Open a GitHub issue with steps to reproduce (for bugs) or the problem
you're trying to solve (for features). Include your OS, GPU, and whether
you're running from source or a packaged release.
