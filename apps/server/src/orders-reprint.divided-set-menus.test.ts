import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { kitchenCourses, printers, printJobs, products, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPinThrottle } from "@waitron/identity";
import { addSetMenuDishes, createProduct, menuItems, setTakeawayVatRate } from "@waitron/menu";
import { creditWholeInvoice, readOrderInvoice } from "./cancel-credit.js";
import { enqueueReceiptCopy, readOriginalReceiptPrint } from "./receipt-print.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { readSettledTicket, type TillSaleResult } from "./till-sale.js";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { splitAfterPrint } from "./split-after-print.js";
import { readOrderRevision } from "./working-order-context.js";
import { COMP_BILL_REASON, GIVE_AWAY_REASON, reasonIdOf } from "./testing/cancel-line.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { inTx, order, type PartyVenue } from "./testing/party-venue.js";
import {
  addSpecLunch,
  lunchBill,
  printSpecBill,
  serveSpecBill,
  setupSetMenuSpecVenue,
  specDeps,
  sendSpecDishes,
  specRows,
  type SpecLunch,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

// VAT rates piece B, S9: the 80 mm ticket of a takeaway set menu whose price was divided between
// dishes at 10% and 21% (the plan's worked example), as first printed, reprinted and credited.
let spec: SpecVenue;
let venue: PartyVenue;
let lunch: SpecLunch;
/** The Lunch menu's Bread roll: a dish at 0.00, so with no weight, taken away at 21%. */
let rollItem: string;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
  },
});

beforeAll(async () => {
  lunch = await addSpecLunch(spec);
  await inTx(venue, async (tx) => {
    for (const [dish, price] of [
      ["Soup", 550],
      ["Hake", 1250],
    ] as const)
      await tx
        .update(products)
        .set({ unitPrice: price })
        .where(eq(products.id, spec.productIds[dish]));
    const [water] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, "Water"));
    await setTakeawayVatRate(tx, water!.id, "10.00");
    const roll = await createProduct(tx, {
      categoryId: null,
      name: "Bread roll",
      pricingUnit: "each",
      unitPrice: "0.00",
      vatClass: "reduced",
      takeawayVatRate: "21.00",
    });
    const [{ id: bread }] = await tx
      .insert(kitchenCourses)
      .values({ name: "Bread", displayOrder: 40 })
      .returning({ id: kitchenCourses.id });
    await tx.update(products).set({ courseId: bread }).where(eq(products.id, roll.id));
    await addSetMenuDishes(tx, lunch.menuId, [{ productId: roll.id, excludedVariantIds: [] }]);
    const [item] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(and(eq(menuItems.menuId, lunch.menuId), eq(menuItems.productId, roll.id)));
    rollItem = item!.id;
    lunch.versionId = await publishWorkingMenu(tx, venue.tables.menuId);
  });
});

/** Comps the bill's line `lineId` whole, under the give-away reason, or takes `percentBp` off it. */
function adjustLine(billId: string, lineId: string, percentBp?: number) {
  return inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: crypto.randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId,
        note: null,
        ...(percentBp === undefined
          ? { reasonId: await reasonIdOf(tx, GIVE_AWAY_REASON), action: "comp" as const }
          : {
              reasonId: await reasonIdOf(tx, COMP_BILL_REASON),
              action: "discount_percent" as const,
              percentBp,
            }),
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
}

async function saleIdOf(billId: string) {
  const [sale] = await venue.db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.workingOrderId, billId));
  return sale!.id;
}

/** The printed lines from the first item to the end of the VAT table, spaces collapsed. */
function itemsAndVat(text: string): string[] {
  const lines = text.split("\n").map((line) => line.replace(/\s+/gu, " ").trim());
  const total = lines.findIndex((line) => /^TOTAL/iu.test(line));
  // The items start after the last line giving a date and time.
  const dated = lines
    .slice(0, total)
    .map((line) => /\d{4}, \d{2}:\d{2}$/u.test(line))
    .lastIndexOf(true);
  const first = dated + 1;
  const vat = lines.slice(total + 1).filter((line) => /\d+ ?%/u.test(line));
  return [
    ...lines.slice(first, total).filter((line) => line !== "" && !/^-+$/u.test(line)),
    ...vat,
  ];
}

const printer = async () => {
  const [{ id }] = await venue.db.select({ id: printers.id }).from(printers);
  return { id: id!, paperWidth: "80mm" as const, resolution: "203dpi" as const };
};

async function printed(ticket: TillSaleResult, saleId: string): Promise<string> {
  const queued = await inTx(venue, async (tx) =>
    enqueueReceiptCopy(tx, venue.cfg, ticket, saleId, await printer()),
  );
  const [job] = await venue.db.select().from(printJobs).where(eq(printJobs.id, queued!.jobId));
  return decodeTicket(job!.payload);
}

