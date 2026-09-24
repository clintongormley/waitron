// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one.
import "@waitron/shared";

/**
 * packages/reporting's codes in the shared error registry. The concept is the daily close (cierre Z),
 * so the prefix is `close.*`. Thrown by `recordDailyClose`.
 *
 * Codes are never renamed once shipped: a wrong one is deprecated and a new one added beside it.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The node's day is already closed — the immutable `UNIQUE(node_id, business_day)`
     * rejected a second close. `businessDay` is the "YYYY-MM-DD" that was already closed. */
    "close.already_closed": { businessDay: string };
    /** A supplied cash count was rejected: a negative or non-numeric figure, a till counted twice, a
     * count for an unknown till, or a till with cash takings that was not counted. `tillId` is
     * present when the fault is a specific till's; `reason` is a stable English discriminator, never
     * a user-facing sentence. */
    "close.invalid_cash_input": { tillId?: string; reason: string };
  }
}
