import { useCallback, useEffect, useRef, useState } from 'react';
import { BryntumSchedulerPro } from '@bryntum/schedulerpro-react';
import type { BryntumSchedulerPro as BryntumSchedulerProInstance } from '@bryntum/schedulerpro-react';
import type { ProjectModelConfig, SchedulerEventModel } from '@bryntum/schedulerpro';
import '@bryntum/schedulerpro/stockholm-light.css';
import { SHARED_CONFIG } from '../scheduler/SchedulerConfig';
import { LazyProject, resetRequestLog } from './LazyProject';
import { LOCATIONS, MONTH, fakeBackend, setLatency, type Location } from './lazyData';

// The A/B/C contract. Every store lazy-loads (eventStore TRUE is required to reproduce Behavior B); autoLoad TRUE is
// required to reproduce Behavior A. Compare with the perf repro, where eventStore.lazyLoad is deliberately FALSE.
const ABC_CONFIG = {
    lazyLoad: true,
    resourceStore: { lazyLoad: { chunkSize: 50 } },
    eventStore: { lazyLoad: true }, // keep TRUE → reproduces Behavior B (the second, events-only request)
    resourceTimeRangeStore: { lazyLoad: true },
    autoLoad: true, // keep TRUE → reproduces Behavior A (fires once at construction, before the widget links → no-op)
} as unknown as ProjectModelConfig;

const addDays = (iso: string, days: number): Date => {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d;
};

const eventRenderer = ({ eventRecord }: { eventRecord: SchedulerEventModel }) => (
    <span className="b-react-event-body">{eventRecord.name as string}</span>
);

// `?repro=lazy&delayMount=1` builds the project NOW but delays rendering the widget ~1.5s — reproducing the production
// timing where the project is constructed far earlier than the widget mounts. This is the Behavior-A hypothesis test:
// if autoLoad fires its one-shot at construction (no widget → no viewport), it would no-op and never retry.
const DELAY_MOUNT = new URLSearchParams(window.location.search).get('delayMount') === '1';

