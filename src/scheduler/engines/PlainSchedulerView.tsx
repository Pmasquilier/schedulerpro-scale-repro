import { BryntumScheduler } from '@bryntum/scheduler-react';
import '@bryntum/scheduler/stockholm-light.css';
import type { BryntumSchedulerPro } from '@bryntum/schedulerpro-react';
import type { EngineViewProps } from '../SchedulerView';

/**
 * Plain engine chunk — the bigdataset demo's regime: `@bryntum/scheduler`, no constraint engine.
 * Imported ONLY via `React.lazy` so its bundle/CSS is fetched only on a `…/plain` page. Pro types
 * are a structural superset, so the plain wrapper is cast here — the one `as`-cast at the boundary.
 */
const PlainScheduler = BryntumScheduler as unknown as typeof BryntumSchedulerPro;

export default function PlainSchedulerView({ schedulerRef, ...config }: EngineViewProps) {
  return <PlainScheduler ref={schedulerRef} {...config} />;
}
