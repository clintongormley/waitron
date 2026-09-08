import { get as httpsGet, request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServeOptions } from "./tls.js";
import { mintMtlsMaterial, startMtlsServer } from "./testing/tls.js";

/**
 * `buildServeOptions` is the whole of this task's TLS surface: with no `tls` it hands `serve` the
 * plain-HTTP options unchanged, and with `tls` it reads the PEM files and returns the
 * `@hono/node-server` option shape (`createServer: node:https.createServer`, `serverOptions:
 * { key, cert }`) that makes the SAME `serve` call serve HTTPS instead. The confirmed option names
 * live in `tls.ts`'s own doc comment; this suite proves the wiring end to end by actually booting a
 * server and completing a verified TLS handshake against it.
 */
describe("buildServeOptions", () => {
  it("returns the base options unchanged when no TLS is configured (plain HTTP loopback dev)", () => {
    const app = new Hono();
    const base = { fetch: app.fetch, port: 0, hostname: "127.0.0.1" };
    // Identity, not merely equal: the undefined branch must not read any file or add a
    // `createServer`/`serverOptions`, so the exact object passed in is what `serve` receives.
    expect(buildServeOptions(base, undefined)).toBe(base);
  });
});

/**
 * A real HTTPS boot: mint a private CA + a `localhost`/`127.0.0.1` server certificate in-process
 * (node-forge, via the same `mintMtlsMaterial` fixture `aeat-transport.test.ts` and `boot.test.ts`
 * already share), write the server key/cert to disk, boot `serve(buildServeOptions(...))` with them,
 * and complete an `https` GET of `/health` that TRUSTS the generated CA via the request's own `ca:`
 * option. `rejectUnauthorized` is left at its secure default (`true`) throughout — verification is
 * the point of the test, and `ca:` is exactly how a real till device trusts its local CA in
 * production (#9), so disabling verification would both prove nothing and model a MITM-open client.
 */
describe("serve(buildServeOptions(base, tls)) over a real TLS handshake", () => {
  const material = mintMtlsMaterial();
  // `string | undefined`: an uninitialized `let` is `undefined` at runtime if `beforeAll` throws
  // before `mkdtemp` assigns it, which is exactly what the afterAll guard below protects against —
  // so the type carries that possibility honestly (the assignment on the first beforeAll line
  // narrows it back to `string` for the uses that follow).
  let dir: string | undefined;
  let certFile: string;
  let keyFile: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "waitron-tls-test-"));
    certFile = join(dir, "server-cert.pem");
    keyFile = join(dir, "server-key.pem");
    await writeFile(certFile, material.serverCertPem);
    await writeFile(keyFile, material.serverKeyPem);
  });

  // Guarded (the whole family this repo enforces): a `beforeAll` that threw before `mkdtemp`
  // returned must not be followed by an `rm(undefined)` reported as a second failure.
  afterAll(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it("serves HTTPS that a client trusting the minted CA can reach — GET /health is 200", async () => {
    const app = new Hono();
    app.get("/health", (c) => c.json({ ok: true }));

    let server: ServerType | undefined;
    try {
      const port = await new Promise<number>((resolve) => {
        server = serve(
          buildServeOptions(
            { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
            { certFile, keyFile },
          ),
          (info: AddressInfo) => resolve(info.port),
        );
      });

      const { status, body } = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          const req = httpsGet(
            // `127.0.0.1`, matching the iPAddress SAN the fixture mints — NOT `localhost`, which a
            // dual-stack host resolves to `::1` first and would fail to connect for a DNS-ordering
            // reason unrelated to TLS. `ca: material.caPem` is the ONLY trust anchor supplied, so a
            // 200 here means the server presented a chain that verifies against the minted CA.
            { hostname: "127.0.0.1", port, path: "/health", ca: material.caPem },
            (res) => {
              let data = "";
              res.on("data", (chunk) => (data += String(chunk)));
              res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
            },
          );
          req.on("error", reject);
        },
      );

      expect(status).toBe(200);
      expect(JSON.parse(body)).toEqual({ ok: true });
    } finally {
      if (server !== undefined) {
        const s = server;
        await new Promise<void>((resolve, reject) =>
          s.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });
});

/**
 * The mTLS fixture's failure containment: a responder that throws must become an HTTP 500, never an
 * uncaught exception that crashes the process. The async-rejection case is contained by the request
 * handler's `.catch`; a SYNCHRONOUS throw is the one that escaped when the responder was invoked
 * eagerly as an argument to `Promise.resolve(...)` — a real authenticated request then crashed the
 * process (exit 7) instead of receiving a 500. This test drives a real client-certificate handshake at
 * a synchronously-throwing responder and asserts the 500; the test completing at all is the proof the
 * throw did not take the process down.
 */
describe("startMtlsServer contains a throwing responder", () => {
  it("answers HTTP 500 (no process crash) when the responder throws synchronously", async () => {
    const material = mintMtlsMaterial();
    const server = await startMtlsServer(material, () => {
      throw new Error("synchronous responder failure");
    });
    try {
      const url = new URL(server.origin);
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpsRequest(
          {
            hostname: url.hostname,
            port: Number(url.port),
            path: "/",
            method: "POST",
            // The server REQUIRES + verifies a client certificate; present the minted client PFX and
            // trust the minted CA so the handshake completes and the request reaches the responder.
            ca: material.caPem,
            pfx: material.clientPfx,
            passphrase: material.clientPassphrase,
          },
          (res) => {
            res.on("data", () => {});
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.end("<probe/>");
      });
      expect(status).toBe(500);
    } finally {
      await server.close();
    }
  });
});
