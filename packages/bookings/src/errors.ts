// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as a
// real module to augment rather than a fresh ambient module of the same name — the idiom
// packages/db, packages/fiscal and packages/fiscal-verifactu already use for their own codes.
import "@waitron/shared";

/**
 * @waitron/bookings' contribution to the shared error registry, added by declaration merging (see
 * the design note atop packages/shared/src/errors.ts). The four `booking.*` codes name the DOMAIN
 * CONCEPT (a restaurant reservation), never the throwing package (CLAUDE.md §3), and are NEVER
 * renamed once shipped — relocated here from apps/server/src/errors.ts when bookings became a module,
 * payloads unchanged.
 *
 * Reachability: every file that throws one of these imports "./errors.js" (the verbs in
 * bookings.ts), and this file is reachable from the barrel — scripts/errors-reachable.test.ts
 * text-walks that graph.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /**
     * No reservation with this id exists in this database. `bookingId` is a caller-supplied uuid the
     * dashboard already holds, not a secret. Mapped to 404 in the route STATUS map.
     */
    "booking.not_found": { bookingId: string };
    /**
     * A reservation was created or edited with a party size that is not a positive integer
     * (`party_size ≤ 0`). The offending `partySize` is echoed — a headcount is not a secret and
     * echoing it makes the error actionable. A CLIENT request-shape fault (400), distinct from the
     * state-conflict `booking.invalid_transition` (409).
     */
    "booking.invalid": { partySize: number };
    /**
     * A lifecycle verb (`cancel`/`no-show`/`complete`/`seat`) found the reservation is not in a state
     * the move is legal from. Carries the affected `bookingId` (the house `*.invalid_transition`
     * convention), not a from/to pair. An absent id surfaces `booking.not_found` before this. Mapped
     * to 409.
     */
    "booking.invalid_transition": { bookingId: string };
    /**
     * `seatBooking` could not resolve a table to seat the party at — neither a `tableId` was passed
     * nor does the booking carry a `table_id`. No params: the route path carries the booking id. A
     * CLIENT request-shape fault (400): a table must be supplied.
     */
    "booking.table_required": Record<string, never>;
  }
}
