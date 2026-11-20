import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer } from "node:https";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as filesystemSpace from "./free-bytes.js";
import * as signedRequest from "./cloud-signed-request.js";
import { RESTORE_STAGING_DIR } from "./restore-staging-dirs.js";
import { publishRestoreFlow, endRestoreFlow } from "./restore-flow.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { S3Client } from "@aws-sdk/client-s3";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import type { CloudRecoveryOptions } from "./cloud-recovery.js";

const archiveWriteFault = vi.hoisted(() => ({
  code: undefined as string | undefined,
  closed: false,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      const code = archiveWriteFault.code;
      if (code !== undefined && String(args[0]).endsWith("/archive")) {
        file.write = (async () => {
          throw Object.assign(new Error(`write ${code}`), { code, syscall: "write" });
        }) as typeof file.write;
        // A close failing after the write did must not replace the write's cause.
        const close = file.close.bind(file);
        file.close = async () => {
          archiveWriteFault.closed = true;
          await close();
          throw Object.assign(new Error("close EIO"), { code: "EIO", syscall: "close" });
        };
      }
      return file;
    },
  };
});

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
const cloudUnavailable = { name: "AppError", code: "cloud.unavailable" };
async function refusedLocally(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("Cloud recovery is unavailable. Try again.");
  expect(error).not.toHaveProperty("code");
}
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(selected = point) {
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
        point: selected,
        operationExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      });
    if (action === "read")
      return Response.json({
        point: selected,
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
    download: vi.fn(async (_grant: unknown, path: string) => writeFile(path, "archive")),
  };
  return { stateDir, calls, options };
}