/** The bill's first ticket as printed, and as reprinted, marked a copy, through each receipt read. */
async function prints(billId: string) {
  const saleId = await saleIdOf(billId);
  const queued = await inTx(venue, (tx) => readOriginalReceiptPrint(tx, saleId));
  if (queued.status === "not_queued") throw new Error("the bill queued no receipt");
  const [first] = await venue.db
    .select({ payload: printJobs.payload })
    .from(printJobs)
    .where(eq(printJobs.id, queued.jobId));
  return {
    saleId,
    original: decodeTicket(first!.payload),
    settled: await printed(
      await inTx(venue, (tx) => readSettledTicket(venue.backend, tx, venue.cfg, billId)),
      saleId,
    ),
    bySaleId: await printed(
      await inTx(venue, (tx) => readTransactionReceipt(venue.backend, tx, venue.cfg, saleId)),
      saleId,
    ),
  };
}

/** The bill's line called `name`, in the set menu or not. */
async function lineOf(billId: string, name: string) {
  return (await specRows(spec, billId)).find((row) => row.name === name)!;
}

function lemonadeAt(rate: string) {
  return inTx(venue, (tx) => setTakeawayVatRate(tx, lunch.lemonadeId, rate));
}

/** Hake costs `cents` more in the Lunch menu; answers the published copy's id. */
async function hakeSupplement(cents: number | null) {
  return inTx(venue, async (tx) => {
    await tx.update(menuItems).set({ grossPrice: cents }).where(eq(menuItems.id, lunch.items.Hake));
    return publishWorkingMenu(tx, venue.tables.menuId);
  });
}

const DIVIDED = [
  "1 Soup A",
  "1 Hake A",
  "1 Lemonade B",
  "1 Lunch menu 14,00",
  "A 10% 10,65 1,07 11,72",
  "B 21% 1,88 0,40 2,28",
];

