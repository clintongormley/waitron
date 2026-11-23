// The CLI is NOT re-exported: it is an operator command, reached through the bin, not the vault.
export { venueCredentials } from "@waitron/db";

export { PURPOSES, isPurpose, validatePayload } from "./purposes.js";
export type { Purpose } from "./purposes.js";

export {
  KEY_RING_VARIABLES,
  encodeKeyRing,
  keyRingEnv,
  loadKeyRing,
  singleLineKeyRingVariables,
} from "./keyring.js";
export type { EncodedKeyRing, KeyEntry, KeyRing } from "./keyring.js";

// cipher.ts is not exported: using its primitives directly would bypass the store.
export {
  credentialProvisioned,
  credentialRevision,
  deleteCredential,
  getCredential,
  listCredentials,
  putCredential,
  readCredentialMeta,
  rotateCredentials,
  tryGetCredential,
} from "./store.js";
export type { CredentialMeta, CredentialRef, CredentialRowMeta, RotationResult } from "./store.js";

export {
  establishNodeSigningKey,
  nodeSigningPublicKey,
  openNodeSigningKeyRow,
  readNodeIdentity,
  readNodeSigningKey,
  sealNodeSigningKeyTx,
} from "./node-signing-key.js";
export type { SealedSigningKeyRow } from "./node-signing-key.js";

export {
  deleteNodePairLinkOtherThanTx,
  deletePairLinkTx,
  readPairSecret,
  setPairLinkStateTx,
  writePairLinkTx,
} from "./node-pair-link.js";
export type { NewPairLink } from "./node-pair-link.js";

export { CREDENTIALS_TABLES } from "./tables.js";

// Keeps errors.ts's augmentation reachable from the public barrel; guard:
// scripts/errors-reachable.test.ts.
import "./errors.js";

export { resolveBackupKeyInputs } from "./backup-key-inputs.js";
export {
  BackupCredentialReadError,
  CREDENTIALS_BACKUP_POLICY,
  readBackupCredential,
  verifyBackupCredentials,
} from "./backup-verification.js";

export {
  purposeKey,
  purposeKeys,
  sealText,
  openText,
  openTextWithPurposeKeys,
} from "./purpose-seal.js";

export {
  authorityKey,
  backupKey,
  diskKey,
  makeMasterKey,
  masterKeyCheckValue,
  masterKeyId,
  masterKeyMatches,
  printMasterKey,
  readMasterKey,
  sealingPublicKey,
  sealingPublicKeyFrom,
} from "./master-key.js";
export type { SealingPublicKey } from "./master-key.js";
