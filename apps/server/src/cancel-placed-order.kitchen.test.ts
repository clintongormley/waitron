import { seedZone } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  kitchenNotices,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { attachPrinterToStation } from "./station-printers.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { parkOrder } from "./working-order.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

let venue: BillVenue;
let zoneId: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    zoneId = await inTx(venue, async (tx) => {
      const [zone] = [await seedZone(tx, { name: "Counter, pays after sending" })];
      await offerProducts(tx, venue.cfg, { zone: { zoneId: zone!.id }, orderStart: "counter" });
      await tx.execute(
        sql`update floor_zones set paid_when = 'ticket_then_pay' where id = ${zone!.id}`,
      );
      return zone!.id;
    });
  },
});

const deps = () => ({ db: venue.db, backend: venue.backend, clock: venue.clock });

describe("cancelling a counter order the kitchen already has", () => {
  it.each(["fired", "served", "unfired", "collected"] as const)(
    "cancelling %s work tells only a station still making it",
    async (stage) => {
      const id = randomUUID();
      await parkOrder(deps(), venue.cfg, {
        id,
        zoneId,
        lines: [{ menuItemId: venue.offerFor("Steak"), quantity: "1" }],
        operatorId: venue.operatorId,
      });
      await placeOrder(
        { ...deps(), admission: testTradingAdmission() },
        venue.cfg,
        id,
        venue.operatorId,
      );
      const [item] = await venue.db
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, id));
      expect(item).toMatchObject({ state: "queued", firedAt: expect.any(String) });
      if (stage === "served")
        await inTx(venue, (tx) =>
          tx
            .update(workingOrderLines)
            .set({ servedQuantity: 1000, servedAt: "2026-11-11T10:00:00Z" })
            .where(eq(workingOrderLines.id, item!.workingOrderLineId)),
        );
      if (stage === "unfired")
        await inTx(venue, (tx) =>
          tx.update(ticketItems).set({ firedAt: null }).where(eq(ticketItems.id, item!.id)),
        );
      if (stage === "collected")
        expect(
          (await send(venue.app, venue.cookie, "POST", `/api/orders/${id}/collect`, {})).status,
        ).toBe(200);
      const printerId = await inTx(venue, async (tx) => {
        const printer = await createPrinter(tx, {
          name: `Kitchen ${randomUUID().slice(0, 8)}`,
          transport: "cloud_poll",
          pollId: randomUUID(),
        });
        await attachPrinterToStation(tx, { stationId: item!.stationId, printerId: printer.id });
        return printer.id;
      });

      const answer = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${id}/cancel`,
        {
          reason: "guest left",
        },
      );

      expect(answer.status).toBe(200);
      const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
      expect(order!.status).toBe("abandoned");
      expect(
        await venue.db
          .select({ kind: kitchenNotices.kind })
          .from(kitchenNotices)
          .where(eq(kitchenNotices.workingOrderId, id)),
      ).toEqual(stage === "fired" ? [{ kind: "void" }] : []);
      expect(
        await venue.db
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(eq(printJobs.printerId, printerId)),
      ).toHaveLength(stage === "fired" ? 1 : 0);
    },
  );
});
