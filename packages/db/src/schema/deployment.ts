import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One row, id pinned to 1 — see 0001_db_baseline_sql.sql for why a second row must be impossible.
 *
 * Deliberately NOT re-exported from `./schema/index.ts` (the barrel `drizzle.config.ts` reads and
 * `client.ts` derives its `Schema` type from). `0001_db_baseline_sql.sql` is hand-written —
 * drizzle-kit never diffed this table into any snapshot, so `deployment` has zero representation
 * anywhere in `drizzle/meta/*.json`. Adding this table to the schema barrel would make
 * drizzle-kit's schema aware of a table its snapshot chain has never recorded; the next plain (non-`--custom`) `drizzle-kit generate` in
 * this package would then diff the two and could emit a second `CREATE TABLE "deployment"`, which
 * fails against any database that already created `deployment`. Bringing this table into the
 * schema barrel safely requires reconciling the snapshot chain at the same time, not just adding the export.
 * `deployment` and its accessors are still exported from the package's own public barrel
 * (`../index.ts`) — that surface is unaffected by this.
 */
export const deployment = pgTable(
  "deployment",
  {
    id: integer("id").primaryKey(),
    environment: text("environment").notNull(),
    // Which role this database plays in the cloud-mirror topology (C2a design §3): a `primary`
    // writes and originates; a `mirror` pulls + applies and serves read-only. Read at runtime so a
    // later promotion needs no restart. Default 'primary' so every existing deployment is unchanged.
    mode: text("mode").notNull().default("primary"),
    // The singleton-ownership axis (promotion runbook design §2), orthogonal to `mode`: `primary` holds
    // the venue's singleton duties (AEAT submitter + reconciler), `secondary` is sell-only. Default
    // 'primary' so an existing single-node deployment stays a singleton-holder. Read at runtime so a
    // later promotion needs no restart.
    singletonRole: text("singleton_role").notNull().default("primary"),
    stampedAt: timestamp("stamped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("deployment_singleton_ck", sql`${t.id} = 1`),
    check("deployment_mode_ck", sql`${t.mode} in ('primary', 'mirror')`),
    check("deployment_singleton_role_ck", sql`${t.singletonRole} in ('primary', 'secondary')`),
    check(
      "deployment_role_valid_ck",
      sql`not (${t.mode} = 'mirror' and ${t.singletonRole} = 'primary')`,
    ),
  ],
);
