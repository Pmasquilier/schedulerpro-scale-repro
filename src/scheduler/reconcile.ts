// Three-way set-diff RESTRICTED to the impacted resource rows, classifying each event by
// presence (which side) then by row (does its resource still match).

export interface DiffableEvent {
  id: string;
  resourceId: number;
}

export interface RowDiff<T extends DiffableEvent> {
  added: T[];
  updated: T[];
  removedIds: string[];
}

export function diffEventRows<T extends DiffableEvent>(params: {
  currentEvents: DiffableEvent[];
  freshEvents: T[];
  impactedResourceIds: number[];
}): RowDiff<T> {
  const { currentEvents, freshEvents, impactedResourceIds } = params;
  const impacted = new Set(impactedResourceIds);

  const currentInScope = currentEvents.filter((e) => impacted.has(e.resourceId));
  const freshInScope = freshEvents.filter((e) => impacted.has(e.resourceId));

  const currentById = new Map(currentInScope.map((e) => [e.id, e] as const));
  const freshById = new Map(freshInScope.map((e) => [e.id, e] as const));

  // id only in fresh -> added (a new event / recurring slice with a new id).
  const added = freshInScope.filter((e) => !currentById.has(e.id));

  // id on BOTH sides AND same row -> updated (no blink, just new placement/data).
  // If the rows DISAGREE (a lagging read mid-gesture), the id lands in NO bucket and is
  // left exactly as painted — this is what keeps optimistic truth from being clobbered.
  const updated = freshInScope.filter((e) => currentById.get(e.id)?.resourceId === e.resourceId);

  // id only in current -> removed. Computed for completeness, but the move path discards it: a
  // move never changes an id, and a read-after-write lag must not delete a shift we're keeping.
  const removedIds = currentInScope.filter((e) => !freshById.has(e.id)).map((e) => e.id);

  return { added, updated, removedIds };
}
