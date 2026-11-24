import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  products,
  productTakeawayVatRates,
  readVenueClock,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct, setProductVariants, setTakeawayVatRate } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments } from "@waitron/payments";
import type { Dining } from "@waitron/shared";
import { departments, setDepartmentSalePolicyField } from "@waitron/venue-service";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { closeOfDayConfig, issueBillAtClose } from "./close-of-day.js";
import {
  cashPayment,
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { clockAtIso, filedFor } from "./testing/later-sale-date-fixture.js";
import {
  order as orderOnParty,
  seatWithNoAllergies,
  setupPartyVenue,
  inTx as partyTx,
} from "./testing/party-venue.js";
import {
  capturedCardPayment,
  seedBillSetMenu,
  setMenuOnFullMenu,
} from "./testing/set-menu-bill-fixture.js";
import { seedTakeawayProducts } from "./testing/takeaway-menu.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";
import "./errors.js";

// Passes every call through, counting the reads of the products' takeaway rates.
const rateReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@waitron/menu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/menu")>();
  return {
    ...actual,
    readTakeawayVatSchedules: (...args: Parameters<typeof actual.readTakeawayVatSchedules>) => {
      rateReads.count++;
      return actual.readTakeawayVatSchedules(...args);
    },
  };
});

// Taken away, a product line files at its product's own takeaway rate as it stands when the invoice
// is issued, never at a label frozen on the line. Every product here is labelled `reduced` (10%)
// both ways, so a line read from its label files 10%.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

async function tillChoiceEverywhere(tx: Transaction): Promise<void> {
  for (const { id } of await tx.select({ id: departments.id }).from(departments)) {
    await setDepartmentSalePolicyField(tx, id, "dining", "till_choice");
  }
}

const labelledReduced = (tx: Transaction, name: string, unitPrice: string, rate: string) =>
  createProduct(tx, {
    categoryId: null,
    name,
    pricingUnit: "each",
    unitPrice,
    vatClass: "reduced",
    takeawayVatRate: rate,
  });

async function counterVenue() {
  const venue = await provisionBillVenue(suite.db);
  const made = await inTx(venue, async (tx) => {
    await tillChoiceEverywhere(tx);
    const tea = await labelledReduced(tx, "Iced tea", "1.80", "10.00");
    const coffee = await labelledReduced(tx, "Coffee", "1.50", "10.00");
    const [double] = await setProductVariants(
      tx,
      coffee.id,
      [
        {
          name: "Double",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "2.20",
          available: true,
        },
      ],
      "es-ES",
    );
    const counter = await offerProducts(tx);
    return { tea: tea.id, coffee: coffee.id, double: double!.id, counter };
  });
  return { venue, ...made };
}

async function park(
  venue: BillVenue,
  counter: ZoneOffers,
  dining: Dining,
  lines: { menuItemId: string; variantId?: string; quantity: string }[],
): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines,
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
    dining,
  });
  return id;
}

const setDining = (venue: BillVenue, orderId: string, dining: Dining) =>
  inTx(venue, (tx) =>
    tx.update(workingOrders).set({ dining }).where(eq(workingOrders.id, orderId)),
  );

/** Each filed line's rate in basis points, in line order. */
function filedRates(db: Database, workingOrderId: string): number[] {
  return db
    .all<{ vat_rate: number }>(
      sql`select sl.vat_rate from sale_lines sl
          join sales s on s.id = sl.sale_id
          where s.working_order_id = ${workingOrderId}
          order by sl.line_no`,
    )
    .map((row) => row.vat_rate);
}

async function paidInCash(venue: BillVenue, id: string, tendered: string): Promise<void> {
  const sold = await cashPayment(venue, venue.cookie, id, tendered);
  expect(sold.status).toBe(200);
}

async function productNamed(venue: BillVenue, name: string): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx.select({ id: products.id }).from(products).where(eq(products.name, name)),
  );
  return row!.id;
}

/** A table's bill set to take away while empty, then given one of `name`. */
async function takeawayTab(venue: BillVenue, name: string): Promise<string> {
  const { tabId } = await seatedWith(venue);
  await setDining(venue, tabId, "takeaway");
  await inTx(venue, (tx) =>
    addTabRound(tx, venue.cfg, tabId, [{ menuItemId: venue.offerFor(name), quantity: "1" }]),
  );
  return tabId;
}

async function replaceRows(
  venue: BillVenue,
  productId: string,
  rows: { startsOn: string | null; rate: number }[],
): Promise<void> {
  await inTx(venue, async (tx) => {
    await tx
      .delete(productTakeawayVatRates)
      .where(eq(productTakeawayVatRates.productId, productId));
    if (rows.length > 0)
      await tx.insert(productTakeawayVatRates).values(rows.map((row) => ({ productId, ...row })));
  });
}

