import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LOCAL =
  "per-node vault: membership.node_key is shared and its purpose key collides across nodes; each node seals under its own ring (step-4 plan, derived fact 2)";

/**
 * Credentials' tables, classified for native replication (swap spec §2.1). Stored secrets are
 * per-NODE, never replicated: a blob is sealed under the writing node's own box-key ring, so a copy
 * cannot be opened on another node (GCM auth fails), and both nodes hold the same
 * `"membership.node_key"` primary key, which would collide on copy.
 * Completeness against credentials' migrations is guarded by `classification.test.ts`.
 */
export const CREDENTIALS_CLASSIFICATION: readonly ClassifiedTable[] = [
  // local (1) — the stored credentials; written and read only on the node that sealed them.
  classify("tenant_credentials", "local", LOCAL),
];
