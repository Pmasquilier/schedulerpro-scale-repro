# Bryntum Scheduler Pro at scale — performance reproduction

Keeping **Scheduler Pro** fast at **~40k events** (1,000 resources × ~40), month view, behind a
**custom REST backend** (not CrudManager-native by default). Three loading strategies × two
engines, everything else held constant. The backend is simulated in-memory — no external services.

## Run

```bash
npm install && npm run dev
```

Header controls: **strategy** (`Lazy | Non-lazy | CrudManager`), **engine** (`Pro | Plain` —
switching reloads the page, one Bryntum bundle per page), **dataset size** (4k/20k/40k), network
latency, and live metrics (Mount, Drag→reconcile, EventModels-in-engine).

## Results

Production build, MacBook Pro M4, **CPU throttled 4×**, first mount on a clean heap. *Mount* = time
to first paint of the visible rows; *EventModels* = records materialised into the engine.

| @ 20k, Pro | Mount | EventModels |
| --- | --- | --- |
| **CrudManager** (windowed, native sync) | **~1.5 s** — flat to 40k | 4,000 |
| Hand-rolled lazy (windowed, manual reconcile) | ~3 s — flat to 40k | 2,000 |
| Non-lazy (full materialization) | ~6.9 s — grows with size | 20,000 |
| Non-lazy, **plain** Scheduler | ~2.5 s | 20,000 |

- **The constraint engine costs ~2.7×** over the same full materialization (which is why Bryntum's
  big-dataset demo runs on the plain Scheduler).
- **Windowing is the fix:** both windowed paths hold a few thousand EventModels at any dataset size,
  so their mount stays flat; non-lazy scales with the full dataset.
- **CrudManager vs hand-rolled:** both window, but CrudManager replaces the hand-rolled
  persist→re-fetch→diff reconcile on drag/drop with native `autoSync` — that's the part we'd rather
  not maintain ourselves (see question 2).

> One machine, single run — reproduce with the header controls.

## Questions for Bryntum

1. **Keeping Pro fast at 20k–40k** — is windowing via CrudManager (`lazyLoad` + `requestData`) the
   recommended primitive? Any `chunkSize` / buffer guidance for 1,000 resources × a month?
2. **Targeted updates on drag/drop** — to reconcile a move without re-rendering the whole scheduler,
   our hand-rolled `lazy` path needs a manual persist→re-fetch→diff cycle, which we'd rather not own.
   Is CrudManager's `autoSync` the recommended native replacement, or is there another mechanism?
3. **Keeping our own data layer** — we already use **TanStack Query** with our own REST API. Can
   Scheduler Pro work on top of that — letting CrudManager's sync go through our existing TanStack
   mutations / API client rather than have Bryntum own the requests — or does Pro expect to own the
   data layer? What's the supported way to wire it onto an existing stack?
4. **A "no-engine" mode for Pro** — can Scheduler Pro run with the constraint engine bypassed where
   we don't need it (the plain regime) while keeping Pro features where we do?

## Stack

Scheduler Pro / Scheduler **7.3.1** (trial aliases), React wrappers 7.3.2, React 19, Vite 6,
TypeScript 5. Engines are code-split, one Bryntum product per page (switching engines reloads).

> **License.** Defaults to the **trial** builds (they expire). For your own license: copy
> `.npmrc.example` → `.npmrc` (gitignored), add your token, switch both `@bryntum/*` deps in
> `package.json` from the trial aliases to `"7.3.1"`, and reinstall. Use **your own** credentials.
