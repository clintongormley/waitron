import { serve } from "@hono/node-server";
import { BOX_HOSTNAME, BOX_LEAF_HOSTNAMES } from "./box-name.js";
import { buildReachInfo, listBoxIpv4 } from "./box-reach.js";
import { mintedBoxLeaf } from "./box-secrets.js";
import { closeListener } from "./close-listener.js";
import type { ServerConfig } from "./config.js";
import type { ConnectionBootstrapDeps } from "./connection-bootstrap.js";
import type { DeclarationPagesDeps } from "./declaration-pages.js";
import { buildLandingApp } from "./landing-app.js";
import type { Logger } from "./logger.js";
import type { VenueNameState } from "./mdns.js";
import { buildServeOptions } from "./tls.js";

/**
 * Takes only the fields it reads so the recovery entrypoint, which never runs `loadConfig`, can build
 * one (`node-entry.ts`).
 */
export type LandingListenerConfig = Pick<
  ServerConfig,
  "landingPort" | "httpHost" | "stateDir" | "httpPort" | "boxAddresses" | "tls"
> & {
  connection?: ConnectionBootstrapDeps;
  notSetUp?: boolean;
};

/** A spare's landing pages are for its own screen only. */
export function landingHostFor(
  config: LandingListenerConfig,
  spare: boolean,
): LandingListenerConfig {
  return spare ? { ...config, httpHost: "127.0.0.1" } : config;
}

/**
 * Bind the plain-HTTP trust/landing listener on `config.landingPort`, beside the HTTPS one. A phone
 * opening the HTTPS origin on an untrusted self-signed leaf hits the certificate interstitial before
 * any of our JS runs, so the "trust the CA" page must be served over plain HTTP. It never redirects
 * and sends no HSTS — both would strand the phone back on the interstitial.
 *
 * Public bootstrap may precede a usable leaf; operator TLS and port 0 still disable this listener.
 */
export function startLandingListener(
  config: LandingListenerConfig,
  log: Logger,
  declarationPages: DeclarationPagesDeps = {},
  venueNameState?: () => VenueNameState,
): { close(): Promise<void> } | undefined {
  if (
    config.landingPort === 0 ||
    config.tls !== undefined ||
    (config.connection === undefined && mintedBoxLeaf(config.stateDir) === undefined)
  ) {
    return undefined;
  }
  const reachNow = () =>
    buildReachInfo({
      hostname: BOX_HOSTNAME,
      port: config.httpPort,
      secure: true,
      listIpv4: () => config.boxAddresses ?? listBoxIpv4(),
    });
  const app = buildLandingApp({
    stateDir: config.stateDir,
    reachUrls: () => {
      const reach = reachNow();
      return [reach.hostnameUrl, ...reach.ipUrls];
    },
    httpsUrl: reachNow().hostnameUrl,
    log,
    connection: config.connection,
    landingPort: config.landingPort,
    connectionHostnames: BOX_LEAF_HOSTNAMES,
    declarationPages,
    venueNameState,
    notSetUp: config.notSetUp,
  });
  const server = serve(
    buildServeOptions(
      { fetch: app.fetch, port: config.landingPort, hostname: config.httpHost },
      undefined,
    ),
    (info) => log("info", "landing.listening", { port: info.port }),
  );
  // Unlike the main listener, a landing bind failure must not take the box down: it is a convenience
  // surface, and a low port may need a privilege a dev host lacks. Without a handler Node would crash
  // the process on the unhandled 'error'.
  server.on("error", (error: NodeJS.ErrnoException) => {
    log("warn", "landing.listen_failed", {
      port: config.landingPort,
      /* v8 ignore start */
      code: error.code ?? "unknown",
      /* v8 ignore stop */
    });
  });
  return {
    close: () => closeListener(server),
  };
}