describe("a takeaway line files its product's rate as it stands at issue", () => {
  it("a line parked at 10% whose product is then set to 21% files 21%", async () => {
    const { venue, tea, counter } = await counterVenue();
    const id = await park(venue, counter, "takeaway", [
      { menuItemId: counter.offerFor(tea), quantity: "1" },
    ]);
    await inTx(venue, (tx) => setTakeawayVatRate(tx, tea, "21.00"));

    await paidInCash(venue, id, "1.80");

    expect(filedRates(venue.db, id)).toEqual([2100]);
  });

  it("a variant without a rate of its own files its parent's new rate", async () => {
    const { venue, coffee, double, counter } = await counterVenue();
    const id = await park(venue, counter, "takeaway", [
      { menuItemId: counter.offerFor(coffee), variantId: double, quantity: "1" },
    ]);
    await inTx(venue, (tx) => setTakeawayVatRate(tx, coffee, "21.00"));

    await paidInCash(venue, id, "2.20");

    expect(filedRates(venue.db, id)).toEqual([2100]);
  });

  it("a walk-up burger at 21% with a lemon-soda extra at 0% files a 21% and a 0% group", async () => {
    const venue = await provisionBillVenue(suite.db);
    const { menu, counter } = await inTx(venue, async (tx) => {
      await tillChoiceEverywhere(tx);
      const menu = await seedTakeawayProducts(tx);
      // The soda's takeaway label now says 10%; its own rate stays 0%.
      await tx
        .update(products)
        .set({ takeawayVatClass: "reduced" })
        .where(eq(products.id, menu.lemonSoda));
      return { menu, counter: await offerProducts(tx) };
    });
    const id = randomUUID();

    const sold = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "12.00",
      dining: "takeaway",
      basket: {
        zoneId: counter.zoneId,
        lines: [
          {
            menuItemId: counter.offerFor(menu.burger),
            quantity: "1",
            extras: [
              { listId: menu.burgerExtras, picks: [{ productId: menu.lemonSoda, quantity: 1 }] },
            ],
          },
        ],
      },
    });

    expect(sold.status).toBe(200);
    expect(filedRates(venue.db, id)).toEqual([2100, 0]);
    const [sale] = venue.db.all<{ vat_breakdown: string }>(
      sql`select vat_breakdown from sales where working_order_id = ${id}`,
    );
    expect(
      (JSON.parse(sale!.vat_breakdown) as { rate: string }[]).map((band) => band.rate).sort(),
    ).toEqual(["0.00", "21.00"]);
  });
});

describe("an order switched between eaten here and taken away after its lines were added", () => {
  it("switched to eaten here, it files the dine-in rate, not the product's takeaway rate", async () => {
    const { venue, tea, counter } = await counterVenue();
    const id = await park(venue, counter, "takeaway", [
      { menuItemId: counter.offerFor(tea), quantity: "1" },
    ]);
    await inTx(venue, (tx) => setTakeawayVatRate(tx, tea, "21.00"));
    await setDining(venue, id, "eat_in");

    await paidInCash(venue, id, "1.80");

    expect(filedRates(venue.db, id)).toEqual([1000]);
  });

  it("switched back to taken away, it files the product's rate", async () => {
    const { venue, tea, counter } = await counterVenue();
    const id = await park(venue, counter, "eat_in", [
      { menuItemId: counter.offerFor(tea), quantity: "1" },
    ]);
    await inTx(venue, (tx) => setTakeawayVatRate(tx, tea, "4.00"));
    await setDining(venue, id, "takeaway");

    await paidInCash(venue, id, "1.80");

    expect(filedRates(venue.db, id)).toEqual([400]);
  });
});

describe("a takeaway meal ended on the eve of a dated rate, ticketed the next day", () => {
  // Europe/Madrid, UTC+1 in March, its business day turning over at 05:00.
  const MON_2200 = "2026-03-16T21:00:00.000Z";
  const THU_0500 = "2026-03-19T04:00:00.000Z";
  const THU_1200 = "2026-03-19T11:00:00.000Z";

  it("files the rate of the meal's day", async () => {
    const venue = await provisionBillVenue(suite.db);
    const croquettes = await productNamed(venue, "Croquettes");
    await replaceRows(venue, croquettes, [
      { startsOn: null, rate: 400 },
      { startsOn: "2026-03-18", rate: 2100 },
    ]);
    const tabId = await takeawayTab(venue, "Croquettes");
    venue.db.run(
      sql`update working_orders set trusted_opened_at = ${MON_2200} where id = ${tabId}`,
    );

    const outcome = await withTransaction(venue.db, async (tx) =>
      issueBillAtClose(
        tx,
        {
          admission: testTradingAdmission(),
          db: venue.db,
          backend: venue.backend,
          clock: clockAtIso(THU_1200),
        },
        closeOfDayConfig(venue.cfg),
        tabId,
        { dayStartedAt: new Date(THU_0500), venueClock: await readVenueClock(tx) },
      ),
    );

    expect(outcome.kind).toBe("issued");
    const { supplyDay, rates } = await filedFor(venue, tabId);
    expect(supplyDay).toBe("2026-03-17");
    expect(rates).toEqual([400]);
  });
});

