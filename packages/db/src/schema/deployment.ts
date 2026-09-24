import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, label, now, table, ts } from "./columns.js";

/**
 * The environment this database was stamped for — one row, `id` pinned to 1 by
 * `deployment_singleton_ck`. It belongs to the DATABASE, not to a node: one database per environment
 * (CLAUDE.md §5), whichever node reads it. A node's own role is on `node_roles`.
 * Its accessors are exported from the package's own public barrel (`../index.ts`).
 */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as ./sales.ts.
export const deployment = table(
  "deployment",
  {
    id: count("id").primaryKey(),
    environment: label("environment").notNull(),
    stampedAt: ts("stamped_at").notNull().$defaultFn(now),
  },
  /* v8 ignore start */
  (t) => [
    check("deployment_singleton_ck", sql`${t.id} = 1`),
    check("deployment_environment_ck", sql`${t.environment} in ('production', 'preproduction')`),
  ],
  /* v8 ignore stop */
);
