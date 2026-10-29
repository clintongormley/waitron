import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { incidents, locations, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { BACKUP_ROOM_START_DELETED_FILE } from "@waitron/provisioning";
import { AppError, locationId as brandLocationId, type NodeId } from "@waitron/shared";
import { createBackupRoomHooks } from "./backup-deletion-alert.js";
import type { VenueDbIdentity } from "./backup-room-note.js";
import type { Logger } from "./logger.js";
import { recordStartDeletions } from "./start-backup-room-record.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

let root: string;
let stateDir: string;
let venueDir: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "start-backup-room-record-")));
  stateDir = join(root, "state");
  venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
  await writeFile(join(venueDir, "venue.db"), "installation");
});
afterEach(() => rm(root, { recursive: true, force: true }));

const recordPath = () => join(stateDir, BACKUP_ROOM_START_DELETED_FILE);
const AT = "2026-10-29T03:00:00.000Z";

async function seedVenue(): Promise<NodeId> {
  await seedTenant(db);
  const [location] = await db
    .insert(locations)
    .values({
      name: "Sala",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    })
    .returning({ id: locations.id });
  return seedNode(db, brandLocationId(location!.id));
}

async function venueDbNow(): Promise<VenueDbIdentity> {
  const info = await lstat(join(venueDir, "venue.db"), { bigint: true });
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    birthtimeNs: info.birthtimeNs.toString(),
  };
}

const entry = (key: string, takenAt: string) => ({
  destination: "usb",
  dir: "/media/usb",
  key,
  bytes: 100,
  takenAt,
});

async function writeRecord(over: Record<string, unknown> = {}): Promise<void> {
  const record = {
    version: 1,
    at: AT,
    venueDb: await venueDbNow(),
    // Newest first, so the days come from the times rather than the order. 22:30 UTC on 30
    // September is 1 October in Madrid.
    deleted: [entry("b", "2026-10-03T21:30:00.000Z"), entry("a", "2026-09-30T22:30:00.000Z")],
    ...over,
  };
  await writeFile(recordPath(), JSON.stringify(record));
}

async function deletionRows() {
  return db
    .select({ params: incidents.params, detectedAt: incidents.detectedAt })
    .from(incidents)
    .where(eq(incidents.code, "backup.archives_deleted"));
}

function harness(over: { record?: Parameters<typeof recordStartDeletions>[0]["record"] } = {}) {
  const log = vi.fn<Logger>();
  return {
    log,
    deps: (nodeId: NodeId) => ({
      stateDir,
      venueDir,
      record:
        over.record ?? createBackupRoomHooks({ db, nodeId, fiscal: null }).recordArchivesDeleted,
      log,
    }),
  };
}

