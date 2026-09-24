// The Drizzle snapshot is built from THIS file's exports. Every name is written out explicitly —
// never `export *`, and never a core table: a core table re-exported here lands in this package's
// snapshot as a duplicate CREATE TABLE. schema-ownership.test.ts enforces this.
export { persons, personStatus, personRole } from "./persons.js";
export { totpEnrollments } from "./totp-enrollments.js";
export { recoveryCodes } from "./recovery-codes.js";
export { googleOidcStates } from "./google-oidc-states.js";
export { sessions } from "./sessions.js";
export { managementSessions } from "./management-sessions.js";
export { managementAccountActions } from "./management-account-actions.js";
export { webauthnCredentials, webauthnChallenges } from "./webauthn.js";
