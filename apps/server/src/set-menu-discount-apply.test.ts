import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adjustmentEndings, createAdjustmentReason } from "@waitron/adjustments";
import { adjustments, sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { centsToDecimal, decimal } from "@waitron/shared";
import { applyAdjustment, previewAdjustment, type AdjustmentAsk } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { buildReceiptDocument } from "./receipt-document.js";
import { readSettledTicket } from "./till-sale.js";
import { readOrderRevision } from "./working-order-context.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import { inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import {
  addSpecDishesToFullMenu,
  addSpecLunch,
  lunchBill,
  printSpecBill,
  sendSpecDraft,
  setupSetMenuSpecVenue,
  specDeps,
  specDishOf,
  specRows,
  specSaleLines,
  type SpecDish,
  type SpecExtra,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
let venue: PartyVenue;
/** The ordinary menu's offer of each dish. */
let ordinary: Record<SpecDish, string>;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    ordinary = await addSpecDishesToFullMenu(spec);
  },
});

type Bill = { partyId: string; tabId: string };
type Ordered = SpecDish | { dish: SpecDish; extras: SpecExtra[] };
type Terms = Pick<AdjustmentAsk, "action" | "percentBp" | "amount">;

const FREE: Terms = { action: "comp" };
const percent = (percentBp: number): Terms => ({ action: "discount_percent", percentBp });
const off = (amount: string): Terms => ({ action: "discount_amount", amount: decimal(amount) });

/** A seated bill eaten here, its dishes sent from the ordinary menu and grouped by the bill. */
async function billOf(dishes: readonly Ordered[], release: "hold" | "fire" = "hold") {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  const draft = await saveSetMenuDraft(
    venue,
    bill,
    ...dishes.map((ordered) => {
      const { dish, extras } = typeof ordered === "string" ? { dish: ordered } : ordered;
      return { menuItemId: ordinary[dish], quantity: "1", ...(extras ? { extras } : {}) };
    }),
  );
  await sendSpecDraft(spec, draft.partyId, draft.id, release);
  return bill;
}

