import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BryntumSchedulerPro } from '@bryntum/schedulerpro-react';
import type { BryntumSchedulerPro as BryntumSchedulerProInstance } from '@bryntum/schedulerpro-react';
import type { SchedulerEventModel } from '@bryntum/schedulerpro';
import { ThemeProvider } from '@mui/material';
import '@bryntum/schedulerpro/stockholm-light.css';
import type { DateRange, ShiftEvent } from '../types';
import { SHARED_CONFIG } from './SchedulerConfig';
import { applicationTheme, renderThemedEventBar } from './ThemedEventBar';
import { useSchedulerProjectModel } from './useSchedulerProjectModel';
import type { SchedulerDataSource } from './schedulerTypes';
import { afterNextPaint, afterRenderSettled, perfMeter } from './perfMeter';

// A/B switch: set localStorage.perfTrivialBars = '1' to render a bare <span> per bar instead of the rich MUI bar.
// This isolates the React-renderer cost (rich vs trivial) at identical engine accumulation — the decisive experiment.
const trivialBars = (): boolean => {
    try {
        return localStorage.getItem('perfTrivialBars') === '1';
    } catch {
        return false;
    }
};

// Per-bar renderer faithful to roger-platform's createThemedRenderer: resolve the stashed domainEvent off the record,
// then either render the rich themed MUI bar or (A/B) a trivial span.
const createEventRenderer = (rich: boolean) => ({ eventRecord }: { eventRecord: SchedulerEventModel }): ReactElement => {
    const event = eventRecord.get('domainEvent') as ShiftEvent;
    if (!rich) return <span className="b-react-event-body">{event.name}</span>;
    return renderThemedEventBar({ event });
};

export interface WindowedSchedulerProps {
    dataSource: SchedulerDataSource;
    month: DateRange;
}

const addDays = (date: Date, days: number): Date => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
};

/**
 * Faithful reproduction of roger-platform PR #12440: a windowed CrudManager (`SchedulerProjectModel`)
 * where the RESOURCE axis lazy-loads 50 rows at a time and events "ride along" in each window response
 * (`eventStore.lazyLoad: false`). Bryntum never evicts loaded rows, so the Pro engine accumulates every
 * resource + event ever scrolled into view — the source of the scroll-back lag we want to surface.
 */
export function WindowedScheduler({ dataSource, month }: WindowedSchedulerProps) {
    const schedulerRef = useRef<BryntumSchedulerProInstance>(null);

    // The wrapper builds and owns the lazy-loading CrudManager project; it loads row ranges via the consumer's loader.
    const project = useSchedulerProjectModel(dataSource.load);

    // Pinned once (stable reference for Bryntum's React wrapper, like the real BryntumSchedulerWrapper).
    const [eventRenderer] = useState(() => createEventRenderer(!trivialBars()));

    // (Re)load from row 0 on mount and whenever `reloadOn` changes. resourceStore.load() reloads just the resource
    // window (events ride along in the response); offset/limit never enter the signature, so scrolling loads
    // incrementally without resetting.
    useEffect(() => {
        const result = project.resourceStore.load();
        if (result instanceof Promise) {
            result.catch((e: unknown) => console.error(e));
        }
    }, [project, dataSource.reloadOn]);

    // Date axis: atomic setTimeSpan (end exclusive, +1 day).
    useEffect(() => {
        const instance = schedulerRef.current?.instance;
        if (!instance) return;
        const result = instance.setTimeSpan(new Date(month.start), addDays(new Date(month.end), 1));
        if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
    }, [month.start, month.end]);

    // Live EventModels metric: every window that loads pushes events into the engine and NEVER evicts them, so this
    // count only climbs as you scroll. It is the smoking gun for the accumulation problem.
    useEffect(() => {
        const store = project.eventStore as unknown as { count: number; on: (cfg: object) => () => void };
        const update = () => perfMeter.setEventModels(store.count);
        const detach = store.on({ change: update, refresh: update, thisObj: store });
        return () => detach?.();
    }, [project]);

    // HARNESS-ONLY: measure first paint of the initial window.
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
            const paintedAt = root ? await afterRenderSettled(root, { isBusy }) : performance.now();
            if (cancelled) return;
            perfMeter.endMount(paintedAt);
            perfMeter.setEventModels(eventStore.count ?? 0);
        })();
        return () => {
            cancelled = true;
        };
    }, [dataSource.reloadOn]);

    // Top-level ThemeProvider mirrors the real wrapper (consumer components stay theme-agnostic). The PER-BAR
    // ThemeProvider inside renderThemedEventBar is the costly part — Bryntum renders bars in detached DOM.
    return (
        <ThemeProvider theme={applicationTheme}>
            <BryntumSchedulerPro
                ref={schedulerRef}
                {...SHARED_CONFIG}
                project={project as never}
                eventRenderer={eventRenderer}
            />
        </ThemeProvider>
    );
}
