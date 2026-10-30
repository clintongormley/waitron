import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  id,
  label,
  newId,
  nowIso,
  parties,
  table,
  tsString,
  workingOrders,
} from "@waitron/db";

/**
 * A bill's number within the seated party that shows it, and the name a waiter gave it. A row with
 * no party has no number.
 */
export const billIdentities = table(
  "bill_identities",
  {
    // No delete rule on either key: a drizzle rebuild of the parent runs with foreign keys on, so a
    // cascading child would be emptied without a word, where this one makes the rebuild fail while
    // it holds rows.
    workingOrderId: id("working_order_id")
      .primaryKey()
      .references(() => workingOrders.id),
    partyId: id("party_id").references(() => parties.id),
    number: count("number"),
    name: label("name"),
  },
  (t) => [
    uniqueIndex("bill_identities_party_number_key").on(t.partyId, t.number),
    check("bill_identities_scope_ck", sql`(${t.partyId} is null) = (${t.number} is null)`),
    check(
      "bill_identities_number_ck",
      sql`${t.number} is null or (typeof(${t.number}) = 'integer' and ${t.number} >= 1)`,
    ),
    // 40 is PARTY_NAME_MAX (@waitron/shared): a bill name follows the party-name rule.
    check(
      "bill_identities_name_ck",
      sql`${t.name} is null or (length(${t.name}) between 1 and 40 and ${t.name} = trim(${t.name}))`,
    ),
  ],
);

/** Every number a seated party has given a bill, so that none is given twice. */
export const billNumberAllocations = table(
  "bill_number_allocations",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // Plain ids with no key: a row nothing may delete would make every party and bill it names
    // undeletable for good. Nothing here refuses an id that names no party or bill;
    // `allocateBillNumber` writes the matching `bill_identities` row in the same transaction, and
    // that row's keys refuse one.
    partyId: id("party_id").notNull(),
    number: count("number").notNull(),
    workingOrderId: id("working_order_id").notNull(),
    allocatedAt: tsString("allocated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("bill_number_allocations_party_number_key").on(t.partyId, t.number),
    check(
      "bill_number_allocations_number_ck",
      sql`typeof(${t.number}) = 'integer' and ${t.number} >= 1`,
    ),
  ],
);
