import {
  base64,
  bounded,
  encoder,
  exact,
  fromDer,
  guarded,
  material,
  random,
  refuse,
  scopeOf,
  unbase64,
} from "./internal.js";
import type { CustodyKey, CustodyPublic, CustodyScope } from "./internal.js";
export type { CustodyKey, CustodyPublic, CustodyScope } from "./internal.js";

function password(value: unknown): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(bounded(value, 1024));
  if (bytes.length < 12) refuse();
  return bytes;
}
async function derive(
  passphrase: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey("raw", passphrase, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export function createCustodyKey(scope: CustodyScope): Promise<CustodyKey> {
  return guarded(async () => {
    const normalized = scopeOf(scope);
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    return fromDer(
      new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
      normalized,
      "created",
    );
  });
}
export function protectCustodyKey(key: CustodyKey, passphrase: string): Promise<string> {
  return guarded(async () => {
    const bytes = password(passphrase);
    const { der } = material(key);
    const salt = random(16),
      iv = random(12);
    const header = {
      kind: "waitron-custodian-key",
      version: 1,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: base64(salt) },
      cipher: { name: "AES-GCM", bits: 256, iv: base64(iv), tagBits: 128 },
      scope: key.scope,
      fingerprint: key.fingerprint,
    };
    const aad = encoder.encode(
      JSON.stringify([
        header.kind,
        header.version,
        header.kdf,
        header.cipher,
        header.scope,
        header.fingerprint,
      ]),
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      await derive(bytes, salt),
      encoder.encode(JSON.stringify({ version: 1, pkcs8: base64(der) })),
    );
    return JSON.stringify({ ...header, ciphertext: base64(new Uint8Array(encrypted)) });
  });
}
export function openCustodyKey(
  fileText: string,
  passphrase: string,
  expected: CustodyPublic,
): Promise<CustodyKey> {
  return guarded(async () => {
    const bytes = password(passphrase);
    const envelope: unknown = JSON.parse(bounded(fileText));
    if (
      !exact(envelope, [
        "kind",
        "version",
        "kdf",
        "cipher",
        "scope",
        "fingerprint",
        "ciphertext",
      ]) ||
      envelope.kind !== "waitron-custodian-key" ||
      envelope.version !== 1 ||
      !exact(envelope.kdf, ["name", "hash", "iterations", "salt"]) ||
      envelope.kdf.name !== "PBKDF2" ||
      envelope.kdf.hash !== "SHA-256" ||
      envelope.kdf.iterations !== 600000 ||
      !exact(envelope.cipher, ["name", "bits", "iv", "tagBits"]) ||
      envelope.cipher.name !== "AES-GCM" ||
      envelope.cipher.bits !== 256 ||
      envelope.cipher.tagBits !== 128 ||
      typeof envelope.fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(envelope.fingerprint)
    )
      refuse();
    const scope = scopeOf(envelope.scope);
    const salt = unbase64(envelope.kdf.salt, 16),
      iv = unbase64(envelope.cipher.iv, 12);
    const encrypted = unbase64(envelope.ciphertext, 17, 4112);
    const kdf = { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: envelope.kdf.salt };
    const cipher = { name: "AES-GCM", bits: 256, iv: envelope.cipher.iv, tagBits: 128 };
    const aad = encoder.encode(
      JSON.stringify([envelope.kind, envelope.version, kdf, cipher, scope, envelope.fingerprint]),
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      await derive(bytes, salt),
      encrypted,
    );
    const payload: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
    );
    if (!exact(payload, ["version", "pkcs8"]) || payload.version !== 1) refuse();
    const key = await fromDer(unbase64(payload.pkcs8, 48), scope, "saved-file", expected);
    if (key.fingerprint !== envelope.fingerprint) {
      key.dispose();
      refuse();
    }
    return key;
  });
}
