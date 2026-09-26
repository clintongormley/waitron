import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  json,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { diningTables } from "./dining-tables.js";

export const visitState = enumType(["open", "needs_clearing", "closed"]);

/**
 * One seated party, from seating until its table is finished: it holds the party's tab, every bill
 * split from it (`working_orders.visit_id`) and the tables it sits at (`visit_tables`).
 *
 * `opened_by` and `closed_by` are plain person ids with no key: `persons` is in @waitron/identity's
 * migration set, not the core one.
 *
 * A visit merged into another is closed and names the survivor in `merged_into_visit_id`; its
 * bills that could no longer move stay here and count as the survivor's (`visitFamily`,
 * `apps/server/src/visits.ts`).
 */
export const visits = table(
  "visits",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    guestCount: count("guest_count"),
    state: visitState("state").notNull().default("open"),
    openedAt: tsString("opened_at").notNull().$defaultFn(nowIso),
    openedBy: id("opened_by").notNull(),
    // Set by Finish table, which moves the visit out of `open`, or by a merge that closes it.
    closedAt: tsString("closed_at"),
    closedBy: id("closed_by"),
    mergedIntoVisitId: id("merged_into_visit_id"),
    billRequestedAt: tsString("bill_requested_at"),
    revision: count("revision").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.mergedIntoVisitId],
      foreignColumns: [t.id],
      name: "visits_merged_into_fk",
    }),
    index("visits_merged_into_idx").on(t.mergedIntoVisitId),
    check("visits_state_ck", enumCheck(t.state)),
    check("visits_guest_count_ck", sql`${t.guestCount} is null or ${t.guestCount} >= 1`),
    check("visits_closed_at_ck", sql`(${t.state} = 'open') = (${t.closedAt} is null)`),
    check(
      "visits_merged_into_ck",
      sql`${t.mergedIntoVisitId} is null or (${t.mergedIntoVisitId} <> ${t.id} and ${t.state} = 'closed')`,
    ),
  ],
);

/**
 * Which tables a visit sits at. `left_at` is null while the table belongs to the visit, and the
 * partial unique index allows one such row per table, so a table joined to a party is protected
 * from a second seating exactly as the first table seated is.
 */
export const visitTables = table(
  "visit_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    visitId: id("visit_id").notNull(),
    tableId: id("table_id").notNull(),
    joinedAt: tsString("joined_at").notNull().$defaultFn(nowIso),
    leftAt: tsString("left_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.visitId],
      foreignColumns: [visits.id],
      name: "visit_tables_visit_fk",
    }),
    foreignKey({
      columns: [t.tableId],
      foreignColumns: [diningTables.id],
      name: "visit_tables_table_fk",
    }),
    uniqueIndex("visit_tables_active_table_uq")
      .on(t.tableId)
      .where(sql`${t.leftAt} is null`),
    index("visit_tables_visit_idx").on(t.visitId),
  ],
);

export const serviceCommandScope = enumType(["visit", "bill"]);

/**
 * One row per service command, keyed by the submission id its device made for it, so a retry after
 * a lost reply returns the recorded result instead of acting twice (`runServiceCommand`,
 * `apps/server/src/visits.ts`).
 *
 * `scope_id` names a visit or a working order by `scope_kind`, so it carries no key.
 */
export const serviceCommands = table(
  "service_commands",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    scopeKind: serviceCommandScope("scope_kind").notNull(),
    scopeId: id("scope_id").notNull(),
    submissionId: label("submission_id").notNull(),
    kind: label("kind").notNull(),
    fingerprint: label("fingerprint").notNull(),
    // Wrapped, so a command that returned nothing replays as nothing rather than as null.
    result: json<{ value?: unknown }>("result").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("service_commands_scope_submission_key").on(t.scopeKind, t.scopeId, t.submissionId),
    check("service_commands_scope_kind_ck", enumCheck(t.scopeKind)),
  ],
);
