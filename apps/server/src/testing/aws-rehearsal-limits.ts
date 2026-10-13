// Apart from aws-rehearsal.ts because Vitest loads the rehearsal config with Node's own loader,
// which refused @waitron/stream's `.js` imports of its TypeScript sources (ERR_MODULE_NOT_FOUND).
export const AWS_REHEARSAL_LIMITS = {
  archiveBytes: 32 * 1024 * 1024,
  deleteObjects: 1005,
  uploadedBytes: 128 * 1024 * 1024,
  denialControlMs: 60_000,
  teardownMs: 120_000,
} as const;

/** The plan's upload-plus-retention and restore-transfer budget; a scenario may pass its own. */
export const AWS_REHEARSAL_SCENARIO_DEADLINE_MS = 15 * 60_000;

/** Room in a test's time limit for building fixtures before its scenario deadline starts. */
export const AWS_REHEARSAL_SETUP_MARGIN_MS = 5 * 60_000;

/** How long a scenario whose signal the deadline aborted may take to stop before teardown starts. */
export const AWS_REHEARSAL_SETTLE_MS = 60_000;
