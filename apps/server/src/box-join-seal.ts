import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import {
  JOIN_APPROVED_LABEL,
  JOIN_BUNDLE_LABEL,
  encodeFields,
  signJoinMessage,
  verifyJoinMessage,
} from "./box-join-code.js";

const IV_BYTES = 12;
const TAG_BYTES = 16;
// The approved answer is repeated unchanged on every poll after approval, so its signature carries
// no rising `seq`; the request id and the hash of the locked bytes tie it to one approval.
const APPROVED_SEQ = 0;

export interface LockedJoinBundle {
  /** The main box's one-use X25519 public key, base64 DER (SPKI). */
  oneUsePublicKey: string;
  /** IV, AES-256-GCM ciphertext and tag, concatenated, base64. */
  ciphertext: string;
  /** The main box's node-key signature over the approved label, request id, one-use key and hash. */
  signature: string;
}

function cipherKey(
  requestId: string,
  shared: Buffer,
  oneUsePublicKey: string,
  encryptionKey: string,
) {
  const info = encodeFields([
    JOIN_BUNDLE_LABEL,
    requestId,
    Buffer.from(oneUsePublicKey, "base64"),
    Buffer.from(encryptionKey, "base64"),
  ]);
  return Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), info, 32));
}

function approvedFields(oneUsePublicKey: string, ciphertext: string): Buffer[] {
  return [
    Buffer.from(oneUsePublicKey, "base64"),
    createHash("sha256").update(Buffer.from(ciphertext, "base64")).digest(),
  ];
}

export function approvedSignature(
  requestId: string,
  oneUsePublicKey: string,
  ciphertext: string,
  mainPrivateKey: string,
): string {
  return signJoinMessage(
    JOIN_APPROVED_LABEL,
    requestId,
    APPROVED_SEQ,
    approvedFields(oneUsePublicKey, ciphertext),
    mainPrivateKey,
  );
}

/** Locks `bundle` so only the holder of `encryptionKey`'s private half can read it, and signs it. */
export function lockJoinBundle(input: {
  requestId: string;
  /** The new box's one-join X25519 public key `Ek`, base64 DER (SPKI). */
  encryptionKey: string;
  bundle: Uint8Array;
  /** The main box's node identity private key, base64 DER (PKCS8). */
  mainPrivateKey: string;
}): LockedJoinBundle {
  const oneUse = generateKeyPairSync("x25519");
  const oneUsePublicKey = oneUse.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const shared = diffieHellman({
    privateKey: oneUse.privateKey,
    publicKey: createPublicKey({
      key: Buffer.from(input.encryptionKey, "base64"),
      format: "der",
      type: "spki",
    }),
  });
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    cipherKey(input.requestId, shared, oneUsePublicKey, input.encryptionKey),
    iv,
  );
  const ciphertext = Buffer.concat([
    iv,
    cipher.update(input.bundle),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
  return {
    oneUsePublicKey,
    ciphertext,
    signature: approvedSignature(
      input.requestId,
      oneUsePublicKey,
      ciphertext,
      input.mainPrivateKey,
    ),
  };
}

/** The bundle, or null when the signature or the lock does not check out. Never throws on wire input. */
export function unlockJoinBundle(input: {
  requestId: string;
  locked: LockedJoinBundle;
  /** The new box's own `Ek`, base64 DER (SPKI). */
  encryptionKey: string;
  /** `Ek`'s private half, base64 DER (PKCS8). */
  encryptionPrivateKey: string;
  /** The main box's node public key from the hello answer, base64 DER (SPKI). */
  mainPublicKey: string;
}): Buffer | null {
  const { locked } = input;
  if (
    !verifyJoinMessage(
      JOIN_APPROVED_LABEL,
      input.requestId,
      APPROVED_SEQ,
      approvedFields(locked.oneUsePublicKey, locked.ciphertext),
      locked.signature,
      input.mainPublicKey,
    )
  ) {
    return null;
  }
  try {
    const shared = diffieHellman({
      privateKey: createPrivateKey({
        key: Buffer.from(input.encryptionPrivateKey, "base64"),
        format: "der",
        type: "pkcs8",
      }),
      publicKey: createPublicKey({
        key: Buffer.from(locked.oneUsePublicKey, "base64"),
        format: "der",
        type: "spki",
      }),
    });
    const bytes = Buffer.from(locked.ciphertext, "base64");
    if (bytes.length < IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      cipherKey(input.requestId, shared, locked.oneUsePublicKey, input.encryptionKey),
      bytes.subarray(0, IV_BYTES),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
}
