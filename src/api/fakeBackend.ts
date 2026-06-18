import type { Resource, ShiftEvent, Insight, DateRange, SortDirection } from '../types';

// Simulated backend: an in-memory array behind an async client with steerable latency. Written
// as a CLIENT so it's swappable for a real HTTP client. Mirrors our REST shape: POST-search,
// no pagination.

let latencyMs = 0;
let resources: Resource[] = [];
let events: ShiftEvent[] = [];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clone = (e: ShiftEvent): ShiftEvent => ({ ...e });

// ISO UTC strings sort chronologically, so string comparison is a valid time comparison.
// An event overlaps the window if it starts before the window ends and ends after it starts.
function overlapsWindow(e: ShiftEvent, range: DateRange): boolean {
  return e.startDate <= range.end && e.endDate >= range.start;
}

// Insights are volatile decoration from a separate endpoint. We derive a stable severity class
// per event id so the overlay is reproducible (a real backend would recompute independently).
const INSIGHT_CLASSES = ['insight-low', 'insight-med', 'insight-high'];
function insightCls(eventId: string): string {
  let h = 0;
  for (let i = 0; i < eventId.length; i++) {
    h = (h * 31 + eventId.charCodeAt(i)) | 0;
  }
  return INSIGHT_CLASSES[Math.abs(h) % INSIGHT_CLASSES.length];
}

export const backend = {
  setLatency(ms: number): void {
    latencyMs = ms;
  },
  getLatency(): number {
    return latencyMs;
  },
  /** Replaces the whole in-memory dataset (called by the size selector). */
  setDataset(nextResources: Resource[], nextEvents: ShiftEvent[]): void {
    resources = nextResources;
    events = nextEvents.map(clone);
  },
  resourceCount(): number {
    return resources.length;
  },

  // 1) Events — windowed by visible resources + date range. Returns ALL matching events (no
  //    pagination), each a fresh clone (server truth).
  async searchShifts(input: {
    employeeIds: number[];
    rangeDates: DateRange[];
    sortBy?: { property: string; direction: SortDirection };
  }): Promise<ShiftEvent[]> {
    await delay(latencyMs);
    const ids = new Set(input.employeeIds);
    const range = input.rangeDates[0];
    const result = events
      .filter((e) => ids.has(e.resourceId) && overlapsWindow(e, range))
      .map(clone);

    if (input.sortBy) {
      const { property, direction } = input.sortBy;
      const dir = direction === 'DESC' ? -1 : 1;
      result.sort((a, b) => {
        const av = a[property as keyof ShiftEvent];
        const bv = b[property as keyof ShiftEvent];
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
      });
    }
    return result;
  },

  // 2) Insights — SEPARATE (volatile) endpoint. One decoration per event in the window.
  async getInsights(input: { employeeIds: number[]; rangeDates: DateRange[] }): Promise<Insight[]> {
    await delay(latencyMs);
    const ids = new Set(input.employeeIds);
    const range = input.rangeDates[0];
    return events
      .filter((e) => ids.has(e.resourceId) && overlapsWindow(e, range))
      .map((e) => ({ eventId: e.id, cls: insightCls(e.id) }));
  },

  // 3) Move — persists a placement change, returns once the server truth is settled.
  async moveShift(input: {
    id: string;
    startDate: string;
    endDate: string;
    resourceId: number;
  }): Promise<void> {
    await delay(latencyMs);
    const e = events.find((ev) => ev.id === input.id);
    if (e) {
      e.startDate = input.startDate;
      e.endDate = input.endDate;
      e.resourceId = input.resourceId;
    }
  },
};

export type Backend = typeof backend;
