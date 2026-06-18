import { lazy, Suspense, type RefObject } from 'react';
import type { BryntumSchedulerPro, BryntumSchedulerProProps } from '@bryntum/schedulerpro-react';
import type { Engine } from '../types';

/**
 * The ONLY place that knows both Bryntum builds exist. Each engine sits behind a `React.lazy`
 * boundary so its product bundle is a separate Vite chunk — a page executes only ONE, which is
 * mandatory: Bryntum throws if two product bundles load in one page (engine switching forces a
 * full reload, so the other chunk never joins it). Everything upstream stays engine-neutral.
 *
 * Pro props/instance are a structural superset of the plain ones at every member we use, so Pro
 * types are the single contract and the plain wrapper is cast inside its own chunk.
 */
export type EngineViewProps = BryntumSchedulerProProps & {
  schedulerRef: RefObject<BryntumSchedulerPro | null>;
};

export type SchedulerViewProps = EngineViewProps & { engine: Engine };

const ProView = lazy(() => import('./engines/ProSchedulerView'));
const PlainView = lazy(() => import('./engines/PlainSchedulerView'));

export function SchedulerView({ engine, ...rest }: SchedulerViewProps) {
  const View = engine === 'plain' ? PlainView : ProView;
  return (
    <Suspense fallback={null}>
      <View {...rest} />
    </Suspense>
  );
}
