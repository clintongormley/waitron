import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

/**
 * The owner-authored NON-FISCAL receipt trim (SP-B4; design §9). The trim (`headerSubtitle` /
 * `footerMessage`) renders AROUND the immutable fiscal art on the printed ticket and can never
 * suppress or reorder a mandated element — it is not a fiscal record.
 *
 * ONE ROW (the tenant_themes shape): `id` is pinned to 1 by `tenant_receipts_singleton_ck`, and that
 * id doubles as the `ON CONFLICT` target the service upserts against. A database whose owner has
 * never opened the receipt editor simply has no row — the service returns the built-in
 * DEFAULT_RECEIPT rather than seeding one (no backfill; the database is recreated pre-production,
 * CLAUDE.md §5).
 *
 * `receipt` is PLAIN jsonb, deliberately NOT `.$type<>()`-annotated with the `@waitron/layouts`
 * `ReceiptConfig`: `@waitron/layouts` depends on `@waitron/db`, so importing its types here would be a
 * circular dependency. The service validates the shape on write (`validateReceiptConfig`); the
 * database stores opaque jsonb. Same rationale — and same precedent — as tenant_themes.
 */
export const tenantReceipts = pgTable(
  "tenant_receipts",
  {
    id: integer("id").primaryKey().notNull().default(1),
    receipt: jsonb("receipt").notNull(),
    // Timestamp `mode: "string"` follows the tenant_themes / devices precedent (an inert Drizzle
    // read-type choice, not a column-type difference).
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("tenant_receipts_singleton_ck", sql`${t.id} = 1`)],
);
