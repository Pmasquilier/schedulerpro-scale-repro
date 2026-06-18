// Shared domain types. Deliberately tiny: an event carries its own resourceId (no assignment
// store), insights are a separate decoration.

export interface Resource {
  id: number;
  name: string;
}

export interface ShiftEvent {
  id: string;
  resourceId: number;
  startDate: string; // ISO
  endDate: string; // ISO
  name: string;
}

/** Volatile decoration served by a SEPARATE endpoint, overlaid off the load path. */
export interface Insight {
  eventId: string;
  cls: string;
}

export interface DateRange {
  start: string; // ISO
  end: string; // ISO
}

export type SortDirection = 'ASC' | 'DESC';

/**
 * Which Bryntum build renders the schedule.
 * - `pro`   — `@bryntum/schedulerpro`, with the constraint scheduling engine.
 * - `plain` — `@bryntum/scheduler`, no constraint engine (the bigdataset demo's regime).
 */
export type Engine = 'pro' | 'plain';

export interface DatasetSize {
  key: string;
  label: string;
  resources: number;
  eventsPerResource: number;
}

export const DATASET_SIZES: DatasetSize[] = [
  { key: '4k', label: '100 × 40 (4k)', resources: 100, eventsPerResource: 40 },
  { key: '20k', label: '500 × 40 (20k)', resources: 500, eventsPerResource: 40 },
  { key: '40k', label: '1000 × 40 (40k)', resources: 1000, eventsPerResource: 40 },
];
