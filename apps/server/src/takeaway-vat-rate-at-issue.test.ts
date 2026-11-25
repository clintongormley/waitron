import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  kitchenCourses,
  menuItemVariantOverrides,
  products,
  productTakeawayVatRates,
  readVenueClock,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addMember,
  addSetMenuDishes,
  createMenu,
  createProduct,
  menuItems,
  requireMenuRoot,
  setProductVariants,
  setTakeawayVatRate,
} from "@waitron/menu";
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
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  capturedCardPayment,
  saveSetMenuDraft,
  seedBillSetMenu,
  setMenuOnFullMenu,
} from "./testing/set-menu-bill-fixture.js";
import { sendSpecDraft, setupSetMenuSpecVenue } from "./testing/set-menu-spec-fixture.js";
import { seedTakeawayProducts } from "./testing/takeaway-menu.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { priceForIssuance } from "./working-order-invoice.js";
import { parkOrder } from "./working-order-open.js";
import { priceStoredOrderForIssuance } from "./stored-order-lines.js";
import "./errors.js";

// Passes every call through, counting the reads of the products' takeaway rates and of recorded
// menu copies. A copy read can be made to fail, or to answer copies holding no set menu.
const rateReads = vi.hoisted(() => ({ count: 0 }));
const copyReads = vi.hoisted(() => ({
  count: 0,
  mode: "pass" as "pass" | "throw" | "no_set_menus",
}));
vi.mock("@waitron/menu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/menu")>();
  const { AppError } = await import("@waitron/shared");
  return {
    ...actual,
    readTakeawayVatSchedules: (...args: Parameters<typeof actual.readTakeawayVatSchedules>) => {
      rateReads.count++;
      return actual.readTakeawayVatSchedules(...args);
    },
    readRecordedDocuments: async (...args: Parameters<typeof actual.readRecordedDocuments>) => {
      copyReads.count++;
      if (copyReads.mode === "throw") throw new AppError("menu.reset_required", { menuId: "old" });
      const documents = await actual.readRecordedDocuments(...args);
      if (copyReads.mode === "pass") return documents;
      return new Map(
        [...documents].map(([versionId, document]) => [versionId, { ...document, setMenus: {} }]),
      );
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
  it("files a set menu at the rate its dishes share", async () => {
    const venue = await setupPartyVenue(suite.db);
    const copy = await partyTx(venue, async (tx) => {
      await setTakeawayVatRate(tx, venue.productId("Flan"), "4.00");
      return setMenuOnFullMenu(tx, venue.tables.menuId, venue.productId("Flan"));
    });
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
    expect(setMenuRates).toEqual([{ vat_rate: 400 }]);
    expect(
      await venue.db
        .select({ state: payments.state })
        .from(payments)
        .where(eq(payments.workingOrderId, tabId)),
    ).toEqual([{ state: "captured" }]);
  });
});

type LunchDish = "Soup" | "Hake" | "Lemonade";

/**
 * The plan's worked example: a takeaway Lunch menu at 14.00 listing Soup (5.50, 10%), Hake (12.50,
 * 10%) and Lemonade (3.50, 21%), none of them offered on their own unless `soupOnMenuAt` puts Soup
 * on the full menu at that menu price, in cents.
 */
