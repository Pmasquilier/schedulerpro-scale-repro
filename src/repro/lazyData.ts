// Self-contained in-memory backend for the A/B/C repro. ~200 resources, each with a few events in a fixed month.
// Events embed resourceId, NO date-axis windowing. An EXTERNAL "location" filter shrinks the resource set — this
// filter lives in React state (Behavior C) and NEVER travels through Bryntum's params; the loader closes over it.

export const LOCATIONS = ['Geneva', 'Zurich', 'Bern'] as const;
export type Location = (typeof LOCATIONS)[number];

export type ReproResource = { id: number; name: string; location: Location };
export type ReproEvent = { id: string; resourceId: number; name: string; startDate: string; endDate: string };

// Fixed month window the scheduler shows (end exclusive is handled by the widget's setTimeSpan).
export const MONTH = { start: '2026-07-01', end: '2026-07-31' };

const RESOURCE_COUNT = 200;
const EVENTS_PER_RESOURCE = 3;

const RESOURCES: ReproResource[] = Array.from({ length: RESOURCE_COUNT }, (_, i) => ({
    id: i + 1,
    name: `Employee ${i + 1}`,
    location: LOCATIONS[i % LOCATIONS.length],
}));

// A few events per resource, spread across the month. Deterministic (no Math.random) so runs are comparable.
const EVENTS: ReproEvent[] = RESOURCES.flatMap((r) =>
    Array.from({ length: EVENTS_PER_RESOURCE }, (_, k) => {
        const day = 2 + k * 9; // days 2, 11, 20
        const dd = String(day).padStart(2, '0');
        return {
            id: `e${r.id}-${k}`,
            resourceId: r.id,
            name: `Shift ${k + 1}`,
            startDate: `2026-07-${dd}T08:00:00`,
            endDate: `2026-07-${dd}T16:00:00`,
        };
    }),
);

let latencyMs = 0;
export const setLatency = (ms: number): void => {
    latencyMs = ms;
};
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Non-windowed backend for the filter/autoLoad repro (t=35495): apply ONLY the external location filter (a server-side
 * param the client store never holds), return the FULL matching set in one response — no offset/limit. `name` rides
 * along so the client can demonstrate an IN-STORE filter (resourceStore.filter) on already-loaded data.
 */
export const fetchAllByLocation = async (location: Location | 'all') => {
    if (latencyMs) await delay(latencyMs);
    const resources = location === 'all' ? RESOURCES : RESOURCES.filter((r) => r.location === location);
    const ids = new Set(resources.map((r) => r.id));
    const events = EVENTS.filter((e) => ids.has(e.resourceId));
    return {
        resources: resources.map((r) => ({ id: r.id, name: r.name })),
        events,
    };
};

/**
 * The fake backend: apply the EXTERNAL location filter, slice the resource axis by offset/limit, then bundle THAT
 * window's events + resourceTimeRanges into the same response (ride-along, no date-axis windowing).
 */
export const fakeBackend = async (input: { offset: number; limit: number; location: Location | 'all' }) => {
    if (latencyMs) await delay(latencyMs);
    const filtered = input.location === 'all' ? RESOURCES : RESOURCES.filter((r) => r.location === input.location);
    const window = filtered.slice(input.offset, input.offset + input.limit);
    const ids = new Set(window.map((r) => r.id));
    const events = EVENTS.filter((e) => ids.has(e.resourceId));
    return {
        resources: window.map((r) => ({ id: r.id, name: r.name })),
        events,
        resourceTimeRanges: [] as unknown[],
    };
};
