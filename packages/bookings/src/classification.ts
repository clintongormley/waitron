import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const STATE = "manager configuration / live service; copied to a standby, never drained back";

/**
 * Bookings' tables, classified for native replication (swap spec §2.1). A booking is live-service
 * state a standby must hold to keep serving the floor, but a returned box's stale reservations must
 * not travel back over the new primary's. `bookings` was core's `state` before SP1 (#270) extracted
 * it into this module; the class is unchanged. Completeness against this module's migrations is
 * guarded by `classification.test.ts`.
 */
export const BOOKINGS_CLASSIFICATION: readonly ClassifiedTable[] = [
  // state (1) — a table reservation; copied to a standby, never drained back.
  classify("bookings", "state", STATE),
];
