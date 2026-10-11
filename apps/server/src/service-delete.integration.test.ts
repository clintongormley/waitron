import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings } from "@waitron/bookings";
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
  createDepartment,
  createServiceZone,
  departments,
  departmentTransferRequests,
  requestDepartmentTransfer,
  readDepartmentDeleteImpact,
  deleteDepartment,
  deleteZone,
  setProfileServiceScope,
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
