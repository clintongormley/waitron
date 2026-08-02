// The entire public surface of @waitron/workforce. Re-exports only — no logic here.
export { WORKFORCE_MIGRATIONS } from "./migrations.js";
export { persons, personStatus, workforceRole } from "./schema/persons.js";
export { hashPin, verifyPin } from "./verify-pin.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable
// from this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
