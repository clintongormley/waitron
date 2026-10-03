import { locationId as brandLocationId } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { checkFailed, refusalOn, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { withTransaction } from "../tenancy.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { workingOrders } from "./orders.js";
import { parties } from "./parties.js";
import { sales } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";
import { unpaidDepartures } from "./unpaid-departures.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL = "aaaaaaaa-1111-4000-8000-000000000001";
/** An order opened from the dashboard at `LOCATION`, needing no device. */
const DASHBOARD = { source: "dashboard", deviceId: null, locationId: LOCATION } as const;
const STAFF = "cccccccc-0000-4000-8000-000000000001";
const SUPERVISOR = "cccccccc-0000-4000-8000-000000000002";
const MISSING = "cccccccc-3333-4000-8000-0000000000ff";
const AT = "2026-10-01T21:00:00.000Z";

let nodeId = "";
let seriesId = "";
let deviceId = "";
let nextOrder = 0;

describe("unpaid_departures", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  beforeAll(async () => {
    const db = suite.db;
    await db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant" }]);
    await db.insert(locations).values({
      id: LOCATION,
      name: "Loc",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await db.insert(tills).values({ id: TILL, locationId: LOCATION, name: "Till" });
    nodeId = await seedNode(db, brandLocationId(LOCATION));
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    seriesId = series!.id;
    ({ deviceId } = await seedDevice(db, { tillId: TILL }));
  });

  /** A party, one bill of it and that bill's unsettled invoice. */
  async function invoicedBill(): Promise<{ partyId: string; billId: string; saleId: string }> {
    nextOrder += 1;
    const orderNumber = nextOrder;
    return inTx(async (tx) => {
      const [party] = await tx
        .insert(parties)
        .values({ openedBy: STAFF })
        .returning({ id: parties.id });
      const [bill] = await tx
        .insert(workingOrders)
        .values({
          ...DASHBOARD,
          nodeId,
          orderNumber,
          status: "placed",
          openedAt: AT,
          partyId: party!.id,
        })
        .returning({ id: workingOrders.id });
      const [sale] = await tx
        .insert(sales)
        .values({
          source: "device",
          deviceId,
          nodeId,
          seriesId,
          invoiceNumber: orderNumber,
          issuedAt: AT,
          issuedOffsetMinutes: 120,
          total: 3000,
          vatBreakdown: [],
          locale: "es",
          invoiceLocales: ["es"],
          fiscalBackend: "verifactu",
          fiscalState: "recorded",
          workingOrderId: bill!.id,
        })
        .returning({ id: sales.id });
      return { partyId: party!.id, billId: bill!.id, saleId: sale!.id };
    });
  }

  function departure(
    of: { partyId: string; billId: string; saleId: string },
    overrides: Partial<typeof unpaidDepartures.$inferInsert> = {},
  ): typeof unpaidDepartures.$inferInsert {
    return {
      partyId: of.partyId,
      workingOrderId: of.billId,
      saleId: of.saleId,
      amount: 3000,
      reason: "Se marcharon sin pagar",
      recordedBy: STAFF,
      authorizedBy: SUPERVISOR,
      source: "device",
      deviceId,
      ...overrides,
    };
  }

  async function recorded(): Promise<string> {
    const bill = await invoicedBill();
    const [row] = await inTx((tx) =>
      tx.insert(unpaidDepartures).values(departure(bill)).returning({ id: unpaidDepartures.id }),
    );
    return row!.id;
  }

  it("keeps what was recorded, with when", async () => {
    const bill = await invoicedBill();
    const [row] = await inTx((tx) =>
      tx.insert(unpaidDepartures).values(departure(bill)).returning(),
    );
    expect(row).toEqual({
      id: expect.any(String),
      partyId: bill.partyId,
      workingOrderId: bill.billId,
      saleId: bill.saleId,
      amount: 3000,
      reason: "Se marcharon sin pagar",
      recordedBy: STAFF,
      authorizedBy: SUPERVISOR,
      source: "device",
      deviceId,
      recordedAt: expect.any(String),
    });
  });

  it("refuses a second departure of the same bill", async () => {
    const bill = await invoicedBill();
    await inTx((tx) => tx.insert(unpaidDepartures).values(departure(bill)));
    const error = await captureError(() =>
      inTx((tx) => tx.insert(unpaidDepartures).values(departure(bill))),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "unpaid_departures",
        columns: ["working_order_id"],
      }),
    ).toBe(true);
  });

  it.each([
    ["party", { partyId: MISSING }],
    ["bill", { workingOrderId: MISSING }],
    ["sale", { saleId: MISSING }],
    ["device", { deviceId: MISSING }],
  ] as const)("refuses a departure naming no %s", async (_, overrides) => {
    const bill = await invoicedBill();
    const error = await captureError(() =>
      inTx((tx) => tx.insert(unpaidDepartures).values(departure(bill, overrides))),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it.each([
    ["nothing", 0],
    ["a negative amount", -1],
  ])("refuses a departure owing %s", async (_, amount) => {
    const bill = await invoicedBill();
    const error = await captureError(() =>
      inTx((tx) => tx.insert(unpaidDepartures).values(departure(bill, { amount }))),
    );
    expect(checkFailed(error, "unpaid_departures_amount_ck")).toBe(true);
    const rows = await inTx((tx) =>
      tx.select().from(unpaidDepartures).where(eq(unpaidDepartures.workingOrderId, bill.billId)),
    );
    expect(rows).toEqual([]);
  });

  it("refuses an UPDATE and leaves the row as written", async () => {
    const id = await recorded();
    const error = await captureError(() =>
      inTx((tx) =>
        tx.update(unpaidDepartures).set({ amount: 1 }).where(eq(unpaidDepartures.id, id)),
      ),
    );
    expect(triggerRaised(error, "unpaid_departures is append-only")).toBe(true);
    const [row] = await inTx((tx) =>
      tx.select().from(unpaidDepartures).where(eq(unpaidDepartures.id, id)),
    );
    expect(row!.amount).toBe(3000);
  });

  it("refuses a DELETE and leaves the row in place", async () => {
    const id = await recorded();
    const error = await captureError(() =>
      inTx((tx) => tx.delete(unpaidDepartures).where(eq(unpaidDepartures.id, id))),
    );
    expect(triggerRaised(error, "unpaid_departures is append-only")).toBe(true);
    const rows = await inTx((tx) =>
      tx.select().from(unpaidDepartures).where(eq(unpaidDepartures.id, id)),
    );
    expect(rows).toHaveLength(1);
  });
});
