import { BryntumSchedulerPro } from '@bryntum/schedulerpro-react';
import '@bryntum/schedulerpro/stockholm-light.css';
import type { EngineViewProps } from '../SchedulerView';

/**
 * Pro engine chunk. Imported ONLY via `React.lazy`, so `@bryntum/schedulerpro` (and its CSS) is
 * fetched only on a `…/pro` page. Isolating the value import here is what prevents the "Grid
 * bundle loaded multiple times" collision with the plain build.
 */
export default function ProSchedulerView({ schedulerRef, ...config }: EngineViewProps) {
  return <BryntumSchedulerPro ref={schedulerRef} {...config} />;
}