describe("Cloud recovery target", () => {
  it("persists private request before network and reconciles a lost start reply", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const saved = JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8"));
    expect((await stat(join(f.stateDir, "cloud/recovery.json"))).mode & 0o777).toBe(0o600);
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
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const view = await createCloudRecoveryClient(f.options).status();
    expect(view.state).toBe("approved");
    expect(view.point).toMatchObject({ id: point.id, capturedAt: point.capturedAt });
    expect(Date.parse(view.expiresAt) - Date.now()).toBeGreaterThan(50 * 60_000);
    expect(JSON.stringify(view)).not.toContain("archive-key");
    expect(JSON.stringify(view)).not.toContain("store.example.test");
  });

  it("refuses a version-1 point over 2 GiB before requesting a download grant", async () => {
    const f = await fixture({ ...point, size: 2_147_483_649 });
    const client = createCloudRecoveryClient(f.options);
    await expect(client.start()).rejects.toMatchObject(cloudUnavailable);
    await expect(client.restore(async () => {}, point.id)).rejects.toMatchObject(cloudUnavailable);
    expect(f.calls.map((call) => call.action)).toEqual(["start", "status", "info"]);
  });

  it("validates bytes and rechecks owner authority before staging", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const stage = vi.fn(
      async (request: import("./restore-request.js").ArchiveFileRestoreRequest) => {
        expect(await readFile(request.artifactPath, "utf8")).toBe("archive");
      },
    );
    await createCloudRecoveryClient(f.options).restore(stage, point.id);
    expect(stage).toHaveBeenCalledWith({
      kind: "archive-file",
      artifactPath: expect.any(String),
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
    const saved = JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8"));
    expect(saved.phase).toBe("staged");
    const client = createCloudRecoveryClient(f.options);
    await client.reportRestored();
    expect(f.calls.map((call) => call.action)).not.toContain("restored");
    await refusedLocally(
      client.markRestored({
        requestId: saved.requestId,
        pointId: "047bacd4-df70-4881-a835-c6dd75ae7ec0",
      }),
    );
    await client.markRestored({ requestId: saved.requestId, pointId: point.id });
    await client.reportRestored();
    expect(f.calls.map((call) => call.action)).toContain("restored");
  });

  it("refuses a wrong digest without staging", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    f.options.download.mockImplementation(async (_grant, path) => writeFile(path, "wrong!!"));
    const stage = vi.fn(async () => {});
    await expect(
      createCloudRecoveryClient(f.options).restore(stage, point.id),
    ).rejects.toMatchObject(cloudUnavailable);
    expect(stage).not.toHaveBeenCalled();
  });

  it("leaves the start reserve untouched when the approved object will not fit", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const free = vi.spyOn(filesystemSpace, "freeBytes").mockResolvedValueOnce(1);
    try {
      await expect(
        createCloudRecoveryClient(f.options).restore(async () => {}, point.id),
      ).rejects.toMatchObject({ code: "restore.archive_resource_limit" });
      expect(f.options.download).not.toHaveBeenCalled();
      expect(await readdir(join(f.stateDir, RESTORE_STAGING_DIR))).toEqual([]);
    } finally {
      free.mockRestore();
    }
  });

  it("refuses staging when Cloud withdraws authority after the archive download", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const original = f.options.fetch;
    let infoRequests = 0;
    f.options.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/info") && ++infoRequests === 3)
        return Promise.resolve(new Response(null, { status: 403 }));
      return original(url, init);
    }) as typeof fetch;
    const stage = vi.fn(async () => {});
    await expect(
      createCloudRecoveryClient(f.options).restore(stage, point.id),
    ).rejects.toMatchObject(cloudUnavailable);
    expect(f.options.download).toHaveBeenCalledOnce();
    expect(stage).not.toHaveBeenCalled();
    expect(await readdir(join(f.stateDir, RESTORE_STAGING_DIR))).toEqual([]);
  });

  it("rejects a read grant for any snapshot other than the displayed approval", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
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
    await expect(
      createCloudRecoveryClient(f.options).restore(stage, point.id),
    ).rejects.toMatchObject(cloudUnavailable);
    expect(f.options.download).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  it("refuses an HTTP storage endpoint before sending temporary credentials", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
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
      await expect(
        createCloudRecoveryClient(options).restore(stage, point.id),
      ).rejects.toMatchObject(cloudUnavailable);
      expect(requests).toBe(0);
      expect(stage).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fails closed on a corrupt private request instead of replacing its key", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const path = join(f.stateDir, "cloud/recovery.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    saved.publicKey = "wrong";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, JSON.stringify(saved));
    await refusedLocally(createCloudRecoveryClient(f.options).start());
    expect(JSON.parse(await readFile(path, "utf8")).requestId).toBe(saved.requestId);
  });

  it("does not replace request identity when expiry check loses the network reply", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const path = join(f.stateDir, "cloud/recovery.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    saved.expiresAt = new Date(Date.now() - 1000).toISOString();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, JSON.stringify(saved));
    f.options.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await expect(createCloudRecoveryClient(f.options).startAgain()).rejects.toMatchObject(
      cloudUnavailable,
    );
    expect(JSON.parse(await readFile(path, "utf8")).requestId).toBe(saved.requestId);
  });

  it("permits an explicit new request when approved operation info has expired", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const old = JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8"));
    const original = f.options.fetch;
    f.options.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) =>
      String(url).endsWith("/info")
        ? Promise.resolve(new Response(null, { status: 410 }))
        : original(url, init),
    ) as typeof fetch;
    expect((await createCloudRecoveryClient(f.options).status()).state).toBe("expired");
    const next = await createCloudRecoveryClient(f.options).startAgain();
    expect(next.requestId).not.toBe(old.requestId);
    const replacement = JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8"));
    expect(replacement.publicKey).not.toBe(old.publicKey);
    expect(replacement.privateKey).not.toBe(old.privateKey);
  });

  it("keeps the same request when owner permission is revoked", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const old = JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8"));
    const original = f.options.fetch;
    f.options.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) =>
      String(url).endsWith("/info")
        ? Promise.resolve(new Response(null, { status: 403 }))
        : original(url, init),
    ) as typeof fetch;
    await expect(createCloudRecoveryClient(f.options).startAgain()).rejects.toMatchObject(
      cloudUnavailable,
    );
    expect(
      JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8")).requestId,
    ).toBe(old.requestId);
  });

  it("refuses production recovery before creating private state", async () => {
    const f = await fixture();
    expect(() => createCloudRecoveryClient({ ...f.options, environment: "production" })).toThrow(
      new Error("Cloud recovery is unavailable. Try again."),
    );
    await expect(readFile(join(f.stateDir, "cloud/recovery.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.runIf(process.env.WAITRON_LARGE_CLOUD_BACKUP_TEST === "1")(
    "stages a 513 MiB HTTPS object from a private file",
    async () => {
      const chunk = Buffer.alloc(1024 * 1024, 0x5a);
      const hash = createHash("sha256");
      for (let i = 0; i < 513; i++) hash.update(chunk);
      const selected = { ...point, size: 513 * chunk.length, digest: hash.digest("hex") };
      const f = await fixture(selected);
      await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
        cloudUnavailable,
      );
      const tls = mintSelfSignedServerCert({
        hostnames: ["localhost"],
        ipAddresses: ["127.0.0.1"],
        now: new Date(),
      });
      const paths: string[] = [];
      const server = createServer(
        { key: tls.serverKeyPem, cert: tls.serverCertPem },
        (req, res) => {
          paths.push(String(req.url));
          res.writeHead(200, { "content-length": selected.size });
          const chunks = Array.from({ length: 513 }, () => chunk);
          void pipeline(Readable.from(chunks), res).catch(() => res.destroy());
        },
      );
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const endpoint = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
      const options: CloudRecoveryOptions = {
        ...f.options,
        download: undefined,
        storageCa: tls.caCertPem,
        fetch: (async (url: string, init?: RequestInit) => {
          const response = await f.options.fetch(url, init);
          if (!url.endsWith("/read")) return response;
          return Response.json({
            ...(await response.json()),
            location: { endpoint, bucket: "backup", region: "local" },
          });
        }) as typeof fetch,
      };
      try {
        let staged = false;
        await createCloudRecoveryClient(options).restore(async (request) => {
          if (!("artifactPath" in request) || typeof request.artifactPath !== "string")
            throw new Error("Expected a private archive file");
          const info = await stat(request.artifactPath);
          expect(info.size).toBe(selected.size);
          expect(info.mode & 0o777).toBe(0o600);
          staged = true;
        }, point.id);
        expect(staged).toBe(true);
        expect(paths.map((path) => new URL(path, endpoint).pathname)).toEqual([
          `/backup/${point.objectKey}`,
        ]);
        expect(await readdir(join(f.stateDir, RESTORE_STAGING_DIR))).toEqual([]);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    60_000,
  );

  it("bounds a stalled HTTPS object body and retries the same scoped GET", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
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
      await expect(
        createCloudRecoveryClient(options).restore(stage, point.id),
      ).rejects.toMatchObject(cloudUnavailable);
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
  it.each(["staged", "placing"] as const)(
    "resumes approval after a failed cold restore ends its %s flow",
    async (phase) => {
      const f = await fixture();
      await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
        cloudUnavailable,
      );
      const stage = vi.fn(async () => {
        await publishRestoreFlow(f.stateDir, { version: 1, phase, request: {} }, async () => {});
      });
      await createCloudRecoveryClient(f.options).restore(stage, point.id);
      const before = JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8"));
      await refusedLocally(createCloudRecoveryClient(f.options).start());
      await refusedLocally(createCloudRecoveryClient(f.options).restore(stage, point.id));
      expect(stage).toHaveBeenCalledOnce();
      await endRestoreFlow(f.stateDir);
      await createCloudRecoveryClient(f.options).start();
      expect((await createCloudRecoveryClient(f.options).status()).state).toBe("approved");
      await createCloudRecoveryClient(f.options).restore(stage, point.id);
      expect(stage).toHaveBeenCalledTimes(2);
      const after = JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8"));
      expect([after.requestId, after.privateKey, after.pointId]).toEqual([
        before.requestId,
        before.privateKey,
        before.pointId,
      ]);
      expect(f.calls.some((c) => c.action === "restored")).toBe(false);
    },
  );

  it("allows an expired failed restore request to be explicitly replaced", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    await createCloudRecoveryClient(f.options).restore(async () => {}, point.id);
    const original = f.options.fetch;
    f.options.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) =>
      String(url).endsWith("/status")
        ? Promise.resolve(new Response(null, { status: 410 }))
        : original(url, init),
    ) as typeof fetch;
    const old = JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8"));
    const next = await createCloudRecoveryClient(f.options).startAgain();
    expect(next.requestId).not.toBe(old.requestId);
  });

  it.each(["permissions", "size"])(
    "refuses private state with unsafe %s before contacting Cloud",
    async (kind) => {
      const f = await fixture();
      await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
        cloudUnavailable,
      );
      const path = join(f.stateDir, "cloud/recovery.json");
      if (kind === "permissions") await chmod(path, 0o644);
      else {
        const saved = JSON.parse(await readFile(path, "utf8"));
        await writeFile(path, JSON.stringify({ ...saved, padding: "x".repeat(8192) }));
      }
      f.calls.length = 0;
      await refusedLocally(createCloudRecoveryClient(f.options).status());
      expect(f.calls).toEqual([]);
    },
  );

  it("keeps the approved point pinned across later status polls", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    await createCloudRecoveryClient(f.options).status();
    const original = f.options.fetch;
    f.options.fetch = vi.fn((url: string | URL | Request, init?: RequestInit) =>
      String(url).endsWith("/info")
        ? Promise.resolve(
            Response.json({
              point: {
                ...point,
                id: "715955bb-2dbd-4481-9746-f6d3e95a8651",
                objectKey: "snapshots/715955bb-2dbd-4481-9746-f6d3e95a8651",
              },
              operationExpiresAt: new Date(Date.now() + 60000).toISOString(),
            }),
          )
        : original(url, init),
    ) as typeof fetch;
    await expect(createCloudRecoveryClient(f.options).status()).rejects.toMatchObject(
      cloudUnavailable,
    );
    expect(
      JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8")).pointId,
    ).toBe(point.id);
  });

  it("bounds otherwise valid control responses before accepting their payload", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const original = f.options.fetch;
    f.options.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const response = await original(url, init);
      return Response.json({ ...(await response.json()), padding: "x".repeat(16384) });
    }) as typeof fetch;
    await expect(createCloudRecoveryClient(f.options).status()).rejects.toMatchObject(
      cloudUnavailable,
    );
  });

  it("requires the original request as well as the snapshot for completion", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    await createCloudRecoveryClient(f.options).restore(async () => {}, point.id);
    await refusedLocally(
      createCloudRecoveryClient(f.options).markRestored({
        requestId: "715955bb-2dbd-4481-9746-f6d3e95a8651",
        pointId: point.id,
      }),
    );
    expect(JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8")).phase).toBe(
      "staged",
    );
  });

  it("rejects a mismatched declared object length before reading its body", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const consumed = vi.fn();
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentLength: 8,
      Body: (async function* () {
        consumed();
        yield Buffer.from("archive");
      })(),
    } as never);
    const stage = vi.fn(async () => {});
    try {
      await expect(
        createCloudRecoveryClient({ ...f.options, download: undefined }).restore(stage, point.id),
      ).rejects.toMatchObject(cloudUnavailable);
      expect(consumed).not.toHaveBeenCalled();
      expect(stage).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });

  it("stops an overlong object stream before consuming further chunks", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const continued = vi.fn();
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      ContentLength: point.size,
      Body: (async function* () {
        yield Buffer.from("too long");
        continued();
        yield Buffer.from("tail");
      })(),
    } as never);
    const stage = vi.fn(async () => {});
    try {
      await expect(
        createCloudRecoveryClient({ ...f.options, download: undefined }).restore(stage, point.id),
      ).rejects.toMatchObject(cloudUnavailable);
      expect(continued).not.toHaveBeenCalled();
      expect(stage).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });

  it.each([
    {
      fault: "the storage request is refused",
      send: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
          syscall: "connect",
        });
      },
      outcome: "cloud",
    },
    {
      fault: "the object body breaks mid-stream",
      send: async () => ({
        ContentLength: point.size,
        Body: (async function* () {
          yield Buffer.from("arc");
          throw Object.assign(new Error("read ECONNRESET"), {
            code: "ECONNRESET",
            syscall: "read",
          });
        })(),
      }),
      outcome: "cloud",
    },
    {
      fault: "a directory stands at this box's download path",
      send: async (stateDir: string) => {
        const staging = join(stateDir, RESTORE_STAGING_DIR);
        const [scratch] = await readdir(staging);
        await mkdir(join(staging, scratch!, "archive"));
        return { ContentLength: point.size, Body: Readable.from([Buffer.from("archive")]) };
      },
      outcome: "local",
    },
    { fault: "this box's disk is full", write: "ENOSPC", outcome: "resource_limit" },
    { fault: "this box's quota is used up", write: "EDQUOT", outcome: "resource_limit" },
    { fault: "this box's disk fails a write", write: "EIO", outcome: "local" },
  ] as const)("answers $outcome when $fault during the download", async (c) => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    const storage = "send" in c ? c.send : undefined;
    const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(
      (storage
        ? () => storage(f.stateDir)
        : async () => ({
            ContentLength: point.size,
            Body: Readable.from([Buffer.from("archive")]),
          })) as never,
    );
    if ("write" in c) archiveWriteFault.code = c.write;
    const stage = vi.fn(async () => {});
    try {
      const restored = createCloudRecoveryClient({ ...f.options, download: undefined }).restore(
        stage,
        point.id,
      );
      if (c.outcome === "cloud") await expect(restored).rejects.toMatchObject(cloudUnavailable);
      else if (c.outcome === "resource_limit")
        await expect(restored).rejects.toMatchObject({ code: "restore.archive_resource_limit" });
      else await refusedLocally(restored);
      if ("write" in c) expect(archiveWriteFault.closed).toBe(true);
      expect(send).toHaveBeenCalledOnce();
      expect(stage).not.toHaveBeenCalled();
      expect(await readdir(join(f.stateDir, RESTORE_STAGING_DIR))).toEqual([]);
    } finally {
      archiveWriteFault.code = undefined;
      archiveWriteFault.closed = false;
      send.mockRestore();
    }
  });

  it("refuses locally when this box cannot sign its request", async () => {
    const f = await fixture();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
      cloudUnavailable,
    );
    f.calls.length = 0;
    const sign = vi.spyOn(signedRequest, "signCloudPayload").mockImplementation(() => {
      throw new TypeError("unusable key");
    });
    try {
      await refusedLocally(createCloudRecoveryClient(f.options).status());
      expect(f.calls).toEqual([]);
    } finally {
      sign.mockRestore();
    }
  });
});

