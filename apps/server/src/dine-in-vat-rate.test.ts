import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  billAdvances,
  billPayments,
  products,
  workingOrderLines,
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
import { advanceBills, provisionAdvanceVenue, type AdvanceVenue } from "./testing/advance-bills.js";
import {
  cashPayment,
  inTx,
  provisionBillVenue,
  send,
  type BillVenue,
} from "./testing/bill-venue.js";
import { clockAtIso } from "./testing/later-sale-date-fixture.js";
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
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order-open.js";
import "./errors.js";

// The area's dine-in rate: 10%, and 4% from 1 January 2027.
vi.mock("@waitron/country-packs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/country-packs")>();
  return {
    ...actual,
    vatRatesFor: (...args: Parameters<typeof actual.vatRatesFor>) => {
      const rates = actual.vatRatesFor(...args);
      return (
        rates && {
          ...rates,
          dineIn: [
            { from: null, rate: "10.00" },
            { from: "2027-01-01", rate: "4.00" },
          ],
        }
      );
    },
  };
});

// Eaten here, every line files at the area's dine-in rate, whatever its product's label or takeaway
// rate.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

async function tillChoiceEverywhere(tx: Transaction): Promise<void> {
  for (const { id } of await tx.select({ id: departments.id }).from(departments)) {
    await setDepartmentSalePolicyField(tx, id, "dining", "till_choice");
  }
}

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

/** A burger with a lemon-soda extra, and a wine labelled `reduced` whose 175 ml variant is given
 * its own `general` label, all taken away at 21%. */
async function generalVenue() {
  const venue = await provisionBillVenue(suite.db);
  const made = await inTx(venue, async (tx) => {
    await tillChoiceEverywhere(tx);
    const menu = await seedTakeawayProducts(tx);
    await tx.update(products).set({ vatClass: "general" }).where(eq(products.id, menu.lemonSoda));
    await setTakeawayVatRate(tx, menu.lemonSoda, "21.00");
    const wine = await createProduct(tx, {
      categoryId: null,
      name: "Wine by the glass",
      pricingUnit: "each",
      unitPrice: "4.00",
      vatClass: "reduced",
      takeawayVatRate: "21.00",
    });
    const [wine175] = await setProductVariants(
      tx,
      wine.id,
      [
        {
          name: "Wine 175",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "5.50",
          available: true,
        },
      ],
      "es-ES",
    );
    await tx.update(products).set({ vatClass: "general" }).where(eq(products.id, wine175!.id));
    return {
      menu,
      wine: wine.id,
      wine175: wine175!.id,
      counter: await offerProducts(tx),
    };
  });
  return { venue, ...made };
}

async function park(
  venue: BillVenue,
  zoneId: string,
  dining: Dining,
  lines: Parameters<typeof parkOrder>[2]["lines"],
): Promise<string> {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    lines,
    zoneId,
    operatorId: venue.operatorId,
    dining,
  });
  return id;
}

describe("an order eaten here files every line at the dine-in rate", () => {
  it("started taken away and switched to eaten here, a burger, its extra and a variant labelled general file 10%", async () => {
    const { venue, menu, wine, wine175, counter } = await generalVenue();
    const id = await park(venue, counter.zoneId, "takeaway", [
      {
        menuItemId: counter.offerFor(menu.burger),
        quantity: "1",
        extras: [
          { listId: menu.burgerExtras, picks: [{ productId: menu.lemonSoda, quantity: 1 }] },
        ],
      },
      { menuItemId: counter.offerFor(wine), variantId: wine175, quantity: "1" },
    ]);
    await inTx(venue, (tx) =>
      tx.update(workingOrders).set({ dining: "eat_in" }).where(eq(workingOrders.id, id)),
    );

    const sold = await cashPayment(venue, venue.cookie, id, "17.50");

    expect(sold.status).toBe(200);
    expect(filedRates(venue.db, id)).toEqual([1000, 1000, 1000]);
  });

  it("a walk-up of a product labelled general files 10%", async () => {
    const { venue, menu, counter } = await generalVenue();
    const id = randomUUID();

    const sold = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "10.00",
      dining: "eat_in",
      basket: {
        zoneId: counter.zoneId,
        lines: [{ menuItemId: counter.offerFor(menu.burger), quantity: "1" }],
      },
    });

    expect(sold.status).toBe(200);
    expect(filedRates(venue.db, id)).toEqual([1000]);
  });
});

describe("an advance files at the dine-in rate of the day it was paid", () => {
  let advanceVenue: AdvanceVenue;
  const { seated } = advanceBills(() => advanceVenue);

  /** The rates of the lines of the advance paid on `iso`, in basis points. */
  async function advanceRatesOn(billId: string, iso: string): Promise<number[]> {
    const venue = advanceVenue.venue;
    const submissionId = randomUUID();
    const paid = await send(
      venue.appAt(clockAtIso(iso)),
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId,
        kind: "contribution",
        amount: "10.00",
        method: "cash",
        tendered: "10.00",
        applied: "10.00",
        tip: "0.00",
        ownReceipt: true,
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const [advance] = await inTx(venue, (tx) =>
      tx
        .select({ saleId: billAdvances.advanceSaleId })
        .from(billAdvances)
        .innerJoin(billPayments, eq(billPayments.id, billAdvances.billPaymentId))
        .where(eq(billPayments.submissionId, submissionId)),
    );
    const rows = venue.db.all<{ vat_rate: number }>(
      sql`select vat_rate from sale_lines where sale_id = ${advance!.saleId}`,
    );
    return rows.map((row) => row.vat_rate);
  }

  // Europe/Madrid, UTC+1 in winter: noon on 31 December 2026 and on 1 January 2027.
  it("10% on 31 December and 4% on 1 January", async () => {
    advanceVenue = await provisionAdvanceVenue(suite.db);
    const billId = await seated("Tasting menu");

    expect(await advanceRatesOn(billId, "2026-12-31T11:00:00.000Z")).toEqual([1000]);
    expect(await advanceRatesOn(billId, "2027-01-01T11:00:00.000Z")).toEqual([400]);
  });
});

describe("an eaten-in set-menu bill paid by a captured card", () => {
  it("files its set-menu line at the dine-in rate, whatever its label", async () => {
    const venue = await setupPartyVenue(suite.db);
    const copy = await partyTx(venue, (tx) =>
      setMenuOnFullMenu(tx, venue.tables.menuId, venue.productId("Flan")),
    );
    const { tabId } = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
    await orderOnParty(venue, tabId, "Burger");
    const setMenuLine = await partyTx(venue, (tx) => seedBillSetMenu(tx, tabId, copy, 2));
    await partyTx(venue, async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ vatClass: "general" })
        .where(eq(workingOrderLines.id, setMenuLine));
      await capturedCardPayment(tx, venue, tabId);
    });

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
    expect(setMenuRates).toEqual([{ vat_rate: 1000 }]);
    expect(
      await venue.db
        .select({ state: payments.state })
        .from(payments)
        .where(eq(payments.workingOrderId, tabId)),
    ).toEqual([{ state: "captured" }]);
  });
});
