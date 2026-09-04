import { foreignKey, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * The owner-authored NON-FISCAL receipt trim for one tenant (SP-B4; design §9). The trim
 * (`headerSubtitle` / `footerMessage`) renders AROUND the immutable fiscal art on the printed ticket
 * and can never suppress or reorder a mandated element — it is not a fiscal record.
 *
 * ONE ROW PER TENANT (the tenant_themes shape): `tenant_id` is the PRIMARY KEY, so it
 * is both the row identity and the tenant discriminator, and it doubles as the `ON CONFLICT` target
 * the service upserts against. A fresh tenant that has never opened the receipt editor simply has no
 * row — the service returns the built-in DEFAULT_RECEIPT rather than seeding one (no backfill; the
 * database is recreated pre-production, CLAUDE.md §5).
 *
 * `receipt` is PLAIN jsonb, deliberately NOT `.$type<>()`-annotated with the `@waitron/layouts`
 * `ReceiptConfig`: `@waitron/layouts` depends on `@waitron/db`, so importing its types here would be a
 * circular dependency. The service validates the shape on write (`validateReceiptConfig`); the
 * database stores opaque jsonb. Same rationale — and same precedent — as tenant_themes.
 *
 * FK via the array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count
 * a never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI process),
 * the same reason tenant-themes.ts uses this form. `restrict`, not cascade: removing a tenant must
 * never silently discard its authored receipt trim.
 *
 * `.enableRLS()` emits only `ENABLE ROW LEVEL SECURITY`. The `FORCE`, the tenant-isolation policy and
 * the app_user grants (SELECT/INSERT/UPDATE — no DELETE, config is replaced in place like
 * tenant_themes) are hand-written in the paired `--custom` migration (CLAUDE.md §3). No separate
 * tenant_id index: the PRIMARY KEY already provides a unique index on it. inmutabilidad requires FORCE.
 */
export const tenantReceipts = pgTable(
  "tenant_receipts",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    receipt: jsonb("receipt").notNull(),
    // Timestamp `mode: "string"` follows the tenant_themes / devices precedent (an inert Drizzle
    // read-type choice, not a column-type difference).
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_receipts_tenant_fk",
    }).onDelete("restrict"),
  ],
).enableRLS();
