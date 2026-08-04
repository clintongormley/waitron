import { foreignKey, index, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { persons } from "@waitron/identity";
import { shifts } from "./shifts.js";

/**
 * A swap request's lifecycle. A requester offers their shift (`requested`); the offered person
 * accepts it (`accepted`, `acceptSwap` in ../shift-swaps.ts); a manager `approved`/`rejected` it.
 * This slice writes `requested` (`requestSwap`) and `accepted` (`acceptSwap`) only — the manager
 * approve/reject transition is a later slice's owner-gated workflow (plan §7), not built here.
 * English tokens, same reason as the sibling enums.
 */
export const shiftSwapStatus = pgEnum("shift_swap_status", [
  "requested",
  "accepted",
  "approved",
  "rejected",
]);

/** One of `requested`/`accepted`/`approved`/`rejected` — the `shift_swap_status` enum's union. */
export type ShiftSwapStatus = (typeof shiftSwapStatus.enumValues)[number];

/**
 * A request to swap shifts between two people — person A (the requester) offers their `from_shift` to
 * person B (`to_person`), optionally taking B's `to_shift` in return. PLANNING data, ordinary mutable
 * rows: the app role holds SELECT, INSERT, UPDATE and DELETE
 * (drizzle/0008_scheduling_planning_rls.sql), no append-only trigger and no chain (design 2026-07-22
 * §2.1 / plan §2.1).
 *
 * `from_shift_id` cascades on delete — a swap is meaningless once the offered shift is gone, so
 * discarding that shift discards the swap. `to_shift_id` is nullable (a one-sided give-away) and SET
 * NULLs on delete — the swap survives as an offer of `from_shift` alone. The permission rule
 * (`requested_by_person` must OWN `from_shift`; only `to_person` may accept) is `requestSwap` /
 * `acceptSwap`'s, not the DB's.
 */
export const shiftSwaps = pgTable(
  "shift_swaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** The person offering the swap — must own `from_shift` (`requestSwap` enforces it). */
    requestedByPersonId: uuid("requested_by_person_id").notNull(),
    /** The shift being offered. */
    fromShiftId: uuid("from_shift_id").notNull(),
    /** The person the shift is offered to — the only one who may accept it. */
    toPersonId: uuid("to_person_id").notNull(),
    /** The shift offered in return, if any; null for a one-sided give-away. */
    toShiftId: uuid("to_shift_id"),
    status: shiftSwapStatus("status").notNull().default("requested"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`, for the coverage reason the
    // sibling schema files document.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "shift_swaps_tenant_fk",
    }).onDelete("restrict"),
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
    // cascade: the offered shift going away discards the swap (it has no meaning without it).
    foreignKey({
      columns: [t.fromShiftId],
      foreignColumns: [shifts.id],
      name: "shift_swaps_from_shift_fk",
    }).onDelete("cascade"),
    // set null: the return shift going away leaves a one-sided offer of `from_shift`, not a deletion.
    foreignKey({
      columns: [t.toShiftId],
      foreignColumns: [shifts.id],
      name: "shift_swaps_to_shift_fk",
    }).onDelete("set null"),
    index("shift_swaps_tenant_id_idx").on(t.tenantId),
    index("shift_swaps_tenant_from_shift_idx").on(t.tenantId, t.fromShiftId),
  ],
).enableRLS();
