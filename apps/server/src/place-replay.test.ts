import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  orderAmendments,
  kitchenPrintJobLines,
  kitchenPrintJobs,
  printers,
  printJobs,
  products,
  sales,
  serviceCommands,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setZoneSalePolicyOverride } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import { markOrderPlaced, parkOrder, placeOrder } from "./working-order.js";
import { provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let venue: BillVenue;
let orderId: string;

beforeEach(async () => {
  venue = await provisionBillVenue(suite.db);
  const [product] = await suite.db.select({ id: products.id }).from(products).limit(1);
  const offer = await withTransaction(suite.db, async (tx) => {
    const station = await createStation(tx, venue.cfg, { name: "Kitchen", isDefault: true });
    const [printer] = await tx.select({ id: printers.id }).from(printers).limit(1);
    await attachPrinterToStation(tx, {
      locationId: venue.cfg.locationId,
      stationId: station.id,
      printerId: printer!.id,
    });
    const offered = await offerProducts(tx, venue.cfg, {
      zone: "counter",
      paidWhen: "ticket_then_pay",
    });
    await setZoneSalePolicyOverride(tx, venue.cfg, offered.zoneId, "collectionNumber", "numbered");
    return offered;
  });
  orderId = randomUUID();
  await parkOrder({ db: suite.db }, venue.cfg, {
    id: orderId,
    zoneId: offer.zoneId,
    lines: [{ menuItemId: offer.offerFor(product!.id), quantity: "1" }],
    operatorId: venue.operatorId,
  });
});

const place = (
  operatorId = venue.operatorId,
  expectedEdit: Parameters<typeof placeOrder>[4] = null,
) =>
  placeOrder(
    { db: suite.db, backend: venue.backend, clock: venue.clock },
    venue.cfg,
    orderId,
    operatorId,
    expectedEdit,
  );

async function snapshot() {
  return {
    orders: await suite.db.select().from(workingOrders),
    lines: await suite.db.select().from(workingOrderLines),
    amendments: await suite.db.select().from(orderAmendments),
    items: await suite.db.select().from(ticketItems),
    prints: await suite.db.select().from(printJobs),
    kitchenPrints: await suite.db.select().from(kitchenPrintJobs),
    kitchenLines: await suite.db.select().from(kitchenPrintJobLines),
    commands: await suite.db.select().from(serviceCommands),
    sales: await suite.db.select().from(sales),
  };
}

describe("a repeated place", () => {
  it("returns the original HTTP result without another kitchen item, slip or amendment", async () => {
    const path = `/api/working-orders/${orderId}/place`;
    const first = await send(venue.app, venue.cookie, "POST", path, { expectedEdit: null });
    expect(first).toEqual({ status: 200, json: { id: orderId, status: "placed" } });
    const saved = await snapshot();
    expect(saved.items).toHaveLength(1);
    expect(saved.amendments).toHaveLength(1);
    expect(saved.prints).toHaveLength(2);
    expect(saved.kitchenPrints).toHaveLength(1);
    expect(saved.kitchenLines).toHaveLength(1);
    expect(saved.sales).toEqual([]);

    const replay = await send(venue.app, venue.cookie, "POST", path, { expectedEdit: null });

    expect(replay).toEqual(first);
    expect(await snapshot()).toEqual(saved);
  });

  it("serialises simultaneous places into one result and one kitchen item", async () => {
    const results = await Promise.all([place(), place()]);
    expect(results).toEqual([
      { id: orderId, status: "placed" },
      { id: orderId, status: "placed" },
    ]);
    const saved = await snapshot();
    expect(saved.items).toHaveLength(1);
    expect(saved.amendments).toHaveLength(1);
    expect(saved.sales).toEqual([]);
  });

  it("refuses a different operator's new place without changing the first result", async () => {
    await place();
    const saved = await snapshot();
    await expect(place(venue.adminId)).rejects.toMatchObject({ code: "submission.id_reused" });
    expect(await snapshot()).toEqual(saved);
  });

  it("refuses a changed editor observation instead of treating it as the first place", async () => {
    await place();
    const saved = await snapshot();
    await expect(
      place(venue.operatorId, {
        billId: orderId,
        editorVersion: 1,
        draftId: null,
        draftRevision: null,
      }),
    ).rejects.toMatchObject({ code: "submission.id_reused" });
    expect(await snapshot()).toEqual(saved);
  });

  it("does not replay a placement made by another operation", async () => {
    await withTransaction(suite.db, (tx) =>
      markOrderPlaced(tx, venue.clock, venue.cfg, orderId, venue.operatorId),
    );
    await expect(place()).rejects.toMatchObject({ code: "working_order.not_open" });
    expect(await suite.db.select().from(serviceCommands)).toEqual([]);
  });

  it("rolls a failed placement back before allowing the same request to succeed", async () => {
    const saved = await snapshot();
    const failure = new Error("Attendance write refused");
    await expect(
      placeOrder(
        {
          db: suite.db,
          backend: venue.backend,
          clock: venue.clock,
          attendance: () => Promise.reject(failure),
        },
        venue.cfg,
        orderId,
        venue.operatorId,
        null,
      ),
    ).rejects.toBe(failure);
    expect(await snapshot()).toEqual(saved);

    expect(await place()).toEqual({ id: orderId, status: "placed" });
    expect(await suite.db.select().from(ticketItems)).toHaveLength(1);
  });

  it("still refuses an abandoned order", async () => {
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, orderId));
    await expect(place()).rejects.toMatchObject({ code: "working_order.not_open" });
    expect(await suite.db.select().from(serviceCommands)).toEqual([]);
  });
});
