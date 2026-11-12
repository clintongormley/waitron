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
} from "../columns.js";
import { REASON_KINDS, type AdjustmentAction } from "@waitron/shared";

const reasonKind = enumType(REASON_KINDS);

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
    noteRequired: flag("note_required").notNull().default(false),
    position: count("position").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("adjustment_reasons_name_key").on(t.name),
    check("adjustment_reasons_name_ck", sql`length(trim(${t.name})) > 0`),
    check("adjustment_reasons_actions_ck", sql`json_array_length(${t.actions}) > 0`),
    check(
      "adjustment_reasons_max_percent_ck",
      sql`${t.maxPercent} is null or ${t.maxPercent} between 0 and 10000`,
    ),
    check("adjustment_reasons_max_amount_ck", sql`${t.maxAmount} is null or ${t.maxAmount} >= 0`),
    check("adjustment_reasons_kind_ck", enumCheck(t.kind)),
    check(
      "adjustment_reasons_kind_fields_ck",
      sql`(${t.kind} = 'void' and ${t.maxPercent} is null and ${t.maxAmount} is null) or ${t.kind} = 'comp'`,
    ),
    check("adjustment_reasons_position_ck", sql`${t.position} >= 0`),
  ],
);
