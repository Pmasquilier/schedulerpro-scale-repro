// Config shared by BOTH routes — everything constant except the loading strategy.
// Month view: a week/day-letter preset gives one column per day across the whole month.
//
// Layout mirrors roger-platform prod (planning-v2, PR #12440): the density that drives the lag comes
// from `fixedRowHeight: true` PINNING every row to `rowHeight`. Without it, Bryntum's default
// (fixedRowHeight: false) grows each row to fit its stacked overlapping events, so ~60 events/row
// balloon a row to hundreds of px and only ~3 rows stay on screen. Prod pins the row → the stack is
// clipped, ~20 rows fit the viewport → ~6-7x more bars painted per fling frame = the real stress case.
// Values read from BryntumSchedulerWrapper.tsx (DEFAULT_CONFIG) + EmployeeShiftSchedulerV2.tsx (per-view).
export const SHARED_CONFIG = {
  // Prod month row height (SCHEDULER_SIZING[view], overrides DEFAULT_CONFIG's 40).
  rowHeight: 56,
  // The density lever: pin the row so stacked events are clipped, not grown into.
  fixedRowHeight: true,
  // Prod default (Bryntum default too) — overlapping events stack vertically; kept explicit for the repro.
  eventLayout: 'stack' as const,
  // Vertical gap between stacked events (prod DEFAULT_CONFIG).
  barMargin: 4,
  // Margin around each resource's event band (prod EVENT_CELL_GAP prop).
  resourceMargin: 1,
  columns: [{ field: 'name', text: 'Employee', width: 170 }],
  // Narrow day columns like prod (roger DAY_COLUMN_WIDTH ≈ 52): the whole month fits the viewport at once
  // (no horizontal scroll), content truncates per cell ("Shift.. / 06:.. / 20:..") exactly like prod's "Kit.. / 11:00 / 19:00".
  viewPreset: { base: 'weekAndDayLetter', tickWidth: 44 },
};