describe("a takeaway product with no rate", () => {
  it("is refused vat_rate.unavailable", async () => {
    const venue = await provisionBillVenue(suite.db);
    const croquettes = await productNamed(venue, "Croquettes");
    const tabId = await takeawayTab(venue, "Croquettes");
    await replaceRows(venue, croquettes, []);

    await expect(
      issueOrderInvoice(
        {
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
          admission: testTradingAdmission(),
        },
        venue.cfg,
        tabId,
        venue.operatorId,
      ),
    ).rejects.toMatchObject({ code: "vat_rate.unavailable", params: { lineNo: 1 } });
    expect(filedRates(venue.db, tabId)).toEqual([]);
  });

  it("refuses a walk-up payment vat_rate.unavailable, leaving no order and no payment", async () => {
    const venue = await provisionBillVenue(suite.db);
    await inTx(venue, tillChoiceEverywhere);
    const croquettes = await productNamed(venue, "Croquettes");
    await replaceRows(venue, croquettes, []);
    const id = randomUUID();

    const refused = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments`,
      {
        submissionId: randomUUID(),
        kind: "share",
        shareOf: 1,
        method: "cash",
        tendered: "20.00",
        dining: "takeaway",
        basket: { lines: [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }] },
      },
    );

    expect(refused).toMatchObject({
      status: 400,
      json: { code: "vat_rate.unavailable", params: { lineNo: 1 } },
    });
    expect(venue.db.all(sql`select id from working_orders where id = ${id}`)).toEqual([]);
    expect(venue.db.all(sql`select id from bill_payments where working_order_id = ${id}`)).toEqual(
      [],
    );
  });
});

describe("a takeaway set-menu bill paid by a captured card", () => {
  it("files its set-menu line at its set menu's takeaway label", async () => {
    const venue = await setupPartyVenue(suite.db);
    const copy = await partyTx(venue, (tx) =>
      setMenuOnFullMenu(tx, venue.tables.menuId, venue.productId("Flan")),
    );
    const { tabId } = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
    await partyTx(venue, (tx) =>
      tx.update(workingOrders).set({ dining: "takeaway" }).where(eq(workingOrders.id, tabId)),
    );
    await orderOnParty(venue, tabId, "Burger");
    await partyTx(venue, (tx) => seedBillSetMenu(tx, tabId, copy, 2));
    await partyTx(venue, (tx) => capturedCardPayment(tx, venue, tabId));

    const result = await settlePendingBillPayments({
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      admission: testTradingAdmission(),
      cfg: venue.cfg,
    });

    expect(result).toMatchObject({ received: 1, pending: 0, errors: [] });
    const setMenuRates = venue.db.all<{ vat_rate: number }>(
      sql`select sl.vat_rate from sale_lines sl
          join sales s on s.id = sl.sale_id
          where s.working_order_id = ${tabId} and sl.product_id is null`,
    );
    expect(setMenuRates).toEqual([{ vat_rate: 2100 }]);
    expect(
      await venue.db
        .select({ state: payments.state })
        .from(payments)
        .where(eq(payments.workingOrderId, tabId)),
    ).toEqual([{ state: "captured" }]);
  });
});

describe("the products' takeaway rates are read once per basket", () => {
  async function twentyLines() {
    const venue = await provisionBillVenue(suite.db);
    const { menu, counter } = await inTx(venue, async (tx) => {
      await tillChoiceEverywhere(tx);
      const menu = await seedTakeawayProducts(tx);
      return { menu, counter: await offerProducts(tx) };
    });
    const lines = Array.from({ length: 20 }, (_, i) => ({
      menuItemId: counter.offerFor(i % 2 === 0 ? menu.cola : menu.cheese),
      quantity: "1",
    }));
    return { venue, counter, lines };
  }

  it("by a walk-up payment", async () => {
    const { venue, counter, lines } = await twentyLines();
    const id = randomUUID();

    rateReads.count = 0;
    const sold = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "60.00",
      dining: "takeaway",
      basket: { zoneId: counter.zoneId, lines },
    });

    expect(sold.status).toBe(200);
    expect(rateReads.count).toBe(1);
    expect(filedRates(venue.db, id)).toEqual(
      Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 2100 : 400)),
    );
  });

  it("when a parked order is paid, and not when it is parked", async () => {
    const { venue, counter, lines } = await twentyLines();

    rateReads.count = 0;
    const id = await park(venue, counter, "takeaway", lines);
    expect(rateReads.count).toBe(0);
    await paidInCash(venue, id, "58.00");

    expect(rateReads.count).toBe(1);
  });
});
