import { it, expect, vi } from "vitest";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installationFixture } from "../test/cloud-installation-fixture.js";
import { reserveCloudCapture, publishCloudCapture } from "./cloud-backup.js";
import { createCloudConnection, type SavedCloudState } from "./cloud-client.js";
const captureKeys = new Map<string, string>();
const signedRequest = '{"upload":"presigned-put-v1"}';
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
function signedGrant(values: unknown[], saved: Record<string, unknown>) {
  const { credentials, ...common } = grant(values, saved);
  return {
    ...common,
    uploadUrl: `${common.location.endpoint}/${common.location.bucket}/${common.incomingKey}?token=${credentials.sessionToken.repeat(1200)}`,
  };
}
it("uses current installation proof and renews the same capture without saving upload secrets", async () => {
  let signedPayload: unknown;
  const f = await installationFixture(async (v, s, _req, res, sent) => {
    signedPayload = sent.payload;
    res.end(JSON.stringify(signedGrant(v, s)));
  });
  try {
    const id = randomUUID();
    const first = await f.client.reserveCapture(id);
    expect(first.id).toBe(id);
    expect(first.incomingKey).toBe("incoming/" + id);
    const saved = await readFile(join(f.stateDir, "cloud/connection.json"), "utf8");
    const state = JSON.parse(saved) as SavedCloudState;
    const request = f.requests.at(-1)!;
    expect(request[2]).toBe("backup-reserve");
    expect(request[6]).toContain("payload");
    expect(request[7]).toBe(signedRequest);
    expect(Buffer.from(String(signedPayload), "base64url").toString()).toBe(
      JSON.stringify([
        "waitron-cloud-machine-v1",
        state.origin,
        "backup-reserve",
        state.view!.registration!.installationId,
        id,
        request[5],
        JSON.stringify(state.lifecycle!.lease),
        signedRequest,
      ]),
    );
    expect(first.uploadUrl).toBe(
      `https://storage.test/venue-one/incoming/${id}?token=${"token".repeat(1200)}`,
    );
    const restarted = createCloudConnection(f.options);
    const retried = await restarted.reserveCapture(id);
    expect(retried.id).toBe(id);
    expect(retried.recoveryKey).toBe(first.recoveryKey);
    const afterRetry = await readFile(join(f.stateDir, "cloud/connection.json"), "utf8");
    for (const secret of [
      first.recoveryKey,
      '"secretAccessKey"',
      '"sessionToken"',
      "token".repeat(1200),
    ])
      expect(afterRetry).not.toContain(secret);
  } finally {
    await f.close();
  }
});
it("falls back once on the exact reservation refusal from older Cloud versions", async () => {
  let status = 400;
  let body: string | undefined;
  let malformedCredentials = false;
  const f = await installationFixture(async (v, s, _req, res) => {
    if (v[7] === "{}" && body === undefined) {
      const reply = grant(v, s);
      res.end(
        JSON.stringify(
          malformedCredentials
            ? { ...reply, credentials: { accessKeyId: "x", secretAccessKey: "y" } }
            : reply,
        ),
      );
    } else res.writeHead(status).end(body ?? '{"error":"invalid_metadata"}');
  });
  const sent = (id: string) =>
    f.requests.filter((v) => v[2] === "backup-reserve" && v[4] === id).map((v) => v[7]);
  try {
    const id = randomUUID();
    await expect(f.client.reserveCapture(id)).resolves.toMatchObject({
      id,
      credentials: {
        accessKeyId: "upload",
        secretAccessKey: "secret",
        sessionToken: "token",
      },
    });
    expect(sent(id)).toEqual([signedRequest, "{}"]);
    malformedCredentials = true;
    await expect(f.client.reserveCapture(randomUUID())).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
    for (const refusal of [
      [400, '{"error":"different"}', [signedRequest]],
      [400, "{", [signedRequest]],
      [400, '{"error":"invalid_metadata"}' + " ".repeat(65536), [signedRequest]],
      [503, '{"error":"invalid_metadata"}', [signedRequest]],
      [400, '{"error":"invalid_metadata"}', [signedRequest, "{}"]],
    ] as const) {
      const id = randomUUID();
      [status, body] = refusal;
      await expect(f.client.reserveCapture(id)).rejects.toMatchObject({
        code: "cloud.unavailable",
      });
      expect(sent(id)).toEqual(refusal[2]);
    }
  } finally {
    await f.close();
  }
});
it("binds signed grants to the opt-in reply and the reserved HTTPS object", async () => {
  let change: (v: ReturnType<typeof signedGrant>) => object;
  let fallback = false;
  const f = await installationFixture(async (v, s, _req, res) => {
    if (fallback && v[7] !== "{}") res.writeHead(400).end('{"error":"invalid_metadata"}');
    else res.end(JSON.stringify(change(signedGrant(v, s))));
  });
  const refuse = () =>
    expect(f.client.reserveCapture(randomUUID())).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  try {
    for (const edit of [
      (u: string) => u.replace("https:", "http:"),
      (u: string) => u.replace("storage.test", "another.test"),
      (u: string) => u.replace("storage.test", "user:pass@storage.test"),
      (u: string) => u.replace("incoming/", "other/"),
      (u: string) => u.split("?")[0],
      (u: string) => u + "#fragment",
      (u: string) => u + "x".repeat(16384),
    ]) {
      change = (v) => ({ ...v, uploadUrl: edit(v.uploadUrl) });
      await refuse();
    }
    const credentials = { accessKeyId: "upload", secretAccessKey: "secret", sessionToken: "token" };
    change = (v) => ({ ...v, credentials });
    await refuse();
    change = (v) => ({ ...v, uploadUrl: undefined, credentials });
    await refuse();
    fallback = true;
    change = (v) => v;
    await refuse();
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
    res.end(body ?? JSON.stringify({ ...signedGrant(v, s), ...patch }));
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
it("lets publication use the retained-copy budget while reserve keeps its shorter budget", async () => {
  const f = await installationFixture(async (v, s, _req, res) => {
    const m = JSON.parse(String(v[7]));
    res.end(JSON.stringify({ ...grant(v, s), ...m, verification: "pending" }));
  });
  await f.client.refresh();
  const state = JSON.parse(
    await readFile(join(f.stateDir, "cloud/connection.json"), "utf8"),
  ) as SavedCloudState;
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const deadline = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    if (ms === 15_000) return AbortSignal.abort();
    return realTimeout(ms);
  });
  const id = randomUUID();
  const metadata = {
    digest: "a".repeat(64),
    size: 7,
    capturedAt: new Date().toISOString(),
    retention: "daily" as const,
    sourceNodeId: randomUUID(),
    modules: { core: 1 },
  };
  try {
    await expect(publishCloudCapture(state, id, metadata)).resolves.toMatchObject(metadata);
    expect(deadline).toHaveBeenCalledWith(50_000);
    await expect(reserveCloudCapture(state, id)).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  } finally {
    deadline.mockRestore();
    await f.close();
  }
});
it("waits past Cloud's ten-second storage grant for a reservation, then gives up", async () => {
  let replyAfter = 0;
  const f = await installationFixture(async (v, s, _req, res) => {
    await new Promise((r) => setTimeout(r, replyAfter));
    res.end(JSON.stringify(signedGrant(v, s)));
  });
  await f.client.refresh();
  const state = JSON.parse(
    await readFile(join(f.stateDir, "cloud/connection.json"), "utf8"),
  ) as SavedCloudState;
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const deadline = vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((ms) => realTimeout(ms / 20));
  try {
    replyAfter = 11_500 / 20;
    const id = randomUUID();
    await expect(reserveCloudCapture(state, id)).resolves.toMatchObject({ id });
    replyAfter = 18_000 / 20;
    await expect(reserveCloudCapture(state, randomUUID())).rejects.toMatchObject({
      code: "cloud.unavailable",
    });
  } finally {
    deadline.mockRestore();
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
      await readFile(join(f.stateDir, "cloud/connection.json"), "utf8"),
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
    res.end(JSON.stringify(signedGrant(v, s)));
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
it("cancels a capture waiting behind another connection operation without waiting for that operation", async () => {
  const f = await installationFixture();
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      entered = r;
    });
  const blocking = f.client.revoke(async () => {
    entered();
    await hold;
  });
  await ready;
  const c = new AbortController();
  const capture = f.client.reserveCapture(randomUUID(), c.signal);
  const result = capture.then(
    () => "completed",
    () => "aborted",
  );
  c.abort();
  try {
    expect(
      await Promise.race([
        result,
        new Promise<string>((r) => setTimeout(() => r("still waiting"), 50)),
      ]),
    ).toBe("aborted");
    expect(f.requests.filter((v) => v[2] === "backup-reserve")).toHaveLength(0);
  } finally {
    release();
    await blocking;
    await result;
    await f.close();
  }
});

it.each([
  { bytes: 65536, accepted: true },
  { bytes: 65537, accepted: false },
])("bounds valid backup JSON at $bytes bytes", async ({ bytes, accepted }) => {
  const f = await installationFixture(async (values, saved, _req, res) => {
    const text = JSON.stringify(signedGrant(values, saved));
    res.end(text + " ".repeat(bytes - Buffer.byteLength(text)));
  });
  try {
    const id = randomUUID();
    const result = f.client.reserveCapture(id);
    if (accepted) expect((await result).id).toBe(id);
    else await expect(result).rejects.toMatchObject({ code: "cloud.unavailable" });
  } finally {
    await f.close();
  }
});
