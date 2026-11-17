import { createHmac } from "node:crypto";
import { aadFor, open, seal } from "./cipher.js";
import { keyForVersion, type KeyEntry, type KeyRing } from "./keyring.js";

export function purposeKey(entry: KeyEntry, purpose: string): Buffer {
  return createHmac("sha256", entry.key).update(`waitron.${purpose}.v1`).digest();
}

export function purposeKeys(ring: KeyRing, purpose: string): Buffer[] {
  return [
    purposeKey(ring.current, purpose),
    ...(ring.previous ? [purposeKey(ring.previous, purpose)] : []),
  ];
}

export function sealText(ring: KeyRing, purpose: string, plaintext: string): string {
  const sealed = seal(purposeKey(ring.current, purpose), aadFor(purpose), plaintext);
  return [
    "v2",
    String(ring.current.version),
    sealed.iv.toString("base64url"),
    sealed.authTag.toString("base64url"),
    sealed.ciphertext.toString("base64url"),
  ].join(".");
}

export function openText(
  ring: KeyRing,
  purpose: string,
  stored: string,
): { value: string; keyVersion: number } | null {
  const parts = stored.split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return null;
  const keyVersion = Number(parts[1]);
  if (!Number.isInteger(keyVersion)) return null;
  const key = keyForVersion(ring, keyVersion);
  if (key === null) return null;
  const value = open(purposeKey({ key, version: keyVersion }, purpose), aadFor(purpose), {
    iv: Buffer.from(parts[2]!, "base64url"),
    authTag: Buffer.from(parts[3]!, "base64url"),
    ciphertext: Buffer.from(parts[4]!, "base64url"),
  });
  return value === null ? null : { value, keyVersion };
}
