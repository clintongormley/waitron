import { unique } from "drizzle-orm/sqlite-core";
import { id, json, label, newId, nowIso, table, tsString } from "./columns.js";

/**
 * A reusable layout canvas; a device profile points at one by its `id`.
 *
 * `definition` deliberately carries no `@waitron/layouts` type: that package depends on this one,
 * so importing its types here would be a cycle. `@waitron/layouts` validates it on write.
 */
export const canvases = table(
  "canvases",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    definition: json("definition").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [unique("canvases_tenant_name_key").on(t.name)],
);
