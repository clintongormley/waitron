// `credential` is the primary's by-id login object (`AdoptCredential`), not the dashboard's
// by-email body: the primary's mirror-bundle route authenticates it with `loginManagerById`.
import { X509Certificate } from "node:crypto";
import { request, type RequestOptions } from "node:https";
import { AppError } from "@waitron/shared";
import type { AdoptCredential } from "./adopt.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { assertSafePrimaryUrl } from "./primary-url.js";
import "./errors.js";
// The registry of the code this file relays from the primary.
import "@waitron/identity";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStrings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === "string");
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isKeyEntry(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.key === "string" && typeof value.version === "number";
}

function isEncodedKeyRing(value: unknown): boolean {
  return isKeyEntry(value) && (value.previous === undefined || isKeyEntry(value.previous));
}

function isMirrorBundle(value: unknown): value is MirrorBundle {
  if (!isRecord(value)) return false;
  const { designated, tenant, primaryNode, reservedIdentity, moduleOverrides, wireguardPublicKey } =
    value;
  if (
    !hasStrings(value, [
      "boxHostname",
      "boxCaPem",
      "relayUrl",
      "accountKey",
      "primaryPublicKey",
      "boxCaKeyPem",
    ]) ||
    !isEncodedKeyRing(value.credentialsRing) ||
    (value.environment !== "production" && value.environment !== "preproduction") ||
    (wireguardPublicKey !== undefined && typeof wireguardPublicKey !== "string") ||
    !isRecord(designated) ||
    !hasStrings(designated, ["locationId", "nodeId"]) ||
    !isRecord(tenant) ||
    !hasStrings(tenant, ["country", "taxId"]) ||
    !isRecord(primaryNode) ||
    !hasStrings(primaryNode, ["name"]) ||
    !isNullableString(primaryNode.filingModule) ||
    !isNullableString(primaryNode.taxModule) ||
    !isRecord(reservedIdentity) ||
    !isRecord(reservedIdentity.modules) ||
    !Array.isArray(reservedIdentity.series) ||
    !reservedIdentity.series.every(
      (entry: unknown) => isRecord(entry) && hasStrings(entry, ["code", "purpose"]),
    ) ||
    !isRecord(reservedIdentity.endorsement) ||
    !hasStrings(reservedIdentity.endorsement, ["nodeId", "publicKey", "endorsedBy", "signature"]) ||
    !isRecord(moduleOverrides) ||
    !Object.values(moduleOverrides).every((override) => typeof override === "boolean")
  ) {
    return false;
  }
  // Module-owned reservation values remain opaque to the bundle carrier.
  return true;
}

/**
 * The primary's refused login is relayed as `password.invalid`, rebuilt here so nothing the primary
 * wrote travels on; every other refusal is `mirror.bundle_fetch_failed`.
 */
async function refusalFrom(response: Response): Promise<AppError> {
  let code: unknown;
  try {
    const body: unknown = await response.json();
    code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
  } catch {
    code = undefined;
  }
  if (code === "password.invalid") return new AppError("password.invalid", {});
  return new AppError("mirror.bundle_fetch_failed", {});
}

// A box's authority certificate is about 1–2 KiB; anything far larger is not one.
const MAX_CERTIFICATE_BYTES = 64 * 1024;

