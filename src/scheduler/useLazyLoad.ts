import {type RefObject, useState} from 'react';
import type {BryntumSchedulerPro, BryntumSchedulerProProps} from '@bryntum/schedulerpro-react';
import type {Resource, ShiftEvent} from '../types';
import {toStoreDatum} from './bryntumTypes';

const RESOURCE_CHUNK_SIZE = 50;

interface LazyRequest {
    startIndex: number;
    count: number;
}

export interface UseLazyLoadParams {
    schedulerRef: RefObject<BryntumSchedulerPro | null>;
    resources: Resource[];
    /** Windowed fetch: given the visible resource ids, return their shifts in the date window. */
    fetchEvents: (employeeIds: number[]) => Promise<ShiftEvent[]>;
}

/**
 * Stable project config with lazy resource + event stores, driving reload from one effect. Both
 * stores MUST be nested under `project` — at top level lazyLoad never engages and the event
 * window collapses to the whole dataset.
 */
export function useLazyLoad(params: UseLazyLoadParams): BryntumSchedulerProProps['project'] {
    const {schedulerRef, resources, fetchEvents} = params;

    const [projectConfig] = useState(
        () =>
            ({
                resourceStore: {
                    lazyLoad: {chunkSize: RESOURCE_CHUNK_SIZE},
                    requestData: ({startIndex, count}: LazyRequest) => {
                        // total lets Bryntum size the scrollbar for the full set; data is just this window.
                        return {
                            data: resources.slice(startIndex, startIndex + count),
                            total: resources.length
                        };
                    },
                },
                eventStore: {
                    lazyLoad: true,
                    requestData: async ({startIndex, count}: LazyRequest) => {
                        const resourceStore = schedulerRef.current?.instance.resourceStore;
                        const employeeIds = resourceStore
                            ? resourceStore
                                .getRange(startIndex, startIndex + count)
                                .map((resource) => Number(resource.id))
                            : [];
                        const events = await fetchEvents(employeeIds);
                        return {data: events.map(toStoreDatum)};
                    },
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any,
    );

    return projectConfig;
}