export function LazyOrchestrationRepro() {
    const schedulerRef = useRef<BryntumSchedulerProInstance>(null);

    // EXTERNAL filter state (Problem 4) — lives in React, NEVER passed through Bryntum's params (the loader closes over
    // it via a ref). The only way to apply it is an imperative reload.
    const [location, setLocation] = useState<Location | 'all'>('all');
    const locationRef = useRef(location);
    locationRef.current = location;

    // IN-STORE filter (the "add a filter to the store" reply). On a NON-lazy store this is instant + zero requests
    // (see ?repro=filter). On THIS lazy store it is NOT free: filter() fires a remote-filter request AND still prunes
    // only the loaded window (partial). That's the whole point — "add a filter to the store" doesn't cleanly apply to a
    // lazy store, which is why an EXTERNAL filter must reload instead.
    const [nameQuery, setNameQuery] = useState('');

    // Widget-mount gate (Behavior-A timing test). When DELAY_MOUNT, the widget appears ~1.5s after the project is built.
    const [mounted, setMounted] = useState(!DELAY_MOUNT);
    useEffect(() => {
        if (DELAY_MOUNT) {
            console.log('[repro] delayMount: project built, widget will mount in 1500ms');
            const id = window.setTimeout(() => setMounted(true), 1500);
            return () => window.clearTimeout(id);
        }
    }, []);

    // Behavior A switch. TRUE = rely on autoLoad only (no manual load) → empty grid, zero requests. FALSE = the
    // useEffect-driven load (Behavior C's mechanism), which also loads on mount and on every filter change.
    const [autoLoadOnly, setAutoLoadOnly] = useState(true);

    // Built ONCE (construction happens now; the widget links LATER on React's schedule — that gap is what breaks autoLoad).
    const [project] = useState(() => {
        const instance = new LazyProject(ABC_CONFIG);
        instance.loadHandler = async ({ params }) => {
            const { resources, events, resourceTimeRanges } = await fakeBackend({
                offset: params.startIndex ?? 0,
                limit: params.count ?? 0,
                location: locationRef.current,
            });
            // Frame as a CrudManager load response: each store section is { rows: [...] }. NO `total` (end-of-data
            // inferred from a short page), matching the production contract.
            return {
                success: true,
                resources: { rows: resources },
                events: { rows: events },
                resourceTimeRanges: { rows: resourceTimeRanges },
            };
        };
        return instance;
    });

    // Behavior C (and the initial load): the ONLY way to reload on an external filter change is an imperative load()
    // from a React effect — Bryntum can't observe `location`. In autoLoad-only mode we do nothing, to prove Behavior A.
    useEffect(() => {
        if (autoLoadOnly) {
            console.log('[repro] autoLoad-only mode → NOT calling load(). Expect: empty grid, zero [sendRequest].');
            return;
        }
        resetRequestLog();
        console.log('[repro] useEffect load() — location =', locationRef.current);
        const result = project.resourceStore.load();
        if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
    }, [project, location, autoLoadOnly]);

    // "What is external filter?" — a plain resourceStore.filter(). Watch the console: on this LAZY store it fires a
    // remote-filter [sendRequest] AND still only prunes the loaded window (partial). So even the "just filter the store"
    // path is neither free nor complete here — which is exactly why `location` (Problem 4) reloads instead.
    useEffect(() => {
        const store = project.resourceStore as unknown as { filter: (cfg: object) => void; clearFilters: () => void };
        const q = nameQuery.trim().toLowerCase();
        if (!q) {
            store.clearFilters();
            return;
        }
        console.log('[repro] resourceStore.filter() — lazy store: triggers a remote request + prunes loaded window only. q =', q);
        store.filter({ id: 'name-search', filterBy: (r: { name: string }) => String(r.name).toLowerCase().includes(q) });
    }, [project, nameQuery]);

    // Date axis: month window (end exclusive → +1 day).
    useEffect(() => {
        const instance = schedulerRef.current?.instance;
        if (!instance) return;
        const result = instance.setTimeSpan(new Date(MONTH.start), addDays(MONTH.end, 1));
        if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
    }, []);

    // Manual escape hatch for Behavior A: prove that data appears the instant we call load() ourselves.
    const forceLoad = useCallback(() => {
        resetRequestLog();
        console.log('[repro] manual project.resourceStore.load()');
        const result = project.resourceStore.load();
        if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
    }, [project]);

    return (
        <div className="app">
            <header className="header">
                <div className="header-row">
                    <strong className="title">Scheduler Pro — lazy-load orchestration repro (forum Problems 3 &amp; 4)</strong>
                </div>
                <div className="header-row controls">
                    <label className="control">
                        In-store filter — name (resourceStore.filter — lazy: remote req + partial)
                        <input
                            value={nameQuery}
                            placeholder="e.g. Employee 1"
                            onChange={(e) => setNameQuery(e.target.value)}
                        />
                    </label>
                    <label className="control">
                        External filter — location (Problem 4: needs reload)
                        <select value={location} onChange={(e) => setLocation(e.target.value as Location | 'all')}>
                            <option value="all">All ({LOCATIONS.length} locations)</option>
                            {LOCATIONS.map((l) => (
                                <option key={l} value={l}>
                                    {l}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="control">
                        <input type="checkbox" checked={autoLoadOnly} onChange={(e) => setAutoLoadOnly(e.target.checked)} />
                        autoLoad only (Problem 3: no manual load)
                    </label>
                    <button type="button" onClick={forceLoad}>
                        Force load()
                    </button>
                    <label className="control latency">
                        Latency
                        <input type="range" min={0} max={1000} step={50} defaultValue={0} onChange={(e) => setLatency(Number(e.target.value))} />
                    </label>
                </div>
            </header>
            <main className="scheduler-area">
                {mounted && <BryntumSchedulerPro ref={schedulerRef} {...SHARED_CONFIG} project={project as never} eventRenderer={eventRenderer} />}
            </main>
        </div>
    );
}
