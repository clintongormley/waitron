import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The cloud mirror's connection config (sync cloud-mirror C2b). A whole-database operational
 * singleton — NO tenant_id, NO RLS — like `deployment`. Non-secret parts only (the per-peer sync
 * token lives in the credentials vault, never here).
 *
 * Deliberately NOT re-exported from `./schema/index.ts` (the barrel `drizzle.config.ts` reads and
 * `client.ts` derives its `Schema` type from), for the same reason `deployment.ts` is kept out of
 * it: `0072_mirror_config.sql` is a hand-written custom migration, so drizzle-kit never diffed this
 * table into any `drizzle/meta/*.json` snapshot. Adding it to the schema barrel would make
 * drizzle-kit aware of a table its snapshot chain has never recorded, and the next plain
 * (non-`--custom`) `drizzle-kit generate` could then emit a second `CREATE TABLE "mirror_config"`
 * that fails against any database that already ran 0071. The accessors are exported from the
 * package barrel (`../index.ts`, via `../mirror-config.ts`); that surface is unaffected.
 */
export const mirrorConfig = pgTable("mirror_config", {
  id: integer("id").primaryKey().notNull().default(1),
  relayUrl: text("relay_url").notNull(),
  boxHostname: text("box_hostname").notNull(),
  boxCaPem: text("box_ca_pem").notNull(),
  adoptedAt: timestamp("adopted_at", { withTimezone: true }).notNull().defaultNow(),
});
