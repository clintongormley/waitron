// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one.
import "@waitron/shared";

/**
 * packages/reporting's codes in the shared error registry. The concept is the daily close (cierre Z),
 * so the prefix is `close.*`. Thrown by `recordDailyClose`.
 *
 * `scripts/errors-reachable.test.ts` checks that this file stays reachable from the package's
 * `index.ts`, weaker than its name: it reads import TEXT, so an import of this file written in a
 * comment or string of another file the barrel reaches fakes an edge.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The node's day is already closed — the immutable `UNIQUE(node_id, business_day)`
     * rejected a second close. `businessDay` is the "YYYY-MM-DD" that was already closed. */
    "close.already_closed": { businessDay: string };
    /** A supplied cash count was rejected: a negative or non-numeric figure, a device counted
     * twice, a count for an unknown device, or a device whose drawer moved cash, whatever the net,
     * that was not counted. `deviceId` is present when the fault is a specific device's; `reason`
     * is a stable English discriminator, never a user-facing sentence. */
    "close.invalid_cash_input": { deviceId?: string; reason: string };
  }
}
