// Apart from aws-rehearsal.ts because Vitest loads the rehearsal config with Node's own loader,
// which refused @waitron/stream's `.js` imports of its TypeScript sources (ERR_MODULE_NOT_FOUND).
export const AWS_REHEARSAL_LIMITS = {
  archiveBytes: 32 * 1024 * 1024,
  deleteObjects: 1005,
  uploadedBytes: 128 * 1024 * 1024,
  denialControlMs: 60_000,
  teardownMs: 120_000,
} as const;

/**
 * How long a rehearsal runs, from creating its bucket to the end of its scenario, before the runner
 * tells it to stop.
 */
export const AWS_REHEARSAL_SCENARIO_DEADLINE_MS = 15 * 60_000;

/** Room in a test's or hook's time limit for its own work outside the runner's budgets. */
export const AWS_REHEARSAL_SETUP_MARGIN_MS = 5 * 60_000;

/** How long a scenario whose signal the deadline aborted may take to stop before teardown starts. */
export const AWS_REHEARSAL_SETTLE_MS = 60_000;

/**
 * How long an outside stop waits for a run to settle, tear down and write its receipt: the settling
 * grace, the teardown budget and half a minute for the receipt.
 */
export const AWS_REHEARSAL_STOP_WAIT_MS =
  AWS_REHEARSAL_SETTLE_MS + AWS_REHEARSAL_LIMITS.teardownMs + 30_000;
