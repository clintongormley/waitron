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
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    // Fail closed on any malformed wire input — a bad public key (createPublicKey throws) or,
    // defensively, a throwing verify() on some runtime. Both mean "cannot trust this" → false. The
    // key travels in adversarial input (a document from the wire), so this is a data failure, not a
    // thrown error. The malformed-public-key test exercises this catch, so it stays covered.
    return false;
  }
}
