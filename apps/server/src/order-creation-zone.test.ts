import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { devices, floorZones, locations, withTransaction, workingOrders } from "@waitron/db";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { locationId } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SimulatorPaymentProvider } from "@waitron/payments";
import {
  departmentReceipts,
  orderServiceContexts,
  setProfileServiceScope,
  replaceZoneClosedWeek,
  createDepartment,
  configureZone,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { createOpenOrder, parkOrder } from "./working-order.js";
import { splitBill } from "./testing/bill-action-fixture.js";
import {
  payWorkingOrder,
  payWorkingOrderIntegratedOrchestration,
} from "./testing/whole-payment-fixture.js";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: PartyVenue;
let counterDepartmentId: string;
beforeEach(async () => {
  venue = await setupPartyVenue(suite.db);
  const zone = await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.resolveZoneContext(tx, venue.cfg, venue.counter.zoneId),
  );
  counterDepartmentId = zone.departmentId;
  await suite.db
    .update(departmentReceipts)
    .set({ receipt: { operationDescription: "Counter meals" } })
    .where(eq(departmentReceipts.departmentId, counterDepartmentId));
});

function context(id: string) {
  return suite.db
    .select({
      zoneId: orderServiceContexts.zoneId,
      departmentId: orderServiceContexts.departmentId,
    })
    .from(orderServiceContexts)
    .where(eq(orderServiceContexts.workingOrderId, id));
}

it.each(["cash", "integrated"] as const)(
  "a walk-up %s sale with no zone records the counter zone and files its authored description",
  async (method) => {
    const id = randomUUID();
    const request = { id, lines: [{ menuItemId: venue.counterItem("Agua"), quantity: "1" }] };
    const deps = { db: suite.db, backend: venue.backend, clock: venue.clock };
    if (method === "cash") {
      expect(
        (
          await payWorkingOrder(deps, venue.cfg, {
            ...request,
            tender: { method: "cash", amount: "2.00" },
          })
        ).total,
      ).toBe("2.00");
    } else {
      expect(
        (
          await payWorkingOrderIntegratedOrchestration(
            { ...deps, provider: new SimulatorPaymentProvider(suite.db) },
            venue.cfg,
            { ...request, simulationOutcome: "captured" },
          )
        ).outcome,
      ).toBe("captured");
    }
    expect(await context(id)).toEqual([
      { zoneId: venue.counter.zoneId, departmentId: counterDepartmentId },
    ]);
    expect(
      suite.db.all(sql`
      select r.descripcion_operacion as description from registros_facturacion r
      join sales s on s.id = r.sale_id where s.working_order_id = ${id}
    `),
    ).toEqual([{ description: "Counter meals" }]);
  },
);

it("an empty order records the device profile's starting zone instead of the counter default", async () => {
  const [device] = await suite.db
    .select()
    .from(devices)
    .where(eq(devices.id, venue.cfg.origin.deviceId));
  const zone = await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.resolveZoneContext(tx, venue.cfg, venue.tables.zoneId),
  );
  await withTransaction(suite.db, (tx) =>
    setProfileServiceScope(tx, venue.cfg, device!.deviceProfileId, {
      departmentId: zone.departmentId,
      allowedZoneIds: null,
      startingZoneId: venue.tables.zoneId,
    }),
  );
  const id = randomUUID();
  await withTransaction(suite.db, (tx) => createOpenOrder(tx, venue.cfg, id, [], null));
  expect(await context(id)).toEqual([
    { zoneId: venue.tables.zoneId, departmentId: zone.departmentId },
  ]);
});

it("an explicit zone wins over the profile starting zone", async () => {
  const [device] = await suite.db
    .select()
    .from(devices)
    .where(eq(devices.id, venue.cfg.origin.deviceId));
  const zone = await withTransaction(suite.db, (tx) =>
    VENUE_SERVICE.resolveZoneContext(tx, venue.cfg, venue.tables.zoneId),
  );
  await withTransaction(suite.db, (tx) =>
    setProfileServiceScope(tx, venue.cfg, device!.deviceProfileId, {
      departmentId: zone.departmentId,
      allowedZoneIds: null,
      startingZoneId: venue.tables.zoneId,
    }),
  );
  const id = randomUUID();
  await withTransaction(suite.db, (tx) =>
    createOpenOrder(tx, venue.cfg, id, [], null, {
      zoneId: venue.counter.zoneId,
    }),
  );
  expect(await context(id)).toEqual([
    { zoneId: venue.counter.zoneId, departmentId: counterDepartmentId },
  ]);
});

it("with no profile start or counter default, refuses an empty order before allocating its number", async () => {
  await suite.db.update(zoneServicePolicies).set({ isCounterDefault: false });
  const before = suite.db.all(sql`select * from working_order_counters order by node_id`);
  const id = randomUUID();
  await expect(
    withTransaction(suite.db, (tx) => createOpenOrder(tx, venue.cfg, id, [], null)),
  ).rejects.toMatchObject({ code: "service_zone.default_missing" });
  expect(await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id))).toEqual([]);
  expect(await context(id)).toEqual([]);
  expect(suite.db.all(sql`select * from working_order_counters order by node_id`)).toEqual(before);
});

