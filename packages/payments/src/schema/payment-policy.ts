import { sql } from "drizzle-orm";
import { check, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The venue's offline-acceptance policy — at most one row, `id` pinned to 1 (the `deployment` /
 * `mirror_config` / `node_membership` singleton shape in `@waitron/db`). `offline_mode` governs
 * whether the offline opt-in is ever available (`accept_offline` | `cash_only`);
 * `offline_amount_cap` bounds even an opted-in acceptance. Modelled as explicit configuration, never
 * inferred from connectivity. The ABSENCE of the row is fail-safe: no row means no offline acceptance
 * at all (see `resolveOfflineDecision`). Mutable config, so no append-only trigger.
 */
export const paymentPolicy = pgTable(
  "payment_policy",
  {
    id: integer("id").primaryKey().notNull().default(1),
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
    check("payment_policy_singleton_ck", sql`${t.id} = 1`),
    check(
      "payment_policy_offline_mode_ck",
      sql`${t.offlineMode} in ('accept_offline', 'cash_only')`,
    ),
    check("payment_policy_cap_ck", sql`${t.offlineAmountCap} >= 0`),
  ],
);