describe("a takeaway set menu divided between 10% and 21%", () => {
  it("prints the set menu at 14.00 with no letter and its dishes with their letters and no amount, and reprints it the same", async () => {
    const bill = await lunchBill(spec, lunch);
    await printSpecBill(spec, bill.partyId, bill.tabId);
    const { original, settled, bySaleId } = await prints(bill.tabId);
    expect(itemsAndVat(original)).toEqual(DIVIDED);
    expect(itemsAndVat(settled)).toEqual(itemsAndVat(original));
    expect(itemsAndVat(bySaleId)).toEqual(itemsAndVat(original));
  });

  it("prints a 2.00 supplement on hake with a plus and hake's letter", async () => {
    const [before] = await venue.db
      .select({ grossPrice: menuItems.grossPrice })
      .from(menuItems)
      .where(eq(menuItems.id, lunch.items.Hake));
    const versionId = await hakeSupplement(200);
    try {
      const bill = await lunchBill(spec, lunch, versionId);
      await printSpecBill(spec, bill.partyId, bill.tabId);
      const { original, settled, bySaleId } = await prints(bill.tabId);
      expect(itemsAndVat(original)).toEqual([
        "1 Soup A",
        "1 Hake +2,00 A",
        "1 Lemonade B",
        "1 Lunch menu 14,00",
        "A 10% 12,47 1,25 13,72",
        "B 21% 1,88 0,40 2,28",
      ]);
      expect(itemsAndVat(settled)).toEqual(itemsAndVat(original));
      expect(itemsAndVat(bySaleId)).toEqual(itemsAndVat(original));
    } finally {
      lunch.versionId = await hakeSupplement(before!.grossPrice);
    }
  });

  it("prints a 10% discount on the set menu as 14.00 and −1.40, and reprints it the same", async () => {
    const bill = await lunchBill(spec, lunch);
    await adjustLine(bill.tabId, (await lineOf(bill.tabId, "Lunch menu")).id, 1000);
    await printSpecBill(spec, bill.partyId, bill.tabId);
    const { original, settled, bySaleId } = await prints(bill.tabId);
    expect(itemsAndVat(original)).toEqual([
      "1 Soup A",
      "1 Hake A",
      "1 Lemonade B",
      "1 Lunch menu 14,00",
      expect.stringMatching(/^Descuento 10 ?% -1,40$/u),
      "A 10% 9,59 0,96 10,55",
      "B 21% 1,69 0,36 2,05",
    ]);
    expect(itemsAndVat(settled)).toEqual(itemsAndVat(original));
    expect(itemsAndVat(bySaleId)).toEqual(itemsAndVat(original));
  });

  it("reprints its first print after the bill was split after printing", async () => {
    const bill = await lunchBill(spec, lunch);
    await serveSpecBill(spec, bill.partyId, bill.tabId);
    await printSpecBill(spec, bill.partyId, bill.tabId);
    const before = await prints(bill.tabId);
    await splitAfterPrint(specDeps(spec), venue.cfg, bill.tabId, {
      ...venue.operator,
      attempts: { throttle: createPinThrottle(), slot: "split" },
    });
    const bySaleId = await printed(
      await inTx(venue, (tx) =>
        readTransactionReceipt(venue.backend, tx, venue.cfg, before.saleId),
      ),
      before.saleId,
    );
    expect(itemsAndVat(before.original)).toEqual(DIVIDED);
    expect(itemsAndVat(bySaleId)).toEqual(itemsAndVat(before.original));
  });

  it("prints its credit note the same, negated", async () => {
    const bill = await lunchBill(spec, lunch);
    await printSpecBill(spec, bill.partyId, bill.tabId);
    const creditId = await inTx(venue, async (tx) =>
      creditWholeInvoice(tx, specDeps(spec), venue.cfg, (await readOrderInvoice(tx, bill.tabId))!, {
        sessionId: venue.operator.sessionId,
      }),
    );
    const credit = await printed(
      await inTx(venue, (tx) => readTransactionReceipt(venue.backend, tx, venue.cfg, creditId)),
      creditId,
    );
    expect(itemsAndVat(credit)).toEqual([
      "-1 Soup A",
      "-1 Hake A",
      "-1 Lemonade B",
      "-1 Lunch menu -14,00",
      "A 10% -10,65 -1,07 -11,72",
      "B 21% -1,88 -0,40 -2,28",
    ]);
  });

  it("with a free water beside it, a reprint still pairs with the bill and prints the first print", async () => {
    const bill = await lunchBill(spec, lunch);
    await order(venue, bill.tabId, "Water");
    await adjustLine(bill.tabId, (await lineOf(bill.tabId, "Water")).id);
    await printSpecBill(spec, bill.partyId, bill.tabId);
    const { original, settled, bySaleId } = await prints(bill.tabId);
    expect(itemsAndVat(original)).toEqual([
      "1 Soup A",
      "1 Hake A",
      "1 Lemonade B",
      "1 Lunch menu 14,00",
      "1 Agua mineral 2,00 A",
      expect.stringMatching(/^Descuento 100 ?% -2,00 A$/u),
      // 14.00 shared 12.25 : 1.75 by menu price, the 12.25 divided 3.13, 7.12 and 2.00.
      "A 10% 10,91 1,09 12,00",
      "B 21% 1,65 0,35 2,00",
    ]);
    expect(itemsAndVat(settled)).toEqual(itemsAndVat(original));
    expect(itemsAndVat(bySaleId)).toEqual(itemsAndVat(original));
  });

  it("lists a dish with no weight under its divided set menu, with the letter of the rate it is filed at", async () => {
    const bill = await lunchBill(spec, lunch, lunch.versionId, [rollItem]);
    await printSpecBill(spec, bill.partyId, bill.tabId);
    const { original, settled, bySaleId } = await prints(bill.tabId);
    expect(itemsAndVat(original)).toEqual([
      "1 Lunch menu 14,00",
      "1 Soup A",
      "1 Hake A",
      "1 Lemonade B",
      "1 Bread roll B",
      "A 10% 10,65 1,07 11,72",
      "B 21% 1,88 0,40 2,28",
    ]);
    expect(itemsAndVat(settled)).toEqual(itemsAndVat(original));
    expect(itemsAndVat(bySaleId)).toEqual(itemsAndVat(original));
  });

  it("lists a dish with no weight under its divided set menu when a one-rate set menu is on the same bill", async () => {
    const bill = await lunchBill(spec, lunch, lunch.versionId, [rollItem]);
    const daily = { ...spec.daily, versionId: lunch.versionId };
    await sendSpecDishes(spec, bill, [
      { dish: "Soup", from: daily },
      { dish: "Hake", from: daily },
    ]);
    await printSpecBill(spec, bill.partyId, bill.tabId);
    const { original, settled, bySaleId } = await prints(bill.tabId);
    expect(itemsAndVat(original)).toEqual([
      "1 Lunch menu 14,00",
      "1 Soup A",
      "1 Hake A",
      "1 Lemonade B",
      "1 Bread roll B",
      "1 Daily menu 14,00 A",
      "A 10% 23,38 2,34 25,72",
      "B 21% 1,88 0,40 2,28",
    ]);
    expect(itemsAndVat(settled)).toEqual(itemsAndVat(original));
    expect(itemsAndVat(bySaleId)).toEqual(itemsAndVat(original));
    const creditId = await inTx(venue, async (tx) =>
      creditWholeInvoice(tx, specDeps(spec), venue.cfg, (await readOrderInvoice(tx, bill.tabId))!, {
        sessionId: venue.operator.sessionId,
      }),
    );
    const credit = await printed(
      await inTx(venue, (tx) => readTransactionReceipt(venue.backend, tx, venue.cfg, creditId)),
      creditId,
    );
    expect(itemsAndVat(credit)).toContain("-1 Bread roll B");
  });

  it("prints a set menu whose dishes share one rate as today (control)", async () => {
    await lemonadeAt("10.00");
    try {
      const bill = await lunchBill(spec, lunch);
      await printSpecBill(spec, bill.partyId, bill.tabId);
      const { original, settled, bySaleId } = await prints(bill.tabId);
      expect(itemsAndVat(original)).toEqual(["1 Lunch menu 14,00", "10% 12,73 1,27 14,00"]);
      expect(itemsAndVat(settled)).toEqual(itemsAndVat(original));
      expect(itemsAndVat(bySaleId)).toEqual(itemsAndVat(original));
    } finally {
      await lemonadeAt("21.00");
    }
  });
});
