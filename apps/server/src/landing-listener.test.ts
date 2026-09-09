import { get as httpGet } from "node:http";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startLandingListener } from "./boot.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";

/**
 * A real boot of the plain-HTTP landing listener: `startLandingListener` binds an actual socket on an
 * ephemeral port against a temp state dir holding a minted leaf + CA, and an `http` GET of `/` proves
 * the load-bearing properties this surface exists for — a 200 (never a redirect) and NO
 * `Strict-Transport-Security` (HSTS would strand a phone on the interstitial). Mirrors `tls.test.ts`'s
 * real-`serve` pattern. `startLandingListener` returns `undefined` when disabled/operator-TLS/leaf-less,
 * so those branches are proven here too without a socket.
 */

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

// A minted-leaf + CA state dir: `mintedBoxLeaf` keys off `tls/server.{crt,key}`, and `/ca.crt` reads
// `tls/ca.crt`. The bytes are placeholders — nothing here completes a TLS handshake (the landing
// listener is plain HTTP); it only needs the files to exist.
async function stateDirWithLeaf(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "waitron-land-boot-"));
  dirs.push(d);
  await mkdir(join(d, "tls"), { recursive: true });
  await writeFile(join(d, "tls", "server.crt"), "leaf-cert");
  await writeFile(join(d, "tls", "server.key"), "leaf-key");
  await writeFile(
    join(d, "tls", "ca.crt"),
    "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n",
  );
  return d;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

// Only the fields `startLandingListener` reads; the rest of `ServerConfig` is irrelevant to it.
function configFor(over: Partial<ServerConfig>): ServerConfig {
  return {
    landingPort: 0,
    tls: undefined,
    httpPort: 8080,
    httpHost: "127.0.0.1",
    boxAddresses: [],
    ...over,
  } as unknown as ServerConfig;
}

const noopLog: Logger = () => {};

describe("startLandingListener", () => {
  it("serves the trust page at / with no redirect and no HSTS", async () => {
    const stateDir = await stateDirWithLeaf();
    const port = await freePort();
    const handle = startLandingListener(configFor({ landingPort: port, stateDir }), noopLog);
    expect(handle).toBeDefined();
    try {
      const res = await new Promise<{
        status: number;
        hsts: string | undefined;
        location: string | undefined;
        body: string;
      }>((resolve, reject) => {
        const req = httpGet({ hostname: "127.0.0.1", port, path: "/" }, (r) => {
          let data = "";
          r.on("data", (chunk) => (data += String(chunk)));
          r.on("end", () =>
            resolve({
              status: r.statusCode ?? 0,
              hsts: r.headers["strict-transport-security"] as string | undefined,
              location: r.headers.location,
              body: data,
            }),
          );
        });
        req.on("error", reject);
      });
      expect(res.status).toBe(200); // not a 3xx — this surface never redirects
      expect(res.location).toBeUndefined();
      expect(res.hsts).toBeUndefined();
      expect(res.body).toContain('href="/ca.crt"');
    } finally {
      await handle?.close();
    }
  });

  it("returns undefined when the landing port is 0 (disabled)", async () => {
    const stateDir = await stateDirWithLeaf();
    expect(startLandingListener(configFor({ landingPort: 0, stateDir }), noopLog)).toBeUndefined();
  });

  it("returns undefined when the box has no minted leaf (leaf-less dev)", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-land-noleaf-"));
    dirs.push(stateDir);
    expect(
      startLandingListener(configFor({ landingPort: 8080, stateDir }), noopLog),
    ).toBeUndefined();
  });

  it("returns undefined when the box serves an operator-supplied cert (config.tls set)", async () => {
    const stateDir = await stateDirWithLeaf();
    expect(
      startLandingListener(
        configFor({
          landingPort: 8080,
          stateDir,
          tls: { certFile: "/x/cert.pem", keyFile: "/x/key.pem" },
        }),
        noopLog,
      ),
    ).toBeUndefined();
  });
});
