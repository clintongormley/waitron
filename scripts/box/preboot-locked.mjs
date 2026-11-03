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
const SERVER_AUTH = "1.3.6.1.5.5.7.3.1";

// Only results this module built reach the request decisions, so a hand-built target cannot.
/** @type {WeakSet<object>} */
const GENUINE = new WeakSet();

/** @template {object} T @param {T} result @returns {T} */
function genuine(result) {
  GENUINE.add(result);
  return result;
}

/** @param {string} reason @returns {LockedTargetResult} */
function refused(reason) {
  return genuine(Object.freeze({ kind: "refused", reason }));
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

/**
 * Node 26's TLS client refused the handshake when the leaf or its CA had an extended key usage
 * without serverAuth, anyExtendedKeyUsage alone included; with no such extension it accepted.
 * @param {X509Certificate} certificate
 */
function allowsServerAuth(certificate) {
  return certificate.keyUsage === undefined || certificate.keyUsage.includes(SERVER_AUTH);
}

/** @param {string} text @param {X509Certificate} ca @param {X509Certificate} recovery */
function redirectRefusal(text, ca, recovery) {
  const redirect = parse(text);
  if (!redirect) return "certificate-unreadable";
  if (redirect.verify(ca.publicKey)) return "redirect-ca-signed";
  if (!redirect.verify(redirect.publicKey)) return "redirect-not-self-signed";
  if (redirect.ca) return "redirect-is-ca";
  if (redirect.subjectAltName !== `DNS:${BOX_NAME}`) return "redirect-names-wrong";
  // A certificate carrying the CA's key never reaches here: it either verifies with the CA's key or
  // is not self-signed.
  if (redirect.publicKey.equals(recovery.publicKey)) return "redirect-same-key";
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
  if (!allowsServerAuth(ca)) return refused("ca-not-server-auth");
  // checkIssued matches the issuer's name and key identifier, both of which another CA can copy;
  // only the signature check ties the leaf to this CA's key.
  if (!recovery.checkIssued(ca) || !recovery.verify(ca.publicKey)) {
    return refused("recovery-not-ca-signed");
  }
  if (recovery.ca) return refused("recovery-is-ca");
  // The recovery key sits unencrypted on the boot partition; sharing the CA's pair would put the
  // CA's signing key there.
  if (recovery.publicKey.equals(ca.publicKey)) return refused("recovery-same-key");
  const recoveryHost = `unlock-${installationId}.${BOX_NAME}`;
  if (recovery.subjectAltName !== `DNS:${recoveryHost}`) return refused("recovery-names-wrong");
  if (!allowsServerAuth(recovery)) return refused("recovery-not-server-auth");
  if (now < recovery.validFromDate.getTime() || now > recovery.validToDate.getTime()) {
    return refused("recovery-expired");
  }
  if (recovery.validToDate > ca.validToDate) return refused("recovery-outlives-ca");
  // A CA past its validTo cannot get here: the two checks above already refuse every such leaf.
  if (now < ca.validFromDate.getTime()) return refused("ca-not-yet-valid");

  // The redirect certificate's dates are deliberately not checked: it is untrusted anyway.
  const refusal = redirectRefusal(redirectCertificate, ca, recovery);
  return genuine(
    Object.freeze({
      kind: "ready",
      target: Object.freeze({
        recoveryHost,
        recoveryUrl: `https://${recoveryHost}/`,
        redirect: refusal ? "refused" : "ready",
        redirectRefusal: refusal,
      }),
    }),
  );
}

function inputInvalid() {
  return Object.assign(new Error(INPUT_CODE), { code: INPUT_CODE, reason: "input-invalid" });
}

const REQUEST_CODE = "locked_request.invalid";
const REQUEST_KEYS = ["scheme", "identity", "host", "method"];
const DEFAULT_PORT = { http: ":80", https: ":443" };
const READS = ["GET", "HEAD"];

/**
 * @typedef {object} LockedRequest  exactly these keys: no path, query, headers or body ever reaches the decision
 * @property {'http'|'https'} scheme
 * @property {'recovery'|'redirect'|null} identity  null for http; for https, what selectLockedIdentity chose
 * @property {string|null} host  the request's Host header as received
 * @property {string} method
 * @typedef {{kind:'redirect', status:302, headers:{location:string, 'cache-control':'no-store'}}
 *   | {kind:'refuse', status:405, headers:{allow:'GET, HEAD', 'cache-control':'no-store'}}
 *   | {kind:'refuse', status:421, headers:{'cache-control':'no-store'}}
 *   | {kind:'explain', status:503, code:'unlock.remote_unavailable', reason:string, headers:{'cache-control':'no-store'}}
 *   | {kind:'unlock'}} LockedDecision  frozen; 'unlock' hands the request to the trusted key screen
 */

/** @param {string} reason */
function requestInvalid(reason) {
  return Object.assign(new Error(REQUEST_CODE), { code: REQUEST_CODE, reason });
}

/** @param {unknown} result @returns {LockedTargetResult} */
function genuineResult(result) {
  if (!GENUINE.has(/** @type {object} */ (result))) throw requestInvalid("target-invalid");
  return /** @type {LockedTargetResult} */ (result);
}

/**
 * toLowerCase would fold the Kelvin sign (U+212A) into "k", so a name outside printable ASCII matches nothing.
 * @param {string} name @returns {string|null}
 */
function asciiLower(name) {
  if (/[^ -~]/.test(name)) return null;
  return name.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/**
 * For the TLS adapter's name callback; null means no certificate, so the handshake ends.
 * @param {LockedTargetResult} result @param {string|undefined} serverName
 * @returns {'recovery'|'redirect'|null}
 */
export function selectLockedIdentity(result, serverName) {
  const checked = genuineResult(result);
  if (checked.kind !== "ready" || typeof serverName !== "string") return null;
  const name = asciiLower(serverName);
  if (name === null) return null;
  if (name === checked.target.recoveryHost) return "recovery";
  if (name === BOX_NAME && checked.target.redirect === "ready") return "redirect";
  return null;
}

/** @param {unknown} request @returns {LockedRequest} */
function checkedRequest(request) {
  if (!exactRecord(request, REQUEST_KEYS)) throw requestInvalid("request-invalid");
  const { scheme, identity, host, method } = /** @type {Record<string, unknown>} */ (request);
  const identityFits =
    scheme === "http"
      ? identity === null
      : scheme === "https" && (identity === "recovery" || identity === "redirect");
  if (!identityFits || (host !== null && typeof host !== "string") || typeof method !== "string") {
    throw requestInvalid("request-invalid");
  }
  return /** @type {LockedRequest} */ ({ scheme, identity, host, method });
}

/** @param {LockedRequest} request */
function hostName(request) {
  const host = request.host === null ? null : asciiLower(request.host);
  if (host === null) return null;
  const port = DEFAULT_PORT[request.scheme];
  return host.endsWith(port) ? host.slice(0, -port.length) : host;
}

/** @template {object} T @param {T} headers @returns {Readonly<T & {'cache-control': 'no-store'}>} */
function noStore(headers) {
  return Object.freeze({ ...headers, "cache-control": "no-store" });
}

/** @returns {LockedDecision} */
function notAllowed() {
  return Object.freeze({ kind: "refuse", status: 405, headers: noStore({ allow: "GET, HEAD" }) });
}

/** @returns {LockedDecision} */
function misdirected() {
  return Object.freeze({ kind: "refuse", status: 421, headers: noStore({}) });
}

/** @param {LockedTarget} target @param {string} method @returns {LockedDecision} */
function redirectOrRefuse(target, method) {
  if (!READS.includes(method)) return notAllowed();
  return Object.freeze({
    kind: "redirect",
    status: 302,
    headers: noStore({ location: target.recoveryUrl }),
  });
}

/**
 * Neither redirect route ever offers a form: no decision has a body, and only the recovery
 * certificate with its own name in Host reaches the key screen.
 * @param {LockedTargetResult} result @param {LockedRequest} request @returns {LockedDecision}
 */
export function decideLockedRequest(result, request) {
  const checked = genuineResult(result);
  // Each value is read once, from the checked copy, so a getter cannot change its answer.
  const fields = checkedRequest(request);
  const { scheme, identity, method } = fields;

  if (checked.kind === "refused") {
    if (scheme === "https") throw requestInvalid("identity-unavailable");
    if (!READS.includes(method)) return notAllowed();
    return Object.freeze({
      kind: "explain",
      status: 503,
      code: "unlock.remote_unavailable",
      reason: checked.reason,
      headers: noStore({}),
    });
  }

  const { target } = checked;
  const host = hostName(fields);
  if (scheme === "http") {
    if (host !== BOX_NAME && host !== target.recoveryHost) return misdirected();
    return redirectOrRefuse(target, method);
  }
  if (identity === "redirect") {
    if (target.redirect !== "ready") throw requestInvalid("identity-unavailable");
    return redirectOrRefuse(target, method);
  }
  if (host !== target.recoveryHost) return misdirected();
  return Object.freeze({ kind: "unlock" });
}
