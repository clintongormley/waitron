import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, createPublicKey, verify } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCloudRecoveryClient, type CloudRecoveryOptions } from "./cloud-recovery.js";
import {
  backupVerificationTargetDigests,
  type BackupVerificationTarget,
} from "./backup-verification-protocol.js";
import * as v2 from "./cloud-recovery-v2.js";

const origin = "https://cloud.example.test";
const unavailable = "Cloud recovery is unavailable. Try again.";
function target(revision = "e".repeat(40)): BackupVerificationTarget {
  const value = {
    runtime: { release: "2026.10.20", revision, fingerprint: "f".repeat(64) },
    modules: [
      {
        name: "core",
        packageVersion: "1.2.3",
        requires: {},
        schema: 2,
        migrationTable: "__drizzle_migrations_db",
        migrationDigest: "a".repeat(64),
        semanticsVersion: 1,
        policyDigest: "b".repeat(64),
      },
    ],
  };
  return { version: 1, ...value, ...backupVerificationTargetDigests(value) };
}
const point = {
  id: "047bacd4-df70-4881-a835-c6dd75ae7ecf",
  venueId: "374cac38-cc58-46d5-8d3b-8443fc4343a4",
  capturedAt: "2026-09-24T10:00:00.000Z",
  modules: { core: 1 },
  digest: createHash("sha256").update("archive").digest("hex"),
  size: 7,
  objectKey: "snapshots/047bacd4-df70-4881-a835-c6dd75ae7ecf",
  verification: "verified",
  kind: "snapshot",
  deleting: false,
  deletedAt: null,
};
function verification() {
  const t = target();
  return {
    protocol: "backup-data-restore/v1",
    target: t,
    policyDigest: t.policyDigest,
    requestDigest: "1".repeat(64),
    archiveSha256: point.digest,
    archiveBytes: 7,
    pointId: point.id,
  };
}
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-recovery-v2-"));
  dirs.push(stateDir);
  const calls: { action: string; body: Record<string, unknown>; payload: unknown[] }[] = [];
  let localTarget = target();
  const f = {
    stateDir,
    calls,
    localTarget: () => localTarget,
    changeTarget: () => {
      localTarget = target("d".repeat(40));
    },
    rewrite: (_action: string, result: Record<string, unknown>): Record<string, unknown> => result,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    expired: false,
  };
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const action = String(url).split("/").at(-1)!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const payload = JSON.parse(
      Buffer.from(String(body.payload), "base64url").toString(),
    ) as unknown[];
    calls.push({ action, body, payload });
    if (f.expired && action === "status") return new Response(null, { status: 410 });
    const requestId = payload[2];
    let result: Record<string, unknown>;
    if (action === "start" || action === "status")
      result = {
        version: 2,
        requestId,
        state: action === "start" ? "awaiting_owner" : "approved",
        operationId: action === "start" ? null : requestId,
        expiresAt: f.expiresAt,
      };
    else if (action === "restored") result = { version: 2, status: "restored" };
    else
      result = {
        version: 2,
        point,
        verification: verification(),
        operationExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        ...(action === "read"
          ? {
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
              expiresAt: f.expiresAt,
            }
          : {}),
      };
    return Response.json(f.rewrite(action, result));
  });
  const options: CloudRecoveryOptions = {
    stateDir,
    origin,
    environment: "preproduction",
    snapshotProtocol: 2,
    target: f.localTarget,
    fetch: fetchImpl as typeof fetch,
    download: vi.fn(async () => Buffer.from("archive")),
  };
  return {
    ...f,
    get rewrite() {
      return f.rewrite;
    },
    set rewrite(value) {
      f.rewrite = value;
    },
    get expired() {
      return f.expired;
    },
    set expired(value) {
      f.expired = value;
    },
    options,
    fetchImpl,
    saved: async () =>
      JSON.parse(await readFile(join(stateDir, "cloud-recovery.json"), "utf8")) as Record<
        string,
        unknown
      >,
  };
}

