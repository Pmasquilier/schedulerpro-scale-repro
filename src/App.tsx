import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import './app.css';
import { DATASET_SIZES, type DatasetSize } from './types';
import { generateDataset } from './api/dataGenerator';
import { backend } from './api/fakeBackend';
import { perfMeter } from './scheduler/perfMeter';
import { WindowedScheduler, type RendererMode } from './scheduler/WindowedScheduler';
import { toEventStoreRow, toResourceStoreRow } from './scheduler/schedulerMapper';
import type { RowRange, SchedulerStores } from './scheduler/schedulerTypes';

// Single strategy: the windowed CrudManager from roger-platform PR #12440. Resource axis lazy-loads
// 50 rows at a time; events ride along in each window (eventStore.lazyLoad: false); no eviction.

const readFlag = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

function MetricsBand() {
  const perf = useSyncExternalStore(perfMeter.subscribe, perfMeter.getSnapshot);
  const fmt = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('en-US')} ms`);
  return (
    <div className="metrics">
      <Metric label="Mount" value={fmt(perf.mountMs)} />
      <Metric
        label="EventModels"
        value={`${perf.eventModels.toLocaleString('en-US')} / ${perf.totalEvents.toLocaleString('en-US')}`}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const testid = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value" data-testid={`metric-${testid}`}>
        {value}
      </span>
    </div>
  );
}

// Benchmark knobs via URL so each config is a plain URL (no localStorage reload dance):
//   ?res=500&epr=40   → dataset = 500 resources × 40 events/resource (density = epr)
//   ?renderer=dom|react|mui → the event-bar rendering path under test (also switchable live in the header)
const BENCH = new URLSearchParams(window.location.search);
const benchRes = Number(BENCH.get('res'));
const benchEpr = Number(BENCH.get('epr'));
const RENDERER_MODES: RendererMode[] = ['dom', 'react', 'mui'];
const urlRenderer = BENCH.get('renderer') as RendererMode | null;
const initialRenderer: RendererMode = urlRenderer && RENDERER_MODES.includes(urlRenderer) ? urlRenderer : 'mui';
const benchTotal = BENCH.get('total') === '1'; // ?total=1 → send `total` so the lazy plugin can window+evict

export function App() {
  const [sizeKey, setSizeKey] = useState<string>('20k');
  const [renderer, setRenderer] = useState<RendererMode>(initialRenderer);
  // Employee-name filter, driven from the UI (not the URL). It's EXTERNAL app state Bryntum can't see, so applying it
  // means reloading the window through our loader (below) — the "not applicable to store → reload" case, done right:
  // the whole dataset is filtered before slicing, so results are complete (unlike an in-store filter on a lazy store).
  const [employeeFilter, setEmployeeFilter] = useState('');

  const size: DatasetSize = useMemo(() => {
    if (benchRes > 0 && benchEpr > 0) {
      return { key: `${benchRes}x${benchEpr}`, label: `${benchRes} × ${benchEpr}`, resources: benchRes, eventsPerResource: benchEpr };
    }
    return DATASET_SIZES.find((s) => s.key === sizeKey) ?? DATASET_SIZES[0];
  }, [sizeKey]);

  // Generate + load into the backend during render, so it's ready before any child effect loads.
  const dataset = useMemo(() => {
    const d = generateDataset(size);
    backend.setDataset(d.resources, d.events);
    return d;
  }, [size]);

  useEffect(() => {
    perfMeter.reset(dataset.events.length);
  }, [dataset]);

  // The ride-along window loader: slice the resource axis, then bundle the events for exactly those
  // resources into the SAME response (no separate event fetch). NO `total` is returned — end-of-data
  // is inferred from a short page, matching the PR's createLoadHandler.
  // Experiment flag: localStorage.perfManuallyScheduled='1' marks every event manuallyScheduled, which tells the Pro
  // engine to skip the per-event scheduling computation. If the single-commit-cost curve flattens, the O(n) cost was
  // the engine re-scheduling the whole resident graph on each commit.
  const manuallyScheduled = readFlag('perfManuallyScheduled');

  const loadWindow = useCallback(
    async ({ offset, limit }: RowRange): Promise<SchedulerStores> => {
      // Apply the external employee-name filter to the FULL resource set before windowing, so paging stays correct.
      const q = employeeFilter.trim().toLowerCase();
      const source = q ? dataset.resources.filter((r) => r.name.toLowerCase().includes(q)) : dataset.resources;
      const slice = source.slice(offset, offset + limit);
      const employeeIds = slice.map((r) => r.id);
      // The external filter reloads through a useEffect (WindowedScheduler's reload effect keyed on dataSource.reloadOn),
      // which is exactly the "we had to call load() ourselves" pattern. Watch this line change as you type a name:
      console.log(`[load] employeeFilter=${JSON.stringify(employeeFilter)} offset=${offset} → ${slice.length}/${source.length} resources`);
      const events = employeeIds.length
        ? await backend.searchShifts({ employeeIds, rangeDates: [dataset.month] })
        : [];
      return {
        resources: slice.map(toResourceStoreRow),
        events: events.map((e) => ({ ...toEventStoreRow(e), ...(manuallyScheduled ? { manuallyScheduled: true } : {}) })),
        resourceTimeRanges: [],
        // ?total=1: hand StoreLazyLoadPlugin the full row count so it can window+evict instead of appending.
        ...(benchTotal ? { total: source.length } : {}),
      };
    },
    [dataset, manuallyScheduled, employeeFilter],
  );

  // A filter/size change reloads from row 0; offset/limit stay out of the signature so scrolling loads more.
  const dataSource = useMemo(
    () => ({ load: loadWindow, reloadOn: `${size.key}|${employeeFilter}` }),
    [loadWindow, size.key, employeeFilter],
  );

  return (
    <div className="app">
      <header className="header">
        <div className="header-row">
          <strong className="title">Scheduler Pro — windowed CrudManager (ride-along events)</strong>
        </div>

        <div className="header-row controls">
          <label className="control">
            Dataset size
            <select value={sizeKey} onChange={(e) => setSizeKey(e.target.value)}>
              {DATASET_SIZES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="control">
            Filter employee
            <input
              value={employeeFilter}
              placeholder="e.g. Employee 1"
              onChange={(e) => setEmployeeFilter(e.target.value)}
            />
          </label>

          <label className="control">
            Bar renderer
            <select value={renderer} onChange={(e) => setRenderer(e.target.value as RendererMode)}>
              {RENDERER_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <MetricsBand />
        </div>
      </header>

      <main className="scheduler-area">
        <WindowedScheduler key={`${size.key}-${renderer}`} dataSource={dataSource} month={dataset.month} renderer={renderer} />
      </main>
    </div>
  );
}
