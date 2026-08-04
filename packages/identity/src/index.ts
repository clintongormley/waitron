// The entire public surface of @waitron/identity. Re-exports only — no logic here.
export { IDENTITY_MIGRATIONS } from "./migrations.js";
export { PERMISSIONS, roleHasPermission } from "./permissions.js";
export type { Permission, PersonRoleValue } from "./permissions.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable
// from this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
import "./errors.js";
