import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bookings } from "@waitron/bookings";
import { diningTables, floorResetTables, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createDepartment, createServiceZone } from "@waitron/venue-service";
import type { StartedServer } from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import { readLayout, saveLayout } from "./floor-plan.js";
import { resetZone } from "./floor-today-store.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { defaultLayout } from "./testing/floor-sets.js";
import { serverFixture } from "./testing/server-fixture.js";
import { copyMigrationsRoot, awaitListening } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

const { beforeServerStarts, startServer } = serverFixture();

for (const mode of ["enabled", "disabled", "never installed"] as const) {
  describe(`table removal through trading boot, bookings ${mode}`, () => {
    const installed = mode !== "never installed";
    const omitted = new Set(["fiscal-none", ...(installed ? [] : ["bookings"])]);
    const modules = ALL_MODULES.filter((module) => !omitted.has(module.name));
    const suite = useVenueDb({
      migrations: migrationOptionsFor(
        manifestSets().filter((set) => !omitted.has(set.name)),
        null,
      ),
    });

    it("removes the dropped table and its waiting reset without losing the recorded booking label", async () => {
      beforeServerStarts();
      const now = new Date();
      const venue = await createClockVenue(suite.db, () => now, modules);
      const fixture = await withTransaction(suite.db, async (tx) => {
        const department = await createDepartment(tx, venue.cfg, {
          name: "Dining room",
          orderStart: "table",
        });
        const zone = await createServiceZone(tx, venue.cfg, {
          name: "Terrace",
          departmentId: department.id,
        });
        const layout = await defaultLayout(tx, venue.cfg, zone.id);
        await saveLayout(
          tx,
          venue.cfg,
          [],
          layout,
          {
            revision: 0,
            tables: [
              {
                key: "a",
                label: "Old terrace table",
                seats: 4,
                fixed: false,
                placement: null,
                partKeys: [],
              },
            ],
          },
          now,
        );
        const plan = await readLayout(tx, venue.cfg, layout);
        const tableId = plan.tables[0]!.liveTableId!;
        await resetZone(tx, venue.cfg, [], zone.id, now, "due");
        let bookingId: string | undefined;
        if (installed) {
          const [booking] = await tx
            .insert(bookings)
            .values({
              locationId: venue.cfg.locationId,
              tableId,
              bookingDate: "2099-01-01",
              bookingTime: "20:00",
              partySize: 2,
              contactName: "Ana",
              createdBy: venue.personId,
              status: "cancelled",
            })
            .returning({ id: bookings.id });
          bookingId = booking!.id;
        }
        await saveLayout(tx, venue.cfg, [], layout, { revision: 1, tables: [] }, now);
        if (!installed) {
          await tx
            .update(floorResetTables)
            .set({ remove: true, pending: true })
            .where(eq(floorResetTables.tableId, tableId));
        }
        if (installed) {
          await resetZone(tx, venue.cfg, [], zone.id, now, "due");
          expect(
            await tx
              .select({ id: diningTables.id })
              .from(diningTables)
              .where(eq(diningTables.id, tableId)),
          ).toEqual([{ id: tableId }]);
          expect(
            await tx
              .select({ remove: floorResetTables.remove, pending: floorResetTables.pending })
              .from(floorResetTables)
              .where(eq(floorResetTables.tableId, tableId)),
          ).toEqual([{ remove: true, pending: true }]);
        }
        return { tableId, bookingId };
      });
      await stampDeployment(suite.db, "preproduction");
      const scratch = await mkdtemp(join(tmpdir(), "waitron-table-removal-"));
      let server: StartedServer | undefined;
      try {
        await copyMigrationsRoot(join(scratch, "migrations"));
        await writeFile(
          join(scratch, "modules.json"),
          JSON.stringify({
            modules: {
              "fiscal-none": false,
              bookings: mode === "enabled",
            },
          }),
        );
        const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
        const [port] = await freePorts(1);
        server = await startServer({
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_HTTP_PORT: String(port),
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
          WAITRON_STATE_DIR: scratch,
          WAITRON_VENUE_DIR: dirname(database),
          WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
          WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
          WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
          WAITRON_ENV: "preproduction",
        });
        await awaitListening(port);
        for (let pass = 0; pass < 3; pass += 1) {
          const response = await fetch(`http://127.0.0.1:${port}/api/tables/state`, {
            headers: { cookie: venue.cookie },
          });
          expect(response.status, await response.clone().text()).toBe(200);
          expect((await response.json()) as { id: string }[]).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ id: fixture.tableId })]),
          );
          expect(
            await suite.db
              .select({ id: diningTables.id })
              .from(diningTables)
              .where(eq(diningTables.id, fixture.tableId)),
          ).toEqual([]);
          expect(
            await suite.db
              .select({ id: floorResetTables.id })
              .from(floorResetTables)
              .where(eq(floorResetTables.tableId, fixture.tableId)),
          ).toEqual([]);
        }
        if (fixture.bookingId !== undefined) {
          expect(
            await suite.db
              .select({
                tableId: bookings.tableId,
                tableLabel: bookings.tableLabel,
                status: bookings.status,
                contactName: bookings.contactName,
              })
              .from(bookings)
              .where(eq(bookings.id, fixture.bookingId)),
          ).toEqual([
            {
              tableId: null,
              tableLabel: "Old terrace table",
              status: "cancelled",
              contactName: "Ana",
            },
          ]);
        } else {
          expect(
            suite.db.all(
              sql`select name from sqlite_master where type = 'table' and name = 'bookings'`,
            ),
          ).toEqual([]);
        }
      } finally {
        await server?.close();
        await rm(scratch, { recursive: true, force: true });
      }
    });
  });
}
