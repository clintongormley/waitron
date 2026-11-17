import { get as httpsGet } from "node:https";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServeOptions, validateTlsIdentity, watchTlsFiles } from "./tls.js";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";

describe("buildServeOptions", () => {
  it("returns the base options unchanged when no TLS is configured (plain HTTP loopback dev)", () => {
    const app = new Hono();
    const base = { fetch: app.fetch, port: 0, hostname: "127.0.0.1" };
    // Identity, not merely equal: the exact object passed in is what `serve` receives.
    expect(buildServeOptions(base, undefined)).toBe(base);
  });
});

/** A real HTTPS boot and a verified handshake; `rejectUnauthorized` stays at its secure default. */
describe("serve(buildServeOptions(base, tls)) over a real TLS handshake", () => {
  const material = mintMtlsMaterial();
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

  // Guarded: a `beforeAll` that threw before `mkdtemp` must not add an `rm(undefined)` failure.
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
            // `127.0.0.1`, not `localhost`, which a dual-stack host may resolve to `::1`. `ca` is the
            // ONLY trust anchor supplied.
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

it("reloads a renewed certificate for fresh TLS connections and keeps serving after an invalid update", async () => {
  const { watchTlsFiles } = await import("./tls.js");
  const { Server } = await import("node:https");
  const { once } = await import("node:events");
  const first = mintMtlsMaterial(),
    second = mintMtlsMaterial();
  const root = await mkdtemp(join(tmpdir(), "waitron-tls-renew-"));
  const files = { certFile: join(root, "cert.pem"), keyFile: join(root, "key.pem") };
  let errors = 0;
  const server = new Server({ key: first.serverKeyPem, cert: first.serverCertPem }, (_, res) =>
    res.end("ok"),
  );
  try {
    await writeFile(files.certFile, first.serverCertPem);
    await writeFile(files.keyFile, first.serverKeyPem);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    watchTlsFiles(
      server,
      files,
      "localhost",
      () => {
        errors++;
      },
      20,
    );
    const serial = (ca = second.caPem) =>
      new Promise<string>((resolve, reject) => {
        const req = httpsGet(
          {
            host: "127.0.0.1",
            port,
            servername: "localhost",
            ca,
            agent: false,
          },
          (res) => {
            const value = (res.socket as import("node:tls").TLSSocket).getPeerCertificate()
              .fingerprint256;
            res.resume();
            res.on("end", () => resolve(value));
          },
        );
        req.on("error", reject);
      });
    const before = await serial(first.caPem);
    await writeFile(files.certFile, second.serverCertPem);
    await writeFile(files.keyFile, second.serverKeyPem);
    await expect.poll(() => serial()).not.toBe(before);
    const after = await serial();
    const previousErrors = errors;
    await writeFile(files.certFile, "broken");
    await expect.poll(() => errors).toBeGreaterThan(previousErrors);
    expect(await serial()).toBe(after);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

it("repeats a persistent reload failure after five minutes instead of suppressing it forever", async () => {
  const { watchTlsFiles } = await import("./tls.js");
  const { Server } = await import("node:https");
  const material = mintMtlsMaterial();
  const root = await mkdtemp(join(tmpdir(), "waitron-tls-alert-"));
  const files = { certFile: join(root, "cert.pem"), keyFile: join(root, "key.pem") };
  const server = new Server({ key: material.serverKeyPem, cert: material.serverCertPem });
  let now = Date.now(),
    errors = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    await writeFile(files.certFile, material.serverCertPem);
    await writeFile(files.keyFile, material.serverKeyPem);
    watchTlsFiles(server, files, "wrong.example.test", () => errors++, 5);
    await vi.waitFor(() => expect(errors).toBe(1));
    now += 300001;
    await vi.waitFor(() => expect(errors).toBe(2));
  } finally {
    server.emit("close");
    clock.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

describe("validateTlsIdentity", () => {
  const material = mintMtlsMaterial();
  const key = Buffer.from(material.serverKeyPem);
  const cert = Buffer.from(material.serverCertPem);
  const during = new Date(2027, 0, 1).getTime();
  const expiry = new Date(2030, 0, 1).getTime();

  it.each(["localhost", "127.0.0.1"])("returns the validated expiry for %s", (hostname) => {
    expect(validateTlsIdentity(key, cert, hostname, during)).toBe(expiry);
  });

  it.each([
    ["other.example.test", during],
    ["localhost", new Date(2025, 0, 1).getTime()],
    ["localhost", expiry],
  ])("refuses a wrong name or a certificate outside its validity (%s, %s)", (hostname, now) => {
    expect(() => validateTlsIdentity(key, cert, hostname, now)).toThrow("TLS certificate invalid");
  });

  it("refuses a certificate paired with another private key", () => {
    const other = mintMtlsMaterial();
    expect(() =>
      validateTlsIdentity(Buffer.from(other.serverKeyPem), cert, "localhost", during),
    ).toThrow(/key values mismatch/);
  });
});

it("accepts one exact staff DNS name together with its new TLS context and retains both on an invalid replacement", async () => {
  const { Server } = await import("node:https");
  const { mintSelfSignedServerCert } = await import("./self-signed-cert.js");
  const first = mintSelfSignedServerCert({
    now: new Date(),
    hostnames: ["staff.first.example.test"],
    ipAddresses: [],
  });
  const next = mintSelfSignedServerCert({
    now: new Date(),
    hostnames: ["staff.next.example.test"],
    ipAddresses: [],
  });
  const root = await mkdtemp(join(tmpdir(), "waitron-staff-tls-"));
  const files = { certFile: join(root, "cert.pem"), keyFile: join(root, "key.pem") };
  const server = new Server({ key: first.serverKeyPem, cert: first.serverCertPem }, (_req, res) =>
    res.end("staff"),
  );
  try {
    await writeFile(files.keyFile, first.serverKeyPem);
    await writeFile(files.certFile, first.serverCertPem);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const fingerprint = () =>
      new Promise<string>((resolve, reject) => {
        const request = httpsGet(
          {
            host: "127.0.0.1",
            port: (server.address() as AddressInfo).port,
            rejectUnauthorized: false,
            agent: false,
          },
          (res) => {
            const value = (res.socket as import("node:tls").TLSSocket).getPeerCertificate()
              .fingerprint256;
            res.resume();
            res.on("end", () => resolve(value));
          },
        );
        request.on("error", reject);
      });
    const watcher = watchTlsFiles(server, files, undefined, () => {}, 10000);
    expect(watcher?.hostname()).toBe("staff.first.example.test");
    const before = await fingerprint();
    await writeFile(files.keyFile, next.serverKeyPem);
    await writeFile(files.certFile, next.serverCertPem);
    watcher.checkNow();
    expect(watcher.hostname()).toBe("staff.next.example.test");
    const accepted = await fingerprint();
    expect(accepted).not.toBe(before);
    const ambiguous = mintSelfSignedServerCert({
      now: new Date(),
      hostnames: ["staff.one.example.test", "staff.two.example.test"],
      ipAddresses: [],
    });
    await writeFile(files.keyFile, ambiguous.serverKeyPem);
    await writeFile(files.certFile, ambiguous.serverCertPem);
    watcher.checkNow();
    expect(watcher.hostname()).toBe("staff.next.example.test");
    expect(await fingerprint()).toBe(accepted);
  } finally {
    server.emit("close");
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