function httpsExchange(
  url: URL,
  options: {
    method: "GET" | "POST";
    trust: Pick<RequestOptions, "ca" | "rejectUnauthorized">;
    body?: string;
  },
  maxBytes?: number,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method,
        agent: false,
        ...options.trust,
        headers:
          options.body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(options.body),
              },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (maxBytes !== undefined && size > maxBytes) {
            req.destroy(new Error("answer too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ status: Number(res.statusCode), text: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/**
 * The main box's authority certificate, read before anything secret is sent so the person can
 * compare its fingerprint with the one the main box shows. `null` for a plain-http address, which
 * only a loopback host may use and which carries no certificate to compare.
 */
export async function fetchPrimaryCertificate(
  primaryUrl: string,
): Promise<{ pem: string; fingerprint256: string } | null> {
  const base = assertSafePrimaryUrl(primaryUrl);
  if (base.protocol === "http:") return null;
  const url = new URL(`${base.href.replace(/\/+$/, "")}/ca.crt`);

  let answer: { status: number; text: string };
  try {
    // The only request that does not verify the box: it carries no credential, body or cookie, and
    // what it returns is a public certificate nothing trusts until the person has compared its
    // fingerprint with the one the main box shows. The bundle request then trusts that one
    // certificate and nothing else.
    answer = await httpsExchange(
      url,
      { method: "GET", trust: { rejectUnauthorized: false } },
      MAX_CERTIFICATE_BYTES,
    );
  } catch {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
  if (answer.status !== 200) throw new AppError("mirror.bundle_fetch_failed", {});
  const certificate = authorityCertificate(answer.text);
  if (certificate === null) throw new AppError("mirror.bundle_fetch_failed", {});
  return { pem: certificate.toString(), fingerprint256: certificate.fingerprint256 };
}

/** One PEM certificate that is an authority, or `null`. */
function authorityCertificate(pem: string): X509Certificate | null {
  if (pem.match(/-----BEGIN CERTIFICATE-----/g)?.length !== 1) return null;
  try {
    const certificate = new X509Certificate(pem);
    return certificate.ca ? certificate : null;
  } catch {
    return null;
  }
}

function sameAuthority(bundleCaPem: string, confirmedCaPem: string): boolean {
  try {
    return (
      new X509Certificate(bundleCaPem).fingerprint256 ===
      new X509Certificate(confirmedCaPem).fingerprint256
    );
  } catch {
    return false;
  }
}

/**
 * Only the PUBLIC half of the standby's key travels; the private key never leaves the mirror.
 * `standby.contactUrl` may be `""`: a standby that advertises nothing is still a member.
 *
 * A network error, a non-2xx response `refusalFrom` does not relay, unparseable JSON, or a
 * malformed bundle is `mirror.bundle_fetch_failed`; no refusal carries upstream detail that could
 * include a URL or connection information.
 */
export async function fetchMirrorBundle(
  primaryUrl: string,
  credential: AdoptCredential,
  standby: { nodeId: string; publicKey: string; contactUrl: string },
  confirmedCaPem?: string,
): Promise<MirrorBundle> {
  // Re-checked here so no caller can make this fetch an unvalidated URL; the request is built from
  // the parsed `URL`, not the raw string.
  const base = assertSafePrimaryUrl(primaryUrl);
  const url = `${base.href.replace(/\/+$/, "")}/management-api/mirror-bundle`;
  // Plain http is allowed only to a loopback host, which only this machine can answer, so it needs
  // no confirmation. Every https request, `localhost` included, is sent only to the authority the
  // person confirmed, and before any connection is opened when there is none.
  const https = base.protocol === "https:";
  if (https && confirmedCaPem === undefined) {
    throw new AppError("mirror.primary_unconfirmed", {});
  }
  const body = JSON.stringify({
    ...credential,
    standbyNodeId: standby.nodeId,
    standbyPublicKey: standby.publicKey,
    standbyContactUrl: standby.contactUrl,
  });

  let response: Response;
  try {
    if (https) {
      // `ca` is the confirmed AUTHORITY: trusting the box's own leaf instead would refuse it.
      const answer = await httpsExchange(new URL(url), {
        method: "POST",
        trust: { ca: confirmedCaPem },
        body,
      });
      response = new Response(answer.text, { status: answer.status });
    } else {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    }
  } catch {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }

  if (!response.ok) throw await refusalFrom(response);

  let bundle: unknown;
  try {
    bundle = await response.json();
  } catch {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
  if (!isMirrorBundle(bundle)) throw new AppError("mirror.bundle_fetch_failed", {});
  // The box that answered is under the confirmed authority; the bundle it sent must name that
  // authority too, or the spare would go on to trust a different one.
  if (confirmedCaPem !== undefined && !sameAuthority(bundle.boxCaPem, confirmedCaPem)) {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
  return bundle;
}
