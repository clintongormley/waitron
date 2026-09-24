import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer } from "node:https";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import type { CloudRecoveryOptions } from "./cloud-recovery.js";

const origin = "https://cloud.example.test";
const point = {
  id: "047bacd4-df70-4881-a835-c6dd75ae7ecf",
  venueId: "374cac38-cc58-46d5-8d3b-8443fc4343a4",
  installationId: "5723dd84-9b75-4962-94ec-1f25af47496d",
  keyVersion: 1,
  kind: "snapshot",
  objectKey: "snapshots/047bacd4-df70-4881-a835-c6dd75ae7ecf",
  digest: createHash("sha256").update("archive").digest("hex"),
  size: 7,
  capturedAt: "2026-09-24T10:00:00.000Z",
  retention: "daily",
  sourceNodeId: "6035e9ee-60bb-47f5-877d-1a63d7ecf357",
  modules: { core: 1 },
  verification: "verified",
  deleting: false,
  deletedAt: null,
};
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-cloud-recovery-"));
  dirs.push(stateDir);
  const calls: { action: string; body: Record<string, unknown> }[] = [];
  let loseStart = true;
  const requestExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const action = new URL(url).pathname.split("/").at(-1)!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ action, body });
    if (action === "start" && loseStart) {
      loseStart = false;
      throw new Error("reply lost");
    }
    if (action === "start" || action === "status")
      return Response.json({
        requestId: JSON.parse(Buffer.from(String(body.payload), "base64url").toString())[2],
        state: action === "start" ? "awaiting_owner" : "approved",
        expiresAt: requestExpiresAt,
        operationId:
          action === "start"
            ? null
            : JSON.parse(Buffer.from(String(body.payload), "base64url").toString())[2],
      });
    if (action === "info")
      return Response.json({
        point,
        operationExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      });
    if (action === "read")
      return Response.json({
        point,
        location: { endpoint: "https://store.example.test", bucket: "backup", region: "local" },
        credentials: { accessKeyId: "access", secretAccessKey: "secret", sessionToken: "session" },
        recoveryKey: "archive-key",
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        operationExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      });
    if (action === "restored") return Response.json({ status: "restored" });
    throw Error(action);
  });
  const options = {
    stateDir,
    origin,
    environment: "preproduction" as const,
    fetch: fetchImpl as typeof fetch,
    download: vi.fn(async () => Buffer.from("archive")),
  };
  return { stateDir, calls, options };
}

