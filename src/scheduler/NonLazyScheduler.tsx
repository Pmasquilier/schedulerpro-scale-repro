import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BryntumSchedulerPro, BryntumSchedulerProProps } from '@bryntum/schedulerpro-react';
import type { SchedulerEventModel } from '@bryntum/schedulerpro';
import type { DateRange, Engine, Insight, Resource, ShiftEvent } from '../types';
import { SchedulerView } from './SchedulerView';
import { settleEngine } from './settleEngine';
import { SHARED_CONFIG, createEventRenderer } from './SchedulerConfig';
import { asChangesetStore, toStoreDatum } from './bryntumTypes';
import { afterNextPaint, afterRenderSettled, perfMeter } from './perfMeter';
import type { MoveInput } from './LazyScheduler';

export interface NonLazySchedulerProps {
  engine: Engine;
  resources: Resource[];
  month: DateRange;
  fetchEvents: (employeeIds: number[]) => Promise<ShiftEvent[]>;
  fetchInsights: (employeeIds: number[]) => Promise<Insight[]>;
  moveShift: (input: MoveInput) => Promise<void>;
}

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

// Non-lazy: the insight class lives ON the event data (native `cls` field), so Bryntum paints
// it normally — no render-time injection needed.
function withInsightClass(events: ShiftEvent[], insights: Insight[]) {
  const clsById = new Map(insights.map((i) => [i.eventId, i.cls]));
  return events.map((e) => ({ ...toStoreDatum(e), cls: clsById.get(e.id) }));
}

export function NonLazyScheduler(props: NonLazySchedulerProps) {
  const { engine, resources, month } = props;
  const schedulerRef = useRef<BryntumSchedulerPro>(null);
  const latestProps = useRef(props);
  latestProps.current = props;

  // Stable identity (matches LazyScheduler) so the wrapper never reassigns eventRenderer +
  // repaints. No insight lookup here: the class lives on the data.
  const eventRenderer = useMemo(() => createEventRenderer(), []);

  // syncDataOnLoad makes each `store.data = …` a granular diff (records keep identity) instead
  // of a clear+rebuild, and forces the ProjectModel to instantiate up front. Two large-load
  // levers keep the diff non-pathological:
  //   • threshold → above N affected records, collapse into ONE batched `refresh` event.
  //   • reorderOnSync:false → skip the per-record reordering pass (our order is stable).
  // Neither changes the diff RESULT, only its cost.
  const [projectConfig] = useState<BryntumSchedulerProProps['project']>(() => ({
    eventStore: { syncDataOnLoad: { threshold: 100 }, reorderOnSync: false },
    resourceStore: { syncDataOnLoad: { threshold: 100 }, reorderOnSync: false },
  }));

  // Pushes the WHOLE dataset in one shot via `store.data = …`, then settles + repaints. Every
  // row's events stay materialised, which is why this regime doesn't scale.
  const loadAll = useCallback(async () => {
    // The wrapper may still be constructing the widget; wait for the ProjectModel to exist.
    let instance = schedulerRef.current?.instance;
    for (let i = 0; i < 60 && !instance?.project; i++) {
      await afterNextPaint();
      instance = schedulerRef.current?.instance;
    }
    if (!instance?.project) return;
    const employeeIds = latestProps.current.resources.map((r) => r.id);
    const [events, insights] = await Promise.all([
      latestProps.current.fetchEvents(employeeIds),
      latestProps.current.fetchInsights(employeeIds),
    ]);

    // Batch the load into a SINGLE repaint (mirrors Bryntum's bigdataset demo): suspend, push
    // both stores, resume with a forced refresh.
    instance.suspendRefresh();
    // Assign store.data directly (cast: the typed setter doesn't accept our raw datum shape).
    (instance.resourceStore as unknown as { data: unknown }).data = latestProps.current.resources;
    (instance.eventStore as unknown as { data: unknown }).data = withInsightClass(events, insights);
    instance.resumeRefresh(true);

    // syncDataOnLoad leaves the Pro view stale: settle the engine, then repaint. No-op on plain.
    await settleEngine(latestProps.current.engine, instance.project);
    instance.refreshRows();

    perfMeter.setEventModels(asChangesetStore(instance.eventStore).count);
  }, []);

  // Mount / dataset change: load everything, measure until the DOM stops mutating (the real
  // "all rows painted" — loadAll resolving only means the data is in the stores; Pro keeps
  // committing event bars across later frames).
  useEffect(() => {
    let cancelled = false;
    perfMeter.startMount();
    loadAll()
      .then(() => {
        const root = (schedulerRef.current?.instance as unknown as { element?: Element } | undefined)?.element;
        return root ? afterRenderSettled(root) : performance.now();
      })
      .then((paintedAt) => {
        if (!cancelled) perfMeter.endMount(paintedAt);
      })
      .catch((e: unknown) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [loadAll, resources]);

  // Atomic setTimeSpan (end exclusive, +1 day).
  useEffect(() => {
    const instance = schedulerRef.current?.instance;
    if (!instance) return;
    const result = instance.setTimeSpan(new Date(month.start), addDays(new Date(month.end), 1));
    if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
  }, [month.start, month.end]);

  // Naive move: persist, then re-fetch EVERYTHING and re-assign store.data — the full dataset
  // round-trips on every drop even though one record changed.
  const onEventDrop = useCallback(({ eventRecords }: { eventRecords: SchedulerEventModel[] }) => {
    perfMeter.startReconcile();
    void (async () => {
      try {
        await Promise.all(
          eventRecords.map((record) =>
            latestProps.current.moveShift({
              id: String(record.id),
              startDate: (record.startDate as Date).toISOString(),
              endDate: (record.endDate as Date).toISOString(),
              resourceId: Number(record.resource.id),
            }),
          ),
        );
        await loadAll();
        await afterNextPaint();
      } catch (e) {
        console.error(e);
      } finally {
        perfMeter.endReconcile();
      }
    })();
  }, [loadAll]);

  return (
    <SchedulerView
      engine={engine}
      schedulerRef={schedulerRef}
      {...SHARED_CONFIG}
      project={projectConfig}
      showDirty={false}
      eventDragFeature
      eventRenderer={eventRenderer}
      onEventDrop={onEventDrop}
    />
  );
}
