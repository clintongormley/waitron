import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  openVenueDatabase,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { businessDayBounds, locationId } from "@waitron/shared";
import { readLocationClock } from "@waitron/reporting";
import { resolveDepartmentService } from "@waitron/venue-service";
import { sql } from "drizzle-orm";
import { ALL_MODULES } from "./modules.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { restoreFromArtifact } from "./restore.js";
import { wipeVenueDatabases } from "./db-wipe.js";
import { readVenueDetails } from "./venue-details.js";

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

describe("business-day timeline through cold restore and reset", () => {
  it("retains effective and pending rows, derives activation on reads and clears them only on a venue wipe", async () => {
    const venue = await setupVenue(suite.db);
    await suite.db.insert(locationDayCutoverChanges).values([
      {
        locationId: venue.cfg.locationId,
        effectiveBusinessDay: "2026-11-04",
        dayCutover: "03:00:00",
      },
      {
        locationId: venue.cfg.locationId,
        effectiveBusinessDay: "2026-11-10",
        dayCutover: "07:00:00",
      },
    ]);
    await suite.db
      .insert(locationBusinessDaySettings)
      .values({ locationId: venue.cfg.locationId, revision: 4 });
    const changes = await suite.db.select().from(locationDayCutoverChanges);
    const settings = await suite.db.select().from(locationBusinessDaySettings);
    const department = (
      await suite.db.execute<{ id: string }>(sql`select id from departments where is_default`)
    ).rows[0]!.id;
    const moments = ["2026-11-10T05:59:59.999Z", "2026-11-10T06:00:00.000Z"];
    const serviceBefore = [];
    for (const moment of moments)
      serviceBefore.push(
        await withTransaction(suite.db, (tx) =>
          resolveDepartmentService(tx, venue.cfg, department, new Date(moment)),
        ),
      );
    const root = await mkdtemp(join(tmpdir(), "a495-cold-restore-"));
    try {
      const dump = join(root, "copy.db");
      await suite.db.archiveTo(dump);
      const manifest = await buildManifest({
        db: suite.db,
        modules: ALL_MODULES,
        environment: "preproduction",
        now: new Date("2026-11-08T12:00:00Z"),
      });
      const artifact = encryptArtifact(
        packArchive([
          { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
          { name: "db.dump", bytes: await readFile(dump) },
          {
            name: "secrets/secrets.env",
            bytes: Buffer.from(
              "WAITRON_CREDENTIALS_KEY=" +
                Buffer.alloc(32, 5).toString("base64") +
                "\nWAITRON_CREDENTIALS_KEY_VERSION=1\n",
            ),
          },
          {
            name: "secrets/trading.env",
            bytes: Buffer.from(
              `WAITRON_TILL_NODE_ID=${venue.cfg.nodeId}\nWAITRON_TILL_LOCATION_ID=${venue.cfg.locationId}\n`,
            ),
          },
        ]),
        "a495-recovery-key",
      );
      const venueDir = join(root, "venue");
      await restoreFromArtifact({
        artifact,
        recoveryKey: "a495-recovery-key",
        stateDir: join(root, "state"),
        stagingDir: join(root, "staging"),
        venueDir,
        migrationsRoot: null,
        modules: ALL_MODULES,
        environment: "preproduction",
        log: () => {},
      });
      const restored = await openVenueDatabase(venueDir);
      try {
        const clock = await withTransaction(restored.venue, (tx) =>
          readLocationClock(tx, venue.cfg.locationId),
        );
        expect(businessDayBounds(clock, "2026-11-09")).toEqual({
          startAt: "2026-11-09T02:00:00.000Z",
          endAt: "2026-11-10T06:00:00.000Z",
        });
        for (const [index, moment] of moments.entries()) {
          const model = await withTransaction(restored.venue, (tx) =>
            readVenueDetails(tx, venue.cfg, new Date(moment)),
          );
          expect(model.businessDayClock.revision).toBe(4);
          expect(model.businessDayClock.currentBusinessDay).toBe(
            index === 0 ? "2026-11-09" : "2026-11-10",
          );
          expect(model.businessDayClock.pending === null).toBe(index === 1);
          expect(
            await withTransaction(restored.venue, (tx) =>
              resolveDepartmentService(
                tx,
                { locationId: locationId(venue.cfg.locationId) },
                department,
                new Date(moment),
              ),
            ),
          ).toEqual(serviceBefore[index]);
        }
        expect(await restored.venue.select().from(locationDayCutoverChanges)).toEqual(changes);
        expect(await restored.venue.select().from(locationBusinessDaySettings)).toEqual(settings);
      } finally {
        await restored.close();
      }
      await wipeVenueDatabases(venueDir);
      await applyMigrations(venueDir, migrations);
      const reset = await openVenueDatabase(venueDir);
      try {
        expect(await reset.venue.select().from(locationDayCutoverChanges)).toEqual([]);
        expect(await reset.venue.select().from(locationBusinessDaySettings)).toEqual([]);
      } finally {
        await reset.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
