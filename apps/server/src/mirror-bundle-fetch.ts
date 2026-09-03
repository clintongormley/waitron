// The real HTTP `fetchBundle` the mirror's `POST /setup-api/adopt` injects into `adoptFromPrimary`
// (adopt.ts). It POSTs the operator's admin credential to the primary's
// `POST /management-api/mirror-bundle` (mirror-bundle-api.ts) and parses the returned `MirrorBundle`.
//
// CREDENTIAL SHAPE. `credential` is NOT an opaque string — it is the primary's login OBJECT
// (`AdoptCredential`: `{ personId, password, totp? }`), the body the primary's MIRROR-BUNDLE route
// (`POST /management-api/mirror-bundle`, mirror-bundle-api.ts) authenticates by id via `loginManagerById`
// (it screens exactly those fields). This is deliberately NOT the dashboard login body — dashboard sign-in
// authenticates `{ email, password, totp }` by email, but this is a server-to-server flow carrying the
// admin's id (the operator types it into the setup connect screen), so the mirror path authenticates it by id
// instead. It travels as a structured type end to end (connect screen →
// `/setup-api/adopt` → here → the primary), so this fetcher simply serialises it as the JSON request body —
// no string-threading, and a wrong shape is rejected at the mirror's own `/setup-api/adopt` boundary
// (a clean 4xx) before it ever reaches this transport.
import { AppError } from "@waitron/shared";
import type { AdoptCredential } from "./adopt.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { assertSafePrimaryUrl } from "./primary-url.js";
import "./errors.js";

/**
 * Fetch a `MirrorBundle` from the primary at `primaryUrl` using the operator's admin `credential`,
 * carrying the mirror's own `standby` identity (membership promotion R2) for the primary to reserve +
 * endorse. Only the standby's PUBLIC half + nodeId travel — the private key is minted and sealed
 * mirror-side (`generateStandbyIdentity`/`establishReservedStandbyIdentity`), never sent.
 *
 * The standby fields ride the SAME JSON body as the credential, flattened as `standbyNodeId` /
 * `standbyPublicKey`: the primary's route screens both alongside the credential in one body read, and
 * a malformed standby there is refused `mirror.standby_invalid` (400) rather than folded into the
 * credential's `password.invalid` (401).
 *
 * ANY failure — a network error reaching the primary, a non-2xx response, or a body that does not
 * parse as JSON — maps to `mirror.bundle_fetch_failed` (Task 6), which the adopt route reports to the
 * operator as HTTP 502 (the mirror is a gateway and its upstream, the primary, failed). The upstream
 * error is NEVER echoed (its `.message` can embed a URL or connection detail — the `sync.*`/`tunnel.*`
 * no-leak discipline), and neither the `credential` nor the returned `syncToken` is ever logged.
 */
export async function fetchMirrorBundle(
  primaryUrl: string,
  credential: AdoptCredential,
  standby: { nodeId: string; publicKey: string },
): Promise<MirrorBundle> {
  // Defense in depth: re-run the SSRF guard at the fetch boundary (setup-api validates before it reaches
  // here, but this fetcher must be safe for any caller — it never builds a request from an unvalidated
  // string). `assertSafePrimaryUrl` throws `mirror.primary_url_invalid` on a scheme/host the policy
  // refuses, and returns the PARSED URL the request is built from — no raw-string concat of attacker input.
  // Strip a trailing slash from the parsed href so `<origin>/` + the path never yields a double slash the
  // primary won't route (the existing trailing-slash behaviour, now off the normalised href).
  const url = `${assertSafePrimaryUrl(primaryUrl).href.replace(/\/+$/, "")}/management-api/mirror-bundle`;

  let response: Response;
  try {
    // TRUST BOOTSTRAP (spec §9): v1 sends the admin credential over the primary's first-contact TLS.
    // This is safe ONLY on a trusted path (the stand-in is localhost). A mirror reaching a primary over an
    // UNTRUSTED network MUST NOT reuse this as-is: it must first verify the primary (a real public-CA cert,
    // or a fingerprint-before-credential step) BEFORE this credential is transmitted. Do not lift this to a
    // reachable-over-the-internet flow without that.
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...credential,
        standbyNodeId: standby.nodeId,
        standbyPublicKey: standby.publicKey,
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
