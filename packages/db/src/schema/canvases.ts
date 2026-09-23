import { unique } from "drizzle-orm/sqlite-core";
import { id, json, label, newId, nowIso, table, tsString } from "./columns.js";

/**
 * A reusable layout CANVAS (design §4, SP-A.2 §16.3). MANY per database, keyed by `name` — a device
 * (Task 8) points at one by its `id`, and `canvases_tenant_name_key` on `(name)` keeps the names
 * distinct.
 *
 * `definition` is PLAIN jsonb, deliberately carrying no `@waitron/layouts` type:
 * `@waitron/layouts` depends on `@waitron/db`, so importing its types here would be a circular
 * dependency. The store service validates the whole CanvasDef on write; the database stores opaque
 * jsonb. Same rationale — and same precedent — as `tenant_themes` (tenant-themes.ts).
 */
export const canvases = table(
  "canvases",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    definition: json("definition").notNull(),
    // Timestamps: `tsString` follows the `devices` precedent (devices.ts) — an inert Drizzle
    // read-type choice, not a column-type difference; the "same precedent" note above is about the
    // jsonb decision only, not these columns.
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("canvases_tenant_name_key").on(t.name), // canvas names are distinct
  ],
);
