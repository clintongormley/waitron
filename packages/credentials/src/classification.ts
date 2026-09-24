import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LOCAL =
  "sealed under the key ring of the node that wrote it, so only that node opens a row; in venue.db like every table, and once slice-2 spec §3.1 lands a rebuild will bring the same node's key back with it. Not keyed by node id: slice 3 moves the vault to a venue key (§3.3)";

/**
 * A stored secret belongs to the node that sealed it: the blob is sealed under that node's own key
 * ring, so another node's read fails with `credentials.decrypt_failed`, never a wrong value.
 */
export const CREDENTIALS_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("tenant_credentials", "local", LOCAL),
];
