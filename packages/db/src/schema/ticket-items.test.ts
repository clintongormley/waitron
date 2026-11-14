import { eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedNode, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { catalogues, products } from "./catalogue.js";
import { kitchenStations } from "./kitchen-stations.js";
import { workingOrderLines } from "./orders.js";
import { ticketItems } from "./ticket-items.js";

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
    await seedVenue(db, {
      name: "Fixture Location A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    nodeA = await seedNode(db);
    const [catA] = await db
      .insert(catalogues)
      .values({ name: "Deli A" })
      .returning({ id: catalogues.id });
    const [prodA] = await db
      .insert(products)
      .values({
        catalogueId: catA!.id,
        name: "Black coffee",
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = prodA!.id;
    const [station] = await db
      .insert(kitchenStations)
      .values({ name: "Kitchen", isDefault: true })
      .returning({ id: kitchenStations.id });
    stationA = station!.id;
  });

  // The Drizzle builder rather than raw SQL: `id` and `queued_at` are `$defaultFn` columns
  // applied CLIENT-side, so a raw insert is refused NOT NULL.
  async function seedOrderLine(
    node: string,
    product: string,
  ): Promise<{ orderId: string; lineId: string }> {
    orderNumberSeq += 1;
    const order = await seedWorkingOrder(suite.db, {
      source: "dashboard",
      deviceId: null,
      nodeId: node,
      orderNumber: orderNumberSeq,
      status: "open",
      openedAt: AT,
    });
    const orderId = order.id;
    const [line] = await suite.db
      .insert(workingOrderLines)
      .values({
        workingOrderId: orderId,
        lineNo: 1,
        productId: product,
        name: "Black coffee",
        descriptions: DESCRIPTIONS_A,
        quantity: 1000,
        unitPriceGross: 110,
        vatClass: "reduced",
        lineTotal: 110,
      })
      .returning({ id: workingOrderLines.id });
    return { orderId, lineId: line!.id };
  }

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  function seedTicket(
    lineId: string,
    station: string,
    state: "queued" | "preparing" | "ready" = "queued",
  ): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(ticketItems)
        .values({ workingOrderLineId: lineId, stationId: station, state })
        .returning({ id: ticketItems.id });
      return row!.id;
    });
  }

  it("ticket_items has no bill column", () => {
    expect(
      suite.db.all(
        sql`select name from pragma_table_info('ticket_items') where name = 'working_order_id'`,
      ),
    ).toEqual([]);
  });

  it("exposes every column through the Drizzle export across the queued → preparing → ready lifecycle", async () => {
    const { orderId, lineId } = await seedOrderLine(nodeA, productA);
    const id = await seedTicket(lineId, stationA);
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
    const [owner] = await suite.db
      .select({ id: workingOrderLines.workingOrderId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, row!.workingOrderLineId));
    expect(owner!.id).toBe(orderId);
    expect(row!.stationId).toBe(stationA);
    expect(row!.queuedAt).not.toBeNull();
    expect(row!.readyAt).not.toBeNull();
  });

  it("refuses a snapshot on an unfrozen ticket", async () => {
    const { lineId } = await seedOrderLine(nodeA, productA);
    const id = await seedTicket(lineId, stationA);
    const block = JSON.stringify({
      who: "Guest",
      allergens: { milk: {} },
      clashes: {},
      note: null,
      labels: { en: { avoids: ["Milk"], clashes: [] }, es: { avoids: ["Milk"], clashes: [] } },
    });
    const error = await captureError(() =>
      suite.db.run(sql`update ticket_items set allergy_original = ${block} where id = ${id}`),
    );
    expect(engineErrorMessage(error)).toContain("ticket_items_allergy_frozen_ck");
  });

  it("stores a frozen ticket with no block", async () => {
    const { lineId } = await seedOrderLine(nodeA, productA);
    const id = await seedTicket(lineId, stationA);
    suite.db.run(sql`update ticket_items set allergy_frozen = 1 where id = ${id}`);
    expect(
      suite.db.all(
        sql`select allergy_frozen, allergy_original, allergy_current from ticket_items where id = ${id}`,
      ),
    ).toEqual([{ allergy_frozen: 1, allergy_original: null, allergy_current: null }]);
  });

  it.each(["original", "current"] as const)(
    "refuses a malformed %s allergy block",
    async (field) => {
      const { lineId } = await seedOrderLine(nodeA, productA);
      const id = await seedTicket(lineId, stationA);
      const column = field === "original" ? sql`allergy_original` : sql`allergy_current`;
      const error = await captureError(() =>
        suite.db.run(
          sql`update ticket_items set allergy_frozen = 1, ${column} = '{}' where id = ${id}`,
        ),
      );
      expect(engineErrorMessage(error)).toContain(`ticket_items_allergy_${field}_ck`);
    },
  );

  it("A773 phases: a new ticket item has no request time and is not pass-controlled", async () => {
    const { lineId } = await seedOrderLine(nodeA, productA);
    const id = await seedTicket(lineId, stationA);
    const [row] = await inTx((tx) => tx.select().from(ticketItems).where(eq(ticketItems.id, id)));
    expect(row!.requestedAt).toBeNull();
    expect(row!.passControlled).toBe(false);
  });

  it("defaults an item to not made here", async () => {
    const { lineId } = await seedOrderLine(nodeA, productA);
    const id = await seedTicket(lineId, stationA);
    const [row] = await suite.db
      .select({ madeHere: ticketItems.madeHere })
      .from(ticketItems)
      .where(eq(ticketItems.id, id));
    expect(row).toEqual({ madeHere: false });
  });

  it("carries a nullable sent_order_number, unset on a new kitchen item", async () => {
    const meta = suite.db
      .all<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
        sql`select name, type, "notnull", dflt_value from pragma_table_info('ticket_items')
             where name = 'sent_order_number'`,
      )
      .map((c) => ({ ...c }));
    expect(meta).toEqual([
      { name: "sent_order_number", type: "INTEGER", notnull: 0, dflt_value: null },
    ]);
    const { lineId } = await seedOrderLine(nodeA, productA);
    const id = await seedTicket(lineId, stationA);
    const [row] = suite.db.all<{ sent_order_number: number | null }>(
      sql`select sent_order_number from ticket_items where id = ${id}`,
    );
    expect(row).toEqual({ sent_order_number: null });
  });

  it("does not index a copied bill id", () => {
    const indexes = suite.db.all<{ name: string }>(
      sql`select name from pragma_index_list('ticket_items')`,
    );
    expect(indexes.map((row) => row.name)).not.toContain("ticket_items_order_idx");
  });

  it("A773 retired storage: a migrated database has no pass marks table", () => {
    const tables = suite.db.all<{ name: string }>(
      sql`select name from sqlite_master where name = 'pass_item_marks'`,
    );
    expect(tables).toEqual([]);
  });

  it("A773 retired storage: ticket items have no Away column", () => {
    const columns = suite.db.all<{ name: string }>(
      sql`select name from pragma_table_info('ticket_items') where name = 'away_at'`,
    );
    expect(columns).toEqual([]);
  });

  it("carries a nullable note column (spec §2/§3, NON-FISCAL)", async () => {
    const meta = suite.db
      .all<{ name: string; type: string; notnull: number }>(
        sql`select name, type, "notnull" from pragma_table_info('ticket_items') where name = 'note'`,
      )
      .map((c) => ({ name: c.name, type: c.type, notnull: c.notnull }));
    expect(meta).toEqual([{ name: "note", type: "TEXT", notnull: 0 }]);
    const { lineId } = await seedOrderLine(nodeA, productA);
    const id = await seedTicket(lineId, stationA);
    await inTx((tx) =>
      tx.update(ticketItems).set({ note: "no salt" }).where(eq(ticketItems.id, id)),
    );
    const [row] = await inTx((tx) =>
      tx.select({ note: ticketItems.note }).from(ticketItems).where(eq(ticketItems.id, id)),
    );
    expect(row!.note).toBe("no salt");
  });

  it("records the quantity fired, and leaves it unset where an insert does not state it", async () => {
    const meta = suite.db
      .all<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
        sql`select name, type, "notnull", dflt_value from pragma_table_info('ticket_items')
             where name = 'quantity'`,
      )
      .map((c) => ({ ...c }));
    expect(meta).toEqual([{ name: "quantity", type: "INTEGER", notnull: 0, dflt_value: null }]);
    const unstated = await seedOrderLine(nodeA, productA);
    const unstatedId = await seedTicket(unstated.lineId, stationA);
    const stated = await seedOrderLine(nodeA, productA);
    const [statedRow] = await inTx((tx) =>
      tx
        .insert(ticketItems)
        .values({ workingOrderLineId: stated.lineId, stationId: stationA, quantity: 2000 })
        .returning({ id: ticketItems.id }),
    );
    const read = await inTx((tx) =>
      tx
        .select({ id: ticketItems.id, quantity: ticketItems.quantity })
        .from(ticketItems)
        .where(inArray(ticketItems.id, [unstatedId, statedRow!.id])),
    );
    expect(Object.fromEntries(read.map((row) => [row.id, row.quantity]))).toEqual({
      [unstatedId]: null,
      [statedRow!.id]: 2000,
    });
  });

  it("rejects a second ticket item for the same line (the per-line UNIQUE — the concurrent-fire guard)", async () => {
    const { lineId } = await seedOrderLine(nodeA, productA);
    await seedTicket(lineId, stationA);
    const e = await captureError(() => seedTicket(lineId, stationA));
    expect(isRefusal(e, UNIQUE_VIOLATION)).toBe(true);
  });

  it("cascades a ticket item away when its working_order_line is deleted (ON DELETE CASCADE)", async () => {
    // The parent order is open, so working_order_lines_require_open_parent permits the delete.
    const { lineId } = await seedOrderLine(nodeA, productA);
    const id = await seedTicket(lineId, stationA);
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