describe("recordStartDeletions", () => {
  it("raises one deletion alert with the oldest and newest taken days at the record's time, and deletes the record", async () => {
    const nodeId = await seedVenue();
    await writeRecord();
    const { log, deps } = harness();

    await recordStartDeletions(deps(nodeId));

    expect(await deletionRows()).toEqual([
      {
        params: { count: 2, date: "2026-10-01", lastDate: "2026-10-03", severalDays: true },
        detectedAt: AT,
      },
    ]);
    expect(existsSync(recordPath())).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("does nothing with no record", async () => {
    const nodeId = await seedVenue();
    const { log, deps } = harness();

    await recordStartDeletions(deps(nodeId));

    expect(await deletionRows()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it.each<[string, () => Promise<void>]>([
    ["not JSON", () => writeFile(recordPath(), "{")],
    ["another version", () => writeRecord({ version: 2 })],
    [
      "with a deletion of negative size",
      () => writeRecord({ deleted: [entry("a", AT)].map((e) => ({ ...e, bytes: -1 })) }),
    ],
  ])("logs and deletes a record that is %s, with no alert", async (_label, spoil) => {
    const nodeId = await seedVenue();
    await spoil();
    const { log, deps } = harness();

    await recordStartDeletions(deps(nodeId));

    expect(await deletionRows()).toEqual([]);
    expect(existsSync(recordPath())).toBe(false);
    expect(log.mock.calls).toEqual([
      ["warn", "backup.start_room_record_dropped", { reason: "malformed" }],
    ]);
  });

  it("logs and deletes a record left for another venue.db, with no alert", async () => {
    const nodeId = await seedVenue();
    // A restore or Start again put a new venue.db, with another file number, in this one's place.
    await writeRecord({ venueDb: { ...(await venueDbNow()), ino: "1" } });
    const { log, deps } = harness();

    await recordStartDeletions(deps(nodeId));

    expect(await deletionRows()).toEqual([]);
    expect(existsSync(recordPath())).toBe(false);
    expect(log.mock.calls).toEqual([
      ["warn", "backup.start_room_record_dropped", { reason: "other_venue_db" }],
    ]);
  });

  it("deletes a record that lists no deletions, with no alert and no log", async () => {
    const nodeId = await seedVenue();
    await writeRecord({ deleted: [] });
    const { log, deps } = harness();

    await recordStartDeletions(deps(nodeId));

    expect(await deletionRows()).toEqual([]);
    expect(existsSync(recordPath())).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps the record and logs, without throwing, when the alert cannot be recorded", async () => {
    const nodeId = await seedVenue();
    await writeRecord();
    const record = vi.fn(async () => {
      throw new AppError("storage.disk_full", {});
    });
    const { log, deps } = harness({ record });

    await expect(recordStartDeletions(deps(nodeId))).resolves.toBeUndefined();

    expect(record).toHaveBeenCalledOnce();
    expect(existsSync(recordPath())).toBe(true);
    expect(log.mock.calls).toEqual([
      ["warn", "backup.start_room_alert_failed", { errorCode: "storage.disk_full", errno: null }],
    ]);
  });

  it("keeps the record and logs, with no alert, when venue.db cannot be read", async () => {
    const nodeId = await seedVenue();
    await writeRecord();
    await rm(join(venueDir, "venue.db"));
    const { log, deps } = harness();

    await recordStartDeletions(deps(nodeId));

    expect(await deletionRows()).toEqual([]);
    expect(existsSync(recordPath())).toBe(true);
    expect(log.mock.calls).toEqual([
      ["warn", "backup.start_room_record_kept", { reason: "venue_db_unreadable", errno: "ENOENT" }],
    ]);
  });

  it("keeps a record it cannot read, and logs", async () => {
    const nodeId = await seedVenue();
    await mkdir(recordPath());
    const { log, deps } = harness();

    await recordStartDeletions(deps(nodeId));

    expect(await deletionRows()).toEqual([]);
    expect(existsSync(recordPath())).toBe(true);
    expect(log.mock.calls).toEqual([
      ["warn", "backup.start_room_record_kept", { reason: "unreadable", errno: "EISDIR" }],
    ]);
  });

  it.each<[string, Error, unknown[][]]>([
    ["already gone", Object.assign(new Error("gone"), { code: "ENOENT" }), []],
    [
      "refused with no error number",
      new Error("refused"),
      [["warn", "backup.start_room_record_delete_failed", { errno: null }]],
    ],
  ])("after the alert, a record whose deletion is %s", async (_label, failure, logged) => {
    const nodeId = await seedVenue();
    await writeRecord();
    const { log, deps } = harness();

    await recordStartDeletions({ ...deps(nodeId), remove: async () => Promise.reject(failure) });

    expect(await deletionRows()).toHaveLength(1);
    expect(log.mock.calls).toEqual(logged);
  });

  it("logs a record it could not delete after the alert, and the next start's second recording leaves the one open alert as it was", async () => {
    const nodeId = await seedVenue();
    await writeRecord();
    const { log, deps } = harness();
    const remove = vi.fn(async () => {
      throw Object.assign(new Error("read-only"), { code: "EROFS" });
    });

    await recordStartDeletions({ ...deps(nodeId), remove });

    expect(existsSync(recordPath())).toBe(true);
    expect(log.mock.calls).toEqual([
      ["warn", "backup.start_room_record_delete_failed", { errno: "EROFS" }],
    ]);
    const first = await deletionRows();
    expect(first).toHaveLength(1);

    // recordIncidentOnce keeps an open alert's first count; once handled, this would raise a
    // second alert for the same deletions.
    await recordStartDeletions(deps(nodeId));

    expect(await deletionRows()).toEqual(first);
    expect(existsSync(recordPath())).toBe(false);
  });
});
