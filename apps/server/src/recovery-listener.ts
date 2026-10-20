import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { AppError } from "@waitron/shared";
import { BOX_HOSTNAME, startLandingListener, type LandingListenerConfig } from "./boot.js";
import { listBoxIpv4, parseBoxAddresses } from "./box-reach.js";
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_LANDING_PORT,
  DEFAULT_HTTP_PORT,
  MAX_HTTP_PORT,
} from "./config.js";
import { isUnset } from "./env-value.js";
import type { Logger } from "./logger.js";
import { buildServeOptions, type TlsFiles } from "./tls.js";
import { mintedBoxLeaf, tightenTlsDir } from "./box-secrets.js";
import { errnoOf } from "./errno.js";
import { mountDiscovery } from "./discovery-api.js";
import { isLoopbackHost } from "./primary-url.js";
import "./errors.js";

/**
 * The box's own minted leaf for the recovery page, or `undefined` when it has never minted one, in
 * which case the page is served over plain HTTP.
 */
export function recoveryTlsFiles(stateDir: string): TlsFiles | undefined {
  return mintedBoxLeaf(stateDir);
}

export interface RecoveryServeOptions {
  stateDir: string;
  port: number;
  httpHost?: string;
  log: Logger;
  /** The plain-HTTP trust/landing listener's config. Omitted → no landing listener. */
  landing?: LandingListenerConfig;
  /** Defaults to the real `startLandingListener`. */
  startLanding?: (
    config: LandingListenerConfig,
    log: Logger,
  ) => { close(): Promise<void> } | undefined;
  /** Defaults to the real `tightenTlsDir`. */
  tightenTls?: (stateDir: string) => Promise<void>;
}

/**
 * Bind the recovery page on the box's own HTTPS port with the box's existing leaf, so an
 * already-trusting phone reaches it at the same URL. Beside it, when `opts.landing` is given and
 * `startLandingListener` binds one, the plain-HTTP trust/landing page: a phone that does not yet
 * trust the leaf hits the certificate interstitial before any recovery page loads.
 *
 * Resolves once the socket is bound and rejects if the bind fails; the caller lets that escape, so
 * the process exits non-zero rather than leaving a page-less container up.
 */
export async function serveRecovery(
  app: Hono,
  opts: RecoveryServeOptions,
): Promise<ReturnType<typeof serve>> {
  // Logged rather than thrown, as at a trading start: a certificate folder left readable is no
  // reason to take the recovery page down.
  try {
    await (opts.tightenTls ?? tightenTlsDir)(opts.stateDir);
  } catch (error: unknown) {
    opts.log("warn", "tls.tighten_failed", { errno: errnoOf(error) });
  }
  return new Promise((resolve, reject) => {
    const tls = recoveryTlsFiles(opts.stateDir);
    const surface = new Hono();
    mountDiscovery(
      surface,
      {
        stateDir: opts.stateDir,
        hostname:
          opts.httpHost !== undefined && isLoopbackHost(opts.httpHost)
            ? opts.httpHost
            : BOX_HOSTNAME,
        port: opts.port,
        secure: tls !== undefined,
        listIpv4: () =>
          opts.httpHost !== undefined && isLoopbackHost(opts.httpHost)
            ? []
            : (opts.landing?.boxAddresses ?? listBoxIpv4()),
        discoveryEnabled: false,
      },
      opts.log,
    );
    surface.route("/", app);
    const server = serve(
      buildServeOptions(
        { fetch: surface.fetch, port: opts.port, hostname: opts.httpHost ?? DEFAULT_HTTP_HOST },
        tls,
      ),
      (info) => {
        opts.log("warn", "recovery.listening", { port: info.port, tls: tls !== undefined });
        // Best-effort: `startLandingListener` logs its own bind failure rather than throwing, so an
        // unbindable landing page never takes the recovery page down.
        const startLanding = opts.startLanding ?? startLandingListener;
        const landing = opts.landing ? startLanding(opts.landing, opts.log) : undefined;
        if (landing !== undefined) {
          server.on("close", () => void landing.close().catch(() => {}));
        }
        resolve(server);
      },
    );
    server.on("error", (error: NodeJS.ErrnoException) => {
      reject(new AppError("server.listen_failed", { port: opts.port, code: error.code ?? "" }));
    });
  });
}

/**
 * The landing listener's config for the recovery path, built from env reads that never throw:
 * recovery never runs `loadConfig`, because a broken config is what lands a box here. `tls` is
 * always undefined because recovery presents only the box's own minted leaf, never an operator
 * certificate.
 */
export function landingConfigFrom(
  env: NodeJS.ProcessEnv,
  stateDir: string,
  httpPort: number,
): LandingListenerConfig {
  let boxAddresses: string[] | undefined;
  try {
    boxAddresses = parseBoxAddresses(env.WAITRON_BOX_ADDRESSES);
  } catch {
    // A malformed WAITRON_BOX_ADDRESSES must not crash recovery; fall back to enumerating interfaces.
    boxAddresses = undefined;
  }
  const raw = env.WAITRON_HTTP_LANDING_PORT;
  // `0` is kept, unlike in `httpPortFrom`: it disables the listener.
  const landingPort = isUnset(raw) ? DEFAULT_HTTP_LANDING_PORT : Number.parseInt(raw, 10);
  return {
    landingPort:
      Number.isInteger(landingPort) && landingPort >= 0 && landingPort <= MAX_HTTP_PORT
        ? landingPort
        : DEFAULT_HTTP_LANDING_PORT,
    httpHost: isUnset(env.WAITRON_HTTP_HOST) ? DEFAULT_HTTP_HOST : env.WAITRON_HTTP_HOST,
    stateDir,
    httpPort,
    boxAddresses,
    tls: undefined,
  };
}

/**
 * `WAITRON_HTTP_PORT`, or the default — resolved here rather than through `loadConfig`, whose throw
 * on a broken config would take the page down with it. Zero is refused because to `listen` it means
 * "any free port", which puts the page somewhere the operator cannot find it.
 */
export function httpPortFrom(env: NodeJS.ProcessEnv): number {
  const port = Number.parseInt(env.WAITRON_HTTP_PORT ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= MAX_HTTP_PORT ? port : DEFAULT_HTTP_PORT;
}
