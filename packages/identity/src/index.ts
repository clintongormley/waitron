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
export { loginManager, loginManagerById, authorizeManager } from "./manager-login.js";
export {
  CHALLENGE_TTL_MS,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
} from "./passkey.js";
export {
  PERMISSIONS,
  permissionsForRole,
  registerModulePermissions,
  roleHasPermission,
} from "./permissions.js";
export type { Permission, PersonRoleValue } from "./permissions.js";
export { persons, personStatus, personRole } from "./schema/persons.js";
export {
  readOwnProfile,
  saveOwnProfile,
  changeOwnPassword,
  changeOwnPin,
  beginOwnTotpEnrollment,
  finishOwnTotpEnrollment,
  regenerateOwnRecoveryCodes,
  removeOwnPasskey,
} from "./profile.js";
export { sessions } from "./schema/sessions.js";
export { managementSessions } from "./schema/management-sessions.js";
export { managementAccountActions } from "./schema/management-account-actions.js";
export { webauthnCredentials, webauthnChallenges } from "./schema/webauthn.js";
export { MIN_PIN_LENGTH, assertPinLength } from "./verify-pin.js";
export {
  clearPersonPin,
  createPerson,
  invitePerson,
  listActivePersonsWithPermission,
  listActiveStaff,
  listPersons,
  normalizeAndValidateEmail,
  reactivatePerson,
  resetPersonLogin,
  resetPin,
  setEmail,
  setPassword,
  setPersonLocale,
  setRole,
  suspendPerson,
  updatePersonDetails,
} from "./staff.js";
export type { PersonSummary, StaffListEntry } from "./staff.js";
export {
  ACCOUNT_ACTION_TTL_MS,
  ACCOUNT_ACTION_CODE_ATTEMPTS,
  ACCOUNT_ACTION_CODE_TTL_MS,
  completeAccountAction,
  completeAccountActionByCode,
  issueAccountAction,
  requestPasswordResetAction,
} from "./account-action.js";
export type { AccountActionPurpose, IssuedAccountAction } from "./account-action.js";
export { hashSecret, verifySecret } from "./secret-hash.js";
export { hashPin, verifyPin } from "./verify-pin.js";
export {
  PIN_THROTTLE_FREE_ATTEMPTS,
  PIN_THROTTLE_IDLE_MS,
  PIN_THROTTLE_MAX_WAIT_SECONDS,
  createPinThrottle,
} from "./pin-throttle.js";
export type { PinThrottle, PinThrottleOptions } from "./pin-throttle.js";
export {
  MIN_PASSWORD_LENGTH,
  assertPasswordLength,
  hashPassword,
  verifyPassword,
} from "./verify-password.js";
export { generateTotpSecret, totpAuthUri, verifyTotp } from "./totp.js";
export {
  beginGoogleLink,
  beginGoogleLogin,
  claimGoogleState,
  completeGoogleLink,
  loginWithGoogle,
} from "./google-oidc.js";
export type { GoogleOidcClaim } from "./google-oidc.js";

export { IDENTITY_CLASSIFICATION } from "./classification.js";
export { IDENTITY_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable
// from this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
import "./errors.js";
