import { get as httpsGet } from "node:https";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServeOptions } from "./tls.js";
import { mintMtlsMaterial } from "./testing/tls.js";

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
  let dir: string;
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
