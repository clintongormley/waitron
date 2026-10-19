import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, json, money, nowIso, table, tsString } from "@waitron/db";
import type { PersonRoleValue } from "@waitron/identity";

/**
 * The venue's adjustment settings, at most one row. `max_bill_comp` is, in cents, what comps may take
 * off one bill before someone on `bill_approver_roles` must approve; null, or no row, is no limit.
 */
export const adjustmentSettings = table(
  "adjustment_settings",
  {
    id: count("id").primaryKey().notNull().default(1),
    maxBillComp: money("max_bill_comp"),
    billApproverRoles: json<PersonRoleValue[]>("bill_approver_roles")
      .notNull()
      .default(["manager", "admin"]),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    check("adjustment_settings_singleton_ck", sql`${t.id} = 1`),
    check(
      "adjustment_settings_max_bill_comp_ck",
      sql`${t.maxBillComp} is null or ${t.maxBillComp} > 0`,
    ),
    check(
      "adjustment_settings_bill_approver_roles_ck",
      sql`json_array_length(${t.billApproverRoles}) > 0`,
    ),
  ],
);
