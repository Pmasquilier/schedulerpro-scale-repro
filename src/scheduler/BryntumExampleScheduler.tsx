import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BryntumSchedulerPro } from '@bryntum/schedulerpro-react';
import type { BryntumSchedulerPro as BryntumSchedulerProInstance } from '@bryntum/schedulerpro-react';
import type { SchedulerEventModel } from '@bryntum/schedulerpro';
import '@bryntum/schedulerpro/stockholm-light.css';
import type { DateRange, ShiftEvent } from '../types';
import { BRYNTUM_EXAMPLE_CONFIG } from './BryntumExampleConfig';
import { ReactEventBar } from './ReactEventBar';
import { useSchedulerProjectModel } from './useSchedulerProjectModel';
import type { SchedulerDataSource } from './schedulerTypes';

// The "bryntum example" benchmark mode. It reuses EVERYTHING variable in the roger windowed path — the same
// single-request CrudManager loader (dataSource.load), the same project model, the same React event bar — and swaps
// ONLY the SchedulerPro config for Bryntum's own shipped example config (BRYNTUM_EXAMPLE_CONFIG). So the delta vs the
// dom/react/mui modes is purely their-config-vs-roger-config, not data, loading, or bar content.
//
// Loading: Marcio (Bryntum staff, forum t=35495) called the single-round-trip CrudManager requestData the fastest path;
// roger's SchedulerProjectModel.sendRequest already IS that (resources + events in ONE response). We keep it, so this
// mode does NOT reproduce the per-store requestData fan-out (the redundant 2nd request) — by design.

const barRenderer = ({ eventRecord }: { eventRecord: SchedulerEventModel }): ReactElement => {
    const event = eventRecord.get('domainEvent') as ShiftEvent;
    return <ReactEventBar event={event} />;
};

export interface BryntumExampleSchedulerProps {
    dataSource: SchedulerDataSource;
    month: DateRange;
}

const addDays = (date: Date, days: number): Date => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
};

export function BryntumExampleScheduler({ dataSource, month }: BryntumExampleSchedulerProps) {
    const schedulerRef = useRef<BryntumSchedulerProInstance>(null);
    const project = useSchedulerProjectModel(dataSource.load);
    const [eventRenderer] = useState(() => barRenderer);

    // (Re)load from row 0 on mount and whenever `reloadOn` changes — identical to WindowedScheduler.
    useEffect(() => {
        const result = project.resourceStore.load();
        if (result instanceof Promise) {
            result.catch((e: unknown) => console.error(e));
        }
    }, [project, dataSource.reloadOn]);

    // Date axis: atomic setTimeSpan (end exclusive, +1 day). Our data spans a month; hourAndDay renders it in hourly ticks.
    useEffect(() => {
        const instance = schedulerRef.current?.instance;
        if (!instance) return;
        const result = instance.setTimeSpan(new Date(month.start), addDays(new Date(month.end), 1));
        if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
    }, [month.start, month.end]);

    // No MUI ThemeProvider here: the React bar is plain (rb-* CSS classes), unlike the mui mode's per-bar ThemeProvider.
    // height:100% binds a definite height so Bryntum virtualises to the visible rows (see WindowedScheduler note).
    return (
        <div style={{ height: '100%' }}>
            <BryntumSchedulerPro
                ref={schedulerRef}
                {...BRYNTUM_EXAMPLE_CONFIG}
                project={project as never}
                eventRenderer={eventRenderer as never}
            />
        </div>
    );
}
