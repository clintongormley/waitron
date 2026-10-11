import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diningTables, floorZones, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { bookings } from "@waitron/bookings";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { TableRemoval } from "@waitron/module";
import { AppError, locationId } from "@waitron/shared";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { tableDeleteRefusals } from "./table-removal.js";

const now = new Date("2026-10-11T12:00:00Z");
for (const enabled of [true, false]) {
  describe(`hierarchy bookings ${enabled ? "enabled" : "disabled"}`, () => {
    const modules = ALL_MODULES.filter((module) => enabled || module.name !== "bookings");
    const removals = enabledTableRemovals(modules);
    const suite = useVenueDb({
      migrations: migrationOptionsFor(
        manifestSets().filter((set) => enabled || set.name !== "bookings"),
        null,
      ),
    });
    it(
      enabled
        ? "collects the enabled booking seat without releasing its records"
        : "without bookings migrations neither impact nor deletion queries bookings",
      async () => {
        await seedTenant(suite.db);
        const [loc] = await suite.db
          .insert(locations)
          .values({ name: "Hierarchy", invoiceLocales: ["es"], operationDescription: "test" })
          .returning();
        const cfg = { locationId: locationId(loc!.id) };
        const [zone] = await suite.db
          .insert(floorZones)
          .values({ locationId: cfg.locationId, name: "Hierarchy" })
          .returning();
        const [table] = await suite.db
          .insert(diningTables)
          .values({ locationId: cfg.locationId, zoneId: zone!.id, label: "T1" })
          .returning();
        let bookingId: string | undefined;
        if (enabled) {
          const [booking] = await suite.db
            .insert(bookings)
            .values({
              locationId: cfg.locationId,
              tableId: table!.id,
              bookingDate: "2026-01-01",
              bookingTime: "20:00:00",
              partySize: 2,
              contactName: "Ana",
              createdBy: randomUUID(),
              status: "seated",
            })
            .returning();
          bookingId = booking!.id;
        } else {
          expect(
            suite.db.execute(sql`select name from sqlite_master where name = 'bookings'`).rows,
          ).toEqual([]);
        }
        const result = await withTransaction(suite.db, (tx) =>
          tableDeleteRefusals(tx, cfg, removals, [table!.id], now),
        );
        expect(result).toEqual(
          enabled
            ? [
                {
                  code: "table.booked",
                  params: { tableId: table!.id, date: "2026-01-01", time: "20:00" },
                  targets: [{ id: bookingId, name: "Ana · 2026-01-01 20:00" }],
                },
              ]
            : [],
        );
        if (enabled)
          expect((await suite.db.select().from(bookings))[0]).toMatchObject({
            tableId: table!.id,
            tableLabel: null,
          });
        else {
          await withTransaction(suite.db, async (tx) => {
            expect(await tableDeleteRefusals(tx, cfg, removals, [table!.id], now)).toEqual([]);
            await tx.run(sql`delete from dining_tables where id = ${table!.id}`);
          });
          expect(await suite.db.select().from(diningTables)).toEqual([]);
        }
        const broken: TableRemoval = {
          refuse: () => Promise.reject(new Error("unexpected legacy read")),
          deleteRefusals: () => Promise.reject(new Error("booking read failed")),
          release: () => Promise.reject(new Error("unexpected release")),
        };
        await expect(
          withTransaction(suite.db, (tx) =>
            tableDeleteRefusals(tx, cfg, [broken], [table!.id], now),
          ),
        ).rejects.toThrow("booking read failed");
        const legacy: TableRemoval = {
          refuse: () =>
            Promise.resolve(
              new Map([
                [
                  table!.id,
                  new AppError("table.booked", {
                    tableId: table!.id,
                    date: "2026-10-12",
                    time: "20:00",
                  }),
                ],
              ]),
            ),
          release: () => Promise.reject(new Error("unexpected release")),
        };
        if (enabled)
          expect(
            await withTransaction(suite.db, (tx) =>
              tableDeleteRefusals(
                tx,
                cfg,
                [
                  legacy,
                  {
                    ...legacy,
                    refuse: () =>
                      Promise.resolve(
                        new Map([[table!.id, new AppError("booking.invalid", { partySize: 2 })]]),
                      ),
                  },
                ],
                [table!.id],
                now,
              ),
            ),
          ).toEqual([
            {
              code: "table.booked",
              params: { tableId: table!.id, date: "2026-10-12", time: "20:00" },
              targets: [{ id: table!.id, name: "T1" }],
            },
            {
              code: "booking.invalid",
              params: { partySize: 2 },
              targets: [{ id: table!.id, name: "T1" }],
            },
          ]);
        if (enabled) {
          const nullable: TableRemoval = {
            ...legacy,
            refuse: () =>
              Promise.resolve(
                new Map([
                  [
                    table!.id,
                    new AppError("origin.invalid", { source: "unexpected", deviceId: null }),
                  ],
                ]),
              ),
          };
          await expect(
            withTransaction(suite.db, (tx) =>
              tableDeleteRefusals(tx, cfg, [nullable], [table!.id], now),
            ),
          ).rejects.toMatchObject({
            code: "origin.invalid",
            params: { source: "unexpected", deviceId: null },
          });
        }
        await expect(
          withTransaction(suite.db, (tx) =>
            tableDeleteRefusals(
              tx,
              cfg,
              [{ ...legacy, refuse: () => Promise.reject(new Error("legacy read failed")) }],
              [table!.id],
              now,
            ),
          ),
        ).rejects.toThrow("legacy read failed");
        expect(
          await withTransaction(suite.db, (tx) => tableDeleteRefusals(tx, cfg, [broken], [], now)),
        ).toEqual([]);
      },
    );
  });
}