async function lunchVenue(
  options: {
    soupOnMenuAt?: number;
    lemonadeRate?: string;
    /** A Large Hake at 15.50, offered on the full menu at 16.50. */
    largeHake?: boolean;
  } = {},
) {
  const spec = await setupSetMenuSpecVenue(suite.db);
  const { venue } = spec;
  const lunch = await partyTx(venue, async (tx) => {
    const [{ id: drinkCourse }] = await tx
      .insert(kitchenCourses)
      .values({ name: "Drink", displayOrder: 30 })
      .returning({ id: kitchenCourses.id });
    const lemonade = await createProduct(tx, {
      categoryId: null,
      name: "Lemonade",
      pricingUnit: "each",
      unitPrice: "3.50",
      vatClass: "reduced",
      takeawayVatRate: options.lemonadeRate ?? "21.00",
    });
    await tx.update(products).set({ courseId: drinkCourse }).where(eq(products.id, lemonade.id));
    const ids: Record<LunchDish, string> = {
      Soup: spec.productIds.Soup,
      Hake: spec.productIds.Hake,
      Lemonade: lemonade.id,
    };
    await tx.update(products).set({ unitPrice: 550 }).where(eq(products.id, ids.Soup));
    await tx.update(products).set({ unitPrice: 1250 }).where(eq(products.id, ids.Hake));
    await setTakeawayVatRate(tx, ids.Soup, "10.00");
    await setTakeawayVatRate(tx, ids.Hake, "10.00");
    const [large] = options.largeHake
      ? await setProductVariants(
          tx,
          ids.Hake,
          [
            {
              name: "Large",
              customerName: null,
              kitchenName: null,
              image: null,
              unitPrice: "15.50",
              available: true,
            },
          ],
          "es-ES",
        )
      : [];
    const { id: menuId } = await createMenu(tx, {
      kind: "set_menu",
      name: "Lunch menu",
      setPrice: "14.00",
    });
    await addSetMenuDishes(
      tx,
      menuId,
      Object.values(ids).map((productId) => ({ productId, excludedVariantIds: [] })),
    );
    const fullMenuId = venue.tables.menuId;
    const root = await requireMenuRoot(tx, fullMenuId);
    await addMember(tx, root, { kind: "set_menu", menuId });
    if (options.soupOnMenuAt !== undefined) {
      await addMember(tx, root, { kind: "product", productId: ids.Soup });
      await tx
        .update(menuItems)
        .set({ grossPrice: options.soupOnMenuAt })
        .where(and(eq(menuItems.menuId, fullMenuId), eq(menuItems.productId, ids.Soup)));
    }
    if (large !== undefined) {
      await addMember(tx, root, { kind: "product", productId: ids.Hake });
      const [hakeItem] = await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(eq(menuItems.menuId, fullMenuId), eq(menuItems.productId, ids.Hake)));
      await tx.insert(menuItemVariantOverrides).values({
        menuItemId: hakeItem!.id,
        productId: ids.Hake,
        variantId: large.id,
        price: 1650,
      });
    }
    const listed = await tx
      .select({ id: menuItems.id, productId: menuItems.productId })
      .from(menuItems)
      .where(eq(menuItems.menuId, menuId));
    const items = Object.fromEntries(
      (Object.keys(ids) as LunchDish[]).map((dish) => [
        dish,
        listed.find(({ productId }) => productId === ids[dish])!.id,
      ]),
    ) as Record<LunchDish, string>;
    return {
      menuId,
      versionId: await publishWorkingMenu(tx, fullMenuId),
      items,
      ids,
      largeHake: large?.id,
    };
  });
  return { spec, venue, lunch };
}

/**
 * A takeaway bill with `dishes` sent from the Lunch menu, which the send groups into its Lunch
 * menus, or, with no dishes, holding `count` Lunch menus that hold none; its id.
 */
async function lunchBill(
  { spec, venue, lunch }: Awaited<ReturnType<typeof lunchVenue>>,
  dishes: readonly (LunchDish | { dish: LunchDish; variantId: string })[],
  count = 1,
): Promise<string> {
  const bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await partyTx(venue, (tx) =>
    tx.update(workingOrders).set({ dining: "takeaway" }).where(eq(workingOrders.id, bill.tabId)),
  );
  if (dishes.length === 0) {
    await partyTx(venue, async (tx) => {
      for (let lineNo = 1; lineNo <= count; lineNo++)
        await seedBillSetMenu(tx, bill.tabId, { ...lunch, name: "Lunch menu" }, lineNo);
    });
  } else {
    const draft = await saveSetMenuDraft(
      venue,
      bill,
      ...dishes.map((line) => {
        const { dish, variantId } = typeof line === "string" ? { dish: line } : line;
        return {
          menuItemId: lunch.items[dish],
          ...(variantId === undefined ? {} : { variantId }),
          menuVersionId: lunch.versionId,
          setMenuId: lunch.menuId,
          quantity: "1",
        };
      }),
    );
    await sendSpecDraft(spec, bill.partyId, draft.id);
  }
  return bill.tabId;
}

/** The bill priced for its invoice. */
function priced(venue: PartyVenue, billId: string) {
  return partyTx(venue, (tx) =>
    priceForIssuance(tx, venue.clock, venue.backend, venue.cfg, billId),
  );
}

