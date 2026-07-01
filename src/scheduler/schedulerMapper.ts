// Ported from roger-platform PR #12440 (Scheduler.mapper.ts).
import type { EventStoreRow, ResourceStoreRow, SchedulerLazyEvent, SchedulerLazyResource } from './schedulerTypes';

// Spread the event flat for Bryntum to render, and keep an untouched copy under `domainEvent` for O(1)
// `record.get('domainEvent')` back in the wrapper. The two must be SEPARATE storage: Bryntum coerces the flat fields
// (dates → tz-shifted Date, +engine fields) on ingest, so the flat copy is not read back. Pointing Bryntum at the nested
// copy via a field `dataSource` does NOT work — date coercion is bidirectional and would poison `domainEvent` too.
export const toEventStoreRow = <TEvent extends SchedulerLazyEvent>(event: TEvent): EventStoreRow<TEvent> => ({ ...event, domainEvent: event });

// Resource counterpart of toEventStoreRow: flat side feeds the columns, `domainResource` is read back by the wrapper.
// Resources carry no dates so the flat copy isn't coerced — the stash exists for one read-back contract shared with the
// event path (so every consumer reasons about resolution the same way), not to dodge coercion.
export const toResourceStoreRow = <TResource extends SchedulerLazyResource>(resource: TResource): ResourceStoreRow<TResource> => ({
    ...resource,
    domainResource: resource,
});
