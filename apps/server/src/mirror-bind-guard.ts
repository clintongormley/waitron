import { AppError } from "@waitron/shared";
import type { ServerConfig } from "./config.js";
import { isLoopbackHost } from "./primary-url.js";
import "./errors.js";

/**
 * Call before the listener binds. `config.httpHost` is the raw env value; `isLoopbackHost` treats
 * unrecognised forms as non-loopback, requiring an explicit exposure opt-in.
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
