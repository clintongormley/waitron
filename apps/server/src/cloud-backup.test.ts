import { it, expect } from "vitest";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { reserveCloudCapture, publishCloudCapture } from "./cloud-backup.js";
import { createCloudConnection, type SavedCloudState } from "./cloud-client.js";
const captureKeys = new Map<string, string>();
function grant(values: unknown[], saved: Record<string, unknown>) {
  const r = (saved.view as { registration: { installationId: string; venueId: string } })
    .registration;
  const id = String(values[4]);
  if (!captureKeys.has(id)) captureKeys.set(id, randomBytes(32).toString("base64url"));
  return {
    id: values[4],
    ...r,
    keyVersion: 1,
    location: { endpoint: "https://storage.test", bucket: "venue-one", region: "local" },
    incomingKey: "incoming/" + String(values[4]),
    recoveryKey: captureKeys.get(id)!,
    credentials: { accessKeyId: "upload", secretAccessKey: "secret", sessionToken: "token" },
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  };
}
it("uses current installation proof and renews the same capture without saving upload secrets", async () => {
  const f = await installationFixture(async (v, s, _req, res) => {
    res.end(JSON.stringify(grant(v, s)));
  });
  try {
    const id = randomUUID();
    const first = await f.client.reserveCapture(id);
    expect(first.id).toBe(id);
    expect(first.incomingKey).toBe("incoming/" + id);
    expect(f.requests.at(-1)?.[2]).toBe("backup-reserve");
    expect(f.requests.at(-1)?.[6]).toContain("payload");
    expect(f.requests.at(-1)?.[7]).toBe("{}");
    const restarted = createCloudConnection(f.options);
    const retried = await restarted.reserveCapture(id);
    expect(retried.id).toBe(id);
    expect(retried.recoveryKey).toBe(first.recoveryKey);
    const saved = await readFile(join(f.stateDir, "cloud-connection.json"), "utf8");
    for (const secret of [first.recoveryKey, '"secretAccessKey"', '"sessionToken"'])
      expect(saved).not.toContain(secret);
  } finally {
    await f.close();
  }
});
it("refuses mismatched or malformed grants and propagates refusal without exposing credentials", async () => {
  let patch: Record<string, unknown> = {},
    code = 200,
    body: string | undefined;
  const f = await installationFixture(async (v, s, _req, res) => {
    res.writeHead(code);
    res.end(body ?? JSON.stringify({ ...grant(v, s), ...patch }));
  });
  try {
    for (const value of [
      { id: randomUUID() },
      { installationId: randomUUID() },
      { venueId: randomUUID() },
      { keyVersion: 0 },
      { incomingKey: "snapshots/other" },
      { recoveryKey: "bad" },
      { expiresAt: new Date(0).toISOString() },
      { expiresAt: new Date(Date.now() + 3600000).toISOString() },
      { credentials: { accessKeyId: "x", secretAccessKey: "y" } },
      { location: { endpoint: "http://storage.test", bucket: "venue-one", region: "local" } },
    ]) {
      patch = value;
      await expect(f.client.reserveCapture(randomUUID())).rejects.toMatchObject({
        code: "cloud.unavailable",
      });
    }
    patch = {};
    for (const status of [401, 403, 409, 410, 429, 503]) {
      code = status;
      body = '{"error":"unavailable"}';
      await expect(f.client.reserveCapture(randomUUID())).rejects.toMatchObject({
        code: "cloud.unavailable",
      });
    }
    code = 200;
    body = "x".repeat(70000);
    await expect(f.client.reserveCapture(randomUUID())).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  } finally {
    await f.close();
  }
});
it("publication checks the exact metadata and reports pending verification", async () => {
  let corrupt: Record<string, unknown> = {};
  const f = await installationFixture(async (v, s, _req, res) => {
    const m = JSON.parse(String(v[7]));
    res.end(
      JSON.stringify({
        ...grant(v, s),
        ...m,
        verification: "pending",
        ...corrupt,
      }),
    );
  });
  try {
    const id = randomUUID(),
      metadata = {
        digest: createHash("sha256").update("archive").digest("hex"),
        size: 7,
        capturedAt: new Date().toISOString(),
        retention: "daily" as const,
        sourceNodeId: randomUUID(),
        modules: { core: 1 },
      };
    expect((await f.client.publishCapture(id, metadata)).verification).toBe("pending");
    expect(JSON.parse(String(f.requests.at(-1)?.[7]))).toEqual(metadata);
    for (const patch of [
      { digest: "f".repeat(64) },
      { modules: { core: 2 } },
      { modules: null },
      { verification: "uploaded" },
    ]) {
      corrupt = patch;
      await expect(f.client.publishCapture(id, metadata)).rejects.toMatchObject({
        code: "cloud.unavailable",
      });
    }
  } finally {
    await f.close();
  }
});
it("local revocation and missing connection refuse capture without issuing new requests", async () => {
  const f = await installationFixture();
  try {
    await f.client.revoke(async () => {});
    const count = f.requests.length;
    await expect(f.client.reserveCapture(randomUUID())).rejects.toMatchObject({
      code: "cloud.binding_conflict",
    });
    expect(f.requests).toHaveLength(count);
  } finally {
    await f.close();
  }
});

