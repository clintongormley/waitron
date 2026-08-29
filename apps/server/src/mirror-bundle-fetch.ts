// The real HTTP `fetchBundle` the mirror's `POST /setup-api/adopt` injects into `adoptFromPrimary`
// (adopt.ts). It POSTs the operator's admin credential to the primary's
// `POST /management-api/mirror-bundle` (mirror-bundle-api.ts) and parses the returned `MirrorBundle`.
//
// CREDENTIAL SHAPE. The primary authenticates the SAME body its dashboard login does — a JSON object
// `{ personId, password, totp? }` (mirror-bundle-api.ts screens exactly those fields). `AdoptRequest`
// (adopt.ts) types `credential` a single opaque `string` so this transport owns the encoding: the
// connect screen (a later C2b task) serialises that login object into `credential`, and this fetcher
// forwards it VERBATIM as the JSON request body. The mirror never re-derives the login shape, and a
// bare (non-JSON) credential simply fails the primary's screen → a 502 below, never a silent success.
import { AppError } from "@waitron/shared";
import type { MirrorBundle } from "./mirror-bundle.js";
import "./errors.js";

/**
 * Fetch a `MirrorBundle` from the primary at `primaryUrl` using the operator's admin `credential`.
 *
 * ANY failure — a network error reaching the primary, a non-2xx response, or a body that does not
 * parse as JSON — maps to `mirror.bundle_fetch_failed` (Task 6), which the adopt route reports to the
 * operator as HTTP 502 (the mirror is a gateway and its upstream, the primary, failed). The upstream
 * error is NEVER echoed (its `.message` can embed a URL or connection detail — the `sync.*`/`tunnel.*`
 * no-leak discipline), and neither the `credential` nor the returned `syncToken` is ever logged.
 */
export async function fetchMirrorBundle(
  primaryUrl: string,
  credential: string,
): Promise<MirrorBundle> {
  // Strip a trailing slash so `<origin>/` + the path never yields a double slash the primary won't route.
  const url = `${primaryUrl.replace(/\/+$/, "")}/management-api/mirror-bundle`;

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
      body: credential,
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
