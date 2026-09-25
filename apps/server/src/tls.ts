import { createHash, X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { isIP } from "node:net";
import { readFileSync, statSync } from "node:fs";
import { createServer as createHttpsServer, Server as HttpsServer } from "node:https";
import { serve } from "@hono/node-server";

/** Derived from the installed `serve` so an incompatible upgrade should fail `tsc`; never yet exercised. */
export type ServeOptions = Parameters<typeof serve>[0];

/** The two PEM file paths that make the host serve HTTPS — `config.tls`'s exact shape. */
export interface TlsFiles {
  certFile: string;
  keyFile: string;
}

/**
 * Turn the plain-HTTP `serve` options into HTTPS ones when — and only when — TLS is configured, by
 * passing `node:https`'s `createServer` plus `{ key, cert }` as `serverOptions`. With no `tls`, the
 * base options are returned UNCHANGED.
 *
 * `readFileSync`, not async: a missing or unreadable certificate must fail the boot immediately.
 */
export function buildServeOptions(base: ServeOptions, tls: TlsFiles | undefined): ServeOptions {
  if (tls === undefined) return base;
  const key = readFileSync(tls.keyFile);
  const cert = readFileSync(tls.certFile);
  return { ...base, createServer: createHttpsServer, serverOptions: { key, cert } };
}

/** Refresh only future handshakes. A failed renewal leaves the last valid TLS context serving. */
export function watchTlsFiles(
  server: HttpsServer,
  files: TlsFiles,
  hostname: string,
  onError: () => void,
  intervalMs = 10000,
): void {
  let accepted = "",
    lastFailure: number | undefined;
  const timer = setInterval(() => {
    try {
      if (statSync(files.keyFile).size > 16384 || statSync(files.certFile).size > 16384)
        throw new Error("TLS file too large");
      const key = readFileSync(files.keyFile),
        cert = readFileSync(files.certFile);
      const fingerprint = createHash("sha256").update(key).update(cert).digest("hex");
      if (fingerprint === accepted) return;
      const leaf = new X509Certificate(cert);
      const matches = isIP(hostname) ? leaf.checkIP(hostname) : leaf.checkHost(hostname);
      if (
        matches !== hostname ||
        Date.parse(leaf.validFrom) > Date.now() ||
        Date.parse(leaf.validTo) <= Date.now()
      )
        throw new Error("TLS certificate invalid");
      createSecureContext({ key, cert });
      server.setSecureContext({ key, cert });
      accepted = fingerprint;
      lastFailure = undefined;
    } catch {
      if (lastFailure === undefined || Date.now() - lastFailure >= 300000) {
        onError();
        lastFailure = Date.now();
      }
    }
  }, intervalMs);
  timer.unref();
  server.once("close", () => clearInterval(timer));
}
