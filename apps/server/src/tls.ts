import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { serve } from "@hono/node-server";

/**
 * The exact options object `@hono/node-server`'s `serve` accepts as its first argument —
 * `Parameters<typeof serve>[0]`, derived from the installed version rather than re-declared, so a
 * package upgrade that reshaped it would surface here as a `tsc` error instead of a runtime
 * surprise. `serve` also takes an optional `listeningListener` second argument, untouched here.
 */
export type ServeOptions = Parameters<typeof serve>[0];

/** The two PEM file paths that make the host serve HTTPS — `config.tls`'s exact shape. */
export interface TlsFiles {
  certFile: string;
  keyFile: string;
}

/**
 * Turn the plain-HTTP `serve` options into HTTPS ones when — and only when — TLS is configured.
 *
 * Confirmed against `@hono/node-server`'s installed `serve` signature
 * (`node_modules/@hono/node-server/dist/types.d.ts` and its `createAdaptorServer` in `server.js`):
 * `Options` is `{ fetch, port?, hostname?, … } & ServerOptions`, and its `createHttpsOptions`
 * member carries exactly two keys — `createServer` (defaulting to `node:http`'s `createServer`, so
 * plain HTTP unless overridden) and `serverOptions` (a `node:https.ServerOptions`). Passing
 * `node:https`'s `createServer` plus `{ key, cert }` is therefore what flips the SAME `serve` call
 * from HTTP to HTTPS — the adaptor does `options.createServer(options.serverOptions || {}, …)`.
 *
 * With no `tls`, the base options are returned UNCHANGED (referentially — no file is read and no
 * `createServer` is added), which is the plain-HTTP loopback-dev path. This function is the whole of
 * the process's TLS capability: production local-CA trust and LAN binding are deployment (#9).
 *
 * `readFileSync`, not async: `boot.ts` builds these options synchronously right before its single
 * `serve` call, and a missing or unreadable file must fail the boot loudly and immediately (spec §8
 * — a host that cannot read its own certificate has no business coming up half-configured), exactly
 * as every other boot-time misconfiguration in `config.ts` does.
 */
export function buildServeOptions(base: ServeOptions, tls: TlsFiles | undefined): ServeOptions {
  if (tls === undefined) return base;
  const key = readFileSync(tls.keyFile);
  const cert = readFileSync(tls.certFile);
  return { ...base, createServer: createHttpsServer, serverOptions: { key, cert } };
}
