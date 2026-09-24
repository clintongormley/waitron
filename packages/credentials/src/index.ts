// The CLI is NOT re-exported: it is an operator command, reached through the bin, not the vault.
export { CREDENTIALS_MIGRATIONS } from "./migrations.js";
export { tenantCredentials } from "./schema/tenant-credentials.js";

export { PURPOSES, isPurpose, validatePayload } from "./purposes.js";
export type { Purpose } from "./purposes.js";

export { loadKeyRing } from "./keyring.js";
export type { KeyEntry, KeyRing } from "./keyring.js";

// cipher.ts is not exported: using its primitives directly would bypass the store.
export {
  credentialProvisioned,
  deleteCredential,
  getCredential,
  listCredentials,
  putCredential,
  rotateCredentials,
  tryGetCredential,
} from "./store.js";
export type { CredentialMeta, CredentialRef, RotationResult } from "./store.js";

export { CREDENTIALS_CLASSIFICATION } from "./classification.js";

// Keeps errors.ts's augmentation reachable from the public barrel, per the reachability rule in
// packages/shared/src/errors.ts.
import "./errors.js";
