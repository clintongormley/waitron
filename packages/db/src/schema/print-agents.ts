import { unique } from "drizzle-orm/sqlite-core";
import { flag, id, label, newId, nowIso, table, tsString } from "./columns.js";
import { locations } from "./tenants.js";

/**
 * An approved local print worker. Its bearer secret stays in the worker; the database holds only a
 * scrypt hash. Revocation retains the identity referenced by print-job claims while denying further
 * authentication.
 */
export const printAgents = table(
  "print_agents",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id")
      .notNull()
      /* v8 ignore start */
      .references(() => locations.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    name: label("name").notNull(),
    // Reported by the agent after authentication; independent of its editable display name.
    host: label("host"),
    // The node that enrolled this agent over loopback, or NULL when a human enrolled it. NO FK to
    // `nodes`: the primary holds no `nodes` row for a mirror (mirror-bundle.ts), so a FK would
    // reject a mirror's self-enrolment.
    nodeId: id("node_id"),
    tokenHash: label("token_hash").notNull(),
    active: flag("active").notNull().default(true),
    lastSeenAt: tsString("last_seen_at"),
    enrolledAt: tsString("enrolled_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // At most one self-enrolled agent per node; NULLs are distinct, so manual agents are unconstrained.
    unique("print_agents_tenant_node_key").on(t.nodeId),
  ],
);
