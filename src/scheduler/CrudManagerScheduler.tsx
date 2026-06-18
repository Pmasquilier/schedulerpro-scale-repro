import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {BryntumSchedulerPro, BryntumSchedulerProProps} from '@bryntum/schedulerpro-react';
import type {DateRange, Engine, Insight, Resource, ShiftEvent} from '../types';
import {SchedulerView} from './SchedulerView';
import {createEventRenderer, SHARED_CONFIG} from './SchedulerConfig';
import {createRequestData, createSyncCodec, createSyncTransport} from './crudBackend';
import type {SyncApiResult, SyncTransport} from './crudBackend';
import {asChangesetStore} from './bryntumTypes';
import {afterNextPaint, afterRenderSettled, perfMeter} from './perfMeter';
import type {MoveInput} from './LazyScheduler';

export interface CrudManagerSchedulerProps {
    engine: Engine;
    resources: Resource[];
    month: DateRange;
    fetchEvents: (employeeIds: number[]) => Promise<ShiftEvent[]>;
    fetchInsights: (employeeIds: number[]) => Promise<Insight[]>;
    moveShift: (input: MoveInput) => Promise<void>;
    // Option B transport: the app's own call (axios/TanStack mutation) for the SYNC POST. Bryntum
    // hands us the encoded changeset string; this issues the request so the app's interceptors fire.
    syncShifts: (body: string, signal: AbortSignal) => Promise<SyncApiResult>;
}

const addDays = (date: Date, days: number): Date => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
};

/**
 * CrudManager-native strategy (production shape). LOAD and reconciliation are delegated to
 * Bryntum's data layer; the SYNC transport is owned by the app so its HTTP interceptors fire:
 *   • LOAD — `lazyLoad` + `requestData` (the documented windowed-fetch function hook).
 *   • SYNC — `autoSync` builds the changeset; `encode`/`decode` (documented JsonEncoder hooks)
 *            translate changeset <-> our REST DTO. The actual POST is issued by the app's own
 *            client via `sendRequest`/`cancelRequest` assigned on the project (so our own
 *            interceptors fire) rather than `syncUrl`. No diffEventRows, no manual move, no
 *            revert, no explicit settle.
 * The endpoint (`POST /api/events/batch`) is mocked by MSW (src/mocks) so this runs server-less.
 * Pro-only; insights overlay out of scope.
 */
