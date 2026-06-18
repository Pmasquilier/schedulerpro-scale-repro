import type { BryntumSchedulerProProps } from '@bryntum/schedulerpro-react';
import type { DomClassList } from '@bryntum/schedulerpro';

// Config shared by BOTH routes — everything constant except the loading strategy.
// Month view: a week/day-letter preset gives one column per day across the whole month.
export const SHARED_CONFIG = {
  rowHeight: 45,
  barMargin: 6,
  eventStyle: 'rounded' as const,
  columns: [{ field: 'name', text: 'Employee', width: 170 }],
  viewPreset: 'weekAndDayLetter',
};

type EventRenderer = NonNullable<BryntumSchedulerProProps['eventRenderer']>;
type EventRendererContext = Parameters<EventRenderer>[0];

/**
 * Event renderer factory. The optional `getCls` applies a volatile insight class to the bar at
 * render time via renderData.cls.add — never written onto the record. Returning JSX routes every
 * visible bar through the Bryntum-React reconciliation path (realistic but heavier at scale).
 */
export function createEventRenderer(getCls?: (eventId: string) => string | undefined): EventRenderer {
  return ({ eventRecord, renderData }: EventRendererContext) => {
    if (getCls) {
      const cls = getCls(String(eventRecord.id));
      if (cls) {
        (renderData.cls as DomClassList).add(cls);
      }
    }
    return <span className="b-react-event-body">{eventRecord.name}</span>;
  };
}
