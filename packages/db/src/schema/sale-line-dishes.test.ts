import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { checkFailed, refusalOn, restrictRefused, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { withTransaction } from "../tenancy.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedNode, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { orderPortionEvents } from "./order-portion-events.js";
import { saleLineDishes } from "./sale-line-dishes.js";
import { workingOrderLines } from "./orders.js";
import { saleLines, sales } from "./sales.js";
import { invoiceSeries } from "./series.js";

const GHOST = "bbbbbbbb-0000-4000-8000-0000000000ff";
const AT = "2026-10-27T12:00:00.000Z";

const LINE = {
  name: "Burger",
  descriptions: { en: "Burger" },
  quantity: 1000,
  unitPriceGross: 950,
  vatClass: "reduced",
  takeawayVatClass: "reduced",
  lineTotal: 950,
};

describe("Dish sale links and events", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let db: Database;
  let orderId = "";
  let otherOrderId = "";
  let saleLineId = "";

  beforeEach(async () => {
    db = suite.db;
    await seedVenue(db, {
      name: "Loc",
      invoiceLocales: ["en"],
    });
    const nodeId = await seedNode(db);
    const { deviceId } = await seedDevice(db);
    const orders: { id: string }[] = [];
    for (const orderNumber of [1, 2]) {
      orders.push(
        await seedWorkingOrder(db, {
          source: "dashboard",
          deviceId: null,
          nodeId,
          orderNumber,
          status: "open",
          openedAt: AT,
        }),
      );
    }
    orderId = orders[0]!.id;
    otherOrderId = orders[1]!.id;
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    saleLineId = await withTransaction(db, async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values({
          source: "device",
          deviceId,
          nodeId,
          seriesId: series!.id,
          invoiceNumber: 1,
          issuedAt: AT,
          issuedOffsetMinutes: 60,
          total: 950,
          vatBreakdown: [],
          locale: "en",
          invoiceLocales: ["en"],
          fiscalBackend: "verifactu",
          fiscalState: "recorded",
        })
        .returning({ id: sales.id });
      const [line] = await tx
        .insert(saleLines)
        .values({
          saleId: sale!.id,
          lineNo: 1,
          name: "Burger",
          descriptions: { en: "Burger" },
          quantity: 1000,
          unitPrice: 950,
          vatRate: 1000,
          lineTotal: 950,
        })
        .returning({ id: saleLines.id });
      return line!.id;
    });
  });

  async function insertLine(lineNo: number): Promise<string> {
    const [row] = await db
      .insert(workingOrderLines)
      .values({ ...LINE, lineNo, workingOrderId: orderId })
      .returning({ id: workingOrderLines.id });
    return row!.id;
  }

  it("refuses linking one dish twice to one sale line", async () => {
    const dish = await insertLine(1);
    const link = (id: string) =>
      db.run(sql`insert into sale_line_dishes (id, sale_line_id, dish_line_id)
      values (${id}, ${saleLineId}, ${dish})`);
    await link("first");
    const error = await captureError(() => link("duplicate"));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "sale_line_dishes",
        columns: ["sale_line_id", "dish_line_id"],
      }),
    ).toBe(true);
  });

  it("refuses deleting a dish line a sale line points at", async () => {
    const [sold, unsold] = [await insertLine(1), await insertLine(2)];
    await db.run(sql`insert into sale_line_dishes (id, sale_line_id, dish_line_id)
      values ('sold', ${saleLineId}, ${sold})`);
    const remove = (id: string) => db.delete(workingOrderLines).where(eq(workingOrderLines.id, id));
    expect(restrictRefused(await captureError(() => remove(sold)))).toBe(true);
    await remove(unsold);
    expect(await db.select({ id: workingOrderLines.id }).from(workingOrderLines)).toEqual([
      { id: sold },
    ]);
  });

  it("refuses a sale link with a missing dish or sale line", async () => {
    const dishLineId = await insertLine(1);
    for (const values of [
      { saleLineId, dishLineId: GHOST },
      { saleLineId: GHOST, dishLineId },
    ]) {
      const error = await captureError(() => db.insert(saleLineDishes).values(values));
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    }
  });

  it("sale-link and event rows refuse update, delete and insert-or-replace", async () => {
    const dish = await insertLine(1);
    const [link] = await db
      .insert(saleLineDishes)
      .values({ saleLineId, dishLineId: dish })
      .returning({ id: saleLineDishes.id });
    const [event] = await db
      .insert(orderPortionEvents)
      .values({ lineId: dish, kind: "cancelled", fromOrderId: orderId })
      .returning({ id: orderPortionEvents.id });
    const rows = [
      ["sale_line_dishes", link!.id, sql`dish_line_id = dish_line_id`],
      ["order_portion_events", event!.id, sql`actor_id = ${"someone"}`],
    ] as const;
    for (const [name, rowId, set] of rows) {
      const raised = `${name} is append-only`;
      const update = await captureError(() =>
        db.run(sql`update ${sql.identifier(name)} set ${set} where id = ${rowId}`),
      );
      expect(triggerRaised(update, raised)).toBe(true);
      const remove = await captureError(() =>
        db.run(sql`delete from ${sql.identifier(name)} where id = ${rowId}`),
      );
      expect(triggerRaised(remove, raised)).toBe(true);
      const replace = await captureError(() =>
        db.run(
          sql`insert or replace into ${sql.identifier(name)} select * from ${sql.identifier(name)} where id = ${rowId}`,
        ),
      );
      expect(triggerRaised(replace, raised)).toBe(true);
    }
  });

  it("A803 portions: a moved event to its own order, or a cancelled event naming a destination, is refused", async () => {
    const dish = await insertLine(1);
    const refusedValues = [
      { kind: "moved" as const, fromOrderId: orderId, toOrderId: orderId },
      { kind: "moved" as const, fromOrderId: orderId, toOrderId: null },
      { kind: "cancelled" as const, fromOrderId: orderId, toOrderId: otherOrderId },
    ];
    for (const values of refusedValues) {
      const error = await captureError(() =>
        db.insert(orderPortionEvents).values({ lineId: dish, ...values }),
      );
      expect(checkFailed(error, "order_portion_events_destination_ck")).toBe(true);
    }
    await db
      .insert(orderPortionEvents)
      .values({ lineId: dish, kind: "moved", fromOrderId: orderId, toOrderId: otherOrderId });
    const kind = await captureError(() =>
      db.run(
        sql`insert into order_portion_events (id, line_id, kind, from_order_id, at) values ('e', ${dish}, 'split', ${orderId}, ${AT})`,
      ),
    );
    expect(checkFailed(kind, "order_portion_events_kind_ck")).toBe(true);
  });

});
