import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, label, money, nowIso, table, tsString } from "@waitron/db";

/**
 * The venue's offline-acceptance policy — at most one row, `id` pinned to 1 (the `deployment` /
 * `node_membership` singleton shape in `@waitron/db`). `offline_mode` governs whether the offline
 * opt-in is ever available (`accept_offline` | `cash_only`);
 * `offline_amount_cap` bounds even an opted-in acceptance. Modelled as explicit configuration, never
 * inferred from connectivity. The ABSENCE of the row is fail-safe: no row means no offline acceptance
 * at all (see `resolveOfflineDecision`). Mutable config, so no append-only trigger.
 */
export const paymentPolicy = table(
  "payment_policy",
  {
    id: count("id").primaryKey().notNull().default(1),
    // A plain text column beside its own check constraint below, NOT the enumText/enumCheck pair:
    // that pair narrows the column's TypeScript type to the union of its values, which is a
    // caller-facing change the schema probe cannot see, and values written inline at the call
    // narrow whatever the column's nullability. enumText's own note in
    // packages/db/src/schema/columns.ts has the table, and says how to control for it.
    offlineMode: label("offline_mode").notNull(),
    offlineAmountCap: money("offline_amount_cap").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
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
