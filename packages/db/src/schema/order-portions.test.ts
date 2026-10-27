import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { checkFailed, refusalOn, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { withTransaction } from "../tenancy.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import {
  orderPortionEvents,
  orderPortions,
  saleLinePortions,
  workingLinePortions,
} from "./order-portions.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { saleLines, sales } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants } from "./tenants.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const COHORT = "bbbbbbbb-0000-4000-8000-000000000001";
const GHOST = "bbbbbbbb-0000-4000-8000-0000000000ff";
const AT = "2026-10-27T12:00:00.000Z";

const LINE = {
  name: "Burger",
  descriptions: { en: "Burger" },
  quantity: 1000,
  unitPriceGross: 950,
  vatClass: "reduced",
  lineTotal: 950,
};

describe("A803 portions: the registry, bindings, sale links and events", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let db: Database;
  let orderId = "";
  let otherOrderId = "";
  let saleLineId = "";

  beforeEach(async () => {
    db = suite.db;
    await db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant" });
    await db.insert(locations).values({
      id: LOCATION,
      name: "Loc",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
    });
    const nodeId = await seedNode(db, brandLocationId(LOCATION));
    const { deviceId } = await seedDevice(db, { locationId: LOCATION });
    const orders = await db
      .insert(workingOrders)
      .values(
        [1, 2].map((orderNumber) => ({
          source: "dashboard" as const,
          deviceId: null,
          locationId: LOCATION,
          nodeId,
          orderNumber,
          status: "open" as const,
          openedAt: AT,
        })),
      )
      .returning({ id: workingOrders.id });
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

  async function insertPortion(ordinal: number): Promise<string> {
    const [row] = await db
      .insert(orderPortions)
      .values({ cohortId: COHORT, ordinal, measured: false })
      .returning({ id: orderPortions.id });
    return row!.id;
  }

  it("A803 portions: a second binding for one line is refused", async () => {
    const line = await insertLine(1);
    const [first, second] = [await insertPortion(1), await insertPortion(2)];
    await db.insert(workingLinePortions).values({ workingOrderLineId: line, portionId: first });
    const error = await captureError(() =>
      db.insert(workingLinePortions).values({ workingOrderLineId: line, portionId: second }),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "working_line_portions",
        columns: ["working_order_line_id"],
      }),
    ).toBe(true);
  });

  it("A803 portions: a second line for one portion is refused", async () => {
    const [a, b] = [await insertLine(1), await insertLine(2)];
    const portion = await insertPortion(1);
    await db.insert(workingLinePortions).values({ workingOrderLineId: a, portionId: portion });
    const error = await captureError(() =>
      db.insert(workingLinePortions).values({ workingOrderLineId: b, portionId: portion }),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "working_line_portions",
        columns: ["portion_id"],
      }),
    ).toBe(true);
  });

  it("A803 portions: a binding, sale link or event naming a missing portion or sale line is refused", async () => {
    const line = await insertLine(1);
    const portion = await insertPortion(1);
    const writes = [
      () => db.insert(workingLinePortions).values({ workingOrderLineId: line, portionId: GHOST }),
      () =>
        db.insert(workingLinePortions).values({ workingOrderLineId: GHOST, portionId: portion }),
      () => db.insert(saleLinePortions).values({ saleLineId, portionId: GHOST }),
      () => db.insert(saleLinePortions).values({ saleLineId: GHOST, portionId: portion }),
      () =>
        db
          .insert(orderPortionEvents)
          .values({ portionId: GHOST, kind: "cancelled", fromOrderId: orderId }),
    ];
    for (const write of writes) {
      expect(isRefusal(await captureError(write), FOREIGN_KEY_VIOLATION)).toBe(true);
    }
  });

  it("A803 portions: registry, sale-link and event rows refuse update, delete and insert-or-replace", async () => {
    const portion = await insertPortion(1);
    const [link] = await db
      .insert(saleLinePortions)
      .values({ saleLineId, portionId: portion })
      .returning({ id: saleLinePortions.id });
    const [event] = await db
      .insert(orderPortionEvents)
      .values({ portionId: portion, kind: "cancelled", fromOrderId: orderId })
      .returning({ id: orderPortionEvents.id });
    const rows = [
      ["order_portions", portion, sql`ordinal = 2`],
      ["sale_line_portions", link!.id, sql`portion_id = portion_id`],
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

  it("A803 portions: deleting a bound line is refused until its binding is deleted, and the registry row stays", async () => {
    const line = await insertLine(1);
    const portion = await insertPortion(1);
    await db.insert(workingLinePortions).values({ workingOrderLineId: line, portionId: portion });
    const refused = await captureError(() =>
      db.delete(workingOrderLines).where(eq(workingOrderLines.id, line)),
    );
    expect(isRefusal(refused, FOREIGN_KEY_VIOLATION)).toBe(true);
    await db.delete(workingLinePortions).where(eq(workingLinePortions.workingOrderLineId, line));
    await db.delete(workingOrderLines).where(eq(workingOrderLines.id, line));
    expect(await db.select({ id: orderPortions.id }).from(orderPortions)).toEqual([
      { id: portion },
    ]);
  });

  it("A803 portions: a moved event to its own order, or a cancelled event naming a destination, is refused", async () => {
    const portion = await insertPortion(1);
    const refusedValues = [
      { kind: "moved" as const, fromOrderId: orderId, toOrderId: orderId },
      { kind: "moved" as const, fromOrderId: orderId, toOrderId: null },
      { kind: "cancelled" as const, fromOrderId: orderId, toOrderId: otherOrderId },
    ];
    for (const values of refusedValues) {
      const error = await captureError(() =>
        db.insert(orderPortionEvents).values({ portionId: portion, ...values }),
      );
      expect(checkFailed(error, "order_portion_events_destination_ck")).toBe(true);
    }
    await db
      .insert(orderPortionEvents)
      .values({ portionId: portion, kind: "moved", fromOrderId: orderId, toOrderId: otherOrderId });
    const kind = await captureError(() =>
      db.run(
        sql`insert into order_portion_events (id, portion_id, kind, from_order_id, at) values ('e', ${portion}, 'split', ${orderId}, ${AT})`,
      ),
    );
    expect(checkFailed(kind, "order_portion_events_kind_ck")).toBe(true);
  });

  it("A803 portions: an ordinal below 1, or repeated in a cohort, is refused", async () => {
    const low = await captureError(() => insertPortion(0));
    expect(checkFailed(low, "order_portions_ordinal_ck")).toBe(true);
    await insertPortion(1);
    const repeated = await captureError(() => insertPortion(1));
    expect(
      refusalOn(repeated, UNIQUE_VIOLATION, {
        table: "order_portions",
        columns: ["cohort_id", "ordinal"],
      }),
    ).toBe(true);
  });
});
