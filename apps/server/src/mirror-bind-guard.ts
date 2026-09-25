// A mirror serves an unauthenticated full-admin dashboard (`mirrorSession`); the only thing keeping
// it off the network is binding a loopback `httpHost`. The opt-in silences this guard; it does not
// add authentication. A primary may bind non-loopback, so the guard is mirror-only.
import { AppError } from "@waitron/shared";
import type { ServerConfig } from "./config.js";
import { isLoopbackHost } from "./primary-url.js";
import "./errors.js";

/**
 * Call before the listener binds. `config.httpHost` is the raw env value; `isLoopbackHost` treats
 * any form it does not recognise as non-loopback, so this can refuse a loopback bind but never
 * allow a non-loopback one.
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

// Only the literal "true" or "1" opts in; anything else, `""` included, keeps the guard armed.
function isExposureAllowed(env: Record<string, string | undefined>): boolean {
  const raw = env.WAITRON_MIRROR_ALLOW_EXPOSED;
  return raw === "true" || raw === "1";
}
