// The public surface of @waitron/server-kit: the shared server-side HTTP helpers lifted out of
// apps/server so a module's routes can import them without depending on the app. Re-exports only.
//
// Excluded from coverage in vitest.config.ts (a pure re-export barrel), the same reason
// packages/shared and packages/fiscal-none exclude theirs.

// Side-effect: keeps this package's errors.ts augmentation reachable from the barrel, per the
// reachability rule scripts/errors-reachable.test.ts enforces.
import "./errors.js";

export { createErrorBoundary } from "./error-boundary.js";
export { codeOf } from "./error-code.js";
export { readJsonBody } from "./read-json-body.js";
export {
  requireBodyUuid,
  requireEnum,
  requireNullableBodyUuid,
  requireNullableString,
  requirePeriod,
  requireString,
  requireUuidParam,
} from "./request-screens.js";
export {
  clearManagementCookie,
  MANAGEMENT_COOKIE,
  readManagementSessionId,
  requireManagementSession,
  setManagementCookie,
} from "./management-cookie.js";
export type { Logger } from "./logger.js";
