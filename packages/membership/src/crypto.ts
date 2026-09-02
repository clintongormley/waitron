import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { NodeKeyPair } from "./types.js";
import "./errors.js";

export function generateNodeKeyPair(): NodeKeyPair {
  // No try/catch: generateKeyPairSync("ed25519") does not throw for this fixed, supported algorithm,
  // so a catch here would be untestable dead code (R2). Only signing (below) can hit a bad key.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

export function signBytes(message: string, privateKeyB64: string): string {
  let key;
  try {
    key = createPrivateKey({
      key: Buffer.from(privateKeyB64, "base64"),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    throw new AppError("membership.key_invalid", { operation: "sign" });
  }
  return sign(null, Buffer.from(message, "utf8"), key).toString("base64");
}

export function verifyBytes(message: string, signatureB64: string, publicKeyB64: string): boolean {
  let key;
  try {
    key = createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    // A malformed public key means we cannot trust the message — treat as a failed verification,
    // not a thrown error, because the key travels in adversarial input (a document from the wire).
    return false;
  }
  // Fail-closed defence on the wire boundary, kept per R2. Proven unreachable for ed25519:
  // node:crypto `verify` returns `false` for malformed/wrong-length signature bytes (empty,
  // short, and over-long all tested) rather than throwing, once the public key is a valid
  // KeyObject — so this catch is untestable here and is ignored for coverage rather than
  // removed, mirroring the unreachable defensive catch in packages/db harness.ts.
  /* v8 ignore start */
  try {
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
  /* v8 ignore stop */
}
