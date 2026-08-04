// The entire public surface of @waitron/identity. Re-exports only — no logic here.
export { IDENTITY_MIGRATIONS } from "./migrations.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable
// from this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
import "./errors.js";
