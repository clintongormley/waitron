import { gunzipSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { CloudConnectionStatus } from "./cloud-client.js";
import type { CloudCaptureGrant, CloudCaptureMetadata, CloudCapturePoint } from "./cloud-backup.js";
import type { ScheduleClock } from "./backup-schedule.js";
import { createCloudArchiveTarget } from "./cloud-archive-target.js";
import { decryptArtifactAsync } from "./artifact-cipher.js";
const roots: string[] = [];
const unavailable = { stored: false, errorCode: "cloud.unavailable" };
const failed = { stored: false, errorCode: "unknown" };
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cloud-snapshot-"));
  roots.push(root);
  const installationId = randomUUID(),
    venueId = randomUUID();
  let now = Date.parse("2026-09-24T12:00:00Z"),
    primary = true,
    lostReply = false;
  let captures = 0;
  const points = new Map<string, CloudCapturePoint>(),
    uploaded = new Map<string, Buffer>();
  const reservations: string[] = [],
    uploads: string[] = [];
  const status: CloudConnectionStatus = {
    state: "complete",
    code: "",
    environment: "test",
    registration: {
      installationId,
      venueId,
      organisationId: randomUUID(),
      legalBusinessId: randomUUID(),
    },
    installation: {
      state: "active",
      revision: 1,
      lastContactAt: null,
      leaseExpiresAt: null,
      services: [
        {
          service: "retained_snapshots",
          state: "ready",
          health: "unknown",
          failure: null,
          observedAt: null,
        },
      ],
    },
  };
  const connection = {
    async status() {
      return status;
    },
    async reserveCapture(id: string): Promise<CloudCaptureGrant> {
      reservations.push(id);
      return {
        id,
        installationId,
        venueId,
        keyVersion: 1,
        location: { endpoint: "https://storage.example", bucket: "venue", region: "local" },
        incomingKey: "incoming/" + id,
        recoveryKey: "secret-key",
        credentials: {
          accessKeyId: "private-access-id",
          secretAccessKey: "private-access-secret",
          sessionToken: "private-session-token",
        },
        expiresAt: new Date(now + 900000).toISOString(),
      };
    },
    async publishCapture(id: string, metadata: CloudCaptureMetadata): Promise<CloudCapturePoint> {
      if (points.has(id)) return points.get(id)!;
      const bytes = uploaded.get(id);
      if (!bytes) throw Error("not uploaded");
      expect(metadata.digest).toBe(createHash("sha256").update(bytes).digest("hex"));
      const point = {
        ...metadata,
        id,
        installationId,
        venueId,
        keyVersion: 1,
        verification: "pending" as const,
      };
      points.set(id, point);
      if (lostReply) {
        lostReply = false;
        throw Error("lost response");
      }
      return point;
    },
  };
  const clock: ScheduleClock = {
    timeZone: "Europe/Madrid",
    dayCutover: "04:00",
    cutoverChanges: [],
  };
  const deps = {
    stateDir: root,
    connection,
    sourceNodeId: randomUUID(),
    isPrimary: () => primary,
    now: () => new Date(now),
    async upload(grant: CloudCaptureGrant, file: string) {
      uploaded.set(grant.id, await readFile(file));
      uploads.push(grant.id);
    },
  };
  function input(signal = new AbortController().signal) {
    const at = new Date(now);
    const staged = Buffer.from("staged archive " + at.toISOString());
    return {
      at,
      clock,
      signal,
      plaintextBytes: staged.length,
      modules: { core: 1 },
      async *entries() {
        captures++;
        yield staged;
      },
    };
  }
  return {
    root,
    deps,
    status,
    points,
    uploaded,
    reservations,
    uploads,
    input,
    advance: (ms: number) => {
      now += ms;
    },
    primary: (v: boolean) => {
      primary = v;
    },
    loseReply: () => {
      lostReply = true;
    },
    captures: () => captures,
  };
}
it("keeps exact encrypted bytes across a failed upload and restart, without persisting secrets", async () => {
  const f = await fixture();
  let fail = true;
  const upload = f.deps.upload;
  f.deps.upload = async (g, p) => {
    if (fail) throw Error("network");
    await upload(g, p);
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual({
    stored: false,
    errorCode: "unknown",
  });
  expect(f.captures()).toBe(1);
  const files = await readdir(join(f.root, "cloud/snapshots"));
  expect(files.sort()).toEqual(["archive.enc", "state.json"]);
  const saved = await readFile(join(f.root, "cloud/snapshots/state.json"), "utf8");
  expect(saved).not.toContain("secret-key");
  for (const secret of ["private-access-id", "private-access-secret", "private-session-token"])
    expect(saved).not.toContain(secret);
  const bytes = await readFile(join(f.root, "cloud/snapshots/archive.enc"));
  fail = false;
  f.advance(60_000);
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect(f.captures()).toBe(2);
  expect(f.uploaded.get(f.reservations[0]!)).toEqual(bytes);
  expect(f.points.size).toBe(2);
  const [old, fresh] = [...f.points.keys()];
  expect(f.reservations).toEqual([old, old, fresh]);
  expect(f.uploads).toEqual([old, fresh]);
  expect(gunzipSync(await decryptArtifactAsync(f.uploaded.get(fresh!)!, "secret-key"))).toEqual(
    Buffer.from("staged archive 2026-09-24T12:01:00.000Z"),
  );
  expect(await readdir(join(f.root, "cloud/snapshots"))).toEqual(["state.json"]);
});
it("reconciles a lost publication reply after expiry without requesting another grant", async () => {
  const f = await fixture();
  f.loseReply();
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual({
    stored: false,
    errorCode: "unknown",
  });
  const pending = [...f.points.keys()][0]!;
  f.advance(25 * 3600000);
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect(f.points.size).toBe(2);
  expect(f.reservations).toEqual([pending, [...f.points.keys()][1]]);
  expect(f.uploads).toEqual(f.reservations);
  expect(f.captures()).toBe(2);
});
it("retries publication without another grant or upload for the old capture", async () => {
  const f = await fixture();
  const publish = f.deps.connection.publishCapture;
  f.deps.connection.publishCapture = async () => {
    throw Error("publication unavailable");
  };
  for (let n = 0; n < 3; n++)
    await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual({
      stored: false,
      errorCode: "unknown",
    });
  expect(f.uploads).toEqual(f.reservations);
  expect(f.reservations).toHaveLength(1);
  expect(f.captures()).toBe(1);
  f.deps.connection.publishCapture = publish;
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect(f.points.size).toBe(2);
  expect(f.reservations).toEqual([...f.points.keys()]);
  expect(f.uploads).toEqual(f.reservations);
});

it("refuses a connection that is not a test connection, as an outcome", async () => {
  const f = await fixture();
  f.status.environment = "production";
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual({
    stored: false,
    errorCode: "cloud.unavailable",
  });
  expect(f.captures()).toBe(0);
  expect(f.reservations).toEqual([]);
});

it("refuses an archive whose expanded size is over 4 GiB before reserving", async () => {
  const f = await fixture();
  await expect(
    createCloudArchiveTarget(f.deps).store({
      ...f.input(),
      plaintextBytes: 4_294_967_297,
    }),
  ).resolves.toEqual({ stored: false, errorCode: "cloud.unavailable" });
  expect(f.captures()).toBe(0);
  expect(f.reservations).toEqual([]);
});

it("records cloud.unavailable with no connection", async () => {
  const f = await fixture();
  await expect(
    createCloudArchiveTarget({ ...f.deps, connection: undefined }).store(f.input()),
  ).resolves.toEqual({ stored: false, errorCode: "cloud.unavailable" });
  expect(f.captures()).toBe(0);
});

it("counts the fixed overhead and a waiting ciphertext in the space needed", async () => {
  const f = await fixture();
  f.deps.upload = async () => {
    throw Error("offline");
  };
  const target = createCloudArchiveTarget(f.deps);
  await expect(target.roomNeeded(10)).resolves.toBe(59);
  await target.store(f.input());
  const waiting = await readFile(join(f.root, "cloud/snapshots/archive.enc"));
  await expect(target.roomNeeded(10)).resolves.toBe(59 + waiting.length);
});

it("labels the first capture of a month monthly and later captures daily", async () => {
  const f = await fixture();
  const w = createCloudArchiveTarget(f.deps);
  await w.store(f.input());
  expect(await createCloudArchiveTarget(f.deps).readCaptureState?.()).toEqual({
    storedAt: f.input().at.getTime(),
    pending: false,
  });
  expect([...f.points.values()].map((p) => p.retention)).toEqual(["monthly"]);
  f.advance(86400000);
  await w.store(f.input());
  expect([...f.points.values()].map((p) => p.retention)).toEqual(["monthly", "daily"]);
  f.advance(9 * 86400000);
  await w.store(f.input());
  expect([...f.points.values()].map((p) => p.retention)).toEqual(["monthly", "daily", "monthly"]);
  expect(f.captures()).toBe(3);
});
it("does not capture for secondary, unconfigured or revoked installations", async () => {
  const f = await fixture();
  const w = createCloudArchiveTarget(f.deps);
  f.primary(false);
  await w.store(f.input());
  f.primary(true);
  f.status.installation!.services[0]!.state = "unconfigured";
  await w.store(f.input());
  f.status.installation!.services[0]!.state = "ready";
  f.status.installation!.state = "revoked";
  await w.store(f.input());
  expect(f.captures()).toBe(0);
  expect(f.reservations).toEqual([]);
});
it("discards an expired unpublished capture and creates a fresh archive", async () => {
  const f = await fixture();
  const upload = f.deps.upload;
  f.deps.upload = async () => {
    throw Error("network");
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  f.advance(25 * 3600000);
  f.deps.upload = upload;
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect(f.captures()).toBe(2);
  expect(new Set(f.reservations).size).toBe(2);
  expect(f.points.size).toBe(1);
});
it("serialises stores and stops before upload if the primary role changes during capture", async () => {
  const f = await fixture();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const input = f.input();
  const target = createCloudArchiveTarget(f.deps);
  const first = target.store({
    ...input,
    async *entries() {
      entered();
      await gate;
      f.primary(false);
      yield* input.entries();
    },
  });
  await started;
  try {
    await expect(target.store(f.input())).resolves.toEqual(unavailable);
  } finally {
    release();
  }
  await expect(first).resolves.toEqual(unavailable);
  expect(f.uploaded.size).toBe(0);
  expect(f.captures()).toBe(1);
});
it("clears an archive after revocation and never delivers it into a new installation", async () => {
  const f = await fixture();
  const upload = f.deps.upload;
  f.deps.upload = async () => {
    throw Error("network");
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  f.status.installation!.state = "revoked";
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect(await readdir(join(f.root, "cloud/snapshots"))).toEqual([]);
  f.status.installation!.state = "active";
  f.deps.upload = upload;
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect(f.captures()).toBe(2);
});
it("rejects a renewed grant with a different archive key version", async () => {
  const f = await fixture();
  f.deps.upload = async () => {
    throw Error("network");
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  const reserve = f.deps.connection.reserveCapture;
  f.deps.connection.reserveCapture = async (id) => ({ ...(await reserve(id)), keyVersion: 2 });
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(unavailable);
  expect(f.captures()).toBe(1);
});
it("leaves malformed state visible rather than silently resetting capture state", async () => {
  const f = await fixture();
  await createCloudArchiveTarget(f.deps).store(f.input());
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(f.root, "cloud/snapshots/state.json"), "{}");
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(unavailable);
  expect(await readFile(join(f.root, "cloud/snapshots/state.json"), "utf8")).toBe("{}");
});
it("removes a stale temporary-file symlink without changing its target", async () => {
  const f = await fixture();
  const { mkdir, writeFile, symlink } = await import("node:fs/promises");
  await mkdir(join(f.root, "cloud/snapshots"), { recursive: true });
  await writeFile(join(f.root, "keep"), "untouched");
  await symlink(join(f.root, "keep"), join(f.root, "cloud/snapshots/state.json.tmp"));
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect(f.points.size).toBe(1);
  expect(await readFile(join(f.root, "keep"), "utf8")).toBe("untouched");
});
it("uses the real clock when no clock override is supplied and honours an already-aborted signal", async () => {
  const f = await fixture();
  const { now: unused, ...deps } = f.deps;
  void unused;
  const worker = createCloudArchiveTarget(deps),
    controller = new AbortController();
  controller.abort();
  await worker.store(f.input(controller.signal));
  expect(f.captures()).toBe(0);
  await worker.store(f.input());
  expect(f.points.size).toBe(1);
});
it("pauses pending delivery while service is unconfigured and discards it when pairing is removed", async () => {
  const f = await fixture();
  f.deps.upload = async () => {
    throw Error("offline");
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  f.status.installation!.services[0]!.state = "unconfigured";
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect(await readdir(join(f.root, "cloud/snapshots"))).toContain("archive.enc");
  delete f.status.registration;
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect(await readdir(join(f.root, "cloud/snapshots"))).toEqual([]);
});
it("refuses malformed pending metadata and a symlinked spool directory", async () => {
  const f = await fixture();
  f.deps.upload = async () => {
    throw Error("offline");
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  const { writeFile, symlink } = await import("node:fs/promises"),
    path = join(f.root, "cloud/snapshots/state.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.pending.metadata.size = -1;
  await writeFile(path, JSON.stringify(saved));
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(unavailable);
  await rm(join(f.root, "cloud/snapshots"), { recursive: true });
  await symlink(f.root, join(f.root, "cloud/snapshots"));
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(unavailable);
});
it("refuses a changed installation grant and empty archives before uploading", async () => {
  const f = await fixture();
  const reserve = f.deps.connection.reserveCapture;
  f.deps.connection.reserveCapture = async (id) => ({
    ...(await reserve(id)),
    installationId: randomUUID(),
  });
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(unavailable);
  expect(f.captures()).toBe(0);
  f.deps.connection.reserveCapture = reserve;
  await expect(
    createCloudArchiveTarget(f.deps).store({
      ...f.input(),
      plaintextBytes: 0,
      async *entries() {
        yield Buffer.alloc(0);
      },
    }),
  ).resolves.toEqual(unavailable);
  expect(f.uploaded.size).toBe(0);
});
it("makes reused temporary files private and removes abandoned plaintext staging on startup", async () => {
  const f = await fixture();
  const { mkdir, writeFile, stat, chmod } = await import("node:fs/promises");
  await mkdir(join(f.root, "cloud/snapshots/staging"), { recursive: true });
  await writeFile(join(f.root, "cloud/snapshots/staging/venue.db"), "plaintext");
  await writeFile(join(f.root, "cloud/snapshots/state.json.tmp"), "old", { mode: 0o666 });
  await chmod(join(f.root, "cloud/snapshots/state.json.tmp"), 0o666);
  await createCloudArchiveTarget(f.deps).store(f.input());
  expect((await stat(join(f.root, "cloud/snapshots/state.json"))).mode & 0o777).toBe(0o600);
  expect(await readdir(join(f.root, "cloud/snapshots"))).toEqual(["state.json"]);
});
it("refuses oversized state files and invalid pending identifiers", async () => {
  const f = await fixture();
  await createCloudArchiveTarget(f.deps).store(f.input());
  const { writeFile } = await import("node:fs/promises"),
    path = join(f.root, "cloud/snapshots/state.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, " ".repeat(65537));
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(unavailable);
  saved.pending = { id: "not-an-id", createdAt: Date.now() };
  await writeFile(path, JSON.stringify(saved));
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(unavailable);
});
it("keeps an expired pending archive when shutdown interrupts the final publication attempt", async () => {
  const f = await fixture();
  f.deps.upload = async () => {
    throw Error("offline");
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  const before = await readFile(join(f.root, "cloud/snapshots/state.json"), "utf8"),
    bytes = await readFile(join(f.root, "cloud/snapshots/archive.enc"));
  f.advance(25 * 3600000);
  const c = new AbortController();
  f.deps.connection.publishCapture = async () => {
    c.abort();
    throw Error("offline");
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input(c.signal))).resolves.toEqual(
    unavailable,
  );
  expect(await readFile(join(f.root, "cloud/snapshots/state.json"), "utf8")).toBe(before);
  expect(await readFile(join(f.root, "cloud/snapshots/archive.enc"))).toEqual(bytes);
});

it("abandons an unpublished capture made more than a day ahead, and takes a fresh one", async () => {
  const f = await fixture();
  f.deps.connection.publishCapture = async () => {
    throw Error("refused");
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  f.advance(-86_400_000 - 1);
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  expect(f.captures()).toBe(2);
  expect(new Set(f.reservations).size).toBe(2);
});

it("keeps an uploaded capture made exactly a day ahead, still waiting on its publication", async () => {
  const f = await fixture();
  f.deps.connection.publishCapture = async () => {
    throw Error("refused");
  };
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  f.advance(-86_400_000);
  await expect(createCloudArchiveTarget(f.deps).store(f.input())).resolves.toEqual(failed);
  expect(f.captures()).toBe(1);
  expect(new Set(f.reservations).size).toBe(1);
});