describe("Cloud recovery target", () => {
  it("persists private request before network and reconciles a lost start reply", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const saved = JSON.parse(await readFile(join(f.stateDir, "cloud-recovery.json"), "utf8"));
    expect((await stat(join(f.stateDir, "cloud-recovery.json"))).mode & 0o777).toBe(0o600);
    const view = await createCloudRecoveryClient(f.options).start();
    expect(view.requestId).toBe(saved.requestId);
    expect(view.code).toBe(saved.code);
    expect(f.calls[0]?.body).not.toEqual(f.calls[1]?.body);
    const first = JSON.parse(Buffer.from(String(f.calls[0]?.body.payload), "base64url").toString());
    const second = JSON.parse(
      Buffer.from(String(f.calls[1]?.body.payload), "base64url").toString(),
    );
    expect(first.slice(0, 6)).toEqual(second.slice(0, 6));
    expect(JSON.stringify(view)).not.toContain(saved.privateKey);
  });

  it("shows approved point without returning archive key or storage authority", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const view = await createCloudRecoveryClient(f.options).status();
    expect(view.state).toBe("approved");
    expect(view.point).toMatchObject({ id: point.id, capturedAt: point.capturedAt });
    expect(Date.parse(view.expiresAt) - Date.now()).toBeGreaterThan(50 * 60_000);
    expect(JSON.stringify(view)).not.toContain("archive-key");
    expect(JSON.stringify(view)).not.toContain("store.example.test");
  });

  it("validates bytes and rechecks owner authority before staging", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const stage = vi.fn(async () => {});
    await createCloudRecoveryClient(f.options).restore(stage, point.id);
    expect(stage).toHaveBeenCalledWith({
      artifact: Buffer.from("archive"),
      recoveryKey: "archive-key",
      environment: "preproduction",
      managedCloud: { requestId: expect.any(String), pointId: point.id },
    });
    expect(f.calls.map((call) => call.action)).toEqual([
      "start",
      "status",
      "info",
      "info",
      "read",
      "info",
    ]);
    const saved = JSON.parse(await readFile(join(f.stateDir, "cloud-recovery.json"), "utf8"));
    expect(saved.phase).toBe("staged");
    const client = createCloudRecoveryClient(f.options);
    await client.reportRestored();
    expect(f.calls.map((call) => call.action)).not.toContain("restored");
    await expect(
      client.markRestored({
        requestId: saved.requestId,
        pointId: "047bacd4-df70-4881-a835-c6dd75ae7ec0",
      }),
    ).rejects.toThrow();
    await client.markRestored({ requestId: saved.requestId, pointId: point.id });
    await client.reportRestored();
    expect(f.calls.map((call) => call.action)).toContain("restored");
  });

  it("refuses a wrong digest without staging", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    f.options.download = vi.fn(async () => Buffer.from("wrong!!"));
    const stage = vi.fn(async () => {});
    await expect(createCloudRecoveryClient(f.options).restore(stage, point.id)).rejects.toThrow();
    expect(stage).not.toHaveBeenCalled();
  });

  it("refuses staging when Cloud withdraws authority after the archive download", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const original = f.options.fetch;
    let infoRequests = 0;
    f.options.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/info") && ++infoRequests === 3)
        return Promise.resolve(new Response(null, { status: 403 }));
      return original(url, init);
    }) as typeof fetch;
    const stage = vi.fn(async () => {});
    await expect(createCloudRecoveryClient(f.options).restore(stage, point.id)).rejects.toThrow();
    expect(f.options.download).toHaveBeenCalledOnce();
    expect(stage).not.toHaveBeenCalled();
  });

  it("rejects a read grant for any snapshot other than the displayed approval", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const original = f.options.fetch;
    f.options.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) =>
      String(url).endsWith("/read")
        ? Promise.resolve(
            Response.json({
              point: {
                ...point,
                id: "715955bb-2dbd-4481-9746-f6d3e95a8651",
                objectKey: "snapshots/715955bb-2dbd-4481-9746-f6d3e95a8651",
              },
              location: {
                endpoint: "https://store.example.test",
                bucket: "backup",
                region: "local",
              },
              credentials: {
                accessKeyId: "access",
                secretAccessKey: "secret",
                sessionToken: "session",
              },
              recoveryKey: "archive-key",
              expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
              operationExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
            }),
          )
        : original(url, init),
    ) as typeof fetch;
    const stage = vi.fn(async () => {});
    await expect(createCloudRecoveryClient(f.options).restore(stage, point.id)).rejects.toThrow();
    expect(f.options.download).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  it("refuses an HTTP storage endpoint before sending temporary credentials", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const { createServer: createHttpServer } = await import("node:http");
    let requests = 0;
    const server = createHttpServer((_req, res) => {
      requests++;
      res.end("archive");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const original = f.options.fetch;
    const options: CloudRecoveryOptions = {
      ...f.options,
      download: undefined,
      fetch: vi.fn((url: string | URL | Request, init?: RequestInit) =>
        String(url).endsWith("/read")
          ? Promise.resolve(
              Response.json({
                point,
                location: { endpoint, bucket: "backup", region: "local" },
                credentials: {
                  accessKeyId: "access",
                  secretAccessKey: "secret",
                  sessionToken: "session",
                },
                recoveryKey: "archive-key",
                expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
                operationExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
              }),
            )
          : original(url, init),
      ) as typeof fetch,
    };
    const stage = vi.fn(async () => {});
    try {
      await expect(createCloudRecoveryClient(options).restore(stage, point.id)).rejects.toThrow();
      expect(requests).toBe(0);
      expect(stage).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fails closed on a corrupt private request instead of replacing its key", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const path = join(f.stateDir, "cloud-recovery.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    saved.publicKey = "wrong";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, JSON.stringify(saved));
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    expect(JSON.parse(await readFile(path, "utf8")).requestId).toBe(saved.requestId);
  });

  it("does not replace request identity when expiry check loses the network reply", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const path = join(f.stateDir, "cloud-recovery.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    saved.expiresAt = new Date(Date.now() - 1000).toISOString();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, JSON.stringify(saved));
    f.options.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await expect(createCloudRecoveryClient(f.options).startAgain()).rejects.toThrow();
    expect(JSON.parse(await readFile(path, "utf8")).requestId).toBe(saved.requestId);
  });

  it("permits an explicit new request when approved operation info has expired", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const old = JSON.parse(await readFile(join(f.stateDir, "cloud-recovery.json"), "utf8"));
    const original = f.options.fetch;
    f.options.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) =>
      String(url).endsWith("/info")
        ? Promise.resolve(new Response(null, { status: 410 }))
        : original(url, init),
    ) as typeof fetch;
    expect((await createCloudRecoveryClient(f.options).status()).state).toBe("expired");
    const next = await createCloudRecoveryClient(f.options).startAgain();
    expect(next.requestId).not.toBe(old.requestId);
    const replacement = JSON.parse(await readFile(join(f.stateDir, "cloud-recovery.json"), "utf8"));
    expect(replacement.publicKey).not.toBe(old.publicKey);
    expect(replacement.privateKey).not.toBe(old.privateKey);
  });

  it("keeps the same request when owner permission is revoked", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const old = JSON.parse(await readFile(join(f.stateDir, "cloud-recovery.json"), "utf8"));
    const original = f.options.fetch;
    f.options.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) =>
      String(url).endsWith("/info")
        ? Promise.resolve(new Response(null, { status: 403 }))
        : original(url, init),
    ) as typeof fetch;
    await expect(createCloudRecoveryClient(f.options).startAgain()).rejects.toThrow();
    expect(
      JSON.parse(await readFile(join(f.stateDir, "cloud-recovery.json"), "utf8")).requestId,
    ).toBe(old.requestId);
  });

  it("refuses production recovery before creating private state", async () => {
    const f = await fixture();
    expect(() => createCloudRecoveryClient({ ...f.options, environment: "production" })).toThrow();
    await expect(readFile(join(f.stateDir, "cloud-recovery.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("bounds a stalled HTTPS object body and retries the same scoped GET", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow();
    const tls = mintSelfSignedServerCert({
      hostnames: ["localhost"],
      ipAddresses: ["127.0.0.1"],
      now: new Date(),
    });
    let requests = 0;
    let stall = true;
    const paths: string[] = [];
    const server = createServer({ key: tls.serverKeyPem, cert: tls.serverCertPem }, (req, res) => {
      requests++;
      paths.push(String(req.url));
      expect(req.method).toBe("GET");
      expect(req.headers.authorization).toContain("access/");
      expect(req.headers["x-amz-security-token"]).toBe("session");
      res.writeHead(200, { "content-length": "7", "content-type": "application/octet-stream" });
      if (stall) res.write("a");
      else res.end("archive");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
    const original = f.options.fetch;
    const options: CloudRecoveryOptions = {
      ...f.options,
      download: undefined,
      storageCa: tls.caCertPem,
      fetch: vi.fn((url: string | URL | Request, init?: RequestInit) =>
        String(url).endsWith("/read")
          ? Promise.resolve(
              Response.json({
                point,
                location: { endpoint, bucket: "backup", region: "local" },
                credentials: {
                  accessKeyId: "access",
                  secretAccessKey: "secret",
                  sessionToken: "session",
                },
                recoveryKey: "archive-key",
                expiresAt: new Date(Date.now() + 5_300).toISOString(),
                operationExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
              }),
            )
          : original(url, init),
      ) as typeof fetch,
    };
    const stage = vi.fn(async () => {});
    try {
      await expect(createCloudRecoveryClient(options).restore(stage, point.id)).rejects.toThrow();
      expect(requests).toBe(1);
      expect(stage).not.toHaveBeenCalled();
      stall = false;
      await createCloudRecoveryClient(options).restore(stage, point.id);
      expect(requests).toBe(2);
      expect(paths.map((path) => new URL(path, endpoint).pathname)).toEqual([
        `/backup/${point.objectKey}`,
        `/backup/${point.objectKey}`,
      ]);
      expect(stage).toHaveBeenCalledOnce();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);
});
