import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProxyOptions } from "vite";

const DEFAULT_STATE_DIR = fileURLToPath(new URL("../apps/server/src/state", import.meta.url));

function resolvedStateDir(): string {
  const configured = process.env.WAITRON_STATE_DIR?.trim();
  if (configured === undefined || configured === "") return DEFAULT_STATE_DIR;
  return isAbsolute(configured) ? configured : resolve(configured);
}

/** Match the protocol selected by `startTradingListener`: a persisted box leaf enables HTTPS. */
export function devServerProxy(
  options: { stateDir?: string } = {},
): ProxyOptions & { target: string } {
  const stateDir = options.stateDir ?? resolvedStateDir();
  const hasLeaf =
    existsSync(join(stateDir, "tls", "server.crt")) &&
    existsSync(join(stateDir, "tls", "server.key"));
  return hasLeaf
    ? { target: "https://127.0.0.1:8080", secure: false }
    : { target: "http://127.0.0.1:8080" };
}
