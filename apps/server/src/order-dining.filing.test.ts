import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { sales, withTransaction, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct, setTakeawayVatRate } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining } from "@waitron/shared";
import { departments, setDepartmentSalePolicyField } from "@waitron/venue-service";
import {
  cashPayment,
  inTx,
  provisionBillVenue,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { createTable } from "./testing/live-table.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { openPartyTab } from "./testing/serve-line.js";
import { seedTakeawayProducts } from "./testing/takeaway-menu.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order-open.js";

// Every read of an order's stored lines rates each line at the class for the order's way of selling
// (A1522): a €1.80 cola is `reduced` served here and `general` taken away; a €4.00 cheese board is
// `reduced` served here and `super_reduced` taken away.
let venue: BillVenue;
let counter: ZoneOffers;
let tables: ZoneOffers;
let menu: Awaited<ReturnType<typeof seedTakeawayProducts>>;
let icedTea: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await withTransaction(db, async (tx) => {
      menu = await seedTakeawayProducts(tx);
      icedTea = (
        await createProduct(tx, {
          categoryId: null,
          name: "Iced tea",
          pricingUnit: "each",
          unitPrice: "1.80",
          vatClass: "reduced",
          takeawayVatRate: "21.00",
        })
      ).id;
      counter = await offerProducts(tx);
      tables = await offerProducts(tx, { zone: "tables" });
    });
  },
});

beforeAll(() =>
  inTx(venue, async (tx) => {
    for (const { id } of await tx.select({ id: departments.id }).from(departments)) {
      await setDepartmentSalePolicyField(tx, id, "dining", "till_choice");
    }
  }),
);

const setDining = (tx: Transaction, orderId: string, dining: Dining) =>
  tx.update(workingOrders).set({ dining }).where(eq(workingOrders.id, orderId));

/** A counter order parked with these products, then set to `dining` before anything is sent. */
async function parked(dining: Dining, productIds: string[]): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines: productIds.map((productId) => ({
      menuItemId: counter.offerFor(productId),
      quantity: "1",
    })),
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  await inTx(venue, (tx) => setDining(tx, id, dining));
  return id;
}

/** A table's bill set to `dining` while empty, then given a round of these products. */
async function tab(dining: Dining, productIds: string[]): Promise<string> {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, {
      label: `T-${randomUUID().slice(0, 8)}`,
      zoneId: tables.zoneId,
    });
    const { tabId } = await openPartyTab(tx, venue.cfg, { tableId: table.id });
    await setDining(tx, tabId, dining);
    await addTabRound(
      tx,
      venue.cfg,
      tabId,
      productIds.map((productId) => ({ menuItemId: tables.offerFor(productId), quantity: "1" })),
    );
    return tabId;
  });
}

/** Each filed line's rate in basis points, in line order. */
function filedRates(workingOrderId: string): number[] {
  return venue.db
    .all<{ vat_rate: number }>(
      sql`select sl.vat_rate from sale_lines sl
          join sales s on s.id = sl.sale_id
          where s.working_order_id = ${workingOrderId}
          order by sl.line_no`,
    )
    .map((row) => row.vat_rate);
}

async function filedBreakdown(workingOrderId: string) {
  const [sale] = await inTx(venue, (tx) =>
    tx
      .select({ vatBreakdown: sales.vatBreakdown })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId)),
  );
  return sale!.vatBreakdown;
}

const byRate = <T extends { rate: string }>(bands: readonly T[]) =>
  [...bands].sort((a, b) => Number(b.rate) - Number(a.rate));

const TAKEAWAY_BANDS = [
  { rate: "21.00", base: "1.49", tax: "0.31" },
  { rate: "4.00", base: "3.85", tax: "0.15" },
];

const ICED_TEA_AT_ZERO = [{ rate: "0.00", base: "1.80", tax: "0.00" }];

const EXPECTED_RATES: Record<Dining, number[]> = { takeaway: [2100, 400], eat_in: [1000, 1000] };