describe("target-bound snapshot recovery v2", () => {
  it("exports a strict saved-target reader and target comparator", () => {
    expect(v2.readSavedSnapshotRecoveryTarget).toBeTypeOf("function");
    expect(v2.assertSnapshotRecoveryTarget).toBeTypeOf("function");
  });
  it("binds the fresh request key, request ID and complete target before contacting Cloud", async () => {
    const f = await fixture();
    const view = await createCloudRecoveryClient(f.options).start();
    const saved = await f.saved();
    const call = f.calls[0]!;
    expect(saved).toMatchObject({
      version: 2,
      protocol: "backup-data-restore/v1",
      target: target(),
      requestId: view.requestId,
    });
    expect((await stat(join(f.stateDir, "cloud-recovery.json"))).mode & 0o777).toBe(0o600);
    expect(call.body).toEqual({
      version: 2,
      target: target(),
      payload: expect.any(String),
      signature: expect.any(String),
    });
    expect(call.payload).toEqual([
      "waitron-cloud-recovery-request-v2",
      origin,
      view.requestId,
      "start",
      saved.publicKey,
      view.code,
      target().digest,
      expect.any(Number),
    ]);
    expect(
      verify(
        null,
        Buffer.from(String(call.body.payload), "base64url"),
        createPublicKey({
          key: Buffer.from(String(saved.publicKey), "base64url"),
          type: "spki",
          format: "der",
        }),
        Buffer.from(String(call.body.signature), "base64url"),
      ),
    ).toBe(true);
    expect(JSON.stringify(view)).not.toContain(String(saved.privateKey));
    expect(await v2.readSavedSnapshotRecoveryTarget(f.stateDir)).toEqual({
      requestId: view.requestId,
      pointId: undefined,
      target: target(),
    });
  });
  it("uses bound proofs for status, info, read and restored and carries exact verification into the restore request", async () => {
    const f = await fixture();
    const client = createCloudRecoveryClient(f.options);
    await client.start();
    await client.status();
    let staged: unknown;
    await client.restore(async (request) => {
      staged = request;
    }, point.id);
    const saved = await f.saved();
    expect(staged).toEqual({
      artifact: Buffer.from("archive"),
      recoveryKey: "archive-key",
      environment: "preproduction",
      managedCloud: { requestId: saved.requestId, pointId: point.id },
      snapshotVerification: verification(),
    });
    await client.markRestored({ requestId: String(saved.requestId), pointId: point.id });
    await client.reportRestored();
    for (const call of f.calls.slice(1)) {
      const early = call.action === "status";
      expect(call.body).toEqual({
        version: 2,
        ...(early ? {} : { id: saved.requestId }),
        target: target(),
        payload: expect.any(String),
        signature: expect.any(String),
      });
      expect(call.payload).toEqual(
        early
          ? [
              "waitron-cloud-recovery-request-v2",
              origin,
              saved.requestId,
              "status",
              saved.publicKey,
              saved.code,
              target().digest,
              expect.any(Number),
            ]
          : [
              "waitron-cloud-recovery-v2",
              origin,
              saved.requestId,
              call.action,
              ["read", "restored"].includes(call.action) ? point.digest : "",
              target().digest,
              expect.any(Number),
            ],
      );
      expect(
        verify(
          null,
          Buffer.from(String(call.body.payload), "base64url"),
          createPublicKey({
            key: Buffer.from(String(saved.publicKey), "base64url"),
            type: "spki",
            format: "der",
          }),
          Buffer.from(String(call.body.signature), "base64url"),
        ),
      ).toBe(true);
    }
    expect((await f.saved()).phase).toBe("reported");
    const legacy = createCloudRecoveryClient({
      ...f.options,
      snapshotProtocol: undefined,
      target: undefined,
    });
    expect(await legacy.replacementIdentity()).toMatchObject({
      requestId: saved.requestId,
      pointId: point.id,
      phase: "reported",
    });
  });
  it.each([undefined, 1, 3])(
    "never downgrades after response negotiation version %s",
    async (version) => {
      const f = await fixture();
      f.rewrite = (_action, result) => ({ ...result, version });
      await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow(unavailable);
      expect(f.calls).toHaveLength(1);
      expect((await f.saved()).version).toBe(2);
    },
  );
  it.each(["status", "info", "read", "after", "restored"])(
    "requires v2 negotiation at %s",
    async (where) => {
      const f = await fixture();
      const client = createCloudRecoveryClient(f.options);
      await client.start();
      let infos = 0;
      f.rewrite = (action, result) => {
        if (action === "info") infos++;
        return action === where || (where === "after" && action === "info" && infos === 3)
          ? { ...result, version: 1 }
          : result;
      };
      if (where === "restored") {
        await client.restore(async () => {}, point.id);
        const s = await f.saved();
        await client.markRestored({ requestId: String(s.requestId), pointId: point.id });
        await expect(client.reportRestored()).rejects.toThrow(unavailable);
        expect((await f.saved()).phase).toBe("restored");
      } else {
        const stage = vi.fn(async () => {});
        await expect(client.restore(stage, point.id)).rejects.toThrow(unavailable);
        expect(stage).not.toHaveBeenCalled();
      }
    },
  );
  it.each([
    "missing",
    "v1",
    "extra",
    "point",
    "digest",
    "size",
    "policy",
    "request",
    "target",
    "forged-target",
  ])("refuses a %s verification descriptor before exposing the selected point", async (fault) => {
    const f = await fixture();
    await createCloudRecoveryClient(f.options).start();
    f.rewrite = (action, result) => {
      if (action !== "info") return result;
      const descriptor: Record<string, unknown> = { ...verification() };
      if (fault === "missing") delete result.verification;
      else {
        if (fault === "v1") descriptor.protocol = "backup-data-restore/v0";
        if (fault === "extra") descriptor.secret = "private";
        if (fault === "point") descriptor.pointId = "715955bb-2dbd-4481-9746-f6d3e95a8651";
        if (fault === "digest") descriptor.archiveSha256 = "2".repeat(64);
        if (fault === "size") descriptor.archiveBytes = 8;
        if (fault === "policy") descriptor.policyDigest = "2".repeat(64);
        if (fault === "request") descriptor.requestDigest = "bad";
        if (fault === "target") descriptor.target = target("d".repeat(40));
        if (fault === "forged-target")
          descriptor.target = {
            ...target(),
            runtime: { ...target().runtime, revision: "d".repeat(40) },
          };
        result.verification = descriptor;
      }
      return result;
    };
    await expect(createCloudRecoveryClient(f.options).status()).rejects.toThrow(unavailable);
    expect((await f.saved()).pointId).toBeUndefined();
    expect(f.options.download).not.toHaveBeenCalled();
  });
  it.each(["read", "after"])(
    "rechecks the complete verification descriptor at %s",
    async (where) => {
      const f = await fixture();
      const client = createCloudRecoveryClient(f.options);
      await client.start();
      let infos = 0;
      f.rewrite = (action, result) => {
        if (action === "info") infos++;
        if (action === where || (where === "after" && action === "info" && infos === 3))
          result.verification = { ...verification(), requestDigest: "2".repeat(64) };
        return result;
      };
      const stage = vi.fn(async () => {});
      await expect(client.restore(stage, point.id)).rejects.toThrow(unavailable);
      expect(stage).not.toHaveBeenCalled();
    },
  );
  it.each(["before-info", "during-info", "during-download"])(
    "rejects a local binary changed %s",
    async (where) => {
      const f = await fixture();
      const client = createCloudRecoveryClient(f.options);
      await client.start();
      if (where === "before-info") f.changeTarget();
      if (where === "during-info")
        f.rewrite = (action, result) => {
          if (action === "info") f.changeTarget();
          return result;
        };
      if (where === "during-download")
        f.options.download = vi.fn(async () => {
          f.changeTarget();
          return Buffer.from("archive");
        });
      const stage = vi.fn(async () => {});
      await expect(client.restore(stage, point.id)).rejects.toThrow(unavailable);
      expect(stage).not.toHaveBeenCalled();
      expect((await f.saved()).target).toEqual(target());
    },
  );
  it("pins the complete descriptor across later status polls", async () => {
    const f = await fixture();
    const client = createCloudRecoveryClient(f.options);
    await client.start();
    await client.status();
    f.rewrite = (action, result) =>
      action === "info"
        ? { ...result, verification: { ...verification(), requestDigest: "2".repeat(64) } }
        : result;
    await expect(client.status()).rejects.toThrow(unavailable);
    expect((await f.saved()).snapshotVerification).toEqual(verification());
  });
  it("does not qualify old v1 state or silently send v1 proofs for a saved v2 request", async () => {
    const f = await fixture();
    f.rewrite = (_action, result) => {
      const r = { ...result };
      delete r.version;
      return r;
    };
    await createCloudRecoveryClient({
      ...f.options,
      snapshotProtocol: undefined,
      target: undefined,
    }).start();
    f.calls.length = 0;
    expect(await v2.readSavedSnapshotRecoveryTarget(f.stateDir)).toBeNull();
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow(unavailable);
    expect(f.calls).toEqual([]);
    await rm(join(f.stateDir, "cloud-recovery.json"));
    f.rewrite = (_action, result) => result;
    await createCloudRecoveryClient(f.options).start();
    f.calls.length = 0;
    await expect(
      createCloudRecoveryClient({
        ...f.options,
        snapshotProtocol: undefined,
        target: undefined,
      }).status(),
    ).rejects.toThrow(unavailable);
    expect(f.calls).toEqual([]);
  });
  it.each(["extra", "protocol", "digest", "key", "phase", "point", "permissions", "size"])(
    "strictly refuses damaged v2 saved %s",
    async (fault) => {
      const f = await fixture();
      await createCloudRecoveryClient(f.options).start();
      const s = await f.saved();
      if (fault === "extra") s.extra = true;
      if (fault === "protocol") s.protocol = "v1";
      if (fault === "digest") s.target = { ...target(), digest: "0".repeat(64) };
      if (fault === "key") s.publicKey = "bad";
      if (fault === "phase") s.phase = "trading";
      if (fault === "point") s.pointId = "bad";
      if (fault === "size") s.code = "1".repeat(65536);
      await writeFile(join(f.stateDir, "cloud-recovery.json"), JSON.stringify(s));
      if (fault === "permissions") await chmod(join(f.stateDir, "cloud-recovery.json"), 0o644);
      await expect(v2.readSavedSnapshotRecoveryTarget(f.stateDir)).rejects.toThrow(unavailable);
    },
  );
  it("returns no saved target when no request exists", async () => {
    const f = await fixture();
    expect(await v2.readSavedSnapshotRecoveryTarget(f.stateDir)).toBeNull();
  });
  it("requires both opt-in and a valid locally computed target before persisting or networking", async () => {
    const f = await fixture();
    for (const options of [
      { ...f.options, target: undefined },
      { ...f.options, snapshotProtocol: undefined },
      { ...f.options, target: () => ({ ...target(), digest: "0".repeat(64) }) },
    ])
      await expect(
        Promise.resolve().then(() => createCloudRecoveryClient(options).start()),
      ).rejects.toThrow(unavailable);
    expect(f.calls).toEqual([]);
    await expect(readFile(join(f.stateDir, "cloud-recovery.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("only replaces an expired request with a fresh key and target", async () => {
    const f = await fixture();
    const client = createCloudRecoveryClient(f.options);
    await client.start();
    const old = await f.saved();
    f.expired = true;
    await client.startAgain();
    const next = await f.saved();
    expect(next.requestId).not.toBe(old.requestId);
    expect(next.publicKey).not.toBe(old.publicKey);
    expect(next.target).toEqual(target());
  });
  it("refuses duplicate response keys instead of accepting the last target", async () => {
    const f = await fixture();
    f.options.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const id = JSON.parse(Buffer.from(body.payload, "base64url").toString())[2];
      return new Response(
        '{"version":1,"version":2,"requestId":' +
          JSON.stringify(id) +
          ',"state":"awaiting_owner","operationId":null,"expiresAt":"2099-01-01T00:00:00.000Z"}',
      );
    }) as typeof fetch;
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow(unavailable);
  });
  it.each(["duplicate", "downgrade"])("refuses %s saved protocol keys", async (fault) => {
    const f = await fixture();
    await createCloudRecoveryClient(f.options).start();
    const raw = await readFile(join(f.stateDir, "cloud-recovery.json"), "utf8");
    await writeFile(
      join(f.stateDir, "cloud-recovery.json"),
      fault === "duplicate"
        ? raw.replace('"version":2', '"version":1,"version":2')
        : raw.replace('"version":2', '"version":1'),
    );
    await expect(v2.readSavedSnapshotRecoveryTarget(f.stateDir)).rejects.toThrow(unavailable);
  });
  it("compares recomputed complete targets and rejects malformed public comparator inputs", () => {
    expect(() =>
      v2.assertSnapshotRecoveryTarget(verification() as v2.SnapshotRecoveryVerification, target()),
    ).not.toThrow();
    expect(() =>
      v2.assertSnapshotRecoveryTarget(
        verification() as v2.SnapshotRecoveryVerification,
        target("d".repeat(40)),
      ),
    ).toThrow(unavailable);
    expect(() =>
      v2.assertSnapshotRecoveryTarget(
        { ...verification(), target: null } as unknown as v2.SnapshotRecoveryVerification,
        target(),
      ),
    ).toThrow(unavailable);
  });
  it("admits the bounded complete composition beyond the old v1 state and response limits", async () => {
    const f = await fixture();
    const t = target();
    t.modules = Array.from({ length: 32 }, (_, i) => ({
      ...t.modules[0]!,
      name: `owner-${i}`,
      migrationTable: `__owner_${i}`,
    }));
    Object.assign(t, backupVerificationTargetDigests(t));
    f.options.target = () => t;
    f.rewrite = (_action, result) => ({
      ...result,
      ...(result.verification
        ? { verification: { ...verification(), target: t, policyDigest: t.policyDigest } }
        : {}),
    });
    const client = createCloudRecoveryClient(f.options);
    await client.start();
    await client.status();
    expect((await stat(join(f.stateDir, "cloud-recovery.json"))).size).toBeGreaterThan(16384);
    const saved = await v2.readSavedSnapshotRecoveryTarget(f.stateDir);
    expect(saved?.target.modules).toHaveLength(32);
    let staged = false;
    await client.restore(async () => {
      staged = true;
    }, point.id);
    expect(staged).toBe(true);
  });
  it("bounds v2 responses before selected-point acceptance", async () => {
    const f = await fixture();
    await createCloudRecoveryClient(f.options).start();
    f.rewrite = (_action, result) => ({ ...result, padding: "x".repeat(65536) });
    await expect(createCloudRecoveryClient(f.options).status()).rejects.toThrow(unavailable);
  });
  it("preserves v1 request and completion proof bytes without target fields", async () => {
    const f = await fixture();
    const options = { ...f.options, snapshotProtocol: undefined, target: undefined };
    const client = createCloudRecoveryClient(options);
    await client.start();
    await client.restore(async () => {}, point.id);
    const saved = await f.saved();
    await client.markRestored({ requestId: String(saved.requestId), pointId: point.id });
    await client.reportRestored();
    for (const call of f.calls) {
      const early = call.action === "start" || call.action === "status";
      expect(call.body).toEqual({
        ...(!early ? { id: saved.requestId } : {}),
        payload: expect.any(String),
        signature: expect.any(String),
      });
      expect(call.payload).toEqual(
        early
          ? [
              "waitron-cloud-recovery-request-v1",
              origin,
              saved.requestId,
              call.action,
              saved.publicKey,
              saved.code,
              expect.any(Number),
            ]
          : [
              "waitron-cloud-recovery-v1",
              origin,
              saved.requestId,
              call.action,
              ["read", "restored"].includes(call.action) ? point.digest : "",
              expect.any(Number),
            ],
      );
    }
    expect(saved).toMatchObject({ version: 1 });
    expect(saved.target).toBeUndefined();
  });
  it.each(["empty", "fraction", "negative", "over-limit", "non-number", "bad-hash", "bad-point"])(
    "refuses verification archive %s",
    async (fault) => {
      const f = await fixture();
      await createCloudRecoveryClient(f.options).start();
      f.rewrite = (action, result) => {
        if (action !== "info") return result;
        const v: Record<string, unknown> = { ...verification() };
        if (fault === "empty") v.archiveBytes = 0;
        if (fault === "fraction") v.archiveBytes = 7.5;
        if (fault === "negative") v.archiveBytes = -1;
        if (fault === "over-limit") v.archiveBytes = 512 * 1024 * 1024 + 1;
        if (fault === "non-number") v.archiveBytes = "7";
        if (fault === "bad-hash") v.archiveSha256 = "bad";
        if (fault === "bad-point") v.pointId = "bad";
        return { ...result, verification: v };
      };
      await expect(createCloudRecoveryClient(f.options).status()).rejects.toThrow(unavailable);
    },
  );
  it.each([
    "null",
    "version",
    "origin",
    "environment",
    "request",
    "code-type",
    "code-value",
    "public-key",
    "private-key",
    "expiry",
    "phase-without-point",
    "point-without-verification",
    "verification-without-point",
    "wrong-verification-target",
    "wrong-verification-point",
  ])("refuses saved %s before returning target identity", async (fault) => {
    const f = await fixture();
    await createCloudRecoveryClient(f.options).start();
    const s = await f.saved();
    if (fault === "version") s.version = 3;
    if (fault === "origin") s.origin = null;
    if (fault === "environment") s.environment = "production";
    if (fault === "request") s.requestId = "bad";
    if (fault === "code-type") s.code = 12345678;
    if (fault === "code-value") s.code = "123";
    if (fault === "public-key") s.publicKey = null;
    if (fault === "private-key") s.privateKey = null;
    if (fault === "expiry") s.expiresAt = "bad";
    if (fault === "phase-without-point") s.phase = "staged";
    if (fault === "point-without-verification") s.pointId = point.id;
    if (fault === "verification-without-point") s.snapshotVerification = verification();
    if (fault === "wrong-verification-target") {
      const t = target("d".repeat(40));
      s.snapshotVerification = { ...verification(), target: t, policyDigest: t.policyDigest };
      s.pointId = point.id;
    }
    if (fault === "wrong-verification-point") {
      s.snapshotVerification = verification();
      s.pointId = "715955bb-2dbd-4481-9746-f6d3e95a8651";
    }
    await writeFile(
      join(f.stateDir, "cloud-recovery.json"),
      JSON.stringify(fault === "null" ? null : s),
    );
    await expect(v2.readSavedSnapshotRecoveryTarget(f.stateDir)).rejects.toThrow(unavailable);
  });
  it("refuses a changed local binary before contacting Cloud again", async () => {
    const f = await fixture();
    const client = createCloudRecoveryClient(f.options);
    await client.start();
    f.calls.length = 0;
    f.changeTarget();
    await expect(client.status()).rejects.toThrow(unavailable);
    expect(f.calls).toEqual([]);
  });
  it("refuses a target that cannot fit its saved approval before creating a request", async () => {
    const f = await fixture();
    const t = target();
    const names = Array.from({ length: 32 }, (_, i) => `owner-${i}`);
    t.modules = names.map((name, i) => ({
      ...t.modules[0]!,
      name,
      migrationTable: `__owner_${i}`,
      requires: Object.fromEntries(
        names.filter((other) => other !== name).map((other) => [other, "1".repeat(16)]),
      ),
    }));
    Object.assign(t, backupVerificationTargetDigests(t));
    f.options.target = () => t;
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow(unavailable);
    expect(f.calls).toEqual([]);
    await expect(readFile(join(f.stateDir, "cloud-recovery.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("keeps private state bounded when a permitted-size response would overflow it", async () => {
    const f = await fixture();
    f.rewrite = (_action, result) => ({ ...result, expiresAt: "2099-01-01" + " ".repeat(65000) });
    await expect(createCloudRecoveryClient(f.options).start()).rejects.toThrow(unavailable);
    const saved = await f.saved();
    expect(saved.expiresAt).toBeUndefined();
    expect((await stat(join(f.stateDir, "cloud-recovery.json"))).size).toBeLessThanOrEqual(65536);
  });
});
