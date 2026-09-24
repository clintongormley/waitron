import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { NodeKeyPair } from "./types.js";
import "./errors.js";

export function generateNodeKeyPair(): NodeKeyPair {
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
    // Fail closed: the key arrives in wire input, so a malformed one means "cannot trust this", not
    // an error.
    return false;
  }
}
