// `credential` is the primary's by-id login object (`AdoptCredential`), not the dashboard's
// by-email body: the primary's mirror-bundle route authenticates it with `loginManagerById`.
import { AppError } from "@waitron/shared";
import type { AdoptCredential } from "./adopt.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { assertSafePrimaryUrl } from "./primary-url.js";
import "./errors.js";

/**
 * Only the PUBLIC half of the standby's key travels; the private key never leaves the mirror.
 * `standby.contactUrl` may be `""`: a standby that advertises nothing is still a member.
 *
 * Any failure (network, non-2xx, unparseable body) is `mirror.bundle_fetch_failed`; the upstream
 * error is discarded, because its message can embed a URL or connection detail.
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

  try {
    return (await response.json()) as MirrorBundle;
  } catch {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
}
