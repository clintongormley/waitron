import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
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
import { workingOrders } from "./orders.js";

export const partyState = enumType(["open", "closed"]);

/**
 * One seated party, from seating until its table is finished: it holds the party's tab, every bill
 * split from it (`working_orders.party_id`) and the tables it sits at (`party_tables`).
 *
 * `opened_by` and `closed_by` are plain person ids with no key: `persons` is in @waitron/identity's
 * migration set, not the core one.
 *
 * A party merged into another is closed and names the survivor in `merged_into_party_id`; its
 * bills that could no longer move stay here and count as the survivor's (`partyFamily`,
 * `apps/server/src/parties.ts`).
 */
export const parties = table(
  "parties",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    guestCount: count("guest_count"),
    state: partyState("state").notNull().default("open"),
    openedAt: tsString("opened_at").notNull().$defaultFn(nowIso),
    openedBy: id("opened_by").notNull(),
    // Set by Finish table or Record unpaid departure (both through `closeParty`), or by a merge
    // that closes it.
    closedAt: tsString("closed_at"),
    closedBy: id("closed_by"),
    mergedIntoPartyId: id("merged_into_party_id"),
    billRequestedAt: tsString("bill_requested_at"),
    name: label("name"),
    // The party's main bill. Two triggers on working_orders clear it when that bill leaves `open`
    // or leaves the party (to another party or to the counter) (`0038_main_bill_release.sql`).
    mainBillId: id("main_bill_id").references((): AnySQLiteColumn => workingOrders.id),
    revision: count("revision").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.mergedIntoPartyId],
      foreignColumns: [t.id],
      name: "parties_merged_into_fk",
    }),
    index("parties_merged_into_idx").on(t.mergedIntoPartyId),
    check("parties_state_ck", enumCheck(t.state)),
    check("parties_guest_count_ck", sql`${t.guestCount} is null or ${t.guestCount} >= 1`),
    check("parties_closed_at_ck", sql`(${t.state} = 'open') = (${t.closedAt} is null)`),
    check(
      "parties_merged_into_ck",
      sql`${t.mergedIntoPartyId} is null or (${t.mergedIntoPartyId} <> ${t.id} and ${t.state} = 'closed')`,
    ),
  ],
);

/**
 * Which tables a party sits at. `left_at` is null while the table belongs to the party, and the
 * partial unique index allows one such row per table, so a table joined to a party is protected
 * from a second seating exactly as the first table seated is.
 */
export const partyTables = table(
  "party_tables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    partyId: id("party_id").notNull(),
    tableId: id("table_id").notNull(),
    joinedAt: tsString("joined_at").notNull().$defaultFn(nowIso),
    leftAt: tsString("left_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.partyId],
      foreignColumns: [parties.id],
      name: "party_tables_party_fk",
    }),
    foreignKey({
      columns: [t.tableId],
      foreignColumns: [diningTables.id],
      name: "party_tables_table_fk",
    }),
    uniqueIndex("party_tables_active_table_uq")
      .on(t.tableId)
      .where(sql`${t.leftAt} is null`),
    index("party_tables_party_idx").on(t.partyId),
  ],
);

export const serviceCommandScope = enumType(["party", "bill"]);

/**
 * One row per service command, keyed by its device's submission id; a bill may also hold one
 * server-written made_here row for the made-here items of a pay-first send on replay.
 *
 * `scope_id` names a party or a working order by `scope_kind`, so it carries no key.
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
    result: json<{ value?: unknown; madeHere?: string[] }>("result").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    unique("service_commands_scope_submission_key").on(t.scopeKind, t.scopeId, t.submissionId),
    check("service_commands_scope_kind_ck", enumCheck(t.scopeKind)),
  ],
);
