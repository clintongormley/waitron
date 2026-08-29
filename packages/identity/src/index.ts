// The entire public surface of @waitron/identity. Re-exports only — no logic here.
export { IDENTITY_MIGRATIONS } from "./migrations.js";
export { authorize } from "./authorize.js";
export type { Authorization, AuthzInput, Override } from "./authorize.js";
export { endSession, loginWithPin } from "./login.js";
export type { Session } from "./login.js";
export {
  IDLE_TIMEOUT_MS,
  startManagementSession,
  resolveManagementSession,
  endManagementSession,
} from "./management-session.js";
export type { ManagementSession } from "./management-session.js";
export { loginManager, authorizeManager } from "./manager-login.js";
export {
  CHALLENGE_TTL_MS,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
} from "./passkey.js";
export { PERMISSIONS, roleHasPermission } from "./permissions.js";
export type { Permission, PersonRoleValue } from "./permissions.js";
export { persons, personStatus, personRole } from "./schema/persons.js";
export { sessions } from "./schema/sessions.js";
export { managementSessions } from "./schema/management-sessions.js";
export { webauthnCredentials, webauthnChallenges } from "./schema/webauthn.js";
export {
  MIN_PIN_LENGTH,
  assertPinLength,
  createPerson,
  listActivePersonsWithPermission,
  listActiveStaff,
  listPersons,
  reactivatePerson,
  resetPin,
  setPassword,
  setPersonLocale,
  setRole,
  suspendPerson,
} from "./staff.js";
export type { PersonSummary, StaffListEntry } from "./staff.js";
export { hashSecret, verifySecret } from "./secret-hash.js";
export { hashPin, verifyPin } from "./verify-pin.js";
export {
  MIN_PASSWORD_LENGTH,
  assertPasswordLength,
  hashPassword,
  verifyPassword,
} from "./verify-password.js";
export { generateTotpSecret, totpAuthUri, verifyTotp } from "./totp.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable
// from this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
import "./errors.js";
