import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * Workforce-ES's tables, classified for native replication (swap spec §2.1). The collective-agreement
 * configuration is manager-set data a standby holds but never sends back. Completeness against this
 * module's migrations is guarded by `classification.test.ts`.
 */
export const WORKFORCE_ES_CLASSIFICATION: readonly ClassifiedTable[] = [
  // state (1) — the venue's convenio configuration; copied to a standby, never drained back.
  classify("convenio_config", "state", STATE),
];
