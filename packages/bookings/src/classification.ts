import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * A standby must hold the bookings to keep serving the floor, but a returned box's stale reservations
 * must not travel back over the new primary's.
 */
export const BOOKINGS_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("bookings", "state", STATE),
];
import type { ChangeSource } from "@waitron/shared";

export const BOOKINGS_CHANGE_SOURCES: readonly ChangeSource[] = [
  { table: "bookings", type: "bookings" },
];
