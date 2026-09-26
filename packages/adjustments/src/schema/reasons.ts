import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  flag,
  id,
  json,
  label,
  money,
  newId,
  nowIso,
  rate,
  table,
  tsString,
} from "@waitron/db";
import { personRole } from "@waitron/identity";
import type { AdjustmentAction } from "../policy.js";

/**
 * A reason staff give for cancelling, comping or discounting, and the policy it carries. `max_amount`
 * caps what the reason takes off one bill in total; `max_percent` caps the percentage it takes off one
 * line in total.
 */
export const adjustmentReasons = table(
  "adjustment_reasons",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    /** Locale -> text. */
    names: json<Record<string, string>>("names").notNull(),
    actions: json<AdjustmentAction[]>("actions").notNull(),
    maxPercent: rate("max_percent"),
    maxAmount: money("max_amount"),
    applyRole: personRole("apply_role").notNull(),
    approverRole: personRole("approver_role").notNull(),
    noteRequired: flag("note_required").notNull().default(false),
    active: flag("active").notNull().default(true),
    position: count("position").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("adjustment_reasons_active_name_key")
      .on(t.name)
      .where(sql`${t.active}`),
    check("adjustment_reasons_name_ck", sql`length(trim(${t.name})) > 0`),
    check("adjustment_reasons_actions_ck", sql`json_array_length(${t.actions}) > 0`),
    check(
      "adjustment_reasons_max_percent_ck",
      sql`${t.maxPercent} is null or (${t.maxPercent} > 0 and ${t.maxPercent} <= 10000)`,
    ),
    check("adjustment_reasons_max_amount_ck", sql`${t.maxAmount} is null or ${t.maxAmount} > 0`),
    check("adjustment_reasons_apply_role_ck", enumCheck(t.applyRole)),
    check("adjustment_reasons_approver_role_ck", enumCheck(t.approverRole)),
    check("adjustment_reasons_position_ck", sql`${t.position} >= 0`),
  ],
);
