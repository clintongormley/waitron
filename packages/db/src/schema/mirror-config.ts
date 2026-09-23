import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, id, label, now, table, ts } from "./columns.js";

/**
 * The cloud mirror's connection config (sync cloud-mirror C2b). A whole-database operational
 * singleton, like `deployment`. Non-secret parts only (the per-peer sync token
 * lives in the credentials vault, never here).
 * Its accessors are exported from the package barrel (`../index.ts`, via `../mirror-config.ts`).
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as ./sales.ts.
export const mirrorConfig = table(
  "mirror_config",
  {
    id: count("id").primaryKey().notNull().default(1),
    relayUrl: label("relay_url").notNull(),
    boxHostname: label("box_hostname").notNull(),
    boxCaPem: label("box_ca_pem").notNull(),
    // The nodeId of the PRIMARY this mirror was adopted from — its ORIGIN, distinct from this node's
    // OWN identity (config.till.nodeId). Split out here (membership R3a) so the mirror can run under its
    // own id while its node-scoped reads resolve against the primary's, which is the id the venue's
    // rows carry (boot.ts's `dataNodeId`). Written
    // owner-role at adopt = designated.nodeId (the primary's). NOT NULL: every mirror has exactly one
    // origin; the table is empty until adopt, so the ADD COLUMN NOT NULL is safe pre-production.
    originNodeId: id("origin_node_id").notNull(),
    adoptedAt: ts("adopted_at").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [check("mirror_config_singleton_ck", sql`${t.id} = 1`)],
  /* v8 ignore stop */
);
