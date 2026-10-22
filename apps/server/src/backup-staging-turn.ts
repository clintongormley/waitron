/** One holder at a time over `<state>/backup-staging` in this process: backup runs, and the
 * free-space deletions. A page's survey never takes it. */
export interface StagingTurn {
  /** A backup run: waits for the holder before it (a deletion or an earlier run), then holds the
   * turn until `work` settles. Runs go in the order they asked. */
  runBackup<T>(work: () => Promise<T>): Promise<T>;
  /** A free-space deletion: never waits for a backup run. When a backup run holds the turn or is
   * waiting for it, answers `{ ran: false }` at once, without running `work`; otherwise holds the
   * turn for `work` (after a deletion already holding it, if any), so no run starts meanwhile. */
  ifNoBackup<T>(work: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>;
  /** True only while a backup run holds the turn — not while one waits. */
  backupRunning(): boolean;
}

export function createStagingTurn(): StagingTurn {
  let tail: Promise<void> = Promise.resolve();
  // Runs holding or waiting for the turn: a deletion asked while one waits would otherwise queue
  // behind it.
  let runsAsked = 0;
  let running = false;

  const join = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  return {
    async runBackup(work) {
      runsAsked += 1;
      try {
        return await join(async () => {
          running = true;
          try {
            return await work();
          } finally {
            running = false;
          }
        });
      } finally {
        runsAsked -= 1;
      }
    },
    async ifNoBackup(work) {
      if (runsAsked > 0) return { ran: false };
      return { ran: true, value: await join(work) };
    },
    backupRunning: () => running,
  };
}
