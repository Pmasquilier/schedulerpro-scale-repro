import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import './app.css';
import { DATASET_SIZES, type DatasetSize } from './types';
import { generateDataset } from './api/dataGenerator';
import { backend } from './api/fakeBackend';
import { perfMeter } from './scheduler/perfMeter';
import { WindowedScheduler } from './scheduler/WindowedScheduler';
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

export function App() {
  const [sizeKey, setSizeKey] = useState<string>('20k');
  const [latency, setLatency] = useState<number>(0);

  const size: DatasetSize = useMemo(
    () => DATASET_SIZES.find((s) => s.key === sizeKey) ?? DATASET_SIZES[0],
    [sizeKey],
  );

  // Generate + load into the backend during render, so it's ready before any child effect loads.
  const dataset = useMemo(() => {
    const d = generateDataset(size);
    backend.setDataset(d.resources, d.events);
    return d;
  }, [size]);

  useEffect(() => {
    perfMeter.reset(dataset.events.length);
  }, [dataset]);

  useEffect(() => {
    backend.setLatency(latency);
  }, [latency]);

  // The ride-along window loader: slice the resource axis, then bundle the events for exactly those
  // resources into the SAME response (no separate event fetch). NO `total` is returned — end-of-data
  // is inferred from a short page, matching the PR's createLoadHandler.
  // Experiment flag: localStorage.perfManuallyScheduled='1' marks every event manuallyScheduled, which tells the Pro
  // engine to skip the per-event scheduling computation. If the single-commit-cost curve flattens, the O(n) cost was
  // the engine re-scheduling the whole resident graph on each commit.
  const manuallyScheduled = readFlag('perfManuallyScheduled');

  const loadWindow = useCallback(
    async ({ offset, limit }: RowRange): Promise<SchedulerStores> => {
      const slice = dataset.resources.slice(offset, offset + limit);
      const employeeIds = slice.map((r) => r.id);
      const events = employeeIds.length
        ? await backend.searchShifts({ employeeIds, rangeDates: [dataset.month] })
        : [];
      return {
        resources: slice.map(toResourceStoreRow),
        events: events.map((e) => ({ ...toEventStoreRow(e), ...(manuallyScheduled ? { manuallyScheduled: true } : {}) })),
        resourceTimeRanges: [],
      };
    },
    [dataset, manuallyScheduled],
  );

  // A filter/size change reloads from row 0; offset/limit stay out of the signature so scrolling loads more.
  const dataSource = useMemo(() => ({ load: loadWindow, reloadOn: size.key }), [loadWindow, size.key]);

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

          <label className="control latency">
            Network latency: <b>{latency} ms</b>
            <input
              type="range"
              min={0}
              max={2000}
              step={50}
              value={latency}
              onChange={(e) => setLatency(Number(e.target.value))}
            />
          </label>

          <MetricsBand />
        </div>
      </header>

      <main className="scheduler-area">
        <WindowedScheduler key={size.key} dataSource={dataSource} month={dataset.month} />
      </main>
    </div>
  );
}