async function total(billId: string) {
  return (await specRows(spec, billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

/** Every row, in line order: what it is, its price and list price, and the set menu holding it. */
async function shape(billId: string) {
  const rows = await specRows(spec, billId);
  const menus = rows.filter(({ setMenuRole }) => setMenuRole === "set_menu").map(({ id }) => id);
  return rows.map((row) => ({
    what: specDishOf(spec, row) ?? row.name,
    price: row.lineTotal,
    list: row.listUnitPriceGross,
    in: row.setMenuLineId === null ? null : menus.indexOf(row.setMenuLineId),
  }));
}

async function dailyOf(billId: string) {
  return (await specRows(spec, billId)).find(({ setMenuRole }) => setMenuRole === "set_menu")!.id;
}

async function askFor(billId: string, lineId: string | null, terms: Terms): Promise<AdjustmentAsk> {
  return inTx(venue, async (tx) => ({
    orderId: billId,
    expectedEdit: await readBillEditState(tx, billId),
    expectedRevision: await readOrderRevision(tx, billId),
    lineId,
    reasonId: (
      await createAdjustmentReason(tx, { ...REASONS.house, name: `House ${randomUUID()}` })
    ).id,
    note: null,
    operatorId: venue.operator.personId,
    ...terms,
  }));
}

function apply(ask: AdjustmentAsk) {
  return inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      { ...ask, admission: specDeps(spec).admission, submissionId: randomUUID() },
      venue.cfg.locale,
    ),
  );
}

function endings() {
  return venue.db.select().from(adjustmentEndings);
}

/** Previews `terms` on the line (the whole bill when null), checking it wrote nothing, then applies
 * them; answers the preview and what the apply recorded. */
async function previewThenApply(billId: string, lineId: string | null, terms: Terms) {
  const ask = await askFor(billId, lineId, terms);
  const before = { rows: await specRows(spec, billId), endings: await endings() };
  const preview = await inTx(venue, (tx) =>
    previewAdjustment(tx, venue.cfg, ask, venue.cfg.locale),
  );
  expect({ rows: await specRows(spec, billId), endings: await endings() }).toEqual(before);
  const { adjustmentIds } = await apply(ask);
  const [record] = await venue.db
    .select({
      before: adjustments.beforeAmount,
      after: adjustments.afterAmount,
      reduction: adjustments.reduction,
    })
    .from(adjustments)
    .where(eq(adjustments.id, adjustmentIds[0]!));
  return { preview, record: record!, id: adjustmentIds[0]! };
}

describe("a comp or discount on a Soup and Sirloin Daily (19.00) covers the Sirloin's 5.00", () => {
  it.each([
    { name: "Free", terms: FREE, daily: 0, sirloin: 0, after: 0 },
    { name: "10%", terms: percent(1000), daily: 1260, sirloin: 450, after: 1710 },
    // By hand: 18.00 × 14/19 = 13.26 off the Daily and 18.00 × 5/19 = 4.74 off the Sirloin.
    { name: "18.00 off", terms: off("18.00"), daily: 74, sirloin: 26, after: 100 },
  ])("$name", async ({ terms, daily, sirloin, after }) => {
    const { tabId } = await billOf(["Soup", "Sirloin"]);
    expect(await total(tabId)).toBe(1900);

    const { preview, record } = await previewThenApply(tabId, await dailyOf(tabId), terms);

    expect(await shape(tabId)).toEqual([
      { what: "Soup", price: 0, list: null, in: 0 },
      { what: "Sirloin", price: sirloin, list: 500, in: 0 },
      { what: "Daily menu", price: daily, list: 1400, in: null },
    ]);
    expect(await total(tabId)).toBe(after);
    expect(record).toEqual({ before: 1900, after, reduction: 1900 - after });
    expect(preview.billTotal).toEqual({ before: "19.00", after: centsToDecimal(after) });
    expect(preview).not.toHaveProperty("replaces");
  });
});

it("leaves a Soup's Bread charged when its Daily is discounted", async () => {
  const { tabId } = await billOf([{ dish: "Soup", extras: [spec.bread] }, "Hake"]);
  expect(await total(tabId)).toBe(1550);

  const { preview, record } = await previewThenApply(tabId, await dailyOf(tabId), percent(1000));

  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 0, list: null, in: 0 },
    { what: "Bread", price: 150, list: null, in: null },
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Daily menu", price: 1260, list: 1400, in: null },
  ]);
  expect(await total(tabId)).toBe(1410);
  expect(record).toEqual({ before: 1400, after: 1260, reduction: 140 });
  expect(preview.billTotal.after).toBe("14.10");
});

it("replaces a Daily's 10% with 20%: the preview says so and writes nothing, the apply ends the 10%", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  const daily = await dailyOf(tabId);
  const first = await previewThenApply(tabId, daily, percent(1000));
  expect(await total(tabId)).toBe(1260);

  const second = await previewThenApply(tabId, daily, percent(2000));

  expect(second.preview).toMatchObject({
    replaces: { action: "discount_percent", percentBp: 1000, amount: "1.40" },
    reduction: "2.80",
    billTotal: { before: "12.60", after: "11.20" },
  });
  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 0, list: null, in: 0 },
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Daily menu", price: 1120, list: 1400, in: null },
  ]);
  expect(await total(tabId)).toBe(1120);
  expect(second.record).toEqual({ before: 1400, after: 1120, reduction: 280 });
  expect(await endings()).toContainEqual(
    expect.objectContaining({
      adjustmentId: first.id,
      workingOrderId: tabId,
      why: "replaced",
      dishName: "Daily menu",
      lineId: null,
    }),
  );
  expect((await endings()).filter(({ adjustmentId }) => adjustmentId === second.id)).toEqual([]);
});

