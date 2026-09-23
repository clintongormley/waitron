import { id, label, now, table, ts } from "./columns.js";

/**
 * A cloud mirror's link to the box it was adopted from (sync cloud-mirror C2b), one row per node,
 * keyed by that node's own id. Non-secret parts only; the per-peer sync token lives in the
 * credentials vault. Every read and write names the node, so a node holding another node's copy of
 * `venue.db` never reads that node's link.
 * Its accessors are exported from the package barrel (`../index.ts`, via `../mirror-config.ts`).
 */
export const mirrorConfig = table("mirror_config", {
  // No foreign key to `nodes`, for the reason on `node_roles.node_id` (`./node-roles.ts`).
  nodeId: id("node_id").primaryKey(),
  relayUrl: label("relay_url").notNull(),
  boxHostname: label("box_hostname").notNull(),
  boxCaPem: label("box_ca_pem").notNull(),
  // The PRIMARY this mirror was adopted from — its origin, distinct from the node's own id above;
  // boot reads it into `dataNodeId` to scope the reports to the rows the venue carries.
  originNodeId: id("origin_node_id").notNull(),
  adoptedAt: ts("adopted_at").notNull().$defaultFn(now),
});
