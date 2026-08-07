// A bare side-effect import so TypeScript augments the real "@waitron/shared" module rather than
// declaring a fresh ambient one — the idiom packages/identity, packages/core use.
import "@waitron/shared";

/**
 * packages/reporting's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention, never the package name. The concept here is
 * the daily close (cierre Z), so the prefix is `close.*`. Thrown by `recordDailyClose` (Task 3);
 * every file that throws one imports "./errors.js" so the augmentation is reachable.
 *
 * Codes are never renamed once shipped: a wrong one is deprecated and a new one added beside it.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The (tenant, node) day is already closed — the immutable `UNIQUE(tenant, node, business_day)`
     * rejected a second close. `businessDay` is the "YYYY-MM-DD" that was already closed. */
    "close.already_closed": { businessDay: string };
    /** A supplied cash count was rejected: a negative figure, a count for an unknown till, or a till
     * with cash takings that was not counted. `tillId` is present when the fault is a specific
     * till's; `reason` is a stable English discriminator, never a user-facing sentence. */
    "close.invalid_cash_input": { tillId?: string; reason: string };
  }
}