describe("a parked order paid whole", () => {
  it.each(["takeaway", "eat_in"] as const)("files each line %s at its class", async (dining) => {
    const id = await parked(dining, [menu.cola, menu.cheeseBoard]);
    const sold = await cashPayment(venue, venue.cookie, id, "5.80");
    expect(sold.status).toBe(200);
    expect(filedRates(id)).toEqual(EXPECTED_RATES[dining]);
  });

  it("files the backend's VAT breakdown in the takeaway bands", async () => {
    const id = await parked("takeaway", [menu.cola, menu.cheeseBoard]);
    const sold = await cashPayment(venue, venue.cookie, id, "5.80");
    expect(sold.status).toBe(200);
    expect(byRate(await filedBreakdown(id))).toEqual(TAKEAWAY_BANDS);
  });
});

describe("a takeaway bill paid in two item payments", () => {
  const ask = (lineNo: number, amount: string) => ({
    kind: "items",
    lines: [{ lineNo }],
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  });

  it("previews each payment at the line's gross and files the final invoice at the takeaway rates", async () => {
    const billId = await tab("takeaway", [menu.cola, menu.cheeseBoard]);
    const path = `/api/working-orders/${billId}/payments`;

    const firstPreview = await send(
      venue.app,
      venue.cookie,
      "POST",
      `${path}/preview`,
      ask(1, "1.80"),
    );
    expect([firstPreview.status, firstPreview.json.applied]).toEqual([200, "1.80"]);
    const first = await send(venue.app, venue.cookie, "POST", path, {
      submissionId: randomUUID(),
      ...ask(1, "1.80"),
    });
    expect([first.status, first.json.invoice]).toEqual([200, undefined]);

    const secondPreview = await send(
      venue.app,
      venue.cookie,
      "POST",
      `${path}/preview`,
      ask(2, "4.00"),
    );
    expect([secondPreview.status, secondPreview.json.applied]).toEqual([200, "4.00"]);
    const second = await send(venue.app, venue.cookie, "POST", path, {
      submissionId: randomUUID(),
      ...ask(2, "4.00"),
    });
    expect(second.status).toBe(200);

    const invoice = second.json.invoice as { vatBreakdown: { rate: string }[] };
    expect(byRate(invoice.vatBreakdown)).toEqual(TAKEAWAY_BANDS);
    expect(filedRates(billId)).toEqual([2100, 400]);
  });
});

describe("a takeaway tab closed by issuing its invoice unpaid", () => {
  it("files each line at its takeaway class", async () => {
    const tabId = await tab("takeaway", [menu.cola, menu.cheeseBoard]);
    await issueOrderInvoice(
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        admission: testTradingAdmission(),
      },
      venue.cfg,
      tabId,
      venue.operatorId,
    );
    expect(filedRates(tabId)).toEqual([2100, 400]);
  });
});

describe("the menu republished between adding a line and switching the order", () => {
  it("files both orders at the product's takeaway rate at issue, not the rate when the line was added", async () => {
    const id = await parked("eat_in", [icedTea]);
    const republished = await inTx(venue, async (tx) => {
      await setTakeawayVatRate(tx, icedTea, "0.00");
      const offers = await offerProducts(tx);
      await setDining(tx, id, "takeaway");
      return offers;
    });

    const sold = await cashPayment(venue, venue.cookie, id, "1.80");
    expect(sold.status).toBe(200);
    expect(filedRates(id)).toEqual([0]);
    expect(await filedBreakdown(id)).toEqual(ICED_TEA_AT_ZERO);

    // A line added after the change files the same rate.
    const fresh = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: fresh,
      lines: [{ menuItemId: republished.offerFor(icedTea), quantity: "1" }],
      zoneId: republished.zoneId,
      operatorId: venue.operatorId,
      dining: "takeaway",
    });
    const freshSold = await cashPayment(venue, venue.cookie, fresh, "1.80");
    expect(freshSold.status).toBe(200);
    expect(filedRates(fresh)).toEqual([0]);
    expect(await filedBreakdown(fresh)).toEqual(ICED_TEA_AT_ZERO);
  });
});
