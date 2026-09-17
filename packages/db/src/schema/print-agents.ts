import { unique } from "drizzle-orm/pg-core";
import { flag, id, label, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * An approved local print worker. Its bearer secret stays in the worker; the database holds only a
 * scrypt hash. Revocation retains the identity referenced by print-job claims while denying further
 * authentication. The app role has SELECT/INSERT/UPDATE only (0001_db_baseline_sql.sql).
 */
export const printAgents = table(
  "print_agents",
  {
    id: id("id").primaryKey().defaultRandom(),
    // The venue the agent lives in — a required scope. A DIRECT location_id →
    // locations.id FK with onDelete restrict, the `shifts`/`devices` shape (§2a).
    locationId: id("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    // The human label ("Cocina USB"), shown in the Impresoras management surface.
    name: label("name").notNull(),
    // Reported by the agent after authentication; independent of its editable display name.
    host: label("host"),
    // The node that enrolled this agent over loopback (on-node auto-enrolment design §3), or NULL when
    // a human enrolled it through knock-and-accept (a till, a Pi). NO FK to `nodes`: the primary holds
    // no `nodes` row for a mirror (it endorses the mirror's key and stores nothing — mirror-bundle.ts),
    // so a FK would reject the very mirror self-enrol the follow-up (spec §7) exists to serve. Bare
    // column, reason recorded here per CLAUDE.md §3.
    nodeId: id("node_id"),
    // scrypt hash of the agent token (hashSecret, secret-hash.ts). Never the plaintext token.
    tokenHash: label("token_hash").notNull(),
    // Authentication refuses revoked agents.
    active: flag("active").notNull().default(true),
    // Touched by requireAgent on each authenticated pull/report. NULL until the agent is first seen.
    lastSeenAt: tsString("last_seen_at"),
    enrolledAt: tsString("enrolled_at").notNull().defaultNow(),
  },
  (t) => [
    // Target of the print_jobs.claimed_by foreign key.
    // At most one self-enrolled agent per node. Postgres treats NULLs as DISTINCT by default, so the
    // many manual (NULL) agents are unconstrained; only non-NULL node_ids are deduplicated.
    unique("print_agents_tenant_node_key").on(t.nodeId),
  ],
);
