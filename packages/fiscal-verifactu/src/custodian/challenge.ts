import {
  base64,
  encoder,
  exact,
  expectedPublic,
  guarded,
  matches,
  material,
  random,
  refuse,
  scopeOf,
  text,
  unbase64,
} from "./internal.js";
import type { CustodyKey, CustodyPublic, CustodyScope } from "./internal.js";

interface CustodyCheck {
  readonly requestId: string;
  readonly kind: "saved-file" | "secret-paper";
}
export interface CustodyCheckReceipt extends CustodyCheck {
  readonly version: 1;
  readonly fingerprint: string;
  readonly nonce: string;
  readonly signature: string;
}
function checkOf(value: CustodyCheck): CustodyCheck {
  if (
    !exact(value, ["requestId", "kind"]) ||
    !text(value.requestId) ||
    (value.kind !== "saved-file" && value.kind !== "secret-paper")
  )
    refuse();
  return Object.freeze({ requestId: value.requestId, kind: value.kind });
}
function challengeBytes(
  check: CustodyCheck,
  scope: CustodyScope,
  fingerprint: string,
  nonce: string,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify([
      "waitron.custody-check",
      1,
      check.requestId,
      check.kind,
      scope,
      fingerprint,
      nonce,
    ]),
  );
}
export function checkCustodyChallenge(
  key: CustodyKey,
  expected: CustodyPublic,
  check: CustodyCheck,
): Promise<CustodyCheckReceipt> {
  return guarded(async () => {
    const binding = checkOf(check);
    const privateMaterial = material(key);
    if (privateMaterial.origin !== binding.kind) refuse();
    const publicKey = await matches(key, expected);
    const nonce = base64(random(32));
    const bytes = challengeBytes(binding, key.scope, key.fingerprint, nonce);
    const signature = await crypto.subtle.sign("Ed25519", privateMaterial.privateKey, bytes);
    if (!(await crypto.subtle.verify("Ed25519", publicKey, signature, bytes))) refuse();
    return {
      version: 1,
      requestId: binding.requestId,
      kind: binding.kind,
      fingerprint: key.fingerprint,
      nonce,
      signature: base64(new Uint8Array(signature)),
    };
  });
}
export function createCustodyCheckVerifier(
  expected: CustodyPublic,
  check: CustodyCheck,
): (receipt: unknown) => Promise<boolean> {
  const binding = checkOf(check);
  const authority = Object.freeze({
    scope: scopeOf(expected.scope),
    publicKey: expected.publicKey,
    fingerprint: expected.fingerprint,
  });
  const used = new Set<string>();
  return async (receipt: unknown) => {
    try {
      if (
        !exact(receipt, ["version", "requestId", "kind", "fingerprint", "nonce", "signature"]) ||
        receipt.version !== 1 ||
        receipt.requestId !== binding.requestId ||
        receipt.kind !== binding.kind ||
        receipt.fingerprint !== authority.fingerprint
      )
        return false;
      unbase64(receipt.nonce, 32);
      const signature = unbase64(receipt.signature, 64);
      const nonce = receipt.nonce as string;
      if (used.has(nonce)) return false;
      // Claim before the asynchronous verifier so concurrent copies cannot both pass.
      used.add(nonce);
      return await crypto.subtle.verify(
        "Ed25519",
        await expectedPublic(authority),
        signature,
        challengeBytes(binding, authority.scope, authority.fingerprint, nonce),
      );
    } catch {
      return false;
    }
  };
}
