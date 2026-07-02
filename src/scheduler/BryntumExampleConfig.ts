// The OFFICIAL Bryntum config, verbatim from two shipped examples, run on OUR dataset as a baseline:
//   - nested-events-lazy-load (schedulerpro): smoothZoom, rowHeight 90, barMargin 10, hourAndDay preset, resourceInfo col.
//   - bigdataset (React + Vite): eventStyle 'tonal', React JSX eventRenderer.
// Contrast with SHARED_CONFIG (roger prod): NO fixedRowHeight (rows grow to fit the stack), tall rows, hourly ticks.
// The point: same data + same single-request loading + same React bar → the delta isolates the SCHEDULER CONFIG,
// answering "did roger misconfigure, or is the lag inherent to Bryntum at this scale?".
//
// Adaptations to our flat shift model: their resourceInfo column shows an image + rating; we only carry `name`, so the
// column binds `name` alone (no avatar, no rating). nestedEvents feature dropped — our events are flat, not a tree.
export const BRYNTUM_EXAMPLE_CONFIG = {
  // Enables smoother wheel and pinch zooming (their comment, verbatim).
  smoothZoom: true,
  // Their tall row. NO fixedRowHeight on purpose: Bryntum's default lets a row grow to fit its stacked events —
  // the exact behavior roger overrode. Keeping it default is what makes this a faithful "out-of-the-box" baseline.
  rowHeight: 90,
  barMargin: 10,
  // bigdataset's event styling.
  eventStyle: 'tonal' as const,
  // Their hourly preset. NOTE: our dataset spans a whole month (setTimeSpan in the component), so this renders the
  // month in hourly ticks — very wide, but Bryntum virtualises the time axis horizontally, so only visible ticks paint.
  viewPreset: 'hourAndDay',
  columns: [{ type: 'resourceInfo' as const, text: 'Name', field: 'name', width: 170 }],
};
