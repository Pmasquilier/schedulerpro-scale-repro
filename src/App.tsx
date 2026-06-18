import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import './app.css';
import { DATASET_SIZES, type DatasetSize, type Engine } from './types';
import { generateDataset } from './api/dataGenerator';
import { backend } from './api/fakeBackend';
import { perfMeter } from './scheduler/perfMeter';
import { LazyScheduler, type MoveInput } from './scheduler/LazyScheduler';
import { NonLazyScheduler } from './scheduler/NonLazyScheduler';
import { CrudManagerScheduler } from './scheduler/CrudManagerScheduler';
import type { SyncApiResult } from './scheduler/crudBackend';

// Hash route: `#/<strategy>/<engine>`, e.g. `#/lazy/pro`.
type Strategy = 'lazy' | 'non-lazy' | 'crud';
interface Route {
  strategy: Strategy;
  engine: Engine;
}

function parseStrategy(s: string): Strategy {
  if (s === 'non-lazy') return 'non-lazy';
  if (s === 'crud') return 'crud';
  return 'lazy';
}

function parseHash(hash: string): Route {
  const [, strategy, engine] = hash.split('/');
  return {
    strategy: parseStrategy(strategy),
    // The CrudManager strategy is Pro-only; force Pro so its bundle never collides with a plain page.
    engine: strategy === 'crud' ? 'pro' : engine === 'plain' ? 'plain' : 'pro',
  };
}

const toHash = (r: Route): string => `#/${r.strategy}/${r.engine}`;

// Engine is fixed per page load (only one Bryntum product bundle may load per page), so
// switching strategy re-renders in place but switching engine forces a full reload.
const PAGE_ENGINE: Engine = parseHash(window.location.hash).engine;

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      const next = parseHash(window.location.hash);
      if (next.engine !== PAGE_ENGINE) {
        window.location.reload();
        return;
      }
      setRoute(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

function MetricsBand() {
  const perf = useSyncExternalStore(perfMeter.subscribe, perfMeter.getSnapshot);
  const fmt = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('en-US')} ms`);
  return (
    <div className="metrics">
      <Metric label="Mount" value={fmt(perf.mountMs)} />
      <Metric label="Drag → reconcile" value={fmt(perf.reconcileMs)} />
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
  const route = useHashRoute();
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
  }, [dataset, route]);

  useEffect(() => {
    backend.setLatency(latency);
  }, [latency]);

  const fetchEvents = useCallback(
    (employeeIds: number[]) =>
      backend.searchShifts({ employeeIds, rangeDates: [dataset.month] }),
    [dataset.month],
  );
  const fetchInsights = useCallback(
    (employeeIds: number[]) => backend.getInsights({ employeeIds, rangeDates: [dataset.month] }),
    [dataset.month],
  );
  const moveShift = useCallback((input: MoveInput) => backend.moveShift(input), []);

  // Option B sync transport: stand-in for the app's TanStack mutation. The call goes through the
  // app's HTTP client (here a plain fetch to the MSW-mocked batch endpoint), so in the real product
  // its axios interceptors (error reporting, 401->login, tracing) fire. Returns an axios-style result.
  const syncShifts = useCallback(
    async (body: string, signal: AbortSignal): Promise<SyncApiResult> => {
      const res = await fetch('/api/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal,
      });
      const parsed = (await res.json().catch(() => ({}))) as SyncApiResult['body'];
      return { status: res.status, body: parsed };
    },
    [],
  );

  const schedulerProps = {
    engine: route.engine,
    resources: dataset.resources,
    month: dataset.month,
    fetchEvents,
    fetchInsights,
    moveShift,
    syncShifts,
  };

  // Clean remount per size/strategy/engine, so each mount metric is measured from scratch.
  const schedulerKey = `${route.strategy}-${route.engine}-${size.key}`;

  return (
    <div className="app">
      <header className="header">
        <div className="header-row">
          <strong className="title">Scheduler — Lazy vs Non-Lazy × Pro vs Plain</strong>
          <nav className="routes">
            <a href={toHash({ ...route, strategy: 'lazy' })} className={route.strategy === 'lazy' ? 'active' : ''}>
              Lazy
            </a>
            <span className="sep">|</span>
            <a
              href={toHash({ ...route, strategy: 'non-lazy' })}
              className={route.strategy === 'non-lazy' ? 'active' : ''}
            >
              Non-lazy
            </a>
            <span className="sep">|</span>
            <a
              href={toHash({ ...route, strategy: 'crud' })}
              className={route.strategy === 'crud' ? 'active' : ''}
            >
              CrudManager
            </a>
          </nav>
          <nav className="routes engines">
            <a href={toHash({ ...route, engine: 'pro' })} className={route.engine === 'pro' ? 'active' : ''}>
              Pro
            </a>
            <span className="sep">|</span>
            <a href={toHash({ ...route, engine: 'plain' })} className={route.engine === 'plain' ? 'active' : ''}>
              Plain
            </a>
          </nav>
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
        {route.strategy === 'crud' ? (
          <CrudManagerScheduler key={schedulerKey} {...schedulerProps} />
        ) : route.strategy === 'lazy' ? (
          <LazyScheduler key={schedulerKey} {...schedulerProps} />
        ) : (
          <NonLazyScheduler key={schedulerKey} {...schedulerProps} />
        )}
      </main>
    </div>
  );
}
