import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { devices, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SimulatorPaymentProvider } from "@waitron/payments";
import {
  departmentReceipts,
  orderServiceContexts,
  setProfileServiceScope,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { VENUE_SERVICE } from "./modules.js";
import { createOpenOrder, parkOrder } from "./working-order.js";
import { splitBill } from "./bill-actions.js";
import { payWorkingOrder, payWorkingOrderIntegratedOrchestration } from "./till-sale.js";
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
