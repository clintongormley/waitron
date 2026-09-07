import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * Credentials' tables, classified for native replication (swap spec §2.1). A tenant's stored secrets
 * are durable configuration a standby must hold to keep serving, but which it never sends back.
 * Completeness against credentials' migrations is guarded by `classification.test.ts`.
 */
export const CREDENTIALS_CLASSIFICATION: readonly ClassifiedTable[] = [
  // state (1) — the tenant's stored credentials; copied to a standby, never drained back.
  classify("tenant_credentials", "state", STATE),
];
