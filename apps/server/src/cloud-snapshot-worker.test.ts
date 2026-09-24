import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { CloudConnectionStatus } from "./cloud-client.js";
import type { CloudCaptureGrant, CloudCaptureMetadata, CloudCapturePoint } from "./cloud-backup.js";
import { createCloudSnapshotWorker } from "./cloud-snapshot-worker.js";
const roots: string[] = [];
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
    online = true,
    lostReply = false;
  let captures = 0;
  const points = new Map<string, CloudCapturePoint>(),
    uploaded = new Map<string, Buffer>();
  const reservations: string[] = [];
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
      if (!online) throw Error("offline");
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
      if (!online) throw Error("offline");
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
  const deps = {
    stateDir: root,
    connection,
    sourceNodeId: randomUUID(),
    isPrimary: () => primary,
    now: () => new Date(now),
    readClock: async () => ({ timeZone: "Europe/Madrid", dayCutover: "04:00" }),
    async createArchive(_grant: CloudCaptureGrant, at: Date) {
      captures++;
      return { bytes: Buffer.from("encrypted archive " + at.toISOString()), modules: { core: 1 } };
    },
    async upload(grant: CloudCaptureGrant, file: string) {
      if (!online) throw Error("offline");
      uploaded.set(grant.id, await readFile(file));
    },
  };
  return {
    root,
    deps,
    status,
    points,
    uploaded,
    reservations,
    advance: (ms: number) => {
      now += ms;
    },
    primary: (v: boolean) => {
      primary = v;
    },
    online: (v: boolean) => {
      online = v;
    },
    loseReply: () => {
      lostReply = true;
    },
    captures: () => captures,
  };
}
const signal = () => new AbortController().signal;
it("keeps exact encrypted bytes across a failed upload and restart, without persisting secrets", async () => {
  const f = await fixture();
  let fail = true;
  const upload = f.deps.upload;
  f.deps.upload = async (g, p) => {
    if (fail) throw Error("network");
    await upload(g, p);
  };
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toThrow("network");
  expect(f.captures()).toBe(1);
  const files = await readdir(join(f.root, "cloud-snapshots"));
  expect(files.sort()).toEqual(["archive.enc", "state.json"]);
  const saved = await readFile(join(f.root, "cloud-snapshots/state.json"), "utf8");
  expect(saved).not.toContain("secret-key");
  for (const secret of ["private-access-id", "private-access-secret", "private-session-token"])
    expect(saved).not.toContain(secret);
  const bytes = await readFile(join(f.root, "cloud-snapshots/archive.enc"));
  fail = false;
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(f.captures()).toBe(1);
  expect([...f.uploaded.values()]).toEqual([bytes]);
  expect(f.points.size).toBe(1);
  expect(new Set(f.reservations).size).toBe(1);
  expect(await readdir(join(f.root, "cloud-snapshots"))).toEqual(["state.json"]);
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(f.captures()).toBe(1);
});
it("reconciles a lost publication reply after expiry without requesting another grant", async () => {
  const f = await fixture();
  f.loseReply();
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toThrow("lost response");
  const grants = f.reservations.length;
  f.advance(25 * 3600000);
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(f.points.size).toBe(1);
  expect(f.reservations.length).toBe(grants);
  expect(f.captures()).toBe(1);
});
it("creates one catch-up snapshot, daily copies and one monthly copy after the month changes", async () => {
  const f = await fixture();
  const w = createCloudSnapshotWorker(f.deps);
  await w.tick(signal());
  expect([...f.points.values()].map((p) => p.retention)).toEqual(["monthly"]);
  f.advance(86400000);
  await w.tick(signal());
  expect([...f.points.values()].map((p) => p.retention)).toEqual(["monthly", "daily"]);
  f.advance(9 * 86400000);
  await w.tick(signal());
  expect([...f.points.values()].map((p) => p.retention)).toEqual(["monthly", "daily", "monthly"]);
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(f.captures()).toBe(3);
});
it("does not capture for secondary, production, unconfigured or revoked installations", async () => {
  const f = await fixture();
  const w = createCloudSnapshotWorker(f.deps);
  f.primary(false);
  await w.tick(signal());
  f.primary(true);
  f.status.environment = "production";
  await w.tick(signal());
  f.status.environment = "test";
  f.status.installation!.services[0]!.state = "unconfigured";
  await w.tick(signal());
  f.status.installation!.services[0]!.state = "ready";
  f.status.installation!.state = "revoked";
  await w.tick(signal());
  expect(f.captures()).toBe(0);
  expect(f.reservations).toEqual([]);
});
it("discards an expired unpublished capture and creates a fresh archive", async () => {
  const f = await fixture();
  const upload = f.deps.upload;
  f.deps.upload = async () => {
    throw Error("network");
  };
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toThrow();
  f.advance(25 * 3600000);
  f.deps.upload = upload;
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(f.captures()).toBe(2);
  expect(new Set(f.reservations).size).toBe(2);
  expect(f.points.size).toBe(1);
});
it("serialises ticks and stops before upload if the primary role changes during capture", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const create = f.deps.createArchive;
  f.deps.createArchive = async (g, at) => {
    await gate;
    f.primary(false);
    return create(g, at);
  };
  const w = createCloudSnapshotWorker(f.deps),
    first = w.tick(signal());
  await new Promise((r) => setTimeout(r, 20));
  await w.tick(signal());
  release();
  await expect(first).rejects.toMatchObject({ code: "cloud.unavailable" });
  expect(f.uploaded.size).toBe(0);
  expect(f.captures()).toBe(1);
});
it("clears an archive after revocation and never delivers it into a new installation", async () => {
  const f = await fixture();
  const upload = f.deps.upload;
  f.deps.upload = async () => {
    throw Error("network");
  };
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toThrow();
  f.status.installation!.state = "revoked";
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(await readdir(join(f.root, "cloud-snapshots"))).toEqual([]);
  f.status.installation!.state = "active";
  f.deps.upload = upload;
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(f.captures()).toBe(2);
});
it("rejects a renewed grant with a different archive key version", async () => {
  const f = await fixture();
  f.deps.upload = async () => {
    throw Error("network");
  };
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toThrow();
  const reserve = f.deps.connection.reserveCapture;
  f.deps.connection.reserveCapture = async (id) => ({ ...(await reserve(id)), keyVersion: 2 });
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  expect(f.captures()).toBe(1);
});
it("leaves malformed state visible rather than silently resetting the schedule", async () => {
  const f = await fixture();
  await createCloudSnapshotWorker(f.deps).tick(signal());
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(f.root, "cloud-snapshots/state.json"), "{}");
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  expect(await readFile(join(f.root, "cloud-snapshots/state.json"), "utf8")).toBe("{}");
});
it("removes a stale temporary-file symlink without changing its target", async () => {
  const f = await fixture();
  const { mkdir, writeFile, symlink } = await import("node:fs/promises");
  await mkdir(join(f.root, "cloud-snapshots"));
  await writeFile(join(f.root, "keep"), "untouched");
  await symlink(join(f.root, "keep"), join(f.root, "cloud-snapshots/state.json.tmp"));
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(f.points.size).toBe(1);
  expect(await readFile(join(f.root, "keep"), "utf8")).toBe("untouched");
});
it("uses the real clock when no clock override is supplied and honours an already-aborted signal", async () => {
  const f = await fixture();
  const { now: unused, ...deps } = f.deps;
  void unused;
  const worker = createCloudSnapshotWorker(deps),
    controller = new AbortController();
  controller.abort();
  await worker.tick(controller.signal);
  expect(f.captures()).toBe(0);
  await worker.tick(signal());
  expect(f.points.size).toBe(1);
});
it("pauses pending delivery while service is unconfigured and discards it when pairing is removed", async () => {
  const f = await fixture();
  f.deps.upload = async () => {
    throw Error("offline");
  };
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toThrow();
  f.status.installation!.services[0]!.state = "unconfigured";
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(await readdir(join(f.root, "cloud-snapshots"))).toContain("archive.enc");
  delete f.status.registration;
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(await readdir(join(f.root, "cloud-snapshots"))).toEqual([]);
});
it("refuses malformed pending metadata and a symlinked spool directory", async () => {
  const f = await fixture();
  f.deps.upload = async () => {
    throw Error("offline");
  };
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toThrow();
  const { writeFile, symlink } = await import("node:fs/promises"),
    path = join(f.root, "cloud-snapshots/state.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.pending.metadata.size = -1;
  await writeFile(path, JSON.stringify(saved));
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  await rm(join(f.root, "cloud-snapshots"), { recursive: true });
  await symlink(f.root, join(f.root, "cloud-snapshots"));
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
});
it("refuses a changed installation grant and empty archives before uploading", async () => {
  const f = await fixture();
  const reserve = f.deps.connection.reserveCapture;
  f.deps.connection.reserveCapture = async (id) => ({
    ...(await reserve(id)),
    installationId: randomUUID(),
  });
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  expect(f.captures()).toBe(0);
  f.deps.connection.reserveCapture = reserve;
  f.deps.createArchive = async () => ({ bytes: Buffer.alloc(0), modules: { core: 1 } });
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  expect(f.uploaded.size).toBe(0);
});
it("makes reused temporary files private and removes abandoned plaintext staging on startup", async () => {
  const f = await fixture();
  const { mkdir, writeFile, stat, chmod } = await import("node:fs/promises");
  await mkdir(join(f.root, "cloud-snapshots/staging"), { recursive: true });
  await writeFile(join(f.root, "cloud-snapshots/staging/venue.db"), "plaintext");
  await writeFile(join(f.root, "cloud-snapshots/state.json.tmp"), "old", { mode: 0o666 });
  await chmod(join(f.root, "cloud-snapshots/state.json.tmp"), 0o666);
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect((await stat(join(f.root, "cloud-snapshots/state.json"))).mode & 0o777).toBe(0o600);
  expect(await readdir(join(f.root, "cloud-snapshots"))).toEqual(["state.json"]);
});
it("refuses oversized state files and invalid pending identifiers", async () => {
  const f = await fixture();
  await createCloudSnapshotWorker(f.deps).tick(signal());
  const { writeFile } = await import("node:fs/promises"),
    path = join(f.root, "cloud-snapshots/state.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, " ".repeat(65537));
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
  saved.pending = { id: "not-an-id", createdAt: Date.now() };
  await writeFile(path, JSON.stringify(saved));
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toMatchObject({
    code: "cloud.unavailable",
  });
});
it("retries publication without another grant or upload after confirmed delivery", async () => {
  const f = await fixture();
  let uploads = 0;
  const upload = f.deps.upload,
    publish = f.deps.connection.publishCapture;
  f.deps.upload = async (g, p) => {
    uploads++;
    await upload(g, p);
  };
  f.deps.connection.publishCapture = async () => {
    throw Error("publication unavailable");
  };
  for (let n = 0; n < 3; n++)
    await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toThrow(
      "publication unavailable",
    );
  expect(uploads).toBe(1);
  expect(f.reservations).toHaveLength(1);
  expect(f.captures()).toBe(1);
  f.deps.connection.publishCapture = publish;
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(f.points.size).toBe(1);
});
it("keeps an expired pending archive when shutdown interrupts the final publication attempt", async () => {
  const f = await fixture();
  f.deps.upload = async () => {
    throw Error("offline");
  };
  await expect(createCloudSnapshotWorker(f.deps).tick(signal())).rejects.toThrow();
  const before = await readFile(join(f.root, "cloud-snapshots/state.json"), "utf8"),
    bytes = await readFile(join(f.root, "cloud-snapshots/archive.enc"));
  f.advance(25 * 3600000);
  const c = new AbortController();
  f.deps.connection.publishCapture = async () => {
    c.abort();
    throw Error("offline");
  };
  await expect(createCloudSnapshotWorker(f.deps).tick(c.signal)).rejects.toThrow();
  expect(await readFile(join(f.root, "cloud-snapshots/state.json"), "utf8")).toBe(before);
  expect(await readFile(join(f.root, "cloud-snapshots/archive.enc"))).toEqual(bytes);
});
it("does not read the venue clock while the next snapshot is not due", async () => {
  const f = await fixture();
  await createCloudSnapshotWorker(f.deps).tick(signal());
  f.deps.readClock = async () => {
    throw Error("unnecessary read");
  };
  await createCloudSnapshotWorker(f.deps).tick(signal());
  expect(f.captures()).toBe(1);
});
