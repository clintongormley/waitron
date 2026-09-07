import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

/**
 * Scheduler's tables, classified for native replication (swap spec §2.1). A scheduled-run record is
 * this node's own bookkeeping of which periodic duties it has fired; the primary owns its own
 * schedule, so it is neither copied to a standby nor drained back. Completeness against scheduler's
 * migrations is guarded by `classification.test.ts`.
 */
export const SCHEDULER_CLASSIFICATION: readonly ClassifiedTable[] = [
  // local (1) — this node's own record of the periodic duties it has run; not copied.
  classify("scheduled_runs", "local", "this node's own scheduled-run bookkeeping; not copied"),
];
