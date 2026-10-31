import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { id, label, now, table, ts } from "@waitron/db";

/** This box's role, keyed by its own node id. */
export const nodeMode = table(
  "node_mode",
  {
    nodeId: id("node_id").primaryKey(),
    // `primary` writes and originates; a `mirror` serves read-only.
    mode: label("mode").$type<"primary" | "mirror">().notNull().default("primary"),
    // Orthogonal to `mode`: `primary` holds the venue's singleton duties (AEAT submitter and
    // reconciler), `secondary` sells only.
    singletonRole: label("singleton_role")
      .$type<"primary" | "secondary">()
      .notNull()
      .default("primary"),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [
    check("node_mode_mode_ck", sql`${t.mode} in ('primary', 'mirror')`),
    check("node_mode_singleton_role_ck", sql`${t.singletonRole} in ('primary', 'secondary')`),
    check(
      "node_mode_role_valid_ck",
      sql`not (${t.mode} = 'mirror' and ${t.singletonRole} = 'primary')`,
    ),
  ],
  /* v8 ignore stop */
);
