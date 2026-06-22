# Bryntum Scheduler Pro at scale — reproduction

A small app to reproduce how **Scheduler Pro** behaves at **~40k events** (1,000 resources × ~40),
month view, on a **custom REST backend** (in-memory, no external services).

## What's implemented

- **Two engines:** Scheduler **Pro** vs **plain** Scheduler (code-split, one bundle per page;
  switching reloads).
- **Three loading strategies:**
  - `Non-lazy` — full materialization (whole dataset into the engine).
  - `Lazy` — resource-axis windowing (`lazyLoad` + `requestData`); only visible rows reach the engine.
  - `CrudManager` — `lazyLoad` + `autoSync`.
- **Three write-path transports** (drag → persist):
  - Option A — CrudManager `syncUrl` + `encode`/`decode` codec (Bryntum owns the fetch).
  - Option B — CrudManager with an app-owned fetch via `sendRequest` / `cancelRequest`
    (our own client + interceptors fire).
  - Option C — hand-rolled: write ourselves, then `applyChangeset({ added, updated, removed })`
    with a per-gesture snapshot/revert.
- **Per-event insights overlay** refreshed after a write, without reloading the grid.
- **Live metrics:** Mount, Drag→reconcile, EventModels-in-engine. Header controls for strategy,
  engine, dataset size (4k/20k/40k) and network latency.

## Run

```bash
npm install && npm run dev
```

## Results

Production build, MacBook Pro M4, **CPU throttled 4×**, first mount on a clean heap.

| @ 20k, Pro | Mount | EventModels |
| --- | --- | --- |
| **CrudManager** (windowed, native sync) | **~1.5 s** — flat to 40k | 4,000 |
| Hand-rolled lazy (windowed, manual reconcile) | ~3 s — flat to 40k | 2,000 |
| Non-lazy (full materialization) | ~6.9 s — grows with size | 20,000 |
| Non-lazy, **plain** Scheduler | ~2.5 s | 20,000 |

The constraint engine costs ~2.7× over the same full materialization; windowing keeps both
windowed paths flat across dataset sizes.

## Stack

Scheduler Pro / Scheduler **7.3.1** (trial aliases), React wrappers 7.3.2, React 19, Vite 6,
TypeScript 5.

> **License.** Defaults to **trial** builds (they expire). For your own license: copy
> `.npmrc.example` → `.npmrc` (gitignored), add your token, switch the `@bryntum/*` deps in
> `package.json` from the trial aliases to `"7.3.1"`, reinstall. Use **your own** credentials.