it("prints a free Daily's Free of 19.00 under the Daily, its lines adding up", async () => {
  const bill = await billOf(["Soup", "Sirloin"], "fire");
  await previewThenApply(bill.tabId, await dailyOf(bill.tabId), FREE);
  await printSpecBill(spec, bill.partyId, bill.tabId);

  const ticket = await inTx(venue, (tx) =>
    readSettledTicket(venue.backend, tx, venue.cfg, bill.tabId),
  );
  const { elements } = buildReceiptDocument({
    ...FULL_INVOICE_DOCUMENT_FIXTURE,
    invoiceLocale: "en-GB",
    namesLocale: "en-GB",
    result: ticket,
  });
  const rules = elements.flatMap((element, at) => (element.kind === "rule" ? [at] : []));
  const printed = elements
    .slice(rules[2]! + 1, rules[3])
    .flatMap((element) => (element.kind === "amount" ? [[element.caption, element.amount]] : []));
  expect(printed).toEqual([
    ["1  Sirloin", "+5.00"],
    ["1  Daily menu", "14.00"],
    ["  Discount 100%", "-19.00"],
  ]);
  expect(ticket.lines.flatMap(({ adjustments }) => adjustments ?? [])).toEqual([
    { kind: "comp", amount: "19.00" },
  ]);
  expect(ticket.total).toBe("0.00");
});

it("files a takeaway Lunch at half off as its stored lines, VAT included", async () => {
  const lunch = await addSpecLunch(spec);
  const bill = await lunchBill(spec, lunch);
  expect(await total(bill.tabId)).toBe(1400);

  await previewThenApply(bill.tabId, await dailyOf(bill.tabId), percent(5000));
  const stored = await shape(bill.tabId);
  await printSpecBill(spec, bill.partyId, bill.tabId);
  const filed = await specSaleLines(spec, bill.tabId);
  const [sale] = await venue.db
    .select({ total: sales.total, vat: sales.vatBreakdown })
    .from(sales)
    .where(eq(sales.id, filed[0]!.saleId));

  expect(stored).toEqual([
    { what: "Soup", price: 0, list: null, in: 0 },
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Lemonade", price: 0, list: null, in: 0 },
    { what: "Lunch menu", price: 700, list: 1400, in: null },
  ]);
  // The Lunch's 7.00 is divided over its dishes by their a la carte prices (6.00, 16.00 and 3.50
  // of 25.50), by hand 1.65, 4.39 and 0.96; at 10% 6.04 is 5.49 and 0.55, at 21% 0.96 is 0.79 and 0.17.
  expect(
    filed.map(({ name, lineGross, vatRate, setMenuPart }) => [
      name,
      lineGross,
      vatRate,
      setMenuPart,
    ]),
  ).toEqual([
    ["Soup", 165, 1000, 165],
    ["Hake", 439, 1000, 439],
    ["Lemonade", 96, 2100, 96],
    ["Lunch menu", 0, 1000, -700],
  ]);
  expect(sale).toEqual({
    total: 700,
    vat: [
      { rate: "10.00", base: "5.49", tax: "0.55" },
      { rate: "21.00", base: "0.79", tax: "0.17" },
    ],
  });
});

describe("a whole-bill comp or discount on a bill whose Daily holds 10% previews what it applies", () => {
  it.each([
    // A whole bill is not comped: all of it off is a discount of 100%.
    { name: "100%", terms: percent(10_000) },
    { name: "10%", terms: percent(1000) },
    { name: "2.00 off", terms: off("2.00") },
  ])("$name", async ({ terms }) => {
    const { tabId } = await billOf(["Soup", "Sirloin"]);
    await apply(await askFor(tabId, await dailyOf(tabId), percent(1000)));
    expect(await total(tabId)).toBe(1710);

    const { preview, record } = await previewThenApply(tabId, null, terms);

    expect(preview.billTotal.before).toBe("17.10");
    expect({ after: preview.billTotal.after, reduction: preview.reduction }).toEqual({
      after: centsToDecimal(await total(tabId)),
      reduction: centsToDecimal(record.reduction),
    });
  });
});
