// Ported from roger-platform PR #12440 (useSchedulerProjectModel.ts).
import type { ProjectModelConfig } from '@bryntum/schedulerpro';
import { useRef, useState } from 'react';
import { SchedulerProjectModel, createLoadHandler } from './SchedulerProjectModel';
import type { SchedulerStoresLoader } from './schedulerTypes';

// Fills the widest viewport (~45 rendered rows) in one load.
const RESOURCE_CHUNK_SIZE = 50;

// Generic windowed lazyLoad config: every store loads by row-index window (no useResourceIds), so one backend page can
// feed resources + events + shading from the same window. Rows arrive in the backend's order; lazyLoad can't sort them
// client-side beyond the loaded window, so the columns are not sortable.
const SCHEDULER_PROJECT_CONFIG: ProjectModelConfig = {
    lazyLoad: true,
    // autoLoad: true SHOULD trigger the first window load by itself. We test whether it fires when the project is
    // built (in a React hook) BEFORE the widget mounts — set localStorage.perfAutoLoadOnly='1' to skip our manual
    // resourceStore.load() and rely on autoLoad alone (see WindowedScheduler).
    resourceStore: { lazyLoad: { chunkSize: RESOURCE_CHUNK_SIZE }, autoLoad: true },
    // Only the resource axis windows: events + shading arrive bundled in each resource-window response, so these stores
    // must not lazy-load on their own — that fired a second request per reload to re-fetch events for the loaded rows.
    eventStore: { lazyLoad: false },
    resourceTimeRangeStore: { lazyLoad: false },
} as ProjectModelConfig;

/**
 * Build the read-only CrudManager project ONCE and wire the consumer's `onLoad` to each row-range request. This hook
 * owns construction only; deciding when to (re)load lives in the wrapper (its `reloadKey` effect).
 */
export const useSchedulerProjectModel = (onLoad: SchedulerStoresLoader): SchedulerProjectModel => {
    // Stable indirection: the project is built once, yet always calls the latest `onLoad` (the consumer rebuilds it
    // every render closing over the current search), so each row-range load reflects the current filters.
    const latest = useRef(onLoad);
    latest.current = onLoad;

    const [project] = useState(() => {
        const instance = new SchedulerProjectModel(SCHEDULER_PROJECT_CONFIG);
        instance.loadHandler = createLoadHandler(rowRange => latest.current(rowRange));
        return instance;
    });

    return project;
};
