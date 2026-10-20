import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  kitchenStations,
  nowIso,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readOrderPreviewItems } from "./order-preview.js";
import { listCounterWaiting, listHeldOrders } from "./working-order.js";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { dashboardOrderAt } from "./testing/session-device.js";

let venue: BillVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

describe("A738 order previews", () => {
  it("A738 lists stored dish variant extras quantity and note for open placed and settled orders", async () => {
    const orders = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const ids = orders.map(() => [randomUUID(), randomUUID(), randomUUID()]);
    await withTransaction(venue.db, async (tx) => {
      const [station] = await tx.select({ id: kitchenStations.id }).from(kitchenStations).limit(1);
      for (const [i, id] of orders.entries()) {
        await tx.insert(workingOrders).values({
          id,
          ...dashboardOrderAt(venue.cfg.locationId),
          nodeId: venue.cfg.nodeId,
          orderNumber: 100 + i,
          status: "open",
        });
        if (i === 3) continue;
        const [dish, extra, plain] = ids[i]!;
        // Insert out of display order; no live product/offer backs these recorded names.
        await tx.insert(workingOrderLines).values([
          {
            id: plain!,
            workingOrderId: id,
            lineNo: 3,
            name: "Staff water",
            descriptions: { "es-ES": "Customer water" },
            kitchenName: "KITCHEN WATER",
            quantity: 2000,
            unitPriceGross: 100,
            vatClass: "general",
            lineTotal: 200,
          },
          {
            id: dish!,
            workingOrderId: id,
            lineNo: 1,
            name: "Staff soup",
            variantName: "Large",
            variantDescriptions: { "es-ES": "Customer large" },
            variantKitchenName: "LG",
            descriptions: { "es-ES": "Customer soup" },
            kitchenName: "KITCHEN SOUP",
            quantity: 375,
            unitPriceGross: 400,
            vatClass: "general",
            lineTotal: 150,
            note: "No salt <please>",
          },
          {
            id: extra!,
            workingOrderId: id,
            lineNo: 2,
            parentLineId: dish!,
            name: "Staff cheese",
            descriptions: { "es-ES": "Customer cheese" },
            kitchenName: "KITCHEN CHEESE",
            quantity: 750,
            unitPriceGross: 100,
            vatClass: "general",
            lineTotal: 75,
          },
        ]);
        if (i === 1 || i === 2)
          await tx
            .update(workingOrders)
            .set({
              status: i === 1 ? "placed" : "settled",
              settledAt: i === 2 ? nowIso() : null,
            })
            .where(eq(workingOrders.id, id));
        if (i === 2)
          await tx.insert(ticketItems).values({
            nodeId: venue.cfg.nodeId,
            workingOrderId: id,
            workingOrderLineId: dish!,
            stationId: station!.id,
            state: "queued",
            firedAt: nowIso(),
            quantity: 125,
          });
      }
    });
    await withTransaction(venue.db, async (tx) => {
      const query = vi.spyOn(tx, "select");
      try {
        expect(await readOrderPreviewItems(tx, [])).toEqual(new Map());
        expect(query).not.toHaveBeenCalled();
        const previews = await readOrderPreviewItems(tx, orders);
        expect(query).toHaveBeenCalledTimes(1);
        expect(previews.get(orders[3]!)).toEqual([]);
        expect(previews.get(orders[0]!)?.[0]?.quantity).toBe("0.375");
      } finally {
        query.mockRestore();
      }
    });
    const parked = await listHeldOrders({ db: venue.db }, venue.cfg);
    const waiting = await listCounterWaiting({ db: venue.db }, venue.cfg);
    for (const [i, list] of [
      [0, parked],
      [1, waiting],
      [2, waiting],
    ] as const) {
      const row = list.find((order) => order.id === orders[i])!;
      expect(row).toMatchObject({ orderNumber: 100 + i, total: "4.25" });
      expect(row.items).toEqual([
        {
          lineId: ids[i]![0],
          name: "Staff soup (Large)",
          quantity: "0.375",
          note: "No salt <please>",
          extras: [{ lineId: ids[i]![1], name: "Staff cheese", quantity: "0.750" }],
        },
        { lineId: ids[i]![2], name: "Staff water", quantity: "2.000", note: null, extras: [] },
      ]);
    }
    expect(parked.find((order) => order.id === orders[3])).toMatchObject({
      itemCount: 0,
      total: "0.00",
      items: [],
    });
    expect(parked.map((row) => row.id)).toEqual([orders[0], orders[3]]);
    expect(waiting.map((row) => row.id)).toEqual([orders[1], orders[2]]);
  });
});
