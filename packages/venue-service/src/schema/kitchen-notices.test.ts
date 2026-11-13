import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  engineErrorMessage,
  kitchenNotices,
  kitchenStations,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import { seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let orderId: string, lineId: string, ticketId: string, stationId: string;
beforeEach(async () => {
  await seedVenue(suite.db, {
    name: "Kitchen",
    invoiceLocales: ["en"],
    operationDescription: "Restaurant",
  });
  const [station] = await suite.db.insert(kitchenStations).values({ name: "Grill" }).returning();
  stationId = station!.id;
  orderId = (await seedWorkingOrder(suite.db, { source: "dashboard", orderNumber: 1 })).id;
  const [line] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: orderId,
      lineNo: 1,
      name: "Burger",
      descriptions: { en: "Beef burger" },
      quantity: 1000,
      unitPriceGross: 1000,
      lineTotal: 1000,
      vatClass: "general",
    })
    .returning();
  lineId = line!.id;
  const [ticket] = await suite.db
    .insert(ticketItems)
    .values({ workingOrderId: orderId, workingOrderLineId: lineId, stationId })
    .returning();
  ticketId = ticket!.id;
});
function write(kind: string, ticket: string | null) {
  return suite.db
    .execute(sql`insert into kitchen_notices (id, station_id, working_order_id, order_label, kind, line_name, quantity, created_at, ticket_item_id)
    values (${randomUUID()}, ${stationId}, ${orderId}, '#1', ${kind}, 'BURGER', 1000, '2026-11-13T12:00:00Z', ${ticket})`);
}
it("refuses a ticket item on a non-moved notice", async () => {
  const error = await captureError(() => write("void", ticketId));
  expect(engineErrorMessage(error)).toContain("kitchen_notices_ticket_item_kind_ck");
  await write("void", null);
  expect(await suite.db.select({ kind: kitchenNotices.kind }).from(kitchenNotices)).toEqual([
    { kind: "void" },
  ]);
});
it("a voided line's ticket leaves its MOVED notice with no ticket", async () => {
  await write("moved", ticketId);
  expect(suite.db.all(sql`select ticket_item_id from kitchen_notices`)).toEqual([
    { ticket_item_id: ticketId },
  ]);
  await suite.db.delete(workingOrderLines).where(eq(workingOrderLines.id, lineId));
  expect(await suite.db.select().from(ticketItems)).toEqual([]);
  expect(suite.db.all(sql`select kind, ticket_item_id from kitchen_notices`)).toEqual([
    { kind: "moved", ticket_item_id: null },
  ]);
});
it("indexes notices by bill and by their optional ticket", () => {
  const indexes = suite.db.all<{ name: string; partial: number }>(
    sql`pragma index_list('kitchen_notices')`,
  );
  expect(indexes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "kitchen_notices_order_idx", partial: 0 }),
      expect.objectContaining({ name: "kitchen_notices_ticket_item_idx", partial: 1 }),
    ]),
  );
});
