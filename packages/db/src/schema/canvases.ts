import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * A reusable layout CANVAS (design §4, SP-A.2 §16.3). MANY per database, keyed by `name` — a device
 * (Task 8) points at one by its `id`, and `canvases_tenant_name_key` on `(name)` keeps the names
 * distinct.
 *
 * `definition` is PLAIN jsonb, deliberately NOT `.$type<>()`-annotated with the `@waitron/layouts`
 * shape: `@waitron/layouts` depends on `@waitron/db`, so importing its types here would be a circular
 * dependency. The store service validates the whole CanvasDef on write; the database stores opaque
 * jsonb. Same rationale — and same precedent — as `tenant_themes` (tenant-themes.ts).
 */
export const canvases = pgTable(
  "canvases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull(),
    // Timestamps: `mode: "string"` follows the `devices` precedent (devices.ts) — an inert Drizzle
    // read-type choice, not a column-type difference; the "same precedent" note above is about the
    // jsonb decision only, not these columns.
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("canvases_tenant_name_key").on(t.name), // canvas names are distinct
  ],
);
