import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { incidents, locations, withTransaction, type Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { markIncidentHandled } from "@waitron/core";
import { locationId as brandLocationId, type NodeId } from "@waitron/shared";
import type { DeletableArchive } from "./backup-room.js";
import { createBackupRoomHooks } from "./backup-deletion-alert.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

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

function archive(key: string): DeletableArchive {
  return {
    destination: "box",
    dir: "/backups",
    key,
    bytes: 100,
    takenAt: new Date("2026-10-01T12:00:00.000Z"),
  };
}

async function backupRows() {
  return db
    .select({
      id: incidents.id,
      source: incidents.source,
      deviceId: incidents.deviceId,
      code: incidents.code,
      params: incidents.params,
      severity: incidents.severity,
      detectedAt: incidents.detectedAt,
      acknowledgedAt: incidents.acknowledgedAt,
    })
    .from(incidents)
    .where(eq(incidents.code, "backup.archives_deleted"))
    .orderBy(incidents.detectedAt);
}

describe("recordArchivesDeleted", () => {
  it("records a backup warning with the count and the venue's calendar day of the deletion", async () => {
    const nodeId = await seedVenue();
    const hooks = createBackupRoomHooks({ db, nodeId, fiscal: null });
    // 00:30 on 28 October in Madrid: before the venue's 06:00 cutover, so its business day is
    // still the 27th, and in UTC it is the 27th too.
    const at = new Date("2026-10-27T23:30:00.000Z");
    await hooks.recordArchivesDeleted([archive("a"), archive("b")], at);
    expect(await backupRows()).toEqual([
      {
        id: expect.any(String),
        source: "backup",
        deviceId: null,
        code: "backup.archives_deleted",
        params: { count: 2, date: "2026-10-28" },
        severity: "warning",
        detectedAt: at.toISOString(),
        acknowledgedAt: null,
      },
    ]);
  });

  it("keeps one open alert with the first count while it is open, and raises a new one once handled", async () => {
    const nodeId = await seedVenue();
    const hooks = createBackupRoomHooks({ db, nodeId, fiscal: null });
    await hooks.recordArchivesDeleted([archive("a")], new Date("2026-10-27T10:00:00.000Z"));
    await hooks.recordArchivesDeleted(
      [archive("b"), archive("c"), archive("d")],
      new Date("2026-10-27T11:00:00.000Z"),
    );
    const open = await backupRows();
    expect(open).toHaveLength(1);
    expect(open[0]!.params).toEqual({ count: 1, date: "2026-10-27" });

    await withTransaction(db, (tx) =>
      markIncidentHandled(tx, {
        id: open[0]!.id,
        personId: null,
        handledAt: new Date("2026-10-27T12:00:00.000Z"),
      }),
    );
    await hooks.recordArchivesDeleted(
      [archive("e"), archive("f")],
      new Date("2026-10-29T10:00:00.000Z"),
    );
    const after = await backupRows();
    expect(after.map((row) => [row.params, row.acknowledgedAt === null])).toEqual([
      [{ count: 1, date: "2026-10-27" }, false],
      [{ count: 2, date: "2026-10-29" }, true],
    ]);
  });
});

describe("readInstallationStart", () => {
  it("answers the fiscal seat's installation start for this node", async () => {
    const nodeId = await seedVenue();
    const start = new Date("2026-10-01T09:00:00.000Z");
    const asked: unknown[] = [];
    const hooks = createBackupRoomHooks({
      db,
      nodeId,
      fiscal: {
        installationStartedAt: async (tx, node) => {
          asked.push(node);
          const [row] = await tx.select({ id: locations.id }).from(locations);
          expect(row).toBeDefined();
          return start;
        },
      },
    });
    expect(await hooks.readInstallationStart()).toEqual(start);
    expect(asked).toEqual([nodeId]);
  });

  it("answers null when the seat has no such member, or there is no seat", async () => {
    const nodeId = await seedVenue();
    expect(await createBackupRoomHooks({ db, nodeId, fiscal: {} }).readInstallationStart()).toBe(
      null,
    );
    expect(await createBackupRoomHooks({ db, nodeId, fiscal: null }).readInstallationStart()).toBe(
      null,
    );
    expect(
      await createBackupRoomHooks({ db, nodeId, fiscal: undefined }).readInstallationStart(),
    ).toBe(null);
  });

  it("answers null without waiting for the write lock when the seat has no such member", async () => {
    const withWriteLock = vi.fn();
    const locked = { withWriteLock } as unknown as Database;
    for (const fiscal of [{}, null, undefined])
      expect(
        await createBackupRoomHooks({
          db: locked,
          nodeId: "node-1" as NodeId,
          fiscal,
        }).readInstallationStart(),
      ).toBe(null);
    expect(withWriteLock).not.toHaveBeenCalled();
  });

  it("reads with a change waiting in the change list and leaves it waiting", async () => {
    const nodeId = await seedVenue();
    await withTransaction(db, () => undefined);
    // A drained list would be empty afterwards: draining is a write, which a nearly full disk
    // refuses.
    db.run(sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`);
    const start = new Date("2026-10-01T09:00:00.000Z");
    const hooks = createBackupRoomHooks({
      db,
      nodeId,
      fiscal: { installationStartedAt: async () => start },
    });
    expect(await hooks.readInstallationStart()).toEqual(start);
    expect(db.all<{ id: string }>(sql`select id from change_log`)).toEqual([{ id: "zz1" }]);
  });
});
