import { jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * A reusable layout CANVAS (design §4, SP-A.2 §16.3). MANY per tenant, keyed by `name` — a device
 * (Task 8) points at one via a composite `(tenant_id, id)` FK, so two `UNIQUE` constraints back that:
 * `canvases_tenant_id_key` on `(tenant_id, id)` is the composite-FK target, and
 * `canvases_tenant_name_key` on `(tenant_id, name)` keeps names unique per tenant.
 *
 * `definition` is PLAIN jsonb, deliberately NOT `.$type<>()`-annotated with the `@waitron/layouts`
 * shape: `@waitron/layouts` depends on `@waitron/db`, so importing its types here would be a circular
 * dependency. The store service validates the whole CanvasDef on write; the database stores opaque
 * jsonb. Same rationale — and same precedent — as `tenant_themes` (tenant-themes.ts).
 *
 * FK `restrict`, not cascade: removing a tenant must never silently discard its authored canvases.
 * The ` v8 ignore next *\/` on the thunk arrow addresses the SAME v8 quirk the FK-thunk form has —
 * drizzle-kit resolves the FK in a separate CLI process, so v8 counts the never-invoked arrow as an
 * uncovered function — but by a DIFFERENT remedy than the array `foreignKey({...})` form
 * `management_sessions` and `tenant_themes` use (no thunk): this table keeps the `.references(() => …)`
 * thunk and silences the false uncovered-function with the v8-ignore.
 */
export const canvases = pgTable(
  "canvases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
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
    unique("canvases_tenant_id_key").on(t.tenantId, t.id), // composite-FK target (devices)
    unique("canvases_tenant_name_key").on(t.tenantId, t.name), // names unique per tenant
  ],
);
