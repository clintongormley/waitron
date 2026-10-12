import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  diningTables,
  floorZones,
  floorTodayTables,
  locations,
  withTransaction,
  installChangeFeed,
  subscribeToChanges,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { bookings } from "@waitron/bookings";
import { hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { LiveEvents, changeSubscriber, mountLiveApi } from "./live-api.js";
import { liveResourceTypes } from "./live-resources.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { TableRemoval } from "@waitron/module";
import { AppError, locationId } from "@waitron/shared";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { removeLiveTables, tableDeleteRefusals } from "./table-removal.js";

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
    it("streams hierarchy interests without optional bookings and delivers installed booking table events", async () => {
      await seedTenant(suite.db);
      const session = await withTransaction(suite.db, async (tx) => {
        const [person] = await tx
          .insert(persons)
          .values({ displayName: "Hierarchy manager", pinHash: hashPin("1234"), role: "manager" })
          .returning();
        return startManagementSession(tx, { personId: person!.id });
      });
      const [loc] = await suite.db
        .insert(locations)
        .values({ name: "Stream hierarchy", invoiceLocales: ["es"], operationDescription: "test" })
        .returning();
      const cfg = { locationId: locationId(loc!.id) };
      const [zone] = await suite.db
        .insert(floorZones)
        .values({ locationId: cfg.locationId, name: "Stream hierarchy" })
        .returning();
      const [table] = await suite.db
        .insert(diningTables)
        .values({ locationId: cfg.locationId, zoneId: zone!.id, label: "T1" })
        .returning();
      await suite.db.insert(floorTodayTables).values({ tableId: table!.id });
      const sources = modules.flatMap((module) => module.changes ?? []);
      await installChangeFeed(suite.db, sources);
      const bus = new LiveEvents();
      const unsubscribe = subscribeToChanges(changeSubscriber(bus, () => {}));
      const app = new Hono();
      mountLiveApi(app, { db: suite.db, bus, resourceTypes: liveResourceTypes(sources) }, () => {});
      const interests = [
        "floor_zones",
        "dining_tables",
        "floor_plans",
        "floor_plan_tables",
        "floor_reset_tables",
        "floor_today_zones",
        "floor_today_tables",
        "floor_today_joins",
        "floor_today_join_tables",
        "parties",
        "party_tables",
        "working_orders",
        "working_order_lines",
        "ticket_items",
        "order_service_contexts",
        "departments",
        "device_profiles",
        "devices",
        "device_profile_service_access",
        "device_profile_zones",
        "device_kitchen_screens",
        "device_kitchen_screen_stations",
        "device_kitchen_screen_zones",
        "device_kitchen_screen_removals",
        "device_profile_kitchen_screens",
        "device_profile_kitchen_screen_stations",
        "device_profile_kitchen_screen_zones",
        "routing_cells",
        "routing_cell_periods",
        "zone_service_policies",
        "zone_sale_policies",
        "zone_closed_times",
        "zone_extensions",
        "department_sale_policies",
        "menu_periods",
        "menu_period_staff_menus",
        "menu_day_timetables",
        "menu_slots",
        "department_days",
        "department_day_ranges",
        "zone_days",
        "zone_day_ranges",
        "period_extensions",
        "department_transfer_desks",
        "department_transfer_destinations",
        "department_transfer_requests",
      ].map((type) => ({ type }));
      const response = await app.request(
        `/management-api/events?resources=${encodeURIComponent(JSON.stringify(interests))}`,
        { headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body!.getReader();
      try {
        expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: ready");
        expect(bus.subscriberCount).toBe(1);
        if (enabled) {
          await withTransaction(suite.db, (tx) =>
            tx.insert(bookings).values({
              locationId: cfg.locationId,
              tableId: table!.id,
              bookingDate: "2026-10-11",
              bookingTime: "20:00",
              partySize: 2,
              contactName: "Ana",
              createdBy: randomUUID(),
            }),
          );
        } else {
          expect(
            suite.db.execute(sql`select name from sqlite_master where name = 'bookings'`).rows,
          ).toEqual([]);
          await withTransaction(suite.db, (tx) =>
            tx
              .update(diningTables)
              .set({ label: "Renamed" })
              .where(sql`${diningTables.id} = ${table!.id}`),
          );
        }
        expect(new TextDecoder().decode((await reader.read()).value)).toBe(
          `event: change\ndata: [{"type":"dining_tables","id":"${table!.id}"}]\n\n`,
        );
        expect(bus.subscriberCount).toBe(1);
      } finally {
        await reader.cancel();
        unsubscribe();
        bus.close();
      }
      await vi.waitFor(() => expect(bus.subscriberCount).toBe(0));
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
            expect(await removeLiveTables(tx, cfg, removals, [table!.id], now)).toEqual(new Set());
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
