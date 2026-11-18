import { Buffer } from "node:buffer";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { TextDecoder } from "node:util";
import { exactRecord } from "./upgrades/contracts.mjs";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^[a-f0-9]{40}$/;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function releasePayload(value) {
  if (
    !exactRecord(value, [
      "format",
      "kind",
      "version",
      "prerelease",
      "sourceSha",
      "platform",
      "images",
    ])
  )
    throw new Error("Invalid release payload");
  const { format, kind, version, prerelease, sourceSha, platform, images } = value;
  if (
    format !== 1 ||
    kind !== "release" ||
    typeof version !== "string" ||
    version.length > 50 ||
    !VERSION.test(version) ||
    typeof prerelease !== "boolean" ||
    typeof sourceSha !== "string" ||
    !SHA.test(sourceSha) ||
    platform !== "linux/amd64" ||
    !exactRecord(images, ["app", "printAgent"]) ||
    typeof images.app !== "string" ||
    !IMAGE_DIGEST.test(images.app) ||
    typeof images.printAgent !== "string" ||
    !IMAGE_DIGEST.test(images.printAgent)
  )
    throw new Error("Invalid release payload");
  return {
    format,
    kind,
    version,
    prerelease,
    sourceSha,
    platform,
    images: { app: images.app, printAgent: images.printAgent },
  };
}

function decodeField(value) {
  if (typeof value !== "string" || value === "") throw new Error("Invalid release envelope");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("Invalid release envelope");
  return decoded;
}

export function signReleaseList(release, privateKey) {
  if (!privateKey.startsWith("-----BEGIN PRIVATE KEY-----"))
    throw new Error("Expected a PKCS#8 release signing key");
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Expected an Ed25519 release signing key");
  const payload = Buffer.from(JSON.stringify(releasePayload(release)));
  const signature = sign(null, payload, key);
  return Buffer.from(
    JSON.stringify({
      payload: payload.toString("base64url"),
      signature: signature.toString("base64url"),
    }) + "\n",
  );
}

export function verifyReleaseList(bytes, trustedPublicKeys) {
  const envelope = JSON.parse(utf8.decode(bytes));
  if (!exactRecord(envelope, ["payload", "signature"])) throw new Error("Invalid release envelope");
  const payload = decodeField(envelope.payload);
  const signature = decodeField(envelope.signature);
  const keys = trustedPublicKeys.map((pem) => {
    if (!pem.startsWith("-----BEGIN PUBLIC KEY-----"))
      throw new Error("Expected an SPKI release public key");
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519")
      throw new Error("Expected an Ed25519 release public key");
    return key;
  });
  if (!keys.some((key) => verify(null, payload, key, signature)))
    throw new Error("Invalid release signature");
  return releasePayload(JSON.parse(utf8.decode(payload)));
}
