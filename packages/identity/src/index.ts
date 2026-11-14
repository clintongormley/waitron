export {
  BUILT_IN_ROLE_KEYS,
  createAccessRole,
  renameAccessRole,
  setAccessRolePermissions,
  deleteAccessRole,
  prepareAccessRoleImport,
  importAccessRole,
  importAccessRoleMembership,
  ensureBuiltInRoles,
  listAccessRoles,
  readPersonAccessRoles,
  setPersonAccessRoles,
} from "./roles.js";
export {
  readPersonAuthority,
  listAdminHolders,
  holds,
  holdsInCopy,
  type PersonAuthority,
} from "./authority.js";
export { authorize, authorizeApproval, authorizeByPin } from "./authorize.js";
export { checkPin, verifyPersonCredential, verifyThrottledCredential } from "./credential.js";
export type { PinAttempts } from "./credential.js";
export type { SecretCheck } from "./secret-check.js";
// Exported for the writers OUTSIDE this package that create a person, which must fold the same way.
export { foldForUniqueness } from "./fold.js";
export type { Authorization, AuthzInput, Override } from "./authorize.js";
export { endDeviceSessions, endSession, loginWithPin } from "./login.js";
export {
  canUseDeviceProfile,
  listStaffAdmittedTo,
  profilesAdmitting,
  readProfileAdmissions,
  setProfileAdmission,
} from "./profile-admission.js";
export type { ProfileAdmission } from "./profile-admission.js";
export {
  deviceProfileAdmissionRoles,
  managementAccountActions,
  managementSessions,
  persons,
  personStatus,
  sessions,
  webauthnChallenges,
  webauthnCredentials,
} from "@waitron/db";
export type { Session } from "./login.js";
export {
  IDLE_TIMEOUT_MS,
  startManagementSession,
  resolveManagementSession,
  checkManagementSession,
  endManagementSession,
} from "./management-session.js";
export type { ManagementSession } from "./management-session.js";
export { hashSessionToken, mintSessionToken } from "./session-token.js";
export {
  deviceTokenMatches,
  hashDeviceToken,
  sightingDue,
  signInWithToken,
  staleBefore,
} from "./device-token.js";
export { encryptTotpSecret } from "./mfa.js";
export type { TotpKeyEntry, TotpKeyRing } from "./mfa.js";
export {
  checkManagerPassword,
  loginManager,
  loginManagerById,
  authorizeManager,
  foldedLoginEmail,
  personIdForLoginEmail,
} from "./manager-login.js";
export {
  CHALLENGE_TTL_MS,
  beginOwnPasskeyCheck,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  readPasskeySignals,
  verifyOwnPasskey,
} from "./passkey.js";
export { markPasskeyOffered, shouldOfferPasskey } from "./passkey-offer.js";
export {
  PERMISSIONS,
  CORE_PERMISSIONS,
  declaredPermissions,
  defaultPermissionsFor,
  isDeclaredPermission,
  registerModulePermissions,
} from "./permissions.js";
export type {
  Permission,
  PermissionDeclaration,
  BuiltInRoleKey,
  DefaultHolder,
} from "./permissions.js";
export {
  readOwnProfile,
  saveOwnProfile,
  confirmOwnEmailChange,
  changeOwnPassword,
  changeOwnPin,
  beginOwnTotpEnrollment,
  finishOwnTotpEnrollment,
  regenerateOwnRecoveryCodes,
  disableOwnTotp,
  unlinkOwnGoogle,
  verifyOwnCredentials,
  verifyOwnFreshSignIn,
  checkOwnPassword,
  removeOwnPasskey,
} from "./profile.js";
export { MIN_PIN_LENGTH, assertPinLength } from "./verify-pin.js";
export { isValidEmail } from "./email.js";
export {
  authorizePersonLoginChange,
  clearPersonPin,
  deactivatePerson,
  invitePerson,
  listActivePersonsWithPermission,
  listActiveStaff,
  listPersons,
  normalizeAndValidateEmail,
  reactivatePersonForInvitation,
  resetPersonLogin,
  setPersonLocale,
  updatePersonDetails,
} from "./staff.js";
export type { PersonSummary, StaffListEntry } from "./staff.js";
export {
  ACCOUNT_ACTION_TTL_MS,
  ACCOUNT_ACTION_CODE_ATTEMPTS,
  ACCOUNT_ACTION_CODE_TTL_MS,
  completeAccountAction,
  inspectAccountAction,
  issueAccountAction,
  issueQueuedAccountAction,
  queueAccountMail,
  queueAccountRecovery,
  queueInvitation,
} from "./account-action.js";
export type {
  AccountActionCompletion,
  AccountActionInspection,
  AccountActionPurpose,
  AccountMailParams,
  IssuedAccountAction,
} from "./account-action.js";
export { hashSecret, verifySecretAsync } from "./secret-hash.js";
export { hashPin, verifyPin } from "./verify-pin.js";
export {
  PIN_THROTTLE_FREE_ATTEMPTS,
  PIN_THROTTLE_FULL_RETRY_SECONDS,
  PIN_THROTTLE_IDLE_MS,
  PIN_THROTTLE_MAX_KEYS_PER_SLOT,
  PIN_THROTTLE_MAX_WAIT_SECONDS,
  pinThrottleIdle,
  createPinThrottle,
  pinThrottleRetryAfterSeconds,
  pinThrottleUnlockAt,
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

export { IDENTITY_TABLES } from "./classification.js";
export { IDENTITY_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
export { IDENTITY_PERSONAL_DATA } from "./personal-data.js";

// Side-effect only: keeps errors.ts's augmentation reachable from the public barrel
// (scripts/errors-reachable.test.ts).
import "./errors.js";
export { withPassiveManagementRead } from "./management-session.js";
export { IDENTITY_CHANGE_SOURCES } from "./classification.js";
export { IDENTITY_BACKUP_VERIFICATION } from "./backup-verification.js";

export { requireFreshManagementSignIn } from "./fresh-sign-in.js";

export { assertUsableAdminRemains } from "./admin-anchor.js";
