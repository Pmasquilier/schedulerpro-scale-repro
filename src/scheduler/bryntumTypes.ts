import type { Store } from '@bryntum/schedulerpro';
import type { ShiftEvent } from '../types';

/** Minimal record shape we read — avoids coupling to a specific (Scheduler vs Pro) model class. */
interface ReadableRecord {
  id: string | number;
  getData(fieldName: string): unknown;
}

// Each datum spreads the typed event (so Bryntum reads native startDate/resourceId/…) AND
// stashes the whole event under `event` for O(1) read-back via record.get.
export interface StoreDatum extends ShiftEvent {
  event: ShiftEvent;
}

export const toStoreDatum = (e: ShiftEvent): StoreDatum => ({ ...e, event: e });

/** Reads the stashed typed event off a record (the loaded "props" truth). */
export function resolveStashedEvent(record: ReadableRecord): ShiftEvent {
  const stashed = record.getData('event') as ShiftEvent | undefined;
  if (!stashed) {
    throw new Error(`Event record ${String(record.id)} is missing its stashed payload`);
  }
  return stashed;
}

// applyChangeset lives on the StoreChanges mixin; narrow to the exact call we make.
export interface ChangesetStore {
  applyChangeset(changeset: {
    added: object[];
    updated: object[];
    removed: { id: string }[];
  }): void;
  count: number;
}

export const asChangesetStore = (store: Store): ChangesetStore =>
  store as unknown as ChangesetStore;
