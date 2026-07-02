import { useEffect, useRef, useState } from 'react';
import { BryntumSchedulerPro } from '@bryntum/schedulerpro-react';
import type { BryntumSchedulerPro as BryntumSchedulerProInstance } from '@bryntum/schedulerpro-react';
import type { ProjectModelConfig, SchedulerEventModel } from '@bryntum/schedulerpro';
import '@bryntum/schedulerpro/stockholm-light.css';
import { SHARED_CONFIG } from '../scheduler/SchedulerConfig';
import { LazyProject, resetRequestLog } from './LazyProject';
import { LOCATIONS, MONTH, fetchAllByLocation, type Location } from './lazyData';

// Forum thread t=35495. Two Bryntum replies, ONE root cause: Bryntum only observes its OWN store, never your React
// state. This repro makes both replies concrete side by side.
//
//  Reply 1 — "To filter data you add a filter to the store; if it's not applicable to the store, you reload."
//    • IN-STORE filter (the `name` field, already loaded): resourceStore.filter() → instant, ZERO requests.
//    • EXTERNAL filter (`location`, a server-side param the store does NOT hold): store.filter() cannot express it,
//      so the data must be reloaded — and since the param lives in React state, that reload is driven from a useEffect.
//
//  Reply 2 — "All our demos use autoLoad, it worked as expected."
//    • autoLoad is TRUE here too, and it DOES load the initial data at mount (their claim holds).
//    • But autoLoad is a ONE-SHOT at construction: it cannot observe a later React-state filter change. Toggle
//      "autoLoad only" ON, change the location, and the grid goes stale — which is exactly why we need the useEffect.

// Non-lazy: each store loads its full set in one response (no windowing). autoLoad fires the initial load at mount.
const CONFIG = {
    autoLoad: true,
    lazyLoad: false,
    resourceStore: { lazyLoad: false },
    eventStore: { lazyLoad: false },
} as unknown as ProjectModelConfig;

const addDays = (iso: string, days: number): Date => {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d;
};

const eventRenderer = ({ eventRecord }: { eventRecord: SchedulerEventModel }) => (
    <span className="b-react-event-body">{eventRecord.name as string}</span>
);

export function FilterAutoLoadRepro() {
    const schedulerRef = useRef<BryntumSchedulerProInstance>(null);

    // IN-STORE filter: a field already present in the loaded records. Filtering it is client-side, no reload.
    const [nameQuery, setNameQuery] = useState('');

    // EXTERNAL filter: a server-side param the store never holds. Lives in React state → Bryntum can't observe it.
    const [location, setLocation] = useState<Location | 'all'>('all');
    const locationRef = useRef(location);
    locationRef.current = location;

    // autoLoad-only switch. TRUE = rely on autoLoad alone (skip the useEffect reload) → a location change is IGNORED,
    // proving the grid goes stale without an imperative load(). Read via ref so toggling it never itself reloads.
    const [autoLoadOnly, setAutoLoadOnly] = useState(false);
    const autoLoadOnlyRef = useRef(autoLoadOnly);
    autoLoadOnlyRef.current = autoLoadOnly;

    // Built ONCE. autoLoad:true fires the FIRST load at construction — this is Bryntum's "autoLoad works" case.
    const [project] = useState(() => {
        const instance = new LazyProject(CONFIG);
        instance.loadHandler = async () => {
            const { resources, events } = await fetchAllByLocation(locationRef.current);
            return { success: true, resources: { rows: resources }, events: { rows: events } };
        };
        return instance;
    });

    // (1) IN-STORE filter — the answer to "add a filter to the store". resourceStore.filter() runs on already-loaded
    // rows, instantly, with ZERO requests. Empty box → clearFilters. This is filtering WITHOUT a reload.
    useEffect(() => {
        const store = project.resourceStore as unknown as {
            filter: (cfg: object) => void;
            clearFilters: () => void;
        };
        const q = nameQuery.trim().toLowerCase();
        if (!q) store.clearFilters();
        else store.filter({ id: 'name-search', filterBy: (r: { name: string }) => r.name.toLowerCase().includes(q) });
    }, [project, nameQuery]);

    // (2) EXTERNAL filter — the answer to "not applicable to the store → reload". autoLoad already handled the INITIAL
    // load at mount (skip the first run), so this effect only fires on a location CHANGE. The location param changed
    // the backend result set; store.filter() can't reach it, so we reload. autoLoad's one shot is spent and can't
    // observe React state, so the ONLY thing that can react to `location` is this useEffect. autoLoad-only mode skips
    // the reload to prove the grid then goes stale.
    const firstRun = useRef(true);
    useEffect(() => {
        if (firstRun.current) {
            firstRun.current = false; // initial data is autoLoad's job — this proves "autoLoad works" at mount
            return;
        }
        if (autoLoadOnlyRef.current) {
            console.log('[filter] autoLoad-only → NOT reloading on location change. Grid stays stale.');
            return;
        }
        resetRequestLog();
        console.log('[filter] useEffect load() — location =', locationRef.current);
        // Non-lazy CrudManager: reload the whole package via project.load(). (resourceStore.load() is a no-op here —
        // a bare store has no transport; only the CrudManager routes through sendRequest. In the lazy repro the
        // lazyLoad plugin intercepts resourceStore.load(), which is why THAT repro can call it directly.)
        const result = project.load();
        if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
    }, [project, location]);

    // Date axis: fixed month (end exclusive → +1 day).
    useEffect(() => {
        const instance = schedulerRef.current?.instance;
        if (!instance) return;
        const result = instance.setTimeSpan(new Date(MONTH.start), addDays(MONTH.end, 1));
        if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
    }, []);

    return (
        <div className="app">
            <header className="header">
                <div className="header-row">
                    <strong className="title">Scheduler Pro — filtering &amp; autoLoad (forum t=35495)</strong>
                </div>
                <div className="header-row controls">
                    <label className="control">
                        In-store filter — name (resourceStore.filter, no reload)
                        <input
                            value={nameQuery}
                            placeholder="e.g. Employee 1"
                            onChange={(e) => setNameQuery(e.target.value)}
                        />
                    </label>
                    <label className="control">
                        External filter — location (server param, needs reload)
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
                        <input
                            type="checkbox"
                            checked={autoLoadOnly}
                            onChange={(e) => setAutoLoadOnly(e.target.checked)}
                        />
                        autoLoad only (no useEffect reload)
                    </label>
                </div>
            </header>
            <main className="scheduler-area">
                <BryntumSchedulerPro
                    ref={schedulerRef}
                    {...SHARED_CONFIG}
                    project={project as never}
                    eventRenderer={eventRenderer}
                />
            </main>
        </div>
    );
}
