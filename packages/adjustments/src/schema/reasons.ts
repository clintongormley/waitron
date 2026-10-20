import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
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
import type { PersonRoleValue } from "@waitron/identity";
import type { AdjustmentAction } from "../policy.js";

export const REASON_KINDS = ["void", "comp"] as const;
export type ReasonKind = (typeof REASON_KINDS)[number];
const reasonKind = enumType(REASON_KINDS);

/**
 * A reason staff give for cancelling (a Void reason) or for comping or discounting (a Comp reason),
 * and the policy it carries. A Void reason holds no role lists and no limits. `max_amount` is what a
 * Comp reason may take off one bill in total, and `max_percent` the percentage it may take off one
 * item in total, before someone on `approver_roles` must approve.
 */
export const adjustmentReasons = table(
  "adjustment_reasons",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    /** Locale -> text. */
    names: json<Record<string, string>>("names").notNull(),
    kind: reasonKind("kind").notNull(),
    actions: json<AdjustmentAction[]>("actions").notNull(),
    maxPercent: rate("max_percent"),
    maxAmount: money("max_amount"),
    applyRoles: json<PersonRoleValue[]>("apply_roles").notNull().default([]),
    approverRoles: json<PersonRoleValue[]>("approver_roles").notNull().default([]),
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
    check("adjustment_reasons_kind_ck", enumCheck(t.kind)),
    check(
      "adjustment_reasons_kind_fields_ck",
      sql`(${t.kind} = 'void' and json_array_length(${t.applyRoles}) = 0 and json_array_length(${t.approverRoles}) = 0 and ${t.maxPercent} is null and ${t.maxAmount} is null) or (${t.kind} = 'comp' and json_array_length(${t.applyRoles}) > 0 and json_array_length(${t.approverRoles}) > 0)`,
    ),
    check("adjustment_reasons_position_ck", sql`${t.position} >= 0`),
  ],
);
