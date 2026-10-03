import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProxyOptions } from "vite";

const DEFAULT_STATE_DIR = fileURLToPath(new URL("../apps/server/src/state", import.meta.url));

export function devPort(variable: string, fallback: number): number {
  const raw = process.env[variable]?.trim();
  if (!raw) return fallback;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variable} must be a port from 1 to 65535`);
  }
  return port;
}

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
  const port = devPort("WAITRON_HTTP_PORT", 8080);
  return hasLeaf
    ? { target: `https://127.0.0.1:${port}`, secure: false }
    : { target: `http://127.0.0.1:${port}` };
}
