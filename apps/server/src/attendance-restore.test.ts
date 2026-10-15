import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locations, newId, openVenueDatabase, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { persons, sessions, hashSessionToken } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import {
  WorkforceBackend,
  attendanceDayWork,
  attendanceMail,
  attendanceQuestions,
  attendanceSourceState,
  readChain,
  verifyChain,
} from "@waitron/workforce";
import { ALL_MODULES } from "./modules.js";
import { buildManifest } from "./backup-manifest.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { restoreFromArtifactFile } from "./restore.js";
import { beginAttendanceDiscovery, discoverAttendanceDays } from "./attendance-discovery.js";
import { runAttendancePass } from "./attendance-loop.js";
import { recordAttendanceFact } from "./attendance-capture.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const now = new Date("2026-01-07T09:00:00Z");
let nodeId: string, locationId: string, personId: string, missingPersonId: string;
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "04:00",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    })
    .returning();
  locationId = location!.id;
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const deviceId = (await seedDevice(suite.db, { locationId: brandLocationId(locationId) }))
    .deviceId;
  const people = await suite.db
    .insert(persons)
    .values([
      { displayName: "Clocked worker", role: "admin" },
      { displayName: "Missing clock", email: "worker@example.test" },
    ])
    .returning();
  [personId, missingPersonId] = people.map((p) => p.id) as [string, string];
  await withTransaction(suite.db, async (tx) => {
    await new WorkforceBackend().clockIn(tx, {
      nodeId,
      locationId,
      personId,
      at: "2026-01-05T09:00:00Z",
      offsetMinutes: 60,
      origin: jobOrigin("dashboard"),
    });
    for (let i = 0; i < 105; i++) {
      const id = newId();
      await tx
        .insert(sessions)
        .values({
          id,
          tokenHash: hashSessionToken(id),
          personId,
          deviceId,
          openedAt: i === 104 ? "2026-01-05T16:40:00Z" : "2026-01-05T10:00:00Z",
        });
    }
    await recordAttendanceFact(tx, {
      source: "order",
      key: "missing-start",
      personId: missingPersonId,
      locationId,
      kind: "order",
      at: "2026-01-05T12:00:00Z",
      offsetMinutes: 60,
      outcome: "qualified",
    });
    await beginAttendanceDiscovery(tx, { locationId, generation: "source-open" });
  });
});
function pass(db: Database) {
  return runAttendancePass({ db, nodeId, locationId, now: () => now, isPrimary: () => true });
}
async function settle(db: Database) {
  for (let i = 0; i < 15; i++) if (!(await pass(db)).more) return;
  throw new Error("restored attendance did not settle");
}
async function snapshot(db: Database) {
  return {
    chain: await readChain(db, { nodeId, locationId }),
    questions: await db.select().from(attendanceQuestions),
    mail: await db.select().from(attendanceMail),
    days: await db.select().from(attendanceDayWork),
  };
}
async function restore() {
  const root = await mkdtemp(join(tmpdir(), "attendance-restore-"));
  dirs.push(root);
  const database = join(root, "source.db");
  await suite.db.archiveTo(database);
  const manifest = await buildManifest({
    db: suite.db,
    modules: ALL_MODULES,
    environment: "preproduction",
    now,
  });
  const artifactPath = join(root, "attendance.enc");
  await writeFile(
    artifactPath,
    encryptArtifact(
      packArchive([
        { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
        { name: "db.dump", bytes: await readFile(database) },
      ]),
      "test-key",
    ),
  );
  const venueDir = join(root, "restored-venue");
  await restoreFromArtifactFile({
    artifactPath,
    recoveryKey: "test-key",
    stateDir: join(root, "state"),
    stagingDir: join(root, "staging"),
    venueDir,
    migrationsRoot: null,
    modules: ALL_MODULES,
    environment: "preproduction",
    skipSecrets: true,
    log: () => {},
  });
  return openVenueDatabase(venueDir);
}
describe("attendance after restoring database contents", () => {
  it.each([false, true])(
    "restarts persisted scans and retains exactly one legal finish (previously settled: %s)",
    async (completed) => {
      if (completed) await settle(suite.db);
      else
        await withTransaction(suite.db, (tx) =>
          discoverAttendanceDays(tx, { locationId, now, batchSize: 2 }),
        );
      const before = await snapshot(suite.db);
      const restored = await restore();
      try {
        const db = restored.venue;
        expect(await snapshot(db)).toEqual(before);
        await withTransaction(db, (tx) =>
          beginAttendanceDiscovery(tx, { locationId, generation: "restored-open" }),
        );
        const first = await pass(db);
        expect(first).toEqual({ processed: false, more: true });
        expect((await snapshot(db)).chain).toEqual(before.chain);
        await settle(db);
        const after = await snapshot(db);
        expect(
          after.chain.map((entry) => [entry.entryKind, entry.eventAt, entry.extension?.authorKind]),
        ).toEqual([
          ["in", "2026-01-05T09:00:00.000Z", "worker"],
          ["out", "2026-01-05T16:40:00.000Z", "automatic"],
        ]);
        expect(after.chain[0]).toEqual(before.chain[0]);
        expect(verifyChain(after.chain)).toEqual({ ok: true });
        expect(after.questions.map((q) => [q.personId, q.kind]).sort()).toEqual(
          [
            [personId, "automatic-out"],
            [missingPersonId, "missing-times"],
          ].sort(),
        );
        expect(after.mail).toHaveLength(1);
        expect(after.mail[0]).toMatchObject({ status: "pending" });
        if (completed) expect(after).toEqual(before);
        const scans = (await db.select().from(attendanceSourceState)).filter(
          (s) => s.recordKind === "scan",
        );
        expect(scans.length).toBeGreaterThan(0);
        expect(
          scans.every(
            (s) => s.generation === "restored-open" && s.completed && s.cursor === s.endpoint,
          ),
        ).toBe(true);
        await settle(db);
        expect(await snapshot(db)).toEqual(after);
      } finally {
        await restored.close();
      }
    },
  );
});
