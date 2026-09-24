import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

/**
 * Scheduler's tables. A scheduled-run record is the venue's record of which periodic duty ran for
 * which period. Only the primary runs duties, and a node that takes over reads the same record, so a
 * pending re-sweep or a failed period the previous primary left is still picked up. Completeness
 * against scheduler's migrations is guarded by `classification.test.ts`.
 */
export const SCHEDULER_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify(
    "scheduled_runs",
    "state",
    "the venue's record of which duty ran for which period; a node that takes over continues it",
  ),
];
