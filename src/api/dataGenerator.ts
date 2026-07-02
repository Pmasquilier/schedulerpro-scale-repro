import type { Resource, ShiftEvent, DatasetSize, DateRange } from '../types';

// Deterministic PRNG so a given size always yields the same dataset (reproducible repro).
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive month window [first day 00:00, last day 23:59:59], as ISO. */
export function currentMonthRange(ref: Date = new Date()): DateRange {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
}

export interface GeneratedDataset {
  resources: Resource[];
  events: ShiftEvent[];
  month: DateRange;
}

/** Generates `size.resources` resources, each with ~`size.eventsPerResource` shifts spread over the month. */
export function generateDataset(size: DatasetSize, ref: Date = new Date()): GeneratedDataset {
  const rng = mulberry32(size.resources * 7919 + size.eventsPerResource);
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const resources: Resource[] = [];
  const events: ShiftEvent[] = [];

  for (let r = 1; r <= size.resources; r++) {
    resources.push({ id: r, name: `Employee ${r}` });

    // One shift per day: prod parity (one bar per day per employee — a fat, readable bar filling each cell),
    // rather than a random scatter that leaves some days empty. Resource count stays the scale knob;
    // eventsPerResource is now implicitly daysInMonth.
    for (let day = 1; day <= daysInMonth; day++) {
      // Long shift (~14–16h) so the bar fills most of a wide day column and its content stays readable —
      // a realistic 9h shift only spans ~37% of the 24h column and clips the label. This is a render repro.
      const startHour = 6 + Math.floor(rng() * 2); // 06:00–07:00
      const duration = 14 + Math.floor(rng() * 3); // 14–16h
      const start = new Date(year, month, day, startHour, 0, 0);
      const end = new Date(year, month, day, startHour + duration, 0, 0);

      events.push({
        id: `e-${r}-${day}`,
        resourceId: r,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        name: `Shift ${day}`,
      });
    }
  }

  return { resources, events, month: currentMonthRange(ref) };
}