/** Each priced line's name, total, rate and set-menu part. */
async function pricedRows(venue: PartyVenue, billId: string) {
  const { priced: lines } = await priced(venue, billId);
  return {
    rows: lines.lines.map((line) => [
      line.name,
      line.lineGross,
      line.vatRate,
      line.setMenuPart ?? null,
    ]),
    vat: lines.vatBreakdown.map(({ rate, base, tax }) => ({ rate, base, tax })),
  };
}

describe("a takeaway set menu priced for its invoice", () => {
  it("divides a set menu whose dishes' rates differ", async () => {
    const lunch = await lunchVenue();
    const billId = await lunchBill(lunch, ["Soup", "Hake", "Lemonade"]);

    expect(await pricedRows(lunch.venue, billId)).toEqual({
      rows: [
        ["Lunch menu", "0.00", "10.00", "-14.00"],
        ["Soup", "3.58", "10.00", "3.58"],
        ["Hake", "8.14", "10.00", "8.14"],
        ["Lemonade", "2.28", "21.00", "2.28"],
      ],
      vat: [
        { rate: "10.00", base: "10.65", tax: "1.07" },
        { rate: "21.00", base: "1.88", tax: "0.40" },
      ],
    });
  });

  it("files a set menu whose dishes share one rate whole at that rate", async () => {
    const lunch = await lunchVenue({ lemonadeRate: "10.00" });
    const billId = await lunchBill(lunch, ["Soup", "Hake", "Lemonade"]);

    expect(await pricedRows(lunch.venue, billId)).toEqual({
      rows: [
        ["Lunch menu", "14.00", "10.00", null],
        ["Soup", "0.00", "10.00", null],
        ["Hake", "0.00", "10.00", null],
        ["Lemonade", "0.00", "10.00", null],
      ],
      vat: [{ rate: "10.00", base: "12.73", tax: "1.27" }],
    });
  });

  it("weighs a dish by the price its menu charges for it", async () => {
    // Soup weighs 6.00, not its product's 5.50: 14.00 over 6.00, 12.50 and 3.50.
    const lunch = await lunchVenue({ soupOnMenuAt: 600 });
    const billId = await lunchBill(lunch, ["Soup", "Hake", "Lemonade"]);

    const { rows } = await pricedRows(lunch.venue, billId);
    expect(rows.map((row) => row[3])).toEqual(["-14.00", "3.82", "7.95", "2.23"]);
  });

  it("weighs a dish with no ordinary offer by its product's price when added", async () => {
    const lunch = await lunchVenue();
    await partyTx(lunch.venue, (tx) =>
      tx.update(products).set({ unitPrice: 700 }).where(eq(products.id, lunch.lunch.ids.Soup)),
    );
    const billId = await lunchBill(lunch, ["Soup", "Hake", "Lemonade"]);

    // 14.00 over 7.00, 12.50 and 3.50.
    const { rows } = await pricedRows(lunch.venue, billId);
    expect(rows.map((row) => row[3])).toEqual(["-14.00", "4.26", "7.61", "2.13"]);
  });

  it("weighs a dish by the price stored when it was added, not its product's price at issue", async () => {
    const lunch = await lunchVenue();
    const billId = await lunchBill(lunch, ["Soup", "Hake", "Lemonade"]);
    const soupPrice = (unitPrice: number) =>
      partyTx(lunch.venue, (tx) =>
        tx.update(products).set({ unitPrice }).where(eq(products.id, lunch.lunch.ids.Soup)),
      );
    await soupPrice(700);
    try {
      const { rows } = await pricedRows(lunch.venue, billId);
      expect(rows.map((row) => row[3])).toEqual(["-14.00", "3.58", "8.14", "2.28"]);
    } finally {
      await soupPrice(550);
    }
  });

  it("weighs a dish by its line's stored a la carte price, not its menu copy's offer", async () => {
    // The copy offers Soup at 6.00; its line says 7.00: 14.00 over 7.00, 12.50 and 3.50.
    const lunch = await lunchVenue({ soupOnMenuAt: 600 });
    const billId = await lunchBill(lunch, ["Soup", "Hake", "Lemonade"]);
    await partyTx(lunch.venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ aLaCarteUnitPrice: 700 })
        .where(
          and(
            eq(workingOrderLines.workingOrderId, billId),
            eq(workingOrderLines.productId, lunch.lunch.ids.Soup),
          ),
        ),
    );

    const { rows } = await pricedRows(lunch.venue, billId);
    expect(rows.map((row) => row[3])).toEqual(["-14.00", "4.26", "7.61", "2.13"]);
  });

  it("weighs a dish sold as a variant by the variant's price in the menu copy", async () => {
    // Large Hake weighs its 16.50 on the full menu, not its own 15.50: 14.00 over 5.50, 16.50, 3.50.
    const lunch = await lunchVenue({ largeHake: true });
    const billId = await lunchBill(lunch, [
      "Soup",
      { dish: "Hake", variantId: lunch.lunch.largeHake! },
      "Lemonade",
    ]);

    const { rows } = await pricedRows(lunch.venue, billId);
    expect(rows.map((row) => row[3])).toEqual(["-14.00", "3.02", "9.06", "1.92"]);
  });

  it("refuses a weighted dish with no rate on its own line, not its set menu's", async () => {
    const lunch = await lunchVenue();
    await partyTx(lunch.venue, (tx) =>
      tx
        .delete(productTakeawayVatRates)
        .where(eq(productTakeawayVatRates.productId, lunch.lunch.ids.Soup)),
    );
    const billId = await lunchBill(lunch, ["Soup", "Hake", "Lemonade"]);

    await expect(priced(lunch.venue, billId)).rejects.toMatchObject({
      code: "vat_rate.unavailable",
      params: { lineNo: 2 },
    });
  });

  it("a set menu with no priced dish takes the highest rate its copy can hold", async () => {
    // Its own takeaway label says 21%; the dishes its copy holds are at 10% and 4%.
    const lunch = await lunchVenue({ lemonadeRate: "4.00" });
    const billId = await lunchBill(lunch, []);

    expect(await pricedRows(lunch.venue, billId)).toEqual({
      rows: [["Lunch menu", "14.00", "10.00", null]],
      vat: [{ rate: "10.00", base: "12.73", tax: "1.27" }],
    });
  });

  it("refuses a set menu with no priced dish whose copy cannot be read", async () => {
    const lunch = await lunchVenue();
    const billId = await lunchBill(lunch, []);

    copyReads.mode = "throw";
    try {
      await expect(priced(lunch.venue, billId)).rejects.toMatchObject({
        code: "menu.reset_required",
      });
    } finally {
      copyReads.mode = "pass";
    }
  });

  it("refuses a set menu with no priced dish whose copy no longer holds it", async () => {
    const lunch = await lunchVenue();
    const billId = await lunchBill(lunch, []);

    copyReads.mode = "no_set_menus";
    try {
      await expect(priced(lunch.venue, billId)).rejects.toMatchObject({
        code: "menu.reset_required",
        params: { menuId: lunch.lunch.menuId },
      });
    } finally {
      copyReads.mode = "pass";
    }
  });

  it("reads no set-menu copy when a dish has a price", async () => {
    const lunch = await lunchVenue();
    const billId = await lunchBill(lunch, ["Soup", "Hake", "Lemonade"]);

    // Copies answered without their set menus: reading the set menu's copy would refuse.
    copyReads.mode = "no_set_menus";
    copyReads.count = 0;
    try {
      const { rows } = await pricedRows(lunch.venue, billId);
      expect(rows.map((row) => row[3])).toEqual(["-14.00", "3.58", "8.14", "2.28"]);
    } finally {
      copyReads.mode = "pass";
    }
    // The dishes' weights are stored on their lines.
    expect(copyReads.count).toBe(0);
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

  it("by an a la carte takeaway bill, which reads no menu copy", async () => {
    const { venue, tea, counter } = await counterVenue();
    const id = await park(venue, counter, "takeaway", [
      { menuItemId: counter.offerFor(tea), quantity: "1" },
    ]);

    copyReads.count = 0;
    await inTx(venue, (tx) => priceStoredOrderForIssuance(tx, id));

    expect(copyReads.count).toBe(0);
  });

  it("when a takeaway set-menu bill is priced, which reads no menu copy", async () => {
    const lunch = await lunchVenue();
    const billId = await lunchBill(lunch, ["Soup", "Soup", "Hake", "Lemonade", "Hake"]);

    rateReads.count = 0;
    copyReads.count = 0;
    await priced(lunch.venue, billId);

    expect(rateReads.count).toBe(1);
    expect(copyReads.count).toBe(0);
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
