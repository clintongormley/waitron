import { X509Certificate } from "node:crypto";
import { exactRecord } from "./upgrades/contracts.mjs";

/**
 * @typedef {object} LockedIdentityInput  every certificate is public PEM text; no private key is ever an input
 * @property {string} installationId  1-56 lowercase letters or digits
 * @property {string} caCertificate  the box CA's public certificate
 * @property {string} recoveryCertificate  the per-disk recovery leaf
 * @property {string} redirectCertificate  the untrusted redirect-only certificate
 * @property {number} now  wall-clock milliseconds since 1970, for the validity dates
 * @typedef {object} LockedTarget  frozen
 * @property {string} recoveryHost  "unlock-<installationId>.waitron.local"
 * @property {string} recoveryUrl  "https://unlock-<installationId>.waitron.local/"
 * @property {'ready'|'refused'} redirect
 * @property {string|null} redirectRefusal
 * @typedef {{ kind: 'ready', target: LockedTarget } | { kind: 'refused', reason: string }} LockedTargetResult  frozen
 */

export const BOX_NAME = "waitron.local";

const INPUT_CODE = "recovery_identity.input_invalid";
const INPUT_KEYS = [
  "installationId",
  "caCertificate",
  "recoveryCertificate",
  "redirectCertificate",
  "now",
];
// "unlock-" plus 56 characters is 63, the longest DNS label.
const INSTALLATION_ID = /^[a-z0-9]{1,56}$/;
const BEGIN = "-----BEGIN CERTIFICATE-----";
const END = "-----END CERTIFICATE-----";
const BASE64_LINE = /^[A-Za-z0-9+/=]+$/;

/** @param {string} reason @returns {LockedTargetResult} */
function refused(reason) {
  return Object.freeze({ kind: "refused", reason });
}

/**
 * Exactly one certificate block and nothing else, its lines all ending the same way, so text
 * appended to a certificate (a private key, a second certificate) never rides along.
 * @param {string} text
 */
function oneCertificateBlock(text) {
  const ending = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text.endsWith(ending) ? text.slice(0, -ending.length) : text;
  const lines = body.split(ending);
  return (
    lines.length >= 3 &&
    lines[0] === BEGIN &&
    lines[lines.length - 1] === END &&
    lines.slice(1, -1).every((line) => BASE64_LINE.test(line))
  );
}

/** @param {string} text @returns {X509Certificate | null} */
function parse(text) {
  if (!oneCertificateBlock(text)) return null;
  try {
    return new X509Certificate(text);
  } catch {
    return null;
  }
}

/** @param {string} text @param {X509Certificate} ca @param {X509Certificate} recovery */
function redirectRefusal(text, ca, recovery) {
  const redirect = parse(text);
  if (!redirect) return "certificate-unreadable";
  if (redirect.verify(ca.publicKey)) return "redirect-ca-signed";
  if (!redirect.verify(redirect.publicKey)) return "redirect-not-self-signed";
  if (redirect.ca) return "redirect-is-ca";
  if (redirect.subjectAltName !== `DNS:${BOX_NAME}`) return "redirect-names-wrong";
  const key = redirect.publicKey;
  if ([recovery.publicKey, ca.publicKey].some((other) => other.equals(key))) {
    return "redirect-same-key";
  }
  return null;
}

/**
 * Pure apart from parsing. A string that is not a certificate is a refusal, not a throw.
 * @param {LockedIdentityInput} input @returns {LockedTargetResult}
 */
export function freezeLockedTarget(input) {
  if (!exactRecord(input, INPUT_KEYS)) throw inputInvalid();
  // Each value is read once, so a getter cannot answer one thing to the check and another later.
  const { installationId, caCertificate, recoveryCertificate, redirectCertificate, now } = input;
  if (
    typeof installationId !== "string" ||
    typeof caCertificate !== "string" ||
    typeof recoveryCertificate !== "string" ||
    typeof redirectCertificate !== "string" ||
    typeof now !== "number" ||
    !Number.isFinite(now)
  ) {
    throw inputInvalid();
  }

  if (!INSTALLATION_ID.test(installationId)) return refused("installation-id-invalid");
  const ca = parse(caCertificate);
  const recovery = parse(recoveryCertificate);
  if (!ca || !recovery) return refused("certificate-unreadable");
  if (!ca.ca || !ca.verify(ca.publicKey)) return refused("ca-invalid");
  // checkIssued compares names only; the signature check is what ties the leaf to this CA's key.
  if (!recovery.checkIssued(ca) || !recovery.verify(ca.publicKey)) {
    return refused("recovery-not-ca-signed");
  }
  if (recovery.ca) return refused("recovery-is-ca");
  // The recovery key sits unencrypted on the boot partition; sharing the CA's pair would put the
  // CA's signing key there.
  if (recovery.publicKey.equals(ca.publicKey)) return refused("recovery-same-key");
  const recoveryHost = `unlock-${installationId}.${BOX_NAME}`;
  if (recovery.subjectAltName !== `DNS:${recoveryHost}`) return refused("recovery-names-wrong");
  if (now < recovery.validFromDate.getTime() || now > recovery.validToDate.getTime()) {
    return refused("recovery-expired");
  }
  if (recovery.validToDate > ca.validToDate) return refused("recovery-outlives-ca");

  // The redirect certificate's dates are deliberately not checked: it is untrusted anyway.
  const refusal = redirectRefusal(redirectCertificate, ca, recovery);
  return Object.freeze({
    kind: "ready",
    target: Object.freeze({
      recoveryHost,
      recoveryUrl: `https://${recoveryHost}/`,
      redirect: refusal ? "refused" : "ready",
      redirectRefusal: refusal,
    }),
  });
}

function inputInvalid() {
  return Object.assign(new Error(INPUT_CODE), { code: INPUT_CODE, reason: "input-invalid" });
}
