import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, json, nowIso, table, tsString } from "./columns.js";

/**
 * The owner-authored base theme. ONE ROW: `id` is pinned to 1 by `tenant_themes_singleton_ck`, and
 * that id is the upsert's conflict target. An owner who has never picked a theme has no row.
 *
 * `theme` deliberately carries no `@waitron/layouts` type, for the reason `canvases` gives.
 */
export const tenantThemes = table(
  "tenant_themes",
  {
    id: count("id").primaryKey().notNull().default(1),
    theme: json("theme").notNull(),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [check("tenant_themes_singleton_ck", sql`${t.id} = 1`)],
);
