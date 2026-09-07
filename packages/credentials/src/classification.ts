import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LOCAL =
  "box-key sealed: a row sealed under one node's vault key is undecryptable on any other node " +
  "(purposes.ts), so these rows are per-node identity/config, never replicated; a standby's secrets " +
  "are re-sealed under its own key at adopt (sync.mirror_token; fiscal.aeat.dormant), never copied.";

/**
 * Credentials' tables, classified for native replication (swap spec §2.1).
 * Completeness against credentials' migrations is guarded by `classification.test.ts`.
 */
export const CREDENTIALS_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("tenant_credentials", "local", LOCAL),
];
