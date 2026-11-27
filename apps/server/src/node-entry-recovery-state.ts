import { errnoOf } from "./errno.js";
import { codeOf } from "@waitron/server-kit";
import { fullDiskFailure } from "./boot-failure.js";
import type { EntryDeps } from "./node-entry-deps.js";
import { withRecoveryLock } from "./recovery-lock.js";
import { type RecoveryState, updateRecoveryState } from "./recovery-state.js";
import { lowestFreeBytes } from "./start-space.js";

/**
 * One change to `recovery.json`, read and written under the recovery lock, so no change is computed
 * from a count read before another process wrote.
 */
export function changeState(
  deps: EntryDeps,
  change: (current: RecoveryState) => RecoveryState,
): Promise<{ before: RecoveryState; after: RecoveryState }> {
  return updateRecoveryState(
    {
      lock: deps.withRecoveryLock ?? withRecoveryLock,
      read: deps.readRecoveryState,
      write: deps.writeRecoveryState,
    },
    deps.stateDir,
    change,
  );
}
/**
 * Persist the escalation state, logging a write failure rather than letting it become the outcome:
 * on the failure path the boot's own error is what matters, and in the stayed-up callback a
 * floating rejection would kill a healthy server. The pre-boot counter, and the write-back before
 * it, are the writes not routed through here, and are allowed to throw: a box whose count cannot be
 * written can never escalate. A full disk found below the free-space floor serves the page instead
 * (`countWritable`).
 */
export async function persistState(
  deps: EntryDeps,
  change: (current: RecoveryState) => RecoveryState,
): Promise<void> {
  try {
    await changeState(deps, change);
  } catch (error) {
    deps.log("warn", "recovery.state_write_failed", {
      errorCode: codeOf(error),
      errno: errnoOf(error) ?? null,
    });
  }
}
export type CountCheck = { written: true } | { written: false; freeBytes: number | null };
/**
 * Writes `recovery.json` back unchanged through the count's own path. Only a failure a full disk
 * explains, judged on free space read after it, is answered; any other is thrown.
 */
export async function countWritable(deps: EntryDeps): Promise<CountCheck> {
  try {
    await changeState(deps, (current) => current);
    return { written: true };
  } catch (error) {
    deps.log("warn", "recovery.state_write_failed", {
      errorCode: codeOf(error),
      errno: errnoOf(error) ?? null,
    });
    const freeBytes = await lowestFreeBytes([deps.stateDir, deps.venueDir], deps.statfs);
    if (fullDiskFailure(error, freeBytes)) return { written: false, freeBytes };
    throw error;
  }
}
