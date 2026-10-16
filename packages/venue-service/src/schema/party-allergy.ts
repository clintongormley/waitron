import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  json,
  label,
  newId,
  parties,
  orderDraftLines,
  workingOrderLines,
  table,
  tsString,
  type AllergenMap,
} from "@waitron/db";

const allergyAnswer = enumType(["none", "allergies"]);
export const partyAllergy = table(
  "party_allergy",
  {
    partyId: id("party_id")
      .primaryKey()
      .references(() => parties.id, { onDelete: "cascade" }),
    answer: allergyAnswer("answer").notNull(),
    // A plain person id; the authenticated caller establishes the actor, outside this module's set.
    changedBy: id("changed_by").notNull(),
    changedAt: tsString("changed_at").notNull(),
  },
  (t) => [check("party_allergy_answer_ck", enumCheck(t.answer))],
);

export const partyAllergyGuests = table(
  "party_allergy_guests",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    partyId: id("party_id").notNull(),
    position: count("position").notNull(),
    who: label("who").notNull(),
    allergens: json<AllergenMap>("allergens").notNull(),
    note: label("note"),
  },
  (t) => [
    foreignKey({
      columns: [t.partyId],
      foreignColumns: [partyAllergy.partyId],
      name: "party_allergy_guests_party_fk",
    }).onDelete("cascade"),
    check(
      "party_allergy_guests_position_ck",
      sql`typeof(${t.position}) = 'integer' and ${t.position} >= 0`,
    ),
    check("party_allergy_guests_who_ck", sql`length(trim(${t.who})) between 1 and 40`),
    check(
      "party_allergy_guests_allergens_ck",
      sql`json_valid(${t.allergens}) and json_type(${t.allergens}) = 'object' and ${t.allergens} <> '{}'`,
    ),
    check("party_allergy_guests_note_ck", sql`${t.note} is null or length(${t.note}) <= 2000`),
  ],
);

export const allergyLineTicks = table(
  "allergy_line_ticks",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    guestId: id("guest_id").notNull(),
    draftLineId: id("draft_line_id"),
    workingLineId: id("working_line_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.guestId],
      foreignColumns: [partyAllergyGuests.id],
      name: "allergy_line_ticks_guest_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.draftLineId],
      foreignColumns: [orderDraftLines.id],
      name: "allergy_line_ticks_draft_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.workingLineId],
      foreignColumns: [workingOrderLines.id],
      name: "allergy_line_ticks_working_fk",
    }).onDelete("cascade"),
    uniqueIndex("allergy_line_ticks_draft_key").on(t.draftLineId),
    uniqueIndex("allergy_line_ticks_working_key").on(t.workingLineId),
    check(
      "allergy_line_ticks_target_ck",
      sql`(${t.draftLineId} is null) <> (${t.workingLineId} is null)`,
    ),
  ],
);
