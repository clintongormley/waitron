import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One row, id pinned to 1 — see 0010_deployment_stamp.sql for why a second row must be impossible.
 *
 * Deliberately NOT re-exported from `./schema/index.ts` (the barrel `drizzle.config.ts` reads and
 * `client.ts` derives its `Schema` type from). 0010_deployment_stamp.sql was generated
 * `--custom` — drizzle-kit never diffed this table into any snapshot, so `deployment` has zero
 * representation anywhere in `drizzle/meta/*.json` (the same shape as 0009's hand-written partial
 * index). Adding this table to the schema barrel would make drizzle-kit's schema aware of a table
 * its snapshot chain has never recorded; the next plain (non-`--custom`) `drizzle-kit generate` in
 * this package would then diff the two and could emit a second `CREATE TABLE "deployment"`, which
 * fails against any database that already ran 0010. Bringing this table into the schema barrel
 * safely requires reconciling the snapshot chain at the same time, not just adding the export.
 * `deployment` and its accessors are still exported from the package's own public barrel
 * (`../index.ts`) — that surface is unaffected by this.
 */
export const deployment = pgTable(
  "deployment",
  {
    id: integer("id").primaryKey(),
    environment: text("environment").notNull(),
    stampedAt: timestamp("stamped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("deployment_singleton_ck", sql`${t.id} = 1`)],
);