it("refuses malformed response bodies, redirects, invalid inputs and missing local authority", async () => {
  let status = 200,
    body = "{",
    redirect = false;
  const f = await installationFixture(async (_v, _s, _req, res) => {
    res.writeHead(status, redirect ? { location: "/wrong" } : {});
    res.end(body);
  });
  try {
    await f.client.refresh();
    const state = JSON.parse(
      await readFile(join(f.stateDir, "cloud-connection.json"), "utf8"),
    ) as SavedCloudState;
    for (const bad of [
      { ...state, view: undefined },
      { ...state, environment: "production" as const },
      { ...state, lifecycle: undefined },
      { ...state, lifecycle: { ...state.lifecycle!, revoked: true } },
    ])
      await expect(reserveCloudCapture(bad, randomUUID())).rejects.toMatchObject({
        code: "cloud.binding_conflict",
      });
    await expect(reserveCloudCapture(state, "invalid")).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    await expect(
      publishCloudCapture(state, randomUUID(), {
        digest: "a".repeat(64),
        size: 1,
        capturedAt: new Date().toISOString(),
        retention: "daily",
        sourceNodeId: randomUUID(),
        modules: { ["x".repeat(5000)]: 1 },
      }),
    ).rejects.toMatchObject({ code: "cloud.unavailable" });
    for (const value of ["{", "null", "[]"]) {
      body = value;
      await expect(reserveCloudCapture(state, randomUUID())).rejects.toMatchObject({
        code: "cloud.unavailable",
      });
    }
    status = 204;
    await expect(reserveCloudCapture(state, randomUUID())).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    status = 302;
    redirect = true;
    await expect(reserveCloudCapture(state, randomUUID())).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(reserveCloudCapture(state, randomUUID(), controller.signal)).rejects.toMatchObject(
      { code: "cloud.unavailable" },
    );
  } finally {
    await f.close();
  }
});
it("queues capture requests behind the connection gate", async () => {
  const f = await installationFixture(async (v, s, _req, res) => {
    res.end(JSON.stringify(grant(v, s)));
  });
  try {
    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(ids.map((id) => f.client.reserveCapture(id)));
    expect(results.map((r) => (r.status === "fulfilled" ? "ok" : r.reason.code))).toEqual([
      "ok",
      "ok",
    ]);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value.id : null))).toEqual(ids);
    expect(f.requests.filter((v) => v[2] === "backup-reserve")).toHaveLength(2);
  } finally {
    await f.close();
  }
});
it("revocation discovered during refresh prevents the capture request", async () => {
  const f = await installationFixture();
  try {
    await f.client.refresh();
    f.revoke();
    const before = f.requests.length;
    await expect(f.client.reserveCapture(randomUUID())).rejects.toMatchObject({
      code: "cloud.binding_conflict",
    });
    expect(f.requests.slice(before).map((v) => v[2])).toEqual(["configuration"]);
  } finally {
    await f.close();
  }
});
it("cancels an oversized response stream before it finishes", async () => {
  let closed!: () => void;
  const finished = new Promise<void>((r) => {
    closed = r;
  });
  const f = await installationFixture(async (_v, _s, _req, res) => {
    res.once("close", closed);
    res.write("x".repeat(70000));
  });
  try {
    await expect(f.client.reserveCapture(randomUUID())).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        finished,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("Response stream stayed open")), 2000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await f.close();
  }
});
