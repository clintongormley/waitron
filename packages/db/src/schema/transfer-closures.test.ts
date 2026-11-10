import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { checkFailed, refusalOn } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { withTransaction } from "../tenancy.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedNode, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { sales } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { transferClosures, type TransferClosureResult } from "./transfer-closures.js";

const ACTOR = "cccccccc-0000-4000-8000-000000000001";
const MISSING = "cccccccc-3333-4000-8000-0000000000ff";
const AT = "2026-11-09T21:00:00.000Z";
const DAY = "2026-11-09";
const INTENT = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

let nodeId = "";
let otherNodeId = "";
let seriesId = "";
let deviceId = "";
let nextOrder = 0;

interface Bill {
  billId: string;
  saleId: string;
}

describe("transfer_closures", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  beforeAll(async () => {
    const db = suite.db;
    await seedVenue(db, {
      name: "Loc",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    nodeId = await seedNode(db);
    otherNodeId = await seedNode(db);
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    seriesId = series!.id;
    ({ deviceId } = await seedDevice(db));
  });

  /** One bill and the invoice issued from it. */
  async function invoicedBill(): Promise<Bill> {
    nextOrder += 1;
    const orderNumber = nextOrder;
    return inTx(async (tx) => {
      const bill = await seedWorkingOrder(tx, {
        source: "dashboard",
        nodeId,
        orderNumber,
        status: "placed",
        openedAt: AT,
      });
      const [sale] = await tx
        .insert(sales)
        .values({
          source: "device",
          deviceId,
          nodeId,
          seriesId,
          invoiceNumber: orderNumber,
          issuedAt: AT,
          issuedOffsetMinutes: 60,
          total: 3000,
          vatBreakdown: [],
          locale: "es",
          invoiceLocales: ["es"],
          fiscalBackend: "verifactu",
          fiscalState: "recorded",
          workingOrderId: bill.id,
        })
        .returning({ id: sales.id });
      return { billId: bill.id, saleId: sale!.id };
    });
  }

  function resultFor(operationId: string, bill: Bill): TransferClosureResult {
    return {
      operationId,
      workingOrderId: bill.billId,
      saleId: bill.saleId,
      invoiceNumber: "FA-1",
      classification: "to_be_paid_by_transfer",
      closedAt: AT,
      businessDay: DAY,
      total: "30.00",
      currency: "EUR",
      party: { state: "open", blockers: ["other_bills", "authority"] },
    };
  }

  function closure(
    bill: Bill,
    overrides: Partial<typeof transferClosures.$inferInsert> = {},
  ): typeof transferClosures.$inferInsert {
    const id = overrides.id ?? randomUUID();
    return {
      id,
      workingOrderId: bill.billId,
      saleId: bill.saleId,
      intent: INTENT,
      actorId: ACTOR,
      source: "device",
      deviceId,
      nodeId,
      closedAt: AT,
      businessDay: DAY,
      result: resultFor(id, bill),
      ...overrides,
    };
  }

  function insert(row: typeof transferClosures.$inferInsert) {
    return inTx((tx) => tx.insert(transferClosures).values(row));
  }

  it("keeps the closure exactly as written, its result included", async () => {
    const bill = await invoicedBill();
    const row = closure(bill);
    await insert(row);
    const [read] = await inTx((tx) =>
      tx.select().from(transferClosures).where(eq(transferClosures.id, row.id)),
    );
    expect(read).toEqual({
      id: row.id,
      workingOrderId: bill.billId,
      saleId: bill.saleId,
      intent: INTENT,
      actorId: ACTOR,
      source: "device",
      deviceId,
      nodeId,
      closedAt: AT,
      businessDay: DAY,
      result: resultFor(row.id, bill),
    });
  });

  it("accepts a closure from the dashboard, naming no device, on another node", async () => {
    const bill = await invoicedBill();
    const row = closure(bill, { source: "dashboard", deviceId: null, nodeId: otherNodeId });
    await insert(row);
    const rows = await inTx((tx) =>
      tx.select().from(transferClosures).where(eq(transferClosures.id, row.id)),
    );
    expect(rows).toHaveLength(1);
  });

  it("accepts a second operation on a different bill", async () => {
    await insert(closure(await invoicedBill()));
    const second = closure(await invoicedBill());
    await insert(second);
    const rows = await inTx((tx) =>
      tx.select().from(transferClosures).where(eq(transferClosures.id, second.id)),
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses a second closure under the same operation id", async () => {
    const first = closure(await invoicedBill());
    await insert(first);
    const other = await invoicedBill();
    const error = await captureError(() => insert(closure(other, { id: first.id })));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "transfer_closures", columns: ["id"] }),
    ).toBe(true);
  });

  it("refuses a second closure of the same bill", async () => {
    const bill = await invoicedBill();
    await insert(closure(bill));
    const other = await invoicedBill();
    const error = await captureError(() =>
      insert(closure({ billId: bill.billId, saleId: other.saleId })),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "transfer_closures",
        columns: ["working_order_id"],
      }),
    ).toBe(true);
  });

  it("refuses a second closure of the same sale", async () => {
    const bill = await invoicedBill();
    await insert(closure(bill));
    const other = await invoicedBill();
    const error = await captureError(() =>
      insert(closure({ billId: other.billId, saleId: bill.saleId })),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "transfer_closures", columns: ["sale_id"] }),
    ).toBe(true);
  });

  it.each([
    ["bill", { workingOrderId: MISSING }],
    ["sale", { saleId: MISSING }],
    ["device", { deviceId: MISSING }],
    ["node", { nodeId: MISSING }],
  ] as const)("refuses a closure naming no %s", async (_, overrides) => {
    const bill = await invoicedBill();
    const error = await captureError(() => insert(closure(bill, overrides)));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it.each([
    ["an unknown source", { source: "nowhere" as "device" }, "transfer_closures_source_ck"],
    ["a device source naming no device", { deviceId: null }, "transfer_closures_source_device_ck"],
    [
      "a dashboard source naming a device",
      { source: "dashboard" as const },
      "transfer_closures_source_device_ck",
    ],
  ] as const)("refuses %s", async (_, overrides, constraint) => {
    const bill = await invoicedBill();
    const error = await captureError(() => insert(closure(bill, overrides)));
    expect(checkFailed(error, constraint)).toBe(true);
  });

  it.each([
    ["a timestamp", "2026-11-09T00:00:00Z"],
    ["a day without padding", "2026-11-9"],
    ["a day in another order", "09-11-2026"],
    ["an empty day", ""],
  ])("refuses %s as the business day", async (_, businessDay) => {
    const bill = await invoicedBill();
    const error = await captureError(() => insert(closure(bill, { businessDay })));
    expect(checkFailed(error, "transfer_closures_business_day_ck")).toBe(true);
  });
});
