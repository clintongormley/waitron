import { BackupSupervisor, backupsJob, type BackupSupervisorDeps } from "../backup-supervisor.js";
import { createJobRunner } from "../job-runner.js";

export function supervisorWithJob(
  deps: BackupSupervisorDeps & { sleep?: (ms: number, signal: AbortSignal) => Promise<void> },
): BackupSupervisor {
  const runner = createJobRunner({
    now: deps.now ?? (() => new Date()),
    log: deps.log,
    subscribe: () => () => {},
    delay: deps.sleep,
  });
  let added = false;
  let stopped = false;
  const supervisor = new BackupSupervisor({
    ...deps,
    onReloaded: () => {
      deps.onReloaded?.();
      if (stopped) return;
      if (added) runner.wake("backups.scheduled");
      else {
        added = true;
        runner.add({
          ...backupsJob(supervisor, () => deps.readSingletonRole() === "primary"),
          onStop: stopSupervisor,
        });
      }
    },
  });
  const stop = supervisor.stop.bind(supervisor);
  let stopping: Promise<void> | undefined;
  const stopSupervisor = () => (stopping ??= stop());
  supervisor.stop = async () => {
    stopped = true;
    const closing = stopSupervisor();
    await runner.stopJobs();
    await closing;
  };
  return supervisor;
}