describe("Cloud selected-copy preview", () => {
  it("reviews verified bytes without staging and still permits a later restore", async () => {
    const f = await fixture();
    const client = createCloudRecoveryClient(f.options);
    await expect(client.start()).rejects.toMatchObject(cloudUnavailable);
    const review = vi.fn(
      async (request: import("./restore-request.js").ArchiveFileRestoreRequest) => {
        expect(await readFile(request.artifactPath, "utf8")).toBe("archive");
        return {
          sourceId: request.managedCloud!.pointId,
          nodeRecoveryKeyName: "Amber Hill",
        };
      },
    );
    expect(typeof client.preview).toBe("function");
    expect(await client.preview(review, point.id)).toEqual({
      sourceId: point.id,
      nodeRecoveryKeyName: "Amber Hill",
    });
    const saved = JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8"));
    expect(saved.phase).toBeUndefined();
    expect(review).toHaveBeenCalledWith({
      kind: "archive-file",
      artifactPath: expect.any(String),
      recoveryKey: "archive-key",
      environment: "preproduction",
      managedCloud: { requestId: saved.requestId, pointId: point.id },
    });
    expect(await readdir(join(f.stateDir, RESTORE_STAGING_DIR))).toEqual([]);
    const stage = vi.fn(async () => {});
    await client.restore(stage, point.id);
    expect(stage).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8")).phase).toBe(
      "staged",
    );
  });
  it("refuses wrong bytes before exposing selected-copy metadata", async () => {
    const f = await fixture();
    const client = createCloudRecoveryClient(f.options);
    await expect(client.start()).rejects.toMatchObject(cloudUnavailable);
    f.options.download.mockImplementation(async (_grant, path) => writeFile(path, "wrong!!"));
    const review = vi.fn(async () => ({ nodeRecoveryKeyName: "Amber Hill" }));
    expect(typeof client.preview).toBe("function");
    await expect(client.preview(review, point.id)).rejects.toMatchObject(cloudUnavailable);
    expect(review).not.toHaveBeenCalled();
  });
  it("releases its gate after a failed preview and keeps the request un-staged", async () => {
    const f = await fixture();
    const client = createCloudRecoveryClient(f.options);
    await expect(client.start()).rejects.toMatchObject(cloudUnavailable);
    expect(typeof client.preview).toBe("function");
    await expect(
      client.preview(async () => {
        throw new Error("damaged archive");
      }, point.id),
    ).rejects.toThrow("damaged archive");
    expect(await client.preview(async () => "selected-name", point.id)).toBe("selected-name");
    expect(
      JSON.parse(await readFile(join(f.stateDir, "cloud/recovery.json"), "utf8")).phase,
    ).toBeUndefined();
  });
});

