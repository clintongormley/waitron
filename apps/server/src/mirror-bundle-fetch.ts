// `credential` is the primary's by-id login object (`AdoptCredential`), not the dashboard's
// by-email body: the primary's mirror-bundle route authenticates it with `loginManagerById`.
import { AppError } from "@waitron/shared";
import type { AdoptCredential } from "./adopt.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { assertSafePrimaryUrl } from "./primary-url.js";
import "./errors.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStrings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === "string");
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isMirrorBundle(value: unknown): value is MirrorBundle {
  if (!isRecord(value)) return false;
  const { designated, tenant, primaryNode, reservedIdentity, moduleOverrides, wireguardPublicKey } =
    value;
  if (
    !hasStrings(value, ["boxHostname", "boxCaPem", "relayUrl", "accountKey"]) ||
    (value.environment !== "production" && value.environment !== "preproduction") ||
    (wireguardPublicKey !== undefined && typeof wireguardPublicKey !== "string") ||
    !isRecord(designated) ||
    !hasStrings(designated, ["locationId", "tillId", "nodeId", "seriesId"]) ||
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
 * Only the PUBLIC half of the standby's key travels; the private key never leaves the mirror.
 * `standby.contactUrl` may be `""`: a standby that advertises nothing is still a member.
 *
 * A network error, non-2xx response, or malformed bundle is
 * `mirror.bundle_fetch_failed`; the refusal carries no upstream detail that could include a URL or
 * connection information.
 */
export async function fetchMirrorBundle(
  primaryUrl: string,
  credential: AdoptCredential,
  standby: { nodeId: string; publicKey: string; contactUrl: string },
): Promise<MirrorBundle> {
  // Re-checked here so no caller can make this fetch an unvalidated URL; the request is built from
  // the parsed `URL`, not the raw string.
  const url = `${assertSafePrimaryUrl(primaryUrl).href.replace(/\/+$/, "")}/management-api/mirror-bundle`;

  let response: Response;
  try {
    // TRUST BOOTSTRAP: the admin credential is sent over first-contact TLS with no verification of
    // the primary. Safe only on a trusted path; an untrusted network needs the primary verified first.
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...credential,
        standbyNodeId: standby.nodeId,
        standbyPublicKey: standby.publicKey,
        standbyContactUrl: standby.contactUrl,
      }),
    });
  } catch {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }

  if (!response.ok) throw new AppError("mirror.bundle_fetch_failed", {});

  let bundle: unknown;
  try {
    bundle = await response.json();
  } catch {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
  if (!isMirrorBundle(bundle)) throw new AppError("mirror.bundle_fetch_failed", {});
  return bundle;
}
