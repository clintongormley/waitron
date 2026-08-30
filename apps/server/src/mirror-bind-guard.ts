// Fail-closed boot guard for the mirror's UNAUTHENTICATED admin surface (sync cloud-mirror hardening).
//
// A mirror node fronts the whole dashboard with an ambient full-admin viewer: `ensureMirrorViewer`
// seeds it and `mirrorSession` auto-injects its session cookie on every request (boot.ts, wired only
// when `deployment.mode === 'mirror'`). Nothing else authenticates that surface — the ONLY thing
// keeping it off the network is that the server binds to `config.httpHost`, whose default is the
// loopback `127.0.0.1`. Setting `WAITRON_HTTP_HOST=0.0.0.0` (or any routable host) would expose the
// unauthenticated admin dashboard with no auth. This guard refuses exactly that: under mirror mode,
// a non-loopback bind throws `server.mirror_bind_exposed` BEFORE `serve(...)` binds the socket,
// unless the operator explicitly opts in via `WAITRON_MIRROR_ALLOW_EXPOSED`.
//
// Real per-user auth + TLS is the hosting slice and is OUT OF SCOPE here; the opt-in ONLY silences
// this stopgap guard and does NOT discharge that owed work. A primary may legitimately bind
// non-loopback (a LAN till host, the tunnel origin), so the guard is mirror-only.
import { AppError } from "@waitron/shared";
import type { ServerConfig } from "./config.js";
import { isLoopbackHost } from "./primary-url.js";
import "./errors.js";

/**
 * Throw `server.mirror_bind_exposed` (naming `config.httpHost`) when a MIRROR node would bind a
 * non-loopback host without the `WAITRON_MIRROR_ALLOW_EXPOSED` opt-in. A no-op for a primary, for a
 * loopback bind, and when the opt-in is truthy. Call it before the listener binds.
 *
 * `config.httpHost` is the RAW `WAITRON_HTTP_HOST` value (`127.0.0.1`, `::1`, `localhost`, `0.0.0.0`,
 * `::`, or a hostname), not a `new URL`-normalized one. That is safe for `isLoopbackHost`'s
 * documented fail-closed contract: any form it does not recognize as loopback is treated as
 * non-loopback, so the worst this guard can do is refuse a bind that was actually loopback — it can
 * never wrongly ALLOW a non-loopback bind.
 */
export function assertMirrorBindSafe(
  config: Pick<ServerConfig, "httpHost">,
  isMirror: boolean,
  env: Record<string, string | undefined>,
): void {
  if (!isMirror) return;
  if (isLoopbackHost(config.httpHost)) return;
  if (isExposureAllowed(env)) return;
  throw new AppError("server.mirror_bind_exposed", { host: config.httpHost });
}

/**
 * The opt-in that silences the bind guard. Only the literal `"true"` or `"1"` count, matching
 * `till-config.ts`'s `WAITRON_TILL_TIPS` convention — anything else (including a typo, or an empty
 * `WAITRON_MIRROR_ALLOW_EXPOSED=`) fails safe to NOT opted in, so the guard stays armed.
 */
function isExposureAllowed(env: Record<string, string | undefined>): boolean {
  const raw = env.WAITRON_MIRROR_ALLOW_EXPOSED;
  return raw === "true" || raw === "1";
}
