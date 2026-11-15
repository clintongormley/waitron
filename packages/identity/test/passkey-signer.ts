import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

function cborHead(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}

/** The CBOR subset a `none` attestation and a COSE key need. */
export function cbor(value: unknown): Buffer {
  if (typeof value === "number") return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === "string") {
    const b = Buffer.from(value);
    return Buffer.concat([cborHead(3, b.length), b]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2, value.length), value]);
  if (value instanceof Map) {
    return Buffer.concat([
      cborHead(5, value.size),
      ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]),
    ]);
  }
  throw new Error("unsupported CBOR value");
}

export const rpIdHash = (rpId: string) => createHash("sha256").update(rpId).digest();

export function newKey(): { cose: Buffer; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = cbor(
    new Map<unknown, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );
  return { cose, privateKey };
}

/**
 * A passkey signed with `node:crypto`: the stored row's values, and a signer of assertions for
 * `rpId` as a browser at `origin` would make them, user present and verified.
 */
export function signingPasskey(rpId: string) {
  const { cose, privateKey } = newKey();
  const credentialId = randomBytes(32).toString("base64url");
  const assert = (challenge: string, origin: string) => {
    const clientData = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }),
    );
    const authData = Buffer.concat([
      rpIdHash(rpId),
      Buffer.from([0x05]),
      Buffer.from([0, 0, 0, 1]),
    ]);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, createHash("sha256").update(clientData).digest()]),
      privateKey,
    );
    return {
      id: credentialId,
      rawId: credentialId,
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientData.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  };
  return { credentialId, publicKey: cose.toString("base64url"), assert };
}
