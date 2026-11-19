import { Buffer } from "node:buffer";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { TextDecoder } from "node:util";
import { exactRecord } from "./upgrades/contracts.mjs";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^[a-f0-9]{40}$/;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export function isNumberedVersion(version) {
  return typeof version === "string" && version.length <= 50 && VERSION.test(version);
}

export function compareReleaseVersions(candidate, installed) {
  if (!isNumberedVersion(candidate) || !isNumberedVersion(installed))
    throw new Error("Expected a numbered release version");

  const requested = candidate.split(".").map(BigInt);
  const current = installed.split(".").map(BigInt);
  for (const [index, part] of requested.entries()) {
    if (part < current[index]) return -1;
    if (part > current[index]) return 1;
  }
  return 0;
}

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
    !isNumberedVersion(version) ||
    typeof prerelease !== "boolean" ||
    typeof sourceSha !== "string" ||
    !SHA.test(sourceSha) ||
    platform !== "linux/amd64" ||
    !exactRecord(images, ["app", "printAgent"]) ||
    typeof images.app !== "string" ||
    !IMAGE_DIGEST.test(images.app) ||
    typeof images.printAgent !== "string" ||
    !IMAGE_DIGEST.test(images.printAgent) ||
    images.app === images.printAgent
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

function readSignedPayload(bytes, trustedPublicKeys) {
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
  const encodings = keys.map((key) =>
    key.export({ type: "spki", format: "der" }).toString("base64"),
  );
  if (new Set(encodings).size !== keys.length)
    throw new Error("Expected distinct release public keys");
  if (!keys.some((key) => verify(null, payload, key, signature)))
    throw new Error("Invalid release signature");
  return JSON.parse(utf8.decode(payload));
}

export function verifyReleaseList(bytes, trustedPublicKeys) {
  return releasePayload(readSignedPayload(bytes, trustedPublicKeys));
}

function isOfferTarget(target) {
  return target === "none" || isNumberedVersion(target);
}

function isOfferCondition(condition, target) {
  if (exactRecord(condition, ["installations"])) {
    return (
      Array.isArray(condition.installations) &&
      condition.installations.every((id) => typeof id === "string" && id.length > 0)
    );
  }
  if (exactRecord(condition, ["atLeast"])) return isNumberedVersion(condition.atLeast);

  const paused = target === "none";
  return (
    exactRecord(condition, paused ? ["bucketBelow", "bucketVersion"] : ["bucketBelow"]) &&
    Number.isInteger(condition.bucketBelow) &&
    condition.bucketBelow >= 1 &&
    condition.bucketBelow <= 99 &&
    (!paused || isNumberedVersion(condition.bucketVersion))
  );
}

function offerPayload(value) {
  if (
    !exactRecord(value, ["format", "kind", "serial", "entries", "default"]) ||
    value.format !== 1 ||
    value.kind !== "offer" ||
    !Number.isSafeInteger(value.serial) ||
    value.serial < 1 ||
    !Array.isArray(value.entries) ||
    !isOfferTarget(value.default)
  )
    throw new Error("Invalid upgrade offer payload");

  // A rule that the box cannot read may describe which offer that box should receive.
  for (const entry of value.entries) {
    if (!exactRecord(entry, ["condition", "target"]) || !isOfferTarget(entry.target))
      throw new Error("Invalid upgrade offer entry");
    if (!isOfferCondition(entry.condition, entry.target))
      throw new Error("Invalid upgrade offer condition");
  }
  return value;
}

function matchesOffer({ condition, target }, boxId, installedVersion) {
  if (Object.hasOwn(condition, "installations")) return condition.installations.includes(boxId);
  if (Object.hasOwn(condition, "atLeast"))
    return compareReleaseVersions(installedVersion, condition.atLeast) >= 0;

  const version = target === "none" ? condition.bucketVersion : target;
  const hash = createHash("sha256").update(`${boxId}:${version}`).digest();
  return hash.readUInt32BE(0) % 100 < condition.bucketBelow;
}

export function selectUpgradeOffer(
  bytes,
  trustedPublicKeys,
  { boxId, installedVersion, previous },
) {
  if (bytes.byteLength > 16 * 1024) throw new Error("Upgrade offer exceeds 16 KiB");
  const offer = offerPayload(readSignedPayload(bytes, trustedPublicKeys));
  const { serial } = offer;
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    previous &&
    (serial < previous.serial || (serial === previous.serial && digest !== previous.digest))
  )
    throw new Error("Upgrade offer serial was already superseded or used for different bytes");

  const match = offer.entries.find((entry) => matchesOffer(entry, boxId, installedVersion));
  const target = match?.target ?? offer.default;
  const version =
    target !== "none" && compareReleaseVersions(target, installedVersion) > 0 ? target : null;
  return { version, serial, digest };
}
