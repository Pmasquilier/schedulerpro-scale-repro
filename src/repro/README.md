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

---

# Filtering & autoLoad repro (forum t=35495)

Separate, **non-lazy** demo answering two Bryntum replies in [t=35495](https://forum.bryntum.com/viewtopic.php?t=35495).
One root cause: **Bryntum only observes its own store, never your React state.** Same `sendRequest`-logging
transport as above, but every store loads its full set in one response (no windowing).

- `FilterAutoLoadRepro.tsx` — the harness: an in-store name filter, an external location filter, an autoLoad-only toggle.
- `lazyData.ts` → `fetchAllByLocation()` — returns the FULL location-filtered set (no offset/limit).

Run: `http://localhost:5173/?repro=filter` — watch `[filter]` / `[sendRequest]` in the console.

## Reply 1 — "add a filter to the store; if it's not applicable to the store, reload"

- **In-store filter** (the `name` field, already loaded): `resourceStore.filter({ id, filterBy })` → filters
  **instantly, zero requests**. This is filtering *without* a reload — Bryntum's recommended path.
- **External filter** (`location`, a server-side param the store never holds): `store.filter()` can't express
  it, so the data must be **reloaded**. Since the param lives in React state, the reload is driven from a
  `useEffect`. Non-lazy reload goes through **`project.load()`** (the CrudManager) — a bare `resourceStore.load()`
  is a no-op here (no transport); only the lazy repro can call `resourceStore.load()` because its lazyLoad plugin
  intercepts it.

## Reply 2 — "all our demos use autoLoad, it worked as expected"

`autoLoad: true` here too, and it **does** load the initial data at mount (their claim holds). But autoLoad is a
**one-shot at construction**; it can't observe a later React-state filter change. Check "autoLoad only", change
the location → the grid goes **stale**. That gap is exactly why a `useEffect` reload is required.

## Verified behavior (dev, 200 resources / 600 events)

| Action | resourceStore.count | `[sendRequest]` | Meaning |
|---|---|---|---|
| Mount (autoLoad) | 200 | 1 | autoLoad loads initial data ✓ |
| In-store filter `name`="Employee 1" | 111 | **0** | store filter, no reload ✓ |
| External filter `location`=Geneva | 67 | **1** | reload via `useEffect` → `project.load()` ✓ |
| autoLoad-only + `location`=Zurich | 200 (stale) | **0** | one-shot can't react to React state ✓ |
| Re-enabled + `location`=Bern | 66 | **1** | reload resumes ✓ |
