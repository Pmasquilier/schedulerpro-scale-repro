import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BryntumSchedulerPro } from '@bryntum/schedulerpro-react';
import type { BryntumSchedulerPro as BryntumSchedulerProInstance } from '@bryntum/schedulerpro-react';
import type { SchedulerEventModel } from '@bryntum/schedulerpro';
import { ThemeProvider } from '@mui/material';
import '@bryntum/schedulerpro/stockholm-light.css';
import type { DateRange, ShiftEvent } from '../types';
import { SHARED_CONFIG } from './SchedulerConfig';
import { applicationTheme, renderThemedEventBar } from './ThemedEventBar';
import { ReactEventBar, deriveBarMeta } from './ReactEventBar';
import { useSchedulerProjectModel } from './useSchedulerProjectModel';
import type { SchedulerDataSource } from './schedulerTypes';

// A/B/C variable: the ONLY thing that changes across benchmark runs. Same bar CONTENT (deriveBarMeta) + same
// nested STRUCTURE across all three — so the delta isolates the rendering engine, not the data or tree depth.
//  dom   → DomConfig object: Bryntum renders/recycles raw DOM nodes, NO React root per bar (the cheap floor).
//  react → plain React <div> tree (ReactEventBar): same shape, one React root recycled per visible bar, no MUI.
//  mui   → the same shape via MUI Stack/Typography/Box + per-bar ThemeProvider — the roger-platform path.
export type RendererMode = 'dom' | 'react' | 'mui';

// DomConfig twin of ReactEventBar: same content + branches, expressed as a plain Bryntum element tree.
const domBar = (event: ShiftEvent): object => {
    const { severity, hasNote, narrow, reserveIconGutter, label, startTime, endTime } = deriveBarMeta(event);
    const icons = `${severity === 'warning' ? '⚠' : '🕐'}${hasNote ? '📝' : ''}`;
    if (narrow) {
        return {
            className: 'nb nb--narrow',
            dataset: { severity },
            children: [
                { tag: 'div', className: 'nb-narrow-label', text: label },
                { tag: 'span', className: 'nb-icons', text: icons },
            ],
        };
    }
    return {
        className: 'nb',
        dataset: { severity },
        children: [
            ...(reserveIconGutter
                ? [{ tag: 'div', className: 'nb-gutter', children: [{ tag: 'span', className: 'nb-icons', text: icons }] }]
                : []),
            {
                tag: 'div',
                className: 'nb-col',
                children: [
                    { tag: 'div', className: 'nb-label', style: reserveIconGutter ? 'padding-right:16px' : undefined, text: label },
                    { tag: 'div', className: 'nb-time', text: startTime },
                    { tag: 'div', className: 'nb-time', text: endTime },
                ],
            },
        ],
    };
};

// Returns a Bryntum eventRenderer. dom → DomConfig (no React); react/mui → JSX (Bryntum's React-cell reconciliation).
const createBarRenderer = (mode: RendererMode) => ({ eventRecord }: { eventRecord: SchedulerEventModel }): ReactElement | object => {
    const event = eventRecord.get('domainEvent') as ShiftEvent;
    if (mode === 'dom') return domBar(event);
    if (mode === 'react') return <ReactEventBar event={event} />;
    return renderThemedEventBar({ event });
};

export interface WindowedSchedulerProps {
    dataSource: SchedulerDataSource;
    month: DateRange;
    renderer: RendererMode;
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
export function WindowedScheduler({ dataSource, month, renderer }: WindowedSchedulerProps) {
    const schedulerRef = useRef<BryntumSchedulerProInstance>(null);

    // The wrapper builds and owns the lazy-loading CrudManager project; it loads row ranges via the consumer's loader.
    const project = useSchedulerProjectModel(dataSource.load);

    // Pinned once (stable reference for Bryntum's React wrapper, like the real BryntumSchedulerWrapper).
    const [eventRenderer] = useState(() => createBarRenderer(renderer));

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

    // Top-level ThemeProvider mirrors the real wrapper (consumer components stay theme-agnostic). The PER-BAR
    // ThemeProvider inside renderThemedEventBar is the costly part — Bryntum renders bars in detached DOM.
    //
    // The height:100% wrapper mirrors roger-platform's BryntumSchedulerWrapper (<Box sx={{ height: '100%' }}>).
    // Without a container of definite height the Pro widget auto-sizes to its content (~100 rows tall) and renders
    // every resident row into the DOM, so a fling repaints ~5x more bars than prod — which is bounded to the
    // viewport (~20 rows) by PageLayout. Binding the height makes Bryntum virtualise to the visible rows, matching prod.
    return (
        <ThemeProvider theme={applicationTheme}>
            <div style={{ height: '100%' }}>
                <BryntumSchedulerPro
                    ref={schedulerRef}
                    {...SHARED_CONFIG}
                    project={project as never}
                    eventRenderer={eventRenderer as never}
                />
            </div>
        </ThemeProvider>
    );
}
