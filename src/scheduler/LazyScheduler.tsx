import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { BryntumSchedulerPro } from '@bryntum/schedulerpro-react';
import type { Model, SchedulerEventModel } from '@bryntum/schedulerpro';
import type { DateRange, Engine, Insight, Resource, ShiftEvent } from '../types';
import { useLazyLoad } from './useLazyLoad';
import { SchedulerView } from './SchedulerView';
import { settleEngine } from './settleEngine';
import { SHARED_CONFIG, createEventRenderer } from './SchedulerConfig';
import { asChangesetStore, resolveStashedEvent, toStoreDatum } from './bryntumTypes';
import { diffEventRows } from './reconcile';
import { afterNextPaint, afterRenderSettled, perfMeter } from './perfMeter';

export interface MoveInput {
  id: string;
  startDate: string;
  endDate: string;
  resourceId: number;
}

export interface LazySchedulerProps {
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

export function LazyScheduler(props: LazySchedulerProps) {
  const { engine, resources, month } = props;
  const schedulerRef = useRef<BryntumSchedulerPro>(null);

  // Always-fresh props for the stable callbacks/config below.
  const latestProps = useRef(props);
  latestProps.current = props;

  const projectConfig = useLazyLoad({ schedulerRef, resources, fetchEvents: props.fetchEvents });

  // ---- Mount measurement (the hook is pure config; we own the ref, so we measure here) ----
  // load() brings in the ROWS; their event windows paint later (lazy cascade + Pro engine). We
  // stay "busy" until at least one event bar actually exists in the DOM — not just until the data
  // lands in the store (count > 0 fires seconds before the Pro engine paints), otherwise the
  // quiet-period detector concludes in that gap and under-reports the true paint time.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let instance = schedulerRef.current?.instance;
      // React.lazy: the instance isn't mounted on the first commit — poll a few frames for it.
      for (let i = 0; i < 60 && !instance; i++) {
        await afterNextPaint();
        instance = schedulerRef.current?.instance;
      }
      if (cancelled || !instance) return;
      const { element, eventStore } = instance;
      perfMeter.startMount();
      try {
        await instance.resourceStore.load();
        const painted = () => element.querySelector('.b-sch-event-wrap') != null;
        const paintedAt = await afterRenderSettled(element, {
          isBusy: () => !painted() || Boolean(eventStore.isLoading),
        });
        if (cancelled) return;
        perfMeter.endMount(paintedAt);
        perfMeter.setEventModels(eventStore.count);
      } catch (e: unknown) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resources]);

  // ---- Insights overlay (volatile, off the load path) ----
  const insightsRef = useRef<Map<string, string>>(new Map());
  const getCls = useCallback((eventId: string) => insightsRef.current.get(eventId), []);
  const eventRenderer = useMemo(() => createEventRenderer(getCls), [getCls]);

  const refreshInsights = useCallback(async () => {
    const employeeIds = latestProps.current.resources.map((r) => r.id);
    const insights = await latestProps.current.fetchInsights(employeeIds);
    const map = new Map<string, string>();
    insights.forEach((i) => map.set(i.eventId, i.cls));
    insightsRef.current = map;

    const instance = schedulerRef.current?.instance;
    if (!instance) return;

    // The lazy pitfall: an insight can target an unloaded row, so getById returns null at
    // runtime (despite its non-null type). The renderer applies the class on scroll-in instead.
    let unloaded = 0;
    insightsRef.current.forEach((_cls, id) => {
      if ((instance.eventStore.getById(id) as Model | null) == null) unloaded++;
    });
    if (unloaded > 0) {
      console.info(
        `[insights] ${unloaded} insight target(s) point to rows not yet loaded (getById === null) — handled, painted lazily.`,
      );
    }

    // refreshResources is the ONLY repaint that re-invokes the event renderer (refresh()/
    // refreshRows() skip it -> stale badge). Virtualized: only visible bars repaint.
    instance.refreshResources(instance.resourceStore.records as Parameters<typeof instance.refreshResources>[0]);
  }, []);

  useEffect(() => {
    void refreshInsights();
    // re-fetch the overlay when the resource set (size) changes
  }, [refreshInsights, resources]);

  // ---- Date axis: atomic setTimeSpan (end exclusive, +1 day) ----
  useEffect(() => {
    const instance = schedulerRef.current?.instance;
    if (!instance) return;
    const start = new Date(month.start);
    const end = addDays(new Date(month.end), 1);
    const result = instance.setTimeSpan(start, end);
    if (result instanceof Promise) result.catch((e: unknown) => console.error(e));
  }, [month.start, month.end]);

  // ---- Move + targeted reconcile (the core) ----
  const onEventDrop = useCallback(({ eventRecords }: { eventRecords: SchedulerEventModel[] }) => {
    const instance = schedulerRef.current?.instance;
    if (!instance) return;
    const { project } = instance;

    // Snapshot the pre-gesture placement from the stashed event, not the live record (the drag
    // already mutated the engine). This per-gesture snapshot is what isolates concurrent drags.
    const preGesturePlacements = eventRecords.map((record) => {
      const ev = resolveStashedEvent(record);
      return { record, resourceId: ev.resourceId, startDate: ev.startDate, endDate: ev.endDate };
    });

    const impactedResourceIds = [
      ...new Set([
        ...preGesturePlacements.map((p) => p.resourceId),
        ...eventRecords.map((r) => Number(r.resource.id)),
      ]),
    ].filter((id) => !Number.isNaN(id));

    const movedIds = new Set(eventRecords.map((r) => String(r.id)));

    const commit = () => settleEngine(latestProps.current.engine, project);

    const revert = async () => {
      const { eventStore } = project;
      for (const p of preGesturePlacements) {
        // A mid-flight reload may have detached this record (record.resource.id would throw). Skip.
        if (eventStore.getById(p.record.id) !== p.record) continue;
        if (String(p.record.resource.id) !== String(p.resourceId)) {
          // reassign, NOT set({ resourceId }) — the latter corrupts the Pro scheduling engine.
          p.record.reassign(p.record.resource, p.resourceId);
        }
        p.record.set({ startDate: new Date(p.startDate), endDate: new Date(p.endDate) });
      }
      await settleEngine(latestProps.current.engine, project);
    };

    const persistAndReconcile = async () => {
      const { eventStore } = project;

      // 1) Persist each moved placement (engine truth = record.resource.id; the data field lags).
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

      // 2) Reconcile: re-fetch ONLY the impacted resource ids and diff against the live records.
      const freshEvents = await latestProps.current.fetchEvents(impactedResourceIds);
      const currentEvents = (eventStore.records as SchedulerEventModel[])
        .filter((r) => impactedResourceIds.includes(Number(r.resource.id)))
        .map((r) => ({ id: String(r.id), resourceId: Number(r.resource.id) }));

      const { added, updated } = diffEventRows({
        currentEvents,
        freshEvents,
        impactedResourceIds,
      });

      // Apply server truth ONLY for events THIS gesture moved; bystanders keep their optimistic
      // truth. removed: [] always — a move never changes an id, so a lagging re-fetch can't delete.
      const isGestureEvent = (e: { id: string }) => movedIds.has(e.id);
      asChangesetStore(eventStore).applyChangeset({
        added: added.filter(isGestureEvent).map(toStoreDatum),
        updated: updated.filter(isGestureEvent).map(toStoreDatum),
        removed: [],
      });
      await settleEngine(latestProps.current.engine, project);

      perfMeter.setEventModels(asChangesetStore(eventStore).count);
      await refreshInsights();
    };

    // Drive the optimistic cycle DETACHED — Bryntum must never await our persistence (it would
    // block the drag). Robustness comes from per-gesture isolation, not from a gate that waits.
    perfMeter.startReconcile();
    void (async () => {
      try {
        await persistAndReconcile();
        await commit();
      } catch (e) {
        console.error(e);
        await revert();
      } finally {
        perfMeter.endReconcile();
      }
    })();
  }, [refreshInsights]);

  return (
    <SchedulerView
      engine={engine}
      schedulerRef={schedulerRef}
      {...SHARED_CONFIG}
      project={projectConfig}
      eventDragFeature
      eventRenderer={eventRenderer}
      onEventDrop={onEventDrop}
    />
  );
}
