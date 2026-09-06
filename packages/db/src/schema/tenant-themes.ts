import { foreignKey, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * The owner-authored base THEME for one tenant (design §4, SP-A.2 §16.3).
 *
 * ONE ROW PER TENANT: `tenant_id` is the PRIMARY KEY, so it is both the row identity and the tenant
 * discriminator, and it doubles as the `ON CONFLICT` target the service upserts against. A fresh
 * tenant that has never picked a theme simply has no row — get-with-default returns "no override"
 * rather than seeding one (no backfill; the database is recreated pre-production, CLAUDE.md §5).
 *
 * `theme` is PLAIN jsonb, deliberately NOT `.$type<>()`-annotated with the `@waitron/layouts` shape:
 * `@waitron/layouts` depends on `@waitron/db`, so importing its types here would be a circular
 * dependency. The service validates the shape on write; the database stores opaque jsonb. Same
 * rationale — and same precedent — as `canvases` (canvases.ts).
 *
 * FK via the array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count
 * a never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI process),
 * the same reason management-sessions.ts uses this form. `restrict`, not cascade: removing a tenant
 * must never silently discard its authored theme.
 */
export const tenantThemes = pgTable(
  "tenant_themes",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    theme: jsonb("theme").notNull(),
    // Timestamp: `mode: "string"` follows the `devices` precedent (devices.ts) — an inert Drizzle
    // read-type choice, not a column-type difference; the "same precedent" note above is about the
    // jsonb decision only, not this column.
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_themes_tenant_fk",
    }).onDelete("restrict"),
  ],
);
