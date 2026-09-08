import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LOCAL =
  "per-node vault: membership.node_key is shared and (tenant_id, purpose) collides across nodes; each node seals under its own ring (step-4 plan, derived fact 2)";

/**
 * Credentials' tables, classified for native replication (swap spec §2.1). A tenant's stored secrets
 * are per-NODE, never replicated: a blob is sealed under the writing node's own box-key ring, so a
 * copy cannot be opened on another node (GCM auth fails), and both nodes hold the same
 * `(tenant_id, "membership.node_key")` PK, which would collide on copy.
 * Completeness against credentials' migrations is guarded by `classification.test.ts`.
 */
export const CREDENTIALS_CLASSIFICATION: readonly ClassifiedTable[] = [
  // local (1) — the tenant's stored credentials; written and read only on the node that sealed them.
  classify("tenant_credentials", "local", LOCAL),
];
