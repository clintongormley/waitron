import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * An approved local print worker. Its bearer secret stays in the worker; the database holds only a
 * scrypt hash. Revocation retains the identity referenced by print-job claims while denying further
 * authentication. The app role has SELECT/INSERT/UPDATE only (0001_db_baseline_sql.sql).
 */
export const printAgents = pgTable(
  "print_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason devices.ts / kitchen-stations.ts use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The venue the agent lives in — a required scope, like tenant_id. A DIRECT location_id →
    // locations.id FK with onDelete restrict, the `shifts`/`devices` shape (§2a).
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    // The human label ("Cocina USB"), shown in the Impresoras management surface.
    name: text("name").notNull(),
    // Reported by the agent after authentication; independent of its editable display name.
    host: text("host"),
    // The node that enrolled this agent over loopback (on-node auto-enrolment design §3), or NULL when
    // a human enrolled it through knock-and-accept (a till, a Pi). NO FK to `nodes`: the primary holds
    // no `nodes` row for a mirror (it endorses the mirror's key and stores nothing — mirror-bundle.ts),
    // so a FK would reject the very mirror self-enrol the follow-up (spec §7) exists to serve. Bare
    // column, reason recorded here per CLAUDE.md §3.
    nodeId: uuid("node_id"),
    // scrypt hash of the agent token (hashSecret, secret-hash.ts). Never the plaintext token.
    tokenHash: text("token_hash").notNull(),
    // Authentication refuses revoked agents.
    active: boolean("active").notNull().default(true),
    // Touched by requireAgent on each authenticated pull/report. NULL until the agent is first seen.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Target of the tenant-consistent print_jobs.claimed_by foreign key.
    unique("print_agents_tenant_id_key").on(t.tenantId, t.id),
    // At most one self-enrolled agent per node. Postgres treats NULLs as DISTINCT by default, so the
    // many manual (NULL) agents are unconstrained; only non-NULL node_ids are deduplicated.
    unique("print_agents_tenant_node_key").on(t.tenantId, t.nodeId),
  ],
);
