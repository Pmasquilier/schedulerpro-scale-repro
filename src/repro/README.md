# Lazy-load orchestration repro (Behaviors A / B / C)

Minimal, self-contained reproduction of three lazy-loading behaviors seen in production with
`@bryntum/schedulerpro` **7.3.1** + React 19, using a `ProjectModel` subclass AS a CrudManager with a
**custom `sendRequest`** callback transport (no HTTP), windowed on the **resource axis only** (events ride
along per window), and an **external filter** held in React state.

This is separate from the perf/accumulation repro (bug #1) at the app root — that one deliberately runs
`eventStore.lazyLoad: false`. This one runs `eventStore.lazyLoad: true` (required to reproduce B).

## Files
- `LazyProject.ts` — `ProjectModel` subclass; `sendRequest` routes `load()` to a JS `loadHandler` and **logs
  every request**: `seq`, `t` (ms), `startIndex`, `count`, `stores`.
- `lazyData.ts` — in-memory backend: 200 resources (3 events each, July 2026), a `location` filter that shrinks the set.
- `LazyOrchestrationRepro.tsx` — the harness: A/B/C config, a location filter bar (React state), an
  autoLoad-only toggle, and a `delayMount` mode.

## Run
```bash
npm run dev
```

| URL | Purpose |
|---|---|
| `http://localhost:5173/?repro=lazy` | A/B/C harness (widget mounts immediately) |
| `http://localhost:5173/?repro=lazy&delayMount=1` | Behavior-A test: project built ~1.5s **before** the widget mounts |

Open DevTools console and watch the `[sendRequest]` / `[repro]` lines.

## The contract
```ts
{
  lazyLoad: true,
  resourceStore:          { lazyLoad: { chunkSize: 50 } },
  eventStore:             { lazyLoad: true },   // TRUE → reproduces B
  resourceTimeRangeStore: { lazyLoad: true },
  autoLoad:               true,                 // TRUE → involved in A
}
```
Each resource-window response bundles that window's `resources` + `events` + `resourceTimeRanges`. No `total`.
The `location` filter lives in React state and is **never** sent through Bryntum's params — the `loadHandler`
closes over it via a ref.

---

## Behavior A — autoLoad no-ops when the project is built before the widget mounts

**Steps:** open `?repro=lazy&delayMount=1`, leave "autoLoad only" checked, wait > 1.5s.

**Result — REPRODUCED (with the timing gap):**
```
[repro] delayMount: project built, widget will mount in 1500ms
[repro] autoLoad-only mode → NOT calling load(). Expect: empty grid, zero [sendRequest].
(widget mounts ~1.5s later)
→ ZERO [sendRequest]. Grid stays empty (0 rows, 0 event bars), never retried.
```

**Control — open `?repro=lazy` (no delay), autoLoad only:** autoLoad DOES fire and the grid fills:
```
[sendRequest] seq=1 t=221 startIndex=0 count=50 stores=["calendars","events","resources","assignments","dependencies","timeRanges","resourceTimeRanges"]
[sendRequest] seq=2 t=292 startIndex=50 count=50 stores=["events","resources","assignments","timeRanges","resourceTimeRanges"]
→ 58 rows, 150 event bars, no manual load() called.
```

**Root cause:** autoLoad fires its one-shot relative to project **construction**. If the widget has not linked
yet (no viewport to size a window), it no-ops and is never retried. In a framework integration the project is
typically created earlier than the widget mounts, so autoLoad silently does nothing.

## Behavior B — a redundant second request on every reload

**Steps:** open `?repro=lazy`, uncheck "autoLoad only" (this calls `resourceStore.load()`).

**Result — REPRODUCED:**
```
[repro] useEffect load() — location = all
[sendRequest] seq=1 t=… startIndex=0 count=50 stores=["events","resources","assignments","timeRanges","resourceTimeRanges"]
[sendRequest] seq=2 t=… startIndex=0 count=50 stores=["events","assignments","timeRanges","resourceTimeRanges"]   ← NO "resources"
```
The 2nd request drops `resources` and re-fetches `events` (+ assignments/timeRanges/resourceTimeRanges) for the
**same window** that the 1st response already delivered. It is fired internally by Bryntum (no user/effect
trigger). Setting `eventStore.lazyLoad: false` removes the 2nd request (verified in the sibling perf repro).

> Note vs production: there the 2nd request's `count` equalled the visible-row count (e.g. 19/21). Here it is
> the chunk size (50) because the loaded window is 50 rows. The redundant-request **structure** is identical.

## Behavior C — reloading on an external (non-Bryntum) filter change

**Steps:** open `?repro=lazy`, uncheck "autoLoad only", then change the **Location** dropdown.

**Result — REPRODUCED:**
```
[repro] useEffect load() — location = Geneva
[sendRequest] seq=1 … stores=[…,"resources",…]
[sendRequest] seq=2 … stores=[… no "resources" …]   ← B repeats on every external reload
```
Because the filter never enters Bryntum's params, the only reload path is a React `useEffect` (depending on the
serialized filter) that imperatively calls `resourceStore.load()`. It works, but it is the same effect that does
the initial load (see A) and it re-triggers B on every change — which feels redundant with the lazy machinery.
