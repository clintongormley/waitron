// The public surface of @waitron/bookings — the first UI-bearing module (SP1: server + data).
// Re-exports only; named solely by @waitron/composition (the module-boundary rule, CLAUDE.md §3).

// Side-effect: keeps this package's errors.ts augmentation reachable from the barrel, per the
// reachability rule scripts/errors-reachable.test.ts enforces.
import "./errors.js";

export { bookings, bookingStatus } from "./schema/bookings.js";
export { BOOKINGS_MIGRATIONS } from "./migrations.js";
export { BOOKINGS_ROUTES } from "./routes.js";
