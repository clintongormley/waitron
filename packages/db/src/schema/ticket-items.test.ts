import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { catalogues, products } from "./catalogue.js";
import { kitchenStations } from "./kitchen-stations.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";
import { ticketItems } from "./ticket-items.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";
// The locale trigger checks description KEYS against the venue's invoice_locales (['es'] here).
const DESCRIPTIONS_A = { es: "Café solo" };

let nodeA = "";
let productA = "";
let stationA = "";
let orderNumberSeq = 0;

describe("ticket_items schema (columns + per-line unique + cascade)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await db.insert(locations).values([
      {
        id: LOCATION_A,
        name: "Fixture Location A",
        invoiceLocales: ["es"],
        operationDescription: "Hostelería",
      },
    ]);
    await db.insert(tills).values([{ id: TILL_A1, locationId: LOCATION_A, name: "A1" }]);
    nodeA = await seedNode(db, brandLocationId(LOCATION_A));
    const [catA] = await db
      .insert(catalogues)
      .values({ name: "Deli A" })
      .returning({ id: catalogues.id });
    const [prodA] = await db
      .insert(products)
      .values({
        catalogueId: catA!.id,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = prodA!.id;
    const [station] = await db
      .insert(kitchenStations)
      .values({ locationId: LOCATION_A, name: "Cocina", isDefault: true })
      .returning({ id: kitchenStations.id });
    stationA = station!.id;
  });

  // The Drizzle builder rather than raw SQL: `id` and `queued_at` are `$defaultFn` columns
  // applied CLIENT-side, so a raw insert is refused NOT NULL.
  async function seedOrderLine(
    till: string,
    node: string,
    product: string,
  ): Promise<{ orderId: string; lineId: string }> {
    orderNumberSeq += 1;
    const [order] = await suite.db
      .insert(workingOrders)
      .values({
        tillId: till,
        nodeId: node,
        orderNumber: orderNumberSeq,
        status: "open",
        openedAt: AT,
      })
      .returning({ id: workingOrders.id });
    const orderId = order!.id;
    const [line] = await suite.db
      .insert(workingOrderLines)
      .values({
        workingOrderId: orderId,
        lineNo: 1,
        productId: product,
        name: "Café solo",
        descriptions: DESCRIPTIONS_A,
        quantity: 1000,
        unitPrice: 100,
        unitPriceGross: 110,
        vatRate: 1000,
        lineTotal: 110,
      })
      .returning({ id: workingOrderLines.id });
    return { orderId, lineId: line!.id };
  }

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  function seedTicket(
    node: string,
    orderId: string,
    lineId: string,
    station: string,
    state: "queued" | "preparing" | "ready" = "queued",
  ): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(ticketItems)
        .values({
          nodeId: node,
          workingOrderId: orderId,
          workingOrderLineId: lineId,
          stationId: station,
          state,
        })
        .returning({ id: ticketItems.id });
      return row!.id;
    });
  }

  it("exposes every column through the Drizzle export across the queued → preparing → ready lifecycle", async () => {
    const { orderId, lineId } = await seedOrderLine(TILL_A1, nodeA, productA);
    const id = await seedTicket(nodeA, orderId, lineId, stationA);
    await inTx((tx) =>
      tx
        .update(ticketItems)
        .set({ state: "preparing", preparingAt: new Date().toISOString() })
        .where(eq(ticketItems.id, id)),
    );
    await inTx((tx) =>
      tx
        .update(ticketItems)
        .set({ state: "ready", readyAt: new Date().toISOString() })
        .where(eq(ticketItems.id, id)),
    );
    const [row] = await inTx((tx) => tx.select().from(ticketItems).where(eq(ticketItems.id, id)));
    expect(row!.state).toBe("ready");
    expect(row!.workingOrderLineId).toBe(lineId);
    expect(row!.workingOrderId).toBe(orderId);
    expect(row!.stationId).toBe(stationA);
    expect(row!.nodeId).toBe(nodeA);
    expect(row!.queuedAt).not.toBeNull();
    expect(row!.readyAt).not.toBeNull();
    // NULL until the pass dispatches the item.
    expect(row!.awayAt).toBeNull();
  });

  it("stamps away_at (the pass dispatch) and reads it back through the Drizzle export", async () => {
    const { orderId, lineId } = await seedOrderLine(TILL_A1, nodeA, productA);
    const id = await seedTicket(nodeA, orderId, lineId, stationA);
    await inTx((tx) =>
      tx
        .update(ticketItems)
        .set({ awayAt: new Date().toISOString() })
        .where(eq(ticketItems.id, id)),
    );
    const [row] = await inTx((tx) => tx.select().from(ticketItems).where(eq(ticketItems.id, id)));
    expect(row!.awayAt).not.toBeNull();
  });

  it("carries a nullable note column (spec §2/§3, NON-FISCAL)", async () => {
    // `pragma table_info` reports the DECLARED type in the case the DDL wrote it.
    const meta = suite.db
      .all<{ name: string; type: string; notnull: number }>(
        sql`select name, type, "notnull" from pragma_table_info('ticket_items') where name = 'note'`,
      )
      .map((c) => ({ name: c.name, type: c.type, notnull: c.notnull }));
    expect(meta).toEqual([{ name: "note", type: "TEXT", notnull: 0 }]);
    const { orderId, lineId } = await seedOrderLine(TILL_A1, nodeA, productA);
    const id = await seedTicket(nodeA, orderId, lineId, stationA);
    await inTx((tx) =>
      tx.update(ticketItems).set({ note: "sin sal" }).where(eq(ticketItems.id, id)),
    );
    const [row] = await inTx((tx) =>
      tx.select({ note: ticketItems.note }).from(ticketItems).where(eq(ticketItems.id, id)),
    );
    expect(row!.note).toBe("sin sal");
  });

  it("rejects a second ticket item for the same line (the per-line UNIQUE — the concurrent-fire guard)", async () => {
    const { orderId, lineId } = await seedOrderLine(TILL_A1, nodeA, productA);
    await seedTicket(nodeA, orderId, lineId, stationA);
    const e = await captureError(() => seedTicket(nodeA, orderId, lineId, stationA));
    expect(isRefusal(e, UNIQUE_VIOLATION)).toBe(true);
  });

  it("cascades a ticket item away when its working_order_line is deleted (ON DELETE CASCADE)", async () => {
    // The parent order is open, so working_order_lines_require_open_parent permits the delete.
    const { orderId, lineId } = await seedOrderLine(TILL_A1, nodeA, productA);
    const id = await seedTicket(nodeA, orderId, lineId, stationA);
    expect(countTicket(id)).toBe(1);
    await suite.db.delete(workingOrderLines).where(eq(workingOrderLines.id, lineId));
    expect(countTicket(id)).toBe(0);
  });

  function countTicket(id: string): number {
    return suite.db.all<{ n: number }>(
      sql`select cast(count(*) as int) as n from ticket_items where id = ${id}`,
    )[0]!.n;
  }
});
