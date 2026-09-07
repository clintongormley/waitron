import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

// The four tables of the current application-layer outbox. They are the OUTBOX MECHANISM itself, not
// domain data: they are NOT native-replicated, and swap step 4 deletes them once native logical
// replication carries the ledger/state publications. Classified `local` so the derivation puts them
// on neither publication.
const OUTBOX =
  "the outbox mechanism itself; not native-replicated, deleted in swap step 4; not copied";

/**
 * Sync's own tables, classified for native replication (swap spec §2.1). Every one is part of the
 * application-layer outbox that native replication replaces, so all four are `local`: on neither
 * publication, and removed in swap step 4. Completeness against sync's migrations is guarded by
 * `classification.test.ts`.
 */
export const SYNC_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("sync_log", "local", OUTBOX),
  classify("sync_cursor", "local", OUTBOX),
  classify("sync_peers", "local", OUTBOX),
  classify("sync_config_conflicts", "local", OUTBOX),
];
