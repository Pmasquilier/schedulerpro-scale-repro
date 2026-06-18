// Tiny live perf store: a useSyncExternalStore (subscribe, getSnapshot) pair plus imperative
// timing marks the schedulers call around load / reconcile.

export interface PerfSnapshot {
  /** Trigger of load() -> first complete paint of the visible rows. */
  mountMs: number | null;
  /** eventDrop -> repaint with server truth. */
  reconcileMs: number | null;
  /** EventModels currently materialised in the engine (eventStore.count). */
  eventModels: number;
  /** Total events in the dataset (the non-lazy engine pays for all of them). */
  totalEvents: number;
}

let snapshot: PerfSnapshot = { mountMs: null, reconcileMs: null, eventModels: 0, totalEvents: 0 };
const listeners = new Set<() => void>();

function set(patch: Partial<PerfSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

let mountStart = 0;
let reconcileStart = 0;

export const perfMeter = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): PerfSnapshot {
    return snapshot;
  },

  /** Called when the size/route changes, before a fresh mount. */
  reset(totalEvents: number): void {
    set({ mountMs: null, reconcileMs: null, eventModels: 0, totalEvents });
  },
  setEventModels(n: number): void {
    if (n !== snapshot.eventModels) set({ eventModels: n });
  },

  startMount(): void {
    mountStart = performance.now();
  },
  /**
   * `at` is the timestamp of the LAST paint (from afterRenderSettled), not "now" — so the quiet
   * window we waited out isn't counted into the metric. Defaults to now for callers that still
   * use a frame proxy.
   */
  endMount(at: number = performance.now()): void {
    set({ mountMs: Math.round(at - mountStart) });
  },

  startReconcile(): void {
    reconcileStart = performance.now();
  },
  endReconcile(): void {
    set({ reconcileMs: Math.round(performance.now() - reconcileStart) });
  },
};

/**
 * Resolves on the frame AFTER the next paint — a proxy for "a frame flushed". Used only to poll
 * for the widget instance to exist; NOT a measure of "everything painted" (see afterRenderSettled).
 */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export interface SettleOptions {
  /** No DOM mutation for this long ⇒ the scheduler is considered painted. */
  quietMs?: number;
  /** Hard cap, so a never-quiet view still resolves. */
  timeoutMs?: number;
  /**
   * While this returns true, the quiet window is held open even with no mutations — covers the
   * lazy gap where the DOM is idle only because a windowed fetch is still in flight (latency).
   */
  isBusy?: () => boolean;
}

/**
 * Resolves when `root`'s subtree stops mutating for `quietMs` — the real "everything visible has
 * painted" signal, since Scheduler Pro commits rows/event bars asynchronously across frames (and,
 * in lazy mode, across network round-trips) with no public "done" event.
 *
 * Returns the timestamp of the LAST observed mutation (the true last paint), NOT the resolve time,
 * so the trailing quiet window is excluded from the measurement.
 */
export function afterRenderSettled(
  root: Element,
  { quietMs = 200, timeoutMs = 15000, isBusy }: SettleOptions = {},
): Promise<number> {
  return new Promise((resolve) => {
    let lastChange = performance.now();
    let quietTimer = 0;
    let hardTimer = 0;

    const finish = () => {
      window.clearTimeout(quietTimer);
      window.clearTimeout(hardTimer);
      observer.disconnect();
      resolve(lastChange);
    };

    const armQuietTimer = () => {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(() => {
        // Idle, but a windowed fetch is still pending: re-poll instead of declaring done.
        if (isBusy?.()) {
          armQuietTimer();
          return;
        }
        finish();
      }, quietMs);
    };

    const observer = new MutationObserver(() => {
      lastChange = performance.now();
      armQuietTimer();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });

    armQuietTimer();
    hardTimer = window.setTimeout(finish, timeoutMs);
  });
}