export function CrudManagerScheduler(props: CrudManagerSchedulerProps) {
    const {resources, month} = props;
    const schedulerRef = useRef<BryntumSchedulerPro>(null);
    const latestProps = useRef(props);
    latestProps.current = props;

    // ---- Insights overlay (volatile, off the load path). IDENTICAL to lazy — the CrudManager is
    // uninvolved: insights are not a crud store, just a render-time decoration. ------------------
    const insightsRef = useRef<Map<string, string>>(new Map());
    const getCls = useCallback((eventId: string) => insightsRef.current.get(eventId), []);
    const eventRenderer = useMemo(() => createEventRenderer(getCls), [getCls]);

    const refreshInsights = useCallback(async () => {
        const employeeIds = latestProps.current.resources.map((r) => r.id);
        const insights = await latestProps.current.fetchInsights(employeeIds);
        const map = new Map<string, string>();
        insights.forEach((i) => map.set(i.eventId, i.cls));
        insightsRef.current = map;

        const instance = schedulerRef.current?.instance;
        if (!instance) return;
        // refreshResources is the ONLY repaint that re-invokes the event renderer (refresh()/
        // refreshRows() skip it -> stale badge). Virtualized: only visible bars repaint.
        instance.refreshResources(
            instance.resourceStore.records as Parameters<typeof instance.refreshResources>[0],
        );
    }, []);

    useEffect(() => {
        void refreshInsights();
        // re-fetch the overlay when the resource set (size) changes
    }, [refreshInsights, resources]);

    // Option B: load + encoding stay DECLARATIVE config (requestData, encode/decode, the sync
    // listener). The TRANSPORT is NOT config — there is no `syncUrl`; instead sendRequest/
    // cancelRequest are assigned on the project instance below, so the app's axios issues the call.
    // autoLoad bootstraps the first window (lazyLoad keeps it to the visible range). writeAllFields
    // makes every changed row carry the full data (id+dates+resourceId) for encode().
    const [projectConfig] = useState(() => {
        const codec = createSyncCodec();
        const requestData = createRequestData({
            getResources: () => latestProps.current.resources,
            fetchEvents: (ids) => latestProps.current.fetchEvents(ids),
        });
        return {
            lazyLoad: true,
            autoLoad: true,
            autoSync: true,
            autoSyncTimeout: 50,
            validateResponse: false,
            writeAllFields: true,
            requestData,
            encode: codec.encode,
            decode: codec.decode,
            listeners: {
                // Reconcile timing: the native `sync` event fires when a sync round-trip commits.
                sync: () => {
                    perfMeter.endReconcile();
                    const inst = schedulerRef.current?.instance;
                    if (inst) perfMeter.setEventModels(asChangesetStore(inst.eventStore).count);
                },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
    });

    // The transport pair, built once. syncShifts is read through the ref so config never goes stale.
    const [transport] = useState<SyncTransport>(() =>
        createSyncTransport({
            syncShifts: (body, signal) => latestProps.current.syncShifts(body, signal),
        }),
    );

    // Option B reintroduces instance patching (the price of axios-owned transport): assign
    // sendRequest/cancelRequest on the project once the instance exists. encode/decode could be
    // declarative config; the transport methods are not documented config keys, so we set them here.
    useEffect(() => {
        let cancelled = false;
        const getProject = () =>
            (schedulerRef.current?.instance as unknown as { project?: Partial<SyncTransport> })
                ?.project;
        void (async () => {
            let project = getProject();
            for (let i = 0; i < 60 && !project; i++) {
                await afterNextPaint();
                project = getProject();
            }
            if (cancelled || !project) return;
            project.sendRequest = transport.sendRequest;
            project.cancelRequest = transport.cancelRequest;
        })();
        return () => {
            cancelled = true;
        };
    }, [transport]);

    // HARNESS-ONLY: measure first-paint of the loaded window. This effect does NOT exist in
    // production — there you simply render <BryntumSchedulerPro project={config}/> and stop.
    useEffect(() => {
        let cancelled = false;
        perfMeter.startMount();
        void (async () => {
            let instance = schedulerRef.current?.instance;
            for (let i = 0; i < 60 && !instance; i++) {
                await afterNextPaint();
                instance = schedulerRef.current?.instance;
            }
            if (cancelled || !instance) return;
            const root = (instance as unknown as { element?: Element }).element;
            const eventStore = instance.eventStore as unknown as { count?: number; isLoading?: boolean };
            const resourceStore = instance.resourceStore as unknown as { isLoading?: boolean };
            const isBusy = () => !eventStore.count || Boolean(eventStore.isLoading) || Boolean(resourceStore.isLoading);
            const paintedAt = root ? await afterRenderSettled(root, {isBusy}) : performance.now();
            if (cancelled) return;
            perfMeter.endMount(paintedAt);
            perfMeter.setEventModels(asChangesetStore(instance.eventStore).count);
        })();
        return () => {
            cancelled = true;
        };
    }, [resources]);

    // ---- Date axis: atomic setTimeSpan (end exclusive, +1 day). ---------------------------------
    useEffect(() => {
        const instance = schedulerRef.current?.instance;
        if (!instance) return;
        const result = instance.setTimeSpan(new Date(month.start), addDays(new Date(month.end), 1));
        if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
    }, [month.start, month.end]);

    // ---- Reconcile timing: drop starts the clock; the native sync stops it (via onSynced). ------
    const onEventDrop = useCallback(() => {
        perfMeter.startReconcile();
    }, []);

    return (
        <SchedulerView
            engine="pro"
            schedulerRef={schedulerRef}
            {...SHARED_CONFIG}
            project={projectConfig as BryntumSchedulerProProps['project']}
            eventDragFeature
            eventRenderer={eventRenderer}
            onEventDrop={onEventDrop as never}
        />
    );
}
