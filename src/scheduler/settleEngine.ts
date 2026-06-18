import type { Engine } from '../types';

/** The two project methods that only the Pro constraint engine exposes. */
interface SettleableProject {
  commitAsync?: () => Promise<unknown>;
  acceptChanges?: () => void;
}

/**
 * Settle the engine after a mutation (data assignment, move, reconcile, revert).
 *
 * The **Pro** constraint engine processes changes async, leaving the view stale and records dirty
 * until told to propagate (`commitAsync`) and re-baseline (`acceptChanges`). The **plain**
 * Scheduler has no constraint engine — mutations are immediately live — so this is a no-op.
 *
 * This is the ONE place the two engines genuinely diverge; everything else stays identical.
 */
export async function settleEngine(engine: Engine, project: SettleableProject): Promise<void> {
  if (engine !== 'pro') return;
  await project.commitAsync?.();
  project.acceptChanges?.();
}
