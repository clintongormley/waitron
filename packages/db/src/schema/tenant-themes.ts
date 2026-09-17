import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { count, json, table, tsString } from "./columns.js";

/**
 * The owner-authored base THEME (design §4, SP-A.2 §16.3).
 *
 * ONE ROW: `id` is pinned to 1 by `tenant_themes_singleton_ck`, the `deployment` / `mirror_config` /
 * `node_membership` shape in this package, and that id doubles as the `ON CONFLICT` target the
 * service upserts against. A database whose owner has never picked a theme simply has no row —
 * get-with-default returns "no override" rather than seeding one (no backfill; the database is
 * recreated pre-production, CLAUDE.md §5).
 *
 * `theme` is PLAIN jsonb, deliberately carrying no `@waitron/layouts` type:
 * `@waitron/layouts` depends on `@waitron/db`, so importing its types here would be a circular
 * dependency. The service validates the shape on write; the database stores opaque jsonb. Same
 * rationale — and same precedent — as `canvases` (canvases.ts).
 */
export const tenantThemes = table(
  "tenant_themes",
  {
    id: count("id").primaryKey().notNull().default(1),
    theme: json("theme").notNull(),
    // Timestamp: `tsString` follows the `devices` precedent (devices.ts) — an inert Drizzle
    // read-type choice, not a column-type difference; the "same precedent" note above is about the
    // jsonb decision only, not this column.
    updatedAt: tsString("updated_at").notNull().defaultNow(),
  },
  (t) => [check("tenant_themes_singleton_ck", sql`${t.id} = 1`)],
);
