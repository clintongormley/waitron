// Makes TypeScript augment the real "@waitron/shared" rather than declare a new ambient module.
import "@waitron/shared";

/** Codes are never renamed once shipped. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** `bookingId` is the caller's own id, not a secret. */
    "booking.not_found": { bookingId: string };
    /** A party size of zero or less. */
    "booking.invalid": { partySize: number };
    /** A lifecycle move the reservation's status does not allow. */
    "booking.invalid_transition": { bookingId: string };
    /** Seating named no table and the booking has none assigned. */
    "booking.table_required": Record<string, never>;
  }
}
