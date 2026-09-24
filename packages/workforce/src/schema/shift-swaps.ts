import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, newId, nowIso, table, tsString } from "@waitron/db";
import { persons } from "@waitron/identity";
import { shifts } from "./shifts.js";

/**
 * The requester offers (`requested`), the offered person accepts (`accepted`), then a manager
 * decides (`approved`/`rejected`).
 */
export const shiftSwapStatus = enumType(["requested", "accepted", "approved", "rejected"]);

export type ShiftSwapStatus = (typeof shiftSwapStatus.enumValues)[number];

/**
 * The requester offers their `from_shift` to `to_person`, optionally taking `to_person`'s `to_shift`
 * in return. Who may request or accept is enforced by `requestSwap`/`acceptSwap`
 * (../shift-swaps.ts), not by the database.
 */
export const shiftSwaps = table(
  "shift_swaps",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    requestedByPersonId: id("requested_by_person_id").notNull(),
    fromShiftId: id("from_shift_id").notNull(),
    toPersonId: id("to_person_id").notNull(),
    /** Null for a one-sided give-away. */
    toShiftId: id("to_shift_id"),
    status: shiftSwapStatus("status").notNull().default("requested"),
    decidedByPersonId: id("decided_by_person_id"),
    decidedAt: tsString("decided_at"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.requestedByPersonId],
      foreignColumns: [persons.id],
      name: "shift_swaps_requested_by_person_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.toPersonId],
      foreignColumns: [persons.id],
      name: "shift_swaps_to_person_fk",
    }).onDelete("restrict"),
    // A swap has no meaning without the shift it offers.
    foreignKey({
      columns: [t.fromShiftId],
      foreignColumns: [shifts.id],
      name: "shift_swaps_from_shift_fk",
    }).onDelete("cascade"),
    // Losing the return shift leaves a one-sided offer.
    foreignKey({
      columns: [t.toShiftId],
      foreignColumns: [shifts.id],
      name: "shift_swaps_to_shift_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.decidedByPersonId],
      foreignColumns: [persons.id],
      name: "shift_swaps_decided_by_person_fk",
    }).onDelete("restrict"),
    index("shift_swaps_from_shift_idx").on(t.fromShiftId),
    check("shift_swaps_status_ck", enumCheck(t.status)),
  ],
);
