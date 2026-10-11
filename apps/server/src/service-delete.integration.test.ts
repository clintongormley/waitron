import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { startManagementSession, persons, registerModulePermissions } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountManagementApi } from "./management-api.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, BOOKINGS_ROUTES, BOOKINGS_PERMISSIONS } from "@waitron/bookings";
import {
  deviceProfiles,
  diningTables,
  floorPlanTables,
  floorPlans,
  floorZones,
  parties,
  partyTables,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  VENUE_SERVICE_ROUTES,
  VENUE_SERVICE_PERMISSIONS,
  createDepartment,
  createServiceZone,
  departments,
  departmentTransferRequests,
  requestDepartmentTransfer,
  readDepartmentDeleteImpact,
  deleteDepartment,
  deleteZone,
  setProfileServiceScope,
  setDepartmentTransferSettings,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { moduleCoreServices } from "./parties.js";
import { counterOrder, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { createTable } from "./testing/live-table.js";
import { saveZonePlan } from "./floor-plan.js";
import { parkOrder } from "./working-order.js";

const NOW = new Date("2026-10-11T12:00:00Z");
let venue: PartyVenue;
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
beforeEach(async () => {
  venue = await setupPartyVenue(suite.db);
});

const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(venue.db, body);
async function snapshot(tx: Transaction) {
  return {
    departments: await tx.select().from(departments),
    zones: await tx.select().from(floorZones),
    tables: await tx.select().from(diningTables),
    plans: await tx.select().from(floorPlans),
    planTables: await tx.select().from(floorPlanTables),
    bookings: await tx.select().from(bookings),
    parties: await tx.select().from(parties),
    partyTables: await tx.select().from(partyTables),
    orders: await tx.select().from(workingOrders),
  };
}
const core = () => moduleCoreServices(venue.cfg, enabledTableRemovals(ALL_MODULES));

async function target() {
  return run(async (tx) => {
    const department = await createDepartment(tx, venue.cfg, {
      name: randomUUID(),
      orderStart: "table",
    });
    const zone = await createServiceZone(tx, venue.cfg, {
      name: randomUUID(),
      departmentId: department.id,
    });
    const table = await createTable(tx, venue.cfg, { label: randomUUID(), zoneId: zone.id });
    return { departmentId: department.id, zoneId: zone.id, tableId: table.id };
  });
}

function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

describe("real module floor deletion", () => {
  it("refuses a booked descendant through the enabled booking removal seat", async () => {
    const f = await target();
    const bookingId = await run(
      async (tx) =>
        (
          await tx
            .insert(bookings)
            .values({
              locationId: venue.cfg.locationId,
              bookingDate: "2026-10-12",
              bookingTime: "20:00:00",
              partySize: 2,
              contactName: "Guest",
              tableId: f.tableId,
              createdBy: venue.operator.personId,
            })
            .returning({ id: bookings.id })
        )[0]!.id,
    );
    const service = core().floorDeletion;
    const impact = await run((tx) =>
      readDepartmentDeleteImpact(tx, venue.cfg, service, f.departmentId, NOW),
    );
    expect(impact.refusals).toContainEqual(expect.objectContaining({ code: "table.booked" }));
    await expect(
      run((tx) => deleteDepartment(tx, venue.cfg, service, f.departmentId, NOW)),
    ).rejects.toMatchObject({ code: "table.booked" });
    expect(
      (await run((tx) => tx.select().from(bookings).where(eq(bookings.id, bookingId)))).length,
    ).toBe(1);
    expect(
      (
        await run((tx) => tx.select().from(departments).where(eq(departments.id, f.departmentId)))
      )[0]?.active,
    ).toBe(true);
  });

  it("rechecks a booking committed after preview when deletion reaches the write queue", async () => {
    const f = await target();
    const service = core().floorDeletion;
    expect(
      (await run((tx) => readDepartmentDeleteImpact(tx, venue.cfg, service, f.departmentId, NOW)))
        .refusals,
    ).toEqual([]);
    const held = gate();
    const release = gate();
    const booking = run(async (tx) => {
      const [row] = await tx
        .insert(bookings)
        .values({
          locationId: venue.cfg.locationId,
          bookingDate: "2026-10-12",
          bookingTime: "20:00:00",
          partySize: 2,
          contactName: "Queued guest",
          tableId: f.tableId,
          createdBy: venue.operator.personId,
        })
        .returning({ id: bookings.id });
      held.open();
      await release.wait;
      return { id: row!.id, snapshot: await snapshot(tx) };
    });
    await held.wait;
    const queued = vi.spyOn(venue.db, "withWriteLock");
    let entered = false;
    const deletion = run(async (tx) => {
      entered = true;
      return deleteDepartment(tx, venue.cfg, service, f.departmentId, NOW);
    });
    expect(queued).toHaveBeenCalledTimes(1);
    queued.mockRestore();
    expect(entered).toBe(false);
    release.open();
    const booked = await booking;
    await expect(deletion).rejects.toMatchObject({ code: "table.booked" });
    expect(entered).toBe(true);
    expect(
      (await run((tx) => tx.select().from(bookings).where(eq(bookings.id, booked.id)))).length,
    ).toBe(1);
    expect(await run(snapshot)).toEqual(booked.snapshot);
    expect(
      (await run((tx) => tx.select().from(diningTables).where(eq(diningTables.id, f.tableId))))
        .length,
    ).toBe(1);
    expect(
      (await run((tx) => tx.select().from(floorZones).where(eq(floorZones.id, f.zoneId))))[0]
        ?.active,
    ).toBe(true);
    expect(
      (
        await run((tx) => tx.select().from(departments).where(eq(departments.id, f.departmentId)))
      )[0]?.active,
    ).toBe(true);
  });

  it("queues deletion after seating and preserves the whole target on refusal", async () => {
    const f = await target();
    const service = core().floorDeletion;
    expect(
      (await run((tx) => readDepartmentDeleteImpact(tx, venue.cfg, service, f.departmentId, NOW)))
        .refusals,
    ).toEqual([]);
    const held = gate();
    const release = gate();
    const writer = run(async (tx) => {
      const seated = await core().seatTable(tx, {
        tableId: f.tableId,
        guestCount: 2,
        operatorId: venue.operator.personId,
      });
      held.open();
      await release.wait;
      return { ...seated, snapshot: await snapshot(tx) };
    });
    await held.wait;
    const queued = vi.spyOn(venue.db, "withWriteLock");
    let entered = false;
    const deletion = run(async (tx) => {
      entered = true;
      return deleteDepartment(tx, venue.cfg, service, f.departmentId, NOW);
    });
    expect(queued).toHaveBeenCalledTimes(1);
    queued.mockRestore();
    expect(entered).toBe(false);
    release.open();
    const seated = await writer;
    await expect(deletion).rejects.toMatchObject({ code: "zone.table_in_use" });
    expect(entered).toBe(true);
    expect(await run(snapshot)).toEqual(seated.snapshot);
    expect(
      (await run((tx) => tx.select().from(diningTables).where(eq(diningTables.id, f.tableId))))
        .length,
    ).toBe(1);
    expect(
      (await run((tx) => tx.select().from(floorZones).where(eq(floorZones.id, f.zoneId))))[0]
        ?.active,
    ).toBe(true);
    expect(
      (
        await run((tx) => tx.select().from(departments).where(eq(departments.id, f.departmentId)))
      )[0]?.active,
    ).toBe(true);
    expect(seated.partyId).toBeTruthy();
  });

  it("queues seating and a master-plan save behind deletion, then refuses both", async () => {
    const f = await target();
    const profileId = await run(
      async (tx) =>
        (
          await tx
            .insert(deviceProfiles)
            .values({ name: randomUUID(), formFactor: "till" })
            .returning({ id: deviceProfiles.id })
        )[0]!.id,
    );
    const service = core().floorDeletion;
    const held = gate();
    const release = gate();
    const deletion = run(async (tx) => {
      let impact;
      try {
        impact = await deleteDepartment(tx, venue.cfg, service, f.departmentId, NOW);
      } finally {
        held.open();
      }
      await release.wait;
      return impact;
    });
    await held.wait;
    const queued = vi.spyOn(venue.db, "withWriteLock");
    let enteredSeat = false;
    let enteredSave = false;
    let enteredProfile = false;
    const seat = run(async (tx) => {
      enteredSeat = true;
      return core().seatTable(tx, {
        tableId: f.tableId,
        guestCount: 1,
        operatorId: venue.operator.personId,
      });
    });
    const save = run(async (tx) => {
      enteredSave = true;
      return saveZonePlan(
        tx,
        venue.cfg,
        enabledTableRemovals(ALL_MODULES),
        f.zoneId,
        { revision: 0, tables: [], joins: [] },
        NOW,
      );
    });
    const profile = run(async (tx) => {
      enteredProfile = true;
      return setProfileServiceScope(tx, venue.cfg, profileId, {
        departmentId: f.departmentId,
        allowedZoneIds: [f.zoneId],
        startingZoneId: f.zoneId,
      });
    });
    expect(queued).toHaveBeenCalledTimes(3);
    queued.mockRestore();
    expect(enteredSeat).toBe(false);
    expect(enteredSave).toBe(false);
    expect(enteredProfile).toBe(false);
    release.open();
    await deletion;
    await expect(seat).rejects.toMatchObject({ code: "table.not_found" });
    await expect(save).rejects.toMatchObject({ code: "zone.not_found" });
    await expect(profile).rejects.toMatchObject({ code: "device_profile.access_invalid" });
    expect(enteredSeat).toBe(true);
    expect(enteredSave).toBe(true);
    expect(enteredProfile).toBe(true);
  });

  it("queues a counter order behind zone deletion and leaves no orphan order", async () => {
    const zoneId = venue.counter.zoneId;
    const before = await run((tx) => tx.select().from(workingOrders));
    const held = gate();
    const release = gate();
    const service = core().floorDeletion;
    const deletion = run(async (tx) => {
      let impact;
      try {
        impact = await deleteZone(tx, venue.cfg, service, zoneId, NOW);
      } finally {
        held.open();
      }
      await release.wait;
      return impact;
    });
    await held.wait;
    const queued = vi.spyOn(venue.db, "withWriteLock");
    const order = counterOrder(venue, "Paella");
    expect(queued).toHaveBeenCalledTimes(1);
    queued.mockRestore();
    release.open();
    await deletion;
    await expect(order).rejects.toMatchObject({ code: "service_zone.not_found" });
    expect(await run((tx) => tx.select().from(workingOrders))).toEqual(before);
  });

  it("queues transfer creation behind department deletion and leaves no request", async () => {
    const f = await target();
    const tabId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: tabId,
      zoneId: venue.tables.zoneId,
      lines: [{ menuItemId: venue.item("Paella"), quantity: "1" }],
      operatorId: venue.operator.personId,
    });
    const [source] = await run((tx) =>
      tx
        .select({ departmentId: zoneServicePolicies.departmentId })
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.zoneId, venue.tables.zoneId)),
    );
    const before = await run((tx) => tx.select().from(departmentTransferRequests));
    const held = gate();
    const release = gate();
    const deletion = run(async (tx) => {
      let impact;
      try {
        impact = await deleteDepartment(tx, venue.cfg, core().floorDeletion, f.departmentId, NOW);
      } finally {
        held.open();
      }
      await release.wait;
      return impact;
    });
    await held.wait;
    const queued = vi.spyOn(venue.db, "withWriteLock");
    let entered = false;
    const transfer = run(async (tx) => {
      entered = true;
      return requestDepartmentTransfer(tx, venue.cfg, tabId, f.departmentId, {
        departmentId: source!.departmentId,
        personId: venue.operator.personId,
      });
    });
    expect(queued).toHaveBeenCalledTimes(1);
    queued.mockRestore();
    expect(entered).toBe(false);
    release.open();
    await deletion;
    await expect(transfer).rejects.toMatchObject({ code: "department.not_found" });
    expect(entered).toBe(true);
    expect(await run((tx) => tx.select().from(departmentTransferRequests))).toEqual(before);
  });
});

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);
registerModulePermissions(BOOKINGS_PERMISSIONS);
async function mounted() {
  const app = new Hono();
  const cookie = await run(async (tx) => {
    const [admin] = await tx.select().from(persons).where(eq(persons.email, "owner@example.test"));
    const session = await startManagementSession(tx, { personId: admin!.id });
    return `${MANAGEMENT_COOKIE}=${session.token}`;
  });
  const removals = enabledTableRemovals(ALL_MODULES);
  mountManagementApi(
    app,
    {
      db: venue.db,
      cfg: venue.cfg,
      venueCfg: venue.cfg,
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
      tableRemovals: removals,
    },
    () => {},
  );
  VENUE_SERVICE_ROUTES.mount(app, { db: venue.db, cfg: venue.cfg, core: core() }, () => {});
  BOOKINGS_ROUTES.mount(app, { db: venue.db, cfg: venue.cfg, core: core() }, () => {});
  const request = async (method: string, id: string, kind: "zone" | "department" = "department") =>
    app.request(
      `${kind === "zone" ? "/management-api/zones" : "/management-api/venue-service/departments"}/${id}${method === "GET" ? "/delete-impact" : ""}`,
      { method, headers: { cookie } },
    );
  const book = async (tableId: string) =>
    app.request("/management-api/bookings", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        bookingDate: "2026-01-01",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Queued guest",
        tableId,
      }),
    });
  return { request, book };
}
async function completeSnapshot(tx: Transaction) {
  const tables = await tx.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != 'management_sessions' order by name`,
  );
  const result: Record<string, unknown[]> = {};
  for (const { name } of tables.rows)
    result[name] = (
      await tx.execute(sql`select * from ${sql.identifier(name)} order by rowid`)
    ).rows;
  return result;
}
function queueSignal() {
  const queued = gate();
  const original = venue.db.withWriteLock.bind(venue.db);
  const spy = vi.spyOn(venue.db, "withWriteLock").mockImplementation((body) => {
    queued.open();
    return original(body);
  });
  return { queued: queued.wait, restore: () => spy.mockRestore() };
}

describe("mounted authenticated service deletion races", () => {
  it.each(["booking", "seating", "counter", "profile", "transfer", "master"] as const)(
    "HTTP deletion rechecks a queued %s writer after preview",
    async (kind) => {
      const f = await target();
      const { request, book } = await mounted();
      const zoneId = kind === "counter" ? venue.counter.zoneId : f.zoneId;
      const id = kind === "counter" ? zoneId : f.departmentId;
      const targetKind = kind === "counter" ? "zone" : "department";
      const profileId =
        kind === "profile"
          ? await run(
              async (tx) =>
                (
                  await tx
                    .insert(deviceProfiles)
                    .values({ name: "Queued profile", formFactor: "till" })
                    .returning()
                )[0]!.id,
            )
          : "";
      let tabId = "";
      let sourceDepartmentId = "";
      if (kind === "transfer") {
        tabId = randomUUID();
        await parkOrder({ db: venue.db }, venue.cfg, {
          id: tabId,
          zoneId: venue.tables.zoneId,
          lines: [{ menuItemId: venue.item("Paella"), quantity: "1" }],
          operatorId: venue.operator.personId,
        });
        const [source] = await run((tx) =>
          tx
            .select()
            .from(zoneServicePolicies)
            .where(eq(zoneServicePolicies.zoneId, venue.tables.zoneId)),
        );
        sourceDepartmentId = source!.departmentId;
      }
      const preview = await request("GET", id, targetKind);
      expect(preview.status).toBe(200);
      expect((await preview.json()).refusals).toEqual([]);
      const held = gate();
      const release = gate();
      const beforeWriter = await run(completeSnapshot);
      let committed!: Awaited<ReturnType<typeof completeSnapshot>>;
      const original = venue.db.withWriteLock.bind(venue.db);
      const writerLock = vi.spyOn(venue.db, "withWriteLock").mockImplementationOnce((body) =>
        original(async () => {
          const result = await body();
          committed = await completeSnapshot(venue.db);
          held.open();
          await release.wait;
          return result;
        }),
      );
      const writer =
        kind === "counter"
          ? counterOrder(venue, "Paella")
          : kind === "booking"
            ? book(f.tableId).then((response) => {
                expect(response.status).toBe(201);
              })
            : run(async (tx) => {
                if (kind === "seating")
                  await core().seatTable(tx, {
                    tableId: f.tableId,
                    guestCount: 2,
                    operatorId: venue.operator.personId,
                  });
                if (kind === "profile")
                  await setProfileServiceScope(tx, venue.cfg, profileId, {
                    departmentId: f.departmentId,
                    allowedZoneIds: [zoneId],
                    startingZoneId: zoneId,
                  });
                if (kind === "transfer") {
                  const [receiving] = await tx
                    .insert(deviceProfiles)
                    .values({ name: "Receiving desk", formFactor: "till" })
                    .returning();
                  await setProfileServiceScope(tx, venue.cfg, receiving!.id, {
                    departmentId: f.departmentId,
                    allowedZoneIds: [zoneId],
                    startingZoneId: zoneId,
                  });
                  await setDepartmentTransferSettings(tx, venue.cfg, sourceDepartmentId, {
                    receivingProfileId: null,
                    destinationDepartmentIds: [f.departmentId],
                  });
                  await setDepartmentTransferSettings(tx, venue.cfg, f.departmentId, {
                    receivingProfileId: receiving!.id,
                    destinationDepartmentIds: [],
                  });
                  await requestDepartmentTransfer(tx, venue.cfg, tabId, f.departmentId, {
                    departmentId: sourceDepartmentId,
                    personId: venue.operator.personId,
                  });
                }
                if (kind === "master")
                  await saveZonePlan(
                    tx,
                    venue.cfg,
                    enabledTableRemovals(ALL_MODULES),
                    zoneId,
                    {
                      revision: 0,
                      tables: [
                        {
                          key: "saved",
                          label: "Queued saved",
                          seats: 2,
                          fixed: false,
                          placement: null,
                        },
                      ],
                      joins: [],
                    },
                    NOW,
                  );
              });
      try {
        await Promise.race([held.wait, writer]);
        writerLock.mockRestore();
        expect(await completeSnapshot(venue.db)).toEqual(beforeWriter);
        const signal = queueSignal();
        const deletion = request("DELETE", id, targetKind);
        try {
          await Promise.race([
            signal.queued,
            deletion.then(() => {
              throw new Error("HTTP deletion answered before requesting the write queue");
            }),
          ]);
        } finally {
          release.open();
          signal.restore();
        }
        await writer;
        const response = await deletion;
        if (kind === "master") {
          expect(response.status).toBe(200);
          expect((await response.json()).removes).toContainEqual({
            key: "saved_tables",
            count: 1,
            targets: [expect.objectContaining({ name: "Queued saved" })],
          });
          expect(
            await run((tx) => tx.select().from(floorPlans).where(eq(floorPlans.zoneId, zoneId))),
          ).toEqual([]);
          expect(
            await run((tx) =>
              tx.select().from(diningTables).where(eq(diningTables.zoneId, zoneId)),
            ),
          ).toEqual([]);
        } else {
          expect(response.status).toBe(409);
          const codes = {
            booking: "table.booked",
            seating: "zone.table_in_use",
            counter: "zone.order_in_progress",
            profile: "department.profile_in_use",
            transfer: "department.transfer_pending",
          };
          expect(await response.json()).toMatchObject({ error: { code: codes[kind] } });
          expect(await run(completeSnapshot)).toEqual(committed);
        }
        if (kind === "booking")
          expect(committed.bookings).toContainEqual(
            expect.objectContaining({
              table_id: f.tableId,
              booking_date: "2026-01-01",
              booking_time: "20:00:00",
              contact_name: "Queued guest",
              status: "booked",
            }),
          );
        if (kind === "counter") {
          expect(committed.working_orders).toHaveLength(beforeWriter.working_orders!.length + 1);
          expect(committed.working_order_lines).toHaveLength(
            beforeWriter.working_order_lines!.length + 1,
          );
          expect(committed.order_service_contexts).toContainEqual(
            expect.objectContaining({ zone_id: zoneId }),
          );
        }
      } finally {
        release.open();
        writerLock.mockRestore();
        await writer;
      }
    },
  );

  it("HTTP deletion commits before queued seating, profile, transfer and master saves and each refuses without orphan rows", async () => {
    const f = await target();
    const { request } = await mounted();
    const profileId = await run(
      async (tx) =>
        (
          await tx
            .insert(deviceProfiles)
            .values({ name: "Stale profile", formFactor: "till" })
            .returning()
        )[0]!.id,
    );
    const tabId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: tabId,
      zoneId: venue.tables.zoneId,
      lines: [{ menuItemId: venue.item("Paella"), quantity: "1" }],
      operatorId: venue.operator.personId,
    });
    const [source] = await run((tx) =>
      tx
        .select()
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.zoneId, venue.tables.zoneId)),
    );
    const held = gate();
    const release = gate();
    const first = run(async () => {
      held.open();
      await release.wait;
    });
    await held.wait;
    const signal = queueSignal();
    const deletion = request("DELETE", f.departmentId);
    try {
      await Promise.race([
        signal.queued,
        deletion.then(() => {
          throw new Error("HTTP deletion answered before requesting the write queue");
        }),
      ]);
    } catch (error) {
      release.open();
      throw error;
    } finally {
      signal.restore();
    }
    const afterDelete = run(completeSnapshot);
    const writers = [
      run((tx) =>
        core().seatTable(tx, {
          tableId: f.tableId,
          guestCount: 1,
          operatorId: venue.operator.personId,
        }),
      ),
      run((tx) =>
        setProfileServiceScope(tx, venue.cfg, profileId, {
          departmentId: f.departmentId,
          allowedZoneIds: [f.zoneId],
          startingZoneId: f.zoneId,
        }),
      ),
      run((tx) =>
        requestDepartmentTransfer(tx, venue.cfg, tabId, f.departmentId, {
          departmentId: source!.departmentId,
          personId: venue.operator.personId,
        }),
      ),
      run((tx) =>
        saveZonePlan(
          tx,
          venue.cfg,
          enabledTableRemovals(ALL_MODULES),
          f.zoneId,
          { revision: 0, tables: [], joins: [] },
          NOW,
        ),
      ),
    ].map((promise) =>
      promise.then(
        () => undefined,
        (caught: unknown) => caught,
      ),
    );
    release.open();
    await first;
    const response = await deletion;
    expect(response.status).toBe(200);
    expect((await response.json()).target).toEqual({
      id: f.departmentId,
      name: expect.any(String),
    });
    const committed = await afterDelete;
    const codes = [
      "table.not_found",
      "device_profile.access_invalid",
      "department.not_found",
      "zone.not_found",
    ];
    for (const [index, error] of (await Promise.all(writers)).entries())
      expect(error).toMatchObject({ code: codes[index] });
    expect(await run(completeSnapshot)).toEqual(committed);
  });

  it("HTTP zone deletion precedes a queued counter order and leaves the complete committed state unchanged", async () => {
    const { request } = await mounted();
    const held = gate();
    const release = gate();
    const first = run(async () => {
      held.open();
      await release.wait;
    });
    await held.wait;
    const signal = queueSignal();
    const deletion = request("DELETE", venue.counter.zoneId, "zone");
    try {
      await Promise.race([
        signal.queued,
        deletion.then(() => {
          throw new Error("HTTP deletion answered before requesting the write queue");
        }),
      ]);
    } catch (error) {
      release.open();
      throw error;
    } finally {
      signal.restore();
    }
    const afterDelete = run(completeSnapshot);
    const order = counterOrder(venue, "Paella").then(
      () => undefined,
      (caught: unknown) => caught,
    );
    release.open();
    await first;
    expect((await deletion).status).toBe(200);
    expect(await order).toMatchObject({ code: "service_zone.not_found" });
    expect(await run(completeSnapshot)).toEqual(await afterDelete);
  });
});