describe("Cloud recovery client exclusion", () => {
  it("holds the client exclusion until a held call completes", async () => {
    const f = await fixture();
    const client = createCloudRecoveryClient(f.options);
    await expect(client.start()).rejects.toMatchObject(cloudUnavailable);
    const { requestId } = await client.status();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = client.preview(async () => {
      entered();
      await barrier;
      return "held";
    }, point.id);
    try {
      await started;
      const callsWhileHeld = f.calls.length;
      await refusedLocally(client.preview(async () => "second", point.id));
      await refusedLocally(client.binding());
      await refusedLocally(client.status());
      await refusedLocally(client.startAgain());
      expect(f.calls.length).toBe(callsWhileHeld);
    } finally {
      release();
    }
    expect(await pending).toBe("held");
    expect(await client.binding()).toEqual({ requestId, pointId: point.id });
    expect((await client.status()).state).toBe("approved");
  });
});

it("refuses a list-valued recovery approval even with a null operation ID", async () => {
  const f = await fixture();
  const client = createCloudRecoveryClient(f.options);
  await expect(client.start()).rejects.toMatchObject(cloudUnavailable);
  await client.start();
  const original = f.options.fetch;
  f.options.fetch = (async (url, init) => {
    const response = await original(url, init);
    return String(url).endsWith("/status")
      ? Response.json({ ...(await response.json()), state: ["approved"], operationId: null })
      : response;
  }) as typeof fetch;
  await expect(createCloudRecoveryClient(f.options).status()).rejects.toMatchObject(
    cloudUnavailable,
  );
});

it.each([
  { bytes: 16384, accepted: true },
  { bytes: 16385, accepted: false },
])("bounds valid recovery JSON at $bytes bytes", async ({ bytes, accepted }) => {
  const f = await fixture();
  await expect(createCloudRecoveryClient(f.options).start()).rejects.toMatchObject(
    cloudUnavailable,
  );
  const original = f.options.fetch!;
  f.options.fetch = (async (url, init) => {
    const response = await original(url, init);
    const text = await response.text();
    return new Response(text + " ".repeat(bytes - Buffer.byteLength(text)));
  }) as typeof fetch;
  const result = createCloudRecoveryClient(f.options).start();
  if (accepted) expect((await result).state).toBe("awaiting_owner");
  else await expect(result).rejects.toMatchObject(cloudUnavailable);
});
