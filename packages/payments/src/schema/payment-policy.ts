import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, label, money, nowIso, table, tsString } from "@waitron/db";

/**
 * The venue's offline-acceptance policy, at most one row. `offline_amount_cap` bounds even an
 * opted-in acceptance. No row means no offline acceptance at all (`resolveOfflineDecision`).
 */
export const paymentPolicy = table(
  "payment_policy",
  {
    id: count("id").primaryKey().notNull().default(1),
    // A plain text column beside its own check constraint, NOT the enumText/enumCheck pair: that
    // pair narrows the column's TypeScript type, a caller-facing change. See enumText in
    // packages/db/src/schema/columns.ts.
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
