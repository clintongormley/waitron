import { sql } from "drizzle-orm";
import { check, foreignKey, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

/**
 * Per-tenant offline-acceptance policy — exactly one row per tenant. `offline_mode` governs whether
 * the offline opt-in is ever available (`accept_offline` | `cash_only`); `offline_amount_cap` bounds
 * even an opted-in acceptance. Modelled as explicit configuration, never inferred from connectivity
 * (mirrors Veri*Factu-mode being explicit per-tenant config). The ABSENCE of a row is fail-safe: no
 * row means no offline acceptance at all (see `resolveOfflineDecision`). Mutable config, so tenant
 * isolation only (no append-only trigger); cascades with its tenant, being pure per-tenant config.
 */
export const paymentPolicy = pgTable(
  "payment_policy",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    offlineMode: text("offline_mode").notNull(),
    offlineAmountCap: numeric("offline_amount_cap", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "payment_policy_tenant_fk",
    }).onDelete("cascade"),
    check(
      "payment_policy_offline_mode_ck",
      sql`${t.offlineMode} in ('accept_offline', 'cash_only')`,
    ),
    check("payment_policy_cap_ck", sql`${t.offlineAmountCap} >= 0`),
  ],
).enableRLS();
