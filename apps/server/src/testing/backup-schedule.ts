import { createBackupSchedule, type BackupSweepDeps } from "../backup-sweep.js";
import { MAX_SLEEP_MS } from "../backup-schedule.js";

export async function driveSchedule(deps: BackupSweepDeps): Promise<void> {
  const schedule = createBackupSchedule(deps);
  const now = deps.now ?? (() => new Date());
  try {
    while (!deps.signal.aborted) {
      const { nextDueAt, waitMs } = await schedule.pass(now(), deps.signal);
      if (deps.signal.aborted) break;
      await deps.sleep(
        nextDueAt === null
          ? MAX_SLEEP_MS
          : Math.min(MAX_SLEEP_MS, waitMs ?? nextDueAt.getTime() - now().getTime()),
        deps.signal,
      );
    }
  } finally {
    deps.onScheduled?.(null);
  }
}
