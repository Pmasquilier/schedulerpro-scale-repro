# Scheduler Pro windowed-CrudManager — scroll-back accumulation reproduction

A minimal reproduction of the **windowed CrudManager** loading strategy we shipped (roger-platform
PR #12440). The main app isolates the headline problem — **scrolling deep, then back to the top, lags
hard** — and a second harness (`src/repro`) reproduces the lazy-load **orchestration** behaviors
(autoLoad timing, external-filter reload). Together they back the Bryntum forum follow-up in
`.context/forum-post.md`, which bundles the four problems below.

## The contract (what the PR does)

A `ProjectModel` subclass (`SchedulerProjectModel`) overrides `sendRequest` so `load()` is served by
an in-process handler instead of HTTP — the documented abstract-transport hook. The store config:

```ts
{
  lazyLoad: true,
  resourceStore:          { lazyLoad: { chunkSize: 50 } },  // only the resource axis windows
  eventStore:             { lazyLoad: false },              // events RIDE ALONG in each window response
  resourceTimeRangeStore: { lazyLoad: false },
}
```

Each resource window (`startIndex` / `count`) returns its 50 resources **plus their events** in the
same response. The load response carries **no `total`** — end-of-data is inferred from a short page.

## The problem

`StoreLazyLoadPlugin` never evicts. Every window you scroll into stays materialised in the Pro
engine, and because events ride along with `lazyLoad: false` they are **never** released either. So
the engine graph grows monotonically with how far you've scrolled, and the per-commit cost grows with
it. Scrolling back to the top then re-commits/re-lays-out over the whole accumulated graph → jank.

`★ Insight ─────────────────────────────────────`
The engine's resident event count (`eventStore.count`) is the smoking gun: it only ever climbs as
you scroll (2,000 → 4,000 → 6,000 → … → 12,000 at 300 of 500 rows) and never drops — see the
measured table below. There is no auto-eviction; a sliding window would have to be coded by hand
via `store.unload()`.
`─────────────────────────────────────────────────`

## Run

```bash
npm install && npm run dev
```

Header: dataset size (4k / 20k / 40k), an employee-name filter, and a **bar renderer** switch —
`dom` / `react` / `mui` render event bars on the roger windowed scheduler, while `bryntum example`
swaps the whole scheduler for Bryntum's shipped example config (same loader + data). URL knobs let
each config be a plain link: `?res=500&epr=40` sizes the dataset, `?renderer=dom|react|mui|bryntum`
picks the path, `?total=1` hands the lazy plugin a row count so it can window+evict.

### Second repro: lazy-load orchestration (behaviors A / B / C)

A separate, self-contained harness reproduces three lazy-load *orchestration* behaviors (autoLoad
no-op, redundant second request, external-filter reload). It runs `eventStore.lazyLoad: true` (the
opposite of the perf contract above), so it lives on its own route. See `src/repro/README.md`.

```
http://localhost:5173/?repro=lazy               # A/B/C harness
http://localhost:5173/?repro=lazy&delayMount=1  # Behavior-A timing test
```

## Measured (production build, MacBook Pro M4, CPU throttled 4×, 20k dataset = 500 × 40)

Scroll-back motion = a ~120-frame programmatic scroll from the deepest loaded row back to row 0.

| State | EventModels in engine | avg frame | p95 | worst frame | jank frames (>50 ms) |
| --- | --- | --- | --- | --- | --- |
| Baseline — first window only | 2,000 | 11 ms | 18 ms | 33 ms | **0** |
| After scrolling to ~250 resources | 10,000 | 65 ms | 133 ms | **908 ms** | **40** |

A single accumulated run has been seen to stall a frame for **>3 s**. The trace also reports a
**CLS of 3.6** during the scroll-back — large layout shifts as the engine re-lays-out the graph.
Baseline is buttery; the *only* variable is how many windows have accumulated.

## Questions for Bryntum

See `.context/forum-post.md` — a single follow-up to
[forum thread t=35495](https://forum.bryntum.com/viewtopic.php?t=35495) bundling the four problems this
repo demonstrates:

1. **Scroll DOWN** — per-commit cost grows with the accumulated (resident) graph; nothing is evicted.
2. **Scroll BACK** — re-layout over the whole accumulated graph janks.
3. **autoLoad no-ops** when the project is built before the widget mounts (framework integration).
4. **External filter reload** — reloading a lazy store on a React-state filter Bryntum never sees.

Core ask: given `lazyLoad` never evicts, what is the supported sliding-window / `unload()` pattern, and
how does it interact with ride-along events and scroll-back re-loading?

## Stack

Scheduler Pro **7.3.1** (trial alias), React wrapper 7.3.2, React 19, Vite 6, TypeScript 5. Read-only
(no sync/write path — that half of the PR is out of scope here).

> **License.** Defaults to the **trial** build (it expires). For your own license: copy
> `.npmrc.example` → `.npmrc` (gitignored), add your token, switch the `@bryntum/*` deps in
> `package.json` from the trial alias to `"7.3.1"`, and reinstall. Use **your own** credentials.
