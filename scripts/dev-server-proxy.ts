import { isDashboardPath } from "../packages/shared/src/app-surfaces.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ProxyOptions } from "vite";

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

export function devCrossAppLinks(app: "till" | "dashboard" | "setup"): Plugin {
  return {
    name: "waitron-dev-cross-app-links",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "";
        const pathname = url.split("?")[0]!;
        const destination =
          app !== "till" && /^\/till(?:\/|$)/.test(pathname)
            ? devPort("WAITRON_TILL_VITE_PORT", 5190)
            : app !== "dashboard" && isDashboardPath(pathname)
              ? devPort("WAITRON_DASHBOARD_VITE_PORT", 5191)
              : undefined;
        if (destination !== undefined) {
          response.writeHead(302, { location: `http://localhost:${destination}${url}` });
          response.end();
        } else if (app === "setup" && pathname.startsWith("/handover/")) {
          void readFile(join(server.config.root, "index.html"), "utf8")
            .then((html) => server.transformIndexHtml("/setup/index.html", html, url))
            .then((html) => {
              response.setHeader("content-type", "text/html; charset=utf-8");
              response.end(html);
            })
            .catch(next);
        } else next();
      });
    },
  };
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
  const hasLeaf = existsSync(join(stateDir, "tls", "server.pem"));
  const port = devPort("WAITRON_HTTP_PORT", 8080);
  return hasLeaf
    ? { target: `https://127.0.0.1:${port}`, secure: false }
    : { target: `http://127.0.0.1:${port}` };
}
