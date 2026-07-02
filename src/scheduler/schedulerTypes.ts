// Ported from roger-platform PR #12440 (Scheduler.type.ts), standalone — no @/ deps.
// The windowed-CrudManager contract: we window on the RESOURCE axis only, never on date.

// We window on the resource axis only, never on date — hence no date fields.
export type SchedulerLazyEvent = { id: string; resourceId: number };

export type SchedulerLazyResource = { id: number };

export type SchedulerLazyResourceTimeRange = { resourceId: number };

// One row in Bryntum's eventStore. The flat side is Bryntum's coerced view of the event (dates normalized, engine fields
// added) — untypeable faithfully, so we expose only the stable SchedulerLazyEvent keys. `domainEvent` is the untouched
// domain copy the wrapper reads back (the only field resolveEvent trusts).
export type EventStoreRow<TEvent> = SchedulerLazyEvent & { domainEvent: TEvent };

// One row in Bryntum's resourceStore — mirrors EventStoreRow. The flat side feeds the columns; `domainResource` is the
// untouched copy the wrapper reads back, so resource resolution shares one mechanism with events (see toResourceStoreRow).
export type ResourceStoreRow<TResource> = SchedulerLazyResource & { domainResource: TResource };

// The three CrudManager store sections one row-window produces — a structural contract shared by every consumer.
export type SchedulerStores = {
    resources: ResourceStoreRow<unknown>[];
    events: EventStoreRow<unknown>[];
    resourceTimeRanges: SchedulerLazyResourceTimeRange[];
    // EXPERIMENT (?total=1): total resource-row count. Given → StoreLazyLoadPlugin can build a sparse store of `total`
    // rows (off-window = placeholder, not resident) and evict natively. Omitted → append-only (the shipped behavior).
    total?: number;
};

/** Post-JSON.parse shape of a CrudManager lazy-load request; we read only the resource-axis fields. */
export type CrudLoadRequest = {
    stores: string[];
    params: {
        startIndex?: number;
        count?: number;
        resourceIds?: (string | number)[];
    };
};

export type CrudResponse = { success?: boolean } & Record<string, unknown>;

export type LoadHandler = (request: CrudLoadRequest) => Promise<CrudResponse>;

/** A row range the CrudManager asks for (offset/limit). Stands in for the PR's Pick<SearchRequest, 'offset' | 'limit'>. */
export type RowRange = { offset: number; limit: number };

// Load one row range and map it to the three stores. The CrudManager owns the row-range bounds (offset/limit); the consumer
// closes over its own search and merges this range into it — the search never travels through Bryntum, only the row range does.
export type SchedulerStoresLoader = (rowRange: RowRange) => Promise<SchedulerStores>;

// Row-window loader + the signal that invalidates it. Bryntum can't detect a search change (the search never enters its
// params), so `reloadOn` carries a serialized search signature: a change reloads from row 0. offset/limit stay out of it
// so scrolling loads more without resetting.
export type SchedulerDataSource = {
    load: SchedulerStoresLoader;
    reloadOn: string;
};