it("a split of a damaged counter order refuses instead of creating another order without a zone", async () => {
  const id = randomUUID();
  await parkOrder({ db: suite.db }, venue.cfg, {
    id,
    zoneId: venue.counter.zoneId,
    lines: [{ menuItemId: venue.counterItem("Agua"), quantity: "1" }],
    operatorId: venue.operator.personId,
  });
  await suite.db.delete(orderServiceContexts).where(eq(orderServiceContexts.workingOrderId, id));
  const before = suite.db.all(sql`select * from working_orders order by id`);
  await expect(
    withTransaction(suite.db, (tx) =>
      splitBill(tx, venue.cfg, id, [{ lineNo: 1 }], {
        operatorId: venue.operator.personId,
      }),
    ),
  ).rejects.toMatchObject({
    code: "order.service_context_missing",
    params: { workingOrderId: id },
  });
  expect(suite.db.all(sql`select * from working_orders order by id`)).toEqual(before);
});

it("splitting a counter bill retains its zone and frozen payment flow without using a new-order default", async () => {
  const id = randomUUID();
  await parkOrder({ db: suite.db }, venue.cfg, {
    id,
    zoneId: venue.counter.zoneId,
    lines: [{ menuItemId: venue.counterItem("Agua"), quantity: "2" }],
    operatorId: venue.operator.personId,
  });
  await suite.db
    .update(orderServiceContexts)
    .set({ serviceMode: "ticket_then_pay" })
    .where(eq(orderServiceContexts.workingOrderId, id));
  await suite.db.update(zoneServicePolicies).set({ isCounterDefault: false });
  const result = await withTransaction(suite.db, (tx) =>
    splitBill(tx, venue.cfg, id, [{ lineNo: 1, quantity: "1" }], {
      operatorId: venue.operator.personId,
    }),
  );
  expect(
    await suite.db
      .select({
        zoneId: orderServiceContexts.zoneId,
        departmentId: orderServiceContexts.departmentId,
        serviceMode: orderServiceContexts.serviceMode,
      })
      .from(orderServiceContexts)
      .where(eq(orderServiceContexts.workingOrderId, result.billId)),
  ).toEqual([
    {
      zoneId: venue.counter.zoneId,
      departmentId: counterDepartmentId,
      serviceMode: "ticket_then_pay",
    },
  ]);
});

it("a closed zone refuses new orders but still lets its existing bill split", async () => {
  const id = randomUUID();
  await parkOrder({ db: suite.db }, venue.cfg, {
    id,
    zoneId: venue.counter.zoneId,
    lines: [{ menuItemId: venue.counterItem("Agua"), quantity: "2" }],
    operatorId: venue.operator.personId,
  });
  await withTransaction(suite.db, (tx) =>
    replaceZoneClosedWeek(
      tx,
      venue.cfg,
      venue.counter.zoneId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        ranges: [{ startsAt: "05:00", endsAt: "05:00" }],
      })),
      0,
    ),
  );
  await expect(
    withTransaction(suite.db, (tx) =>
      createOpenOrder(tx, venue.cfg, randomUUID(), [], null, {
        zoneId: venue.counter.zoneId,
      }),
    ),
  ).rejects.toMatchObject({
    code: "service_zone.closed",
    params: { zoneId: venue.counter.zoneId },
  });
  const result = await withTransaction(suite.db, (tx) =>
    splitBill(tx, venue.cfg, id, [{ lineNo: 1, quantity: "1" }], {
      operatorId: venue.operator.personId,
    }),
  );
  expect(await context(result.billId)).toEqual([
    { zoneId: venue.counter.zoneId, departmentId: counterDepartmentId },
  ]);
  expect(
    suite.db.all(
      sql`select working_order_id as orderId, quantity from working_order_lines where working_order_id in (${id}, ${result.billId}) order by working_order_id`,
    ),
  ).toEqual([id, result.billId].sort().map((orderId) => ({ orderId, quantity: 1000 })));
});

it("another location's device profile cannot supply the zone for this location's order", async () => {
  const [place] = await suite.db
    .insert(locations)
    .values({
      name: "Other location",
      invoiceLocales: ["es-ES"],
      operationDescription: "Other service",
    })
    .returning();
  const cfg = { locationId: locationId(place!.id) };
  const other = await seedDevice(suite.db, {
    locationId: cfg.locationId,
    capabilities: ["take-orders"],
  });
  await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, cfg, {
      name: "Other department",
      orderStart: "table",
    });
    const [zone] = await tx
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: "Other zone" })
      .returning();
    await configureZone(tx, cfg, { zoneId: zone!.id, departmentId: department.id });
    const [device] = await tx.select().from(devices).where(eq(devices.id, other.deviceId));
    await setProfileServiceScope(tx, cfg, device!.deviceProfileId, {
      departmentId: department.id,
      allowedZoneIds: null,
      startingZoneId: zone!.id,
    });
  });
  const id = randomUUID();
  await withTransaction(suite.db, (tx) =>
    createOpenOrder(
      tx,
      {
        ...venue.cfg,
        origin: { source: "device", deviceId: other.deviceId },
      },
      id,
      [],
      null,
    ),
  );
  expect(await context(id)).toEqual([
    { zoneId: venue.counter.zoneId, departmentId: counterDepartmentId },
  ]);
});
