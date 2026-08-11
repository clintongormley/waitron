import { foreignKey, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * The owner-authored till layout + receipt trim for one tenant.
 *
 * ONE ROW PER TENANT (design D2): `tenant_id` is the PRIMARY KEY, so it is both the row identity and
 * the tenant discriminator, and it doubles as the `ON CONFLICT` target the service upserts against.
 * A fresh tenant that has never opened the editor simply has no row — the service returns the
 * built-in defaults rather than seeding one (no backfill; the database is recreated pre-production,
 * CLAUDE.md §5).
 *
 * `definition` and `receipt` are PLAIN jsonb, deliberately NOT `.$type<>()`-annotated with the
 * `@waitron/layouts` shapes: `@waitron/layouts` depends on `@waitron/db`, so importing its types here
 * would be a circular dependency. The service validates the shape on write (`validateLayout` /
 * `validateReceiptConfig`); the database stores opaque jsonb.
 *
 * FK via the array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8
 * count a never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
 * process), the same reason management-sessions.ts uses this form. `restrict`, not cascade: removing
 * a tenant must never silently discard its authored configuration.
 *
 * `.enableRLS()` emits only `ENABLE ROW LEVEL SECURITY`. The `FORCE`, the tenant-isolation policy and
 * the app_user grants are hand-written in the paired `--custom` migration (CLAUDE.md §3), mirroring
 * catalogue's 0027 and sessions' 0003. No separate tenant_id index: the PRIMARY KEY already provides
 * a unique index on it.
 */
export const tillLayouts = pgTable(
  "till_layouts",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    definition: jsonb("definition").notNull(),
    receipt: jsonb("receipt").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "till_layouts_tenant_fk",
    }).onDelete("restrict"),
  ],
).enableRLS();
