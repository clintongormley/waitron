import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { sales } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createAdjustmentReason } from "@waitron/adjustments";
import { decimal, suggestMove } from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { removeSetMenuLines } from "./set-menu-count.js";
import { readOrderRevision } from "./working-order.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { cashContribution, inTx, type PartyVenue } from "./testing/party-venue.js";
import {
  setSpecCount,
  setupSetMenuSpecVenue,
  specBill,
  specDeps,
  specRows,
  specSaleLines,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
let venue: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
  },
});

type Action =
  | { action: "comp" }
  | { action: "discount_percent"; percentBp: number }
  | { action: "discount_amount"; amount: string };

/** Applies `action` to the line `lineId`, or to the whole bill when it is null, under a reason
 * with no limits. */
async function adjust(billId: string, lineId: string | null, action: Action) {
  const reason = await inTx(venue, (tx) =>
    createAdjustmentReason(tx, { ...REASONS.house, name: `House ${crypto.randomUUID()}` }),
  );
  return inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: specDeps(spec).admission,
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: crypto.randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId,
        reasonId: reason.id,
        note: null,
        operatorId: venue.operator.personId,
        ...(action.action === "discount_amount"
          ? { action: action.action, amount: decimal(action.amount) }
          : action),
      },
      venue.cfg.locale,
    ),
  );
}

async function total(billId: string) {
  return (await specRows(spec, billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

async function lineNoOf(billId: string, lineId: string) {
  return (await specRows(spec, billId)).find(({ id }) => id === lineId)!.lineNo;
}

function payByItems(billId: string, lineNo: number, amount: string) {
  return takeBillPayment(
    specDeps(spec),
    venue.cfg,
    billId,
    {
      submissionId: crypto.randomUUID(),
      tip: "0.00",
      kind: "items",
      lines: [{ lineNo }],
      method: "cash",
      tendered: amount,
      applied: amount,
    },
    venue.operator,
  );
}

function cancel(billId: string, lineId: string) {
  return inTx(venue, (tx) => removeSetMenuLines(tx, billId, [lineId]));
}

/** The dish placed on set menu `setMenuLineId` at `place`. */
async function dishAt(billId: string, setMenuLineId: string, place: number) {
  return (await specRows(spec, billId)).find(
    (row) => row.setMenuLineId === setMenuLineId && row.setMenuPlace === place,
  )!;
}

// Failed first: a set-menu line's comp was refused `set_menu.remove_from_summary`.
it("comping a set menu keeps its dishes covered", async () => {
  const tab = await specBill(spec);
  const before = await specRows(spec, tab.tabId);
  await adjust(tab.tabId, tab.daily[0]!, { action: "comp" });
  const after = await specRows(spec, tab.tabId);
  expect(after.find(({ id }) => id === tab.daily[0])).toMatchObject({
    unitPriceGross: 0,
    lineTotal: 0,
    listUnitPriceGross: 1400,
  });
  const dishes = after.filter(({ setMenuLineId }) => setMenuLineId === tab.daily[0]);
  expect(dishes.map(({ name, lineTotal }) => [name, lineTotal])).toEqual([
    ["Soup", 0],
    ["Hake", 0],
  ]);
  expect(after.filter(({ id }) => id !== tab.daily[0])).toEqual(
    before.filter(({ id }) => id !== tab.daily[0]),
  );
  expect(await total(tab.tabId)).toBe(5900);
});

// Passed at once: a surcharged dish is an ordinary priced line.
it("a discount on a surcharge", async () => {
  const tab = await specBill(spec);
  const sirloin = await dishAt(tab.tabId, tab.daily[1]!, 1);
  expect(sirloin).toMatchObject({ name: "Sirloin", lineTotal: 500 });
  await adjust(tab.tabId, sirloin.id, { action: "discount_percent", percentBp: 5000 });
  expect(await dishAt(tab.tabId, tab.daily[1]!, 1)).toMatchObject({
    id: sirloin.id,
    lineTotal: 250,
    listUnitPriceGross: 500,
  });
  expect(await total(tab.tabId)).toBe(7050);
});

// Passed at once: the bill-wide discount never went through the set-menu line refusal.
it("a bill discount spreads over set menus and surcharges and the ticket matches", async () => {
  const tab = await specBill(spec, "fire");
  const before = await specRows(spec, tab.tabId);
  await adjust(tab.tabId, null, { action: "discount_percent", percentBp: 1000 });
  const after = await specRows(spec, tab.tabId);
  expect(await total(tab.tabId)).toBe(6570);
  for (const row of before.filter(({ lineTotal }) => lineTotal === 0)) {
    expect(after.find(({ id }) => id === row.id)).toEqual(row);
  }
  for (const row of after.filter(({ setMenuRole }) => setMenuRole === "set_menu")) {
    expect(row.lineTotal).toBeLessThan(row.listUnitPriceGross!);
  }
  expect((await dishAt(tab.tabId, tab.daily[1]!, 1)).lineTotal).toBeLessThan(500);

  await takeBillPayment(
    specDeps(spec),
    venue.cfg,
    tab.tabId,
    {
      submissionId: crypto.randomUUID(),
      tip: "0.00",
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "65.70",
      applied: "65.70",
    },
    venue.operator,
  );
  const filed = await specSaleLines(spec, tab.tabId);
  expect(filed.map(({ name, quantity, lineGross }) => [name, quantity, lineGross])).toEqual(
    after.map(({ name, quantity, lineTotal }) => [name, quantity, lineTotal]),
  );
  const [sale] = await venue.db
    .select({ total: sales.total })
    .from(sales)
    .where(eq(sales.workingOrderId, tab.tabId));
  expect(sale!.total).toBe(6570);
});

// Failed first: − deleted the item-paid set menu and kept the unpaid empty one.
it("an item-paid set menu cannot be removed, by − or by Cancel", async () => {
  const tab = await specBill(spec);
  const [, , , , third, fourth] = (await setSpecCount(spec, tab.tabId, spec.daily, 4)).setMenus;
  await payByItems(tab.tabId, await lineNoOf(tab.tabId, fourth!.lineId), "14.00");

  const removed = await setSpecCount(spec, tab.tabId, spec.daily, 3);
  expect(removed.setMenus.map(({ lineId }) => lineId)).not.toContain(third!.lineId);
  expect(removed.setMenus.map(({ lineId }) => lineId)).toContain(fourth!.lineId);

  const before = await specRows(spec, tab.tabId);
  const fourthLineNo = await lineNoOf(tab.tabId, fourth!.lineId);
  await expect(setSpecCount(spec, tab.tabId, spec.daily, 2)).rejects.toMatchObject({
    code: "bill.line_paid",
    params: { workingOrderId: tab.tabId, lineNo: fourthLineNo },
  });
  expect(await specRows(spec, tab.tabId)).toEqual(before);
  await expect(cancel(tab.tabId, fourth!.lineId)).rejects.toMatchObject({
    code: "bill.line_paid",
    params: { workingOrderId: tab.tabId, lineNo: fourthLineNo },
  });
  expect(await specRows(spec, tab.tabId)).toEqual(before);
});

// Failed first, at the comp: a set-menu line's comp was refused `set_menu.remove_from_summary`.
// The removal itself was already allowed.
it("a comped empty set menu can be removed", async () => {
  const tab = await specBill(spec);
  const [, , , , third, fourth] = (await setSpecCount(spec, tab.tabId, spec.daily, 4)).setMenus;
  await adjust(tab.tabId, fourth!.lineId, { action: "comp" });
  await adjust(tab.tabId, third!.lineId, { action: "comp" });

  const lowered = await setSpecCount(spec, tab.tabId, spec.daily, 3);
  expect(lowered.setMenus.map(({ lineId }) => lineId)).not.toContain(fourth!.lineId);
  const cancelled = await cancel(tab.tabId, third!.lineId);
  expect(cancelled.setMenus.map(({ lineId }) => lineId)).toEqual([...tab.daily, ...tab.special]);
  expect(await total(tab.tabId)).toBe(7300);
});

// Passed at once: removal does not look at adjustments.
it("after a bill discount, an empty set menu can still be removed", async () => {
  const tab = await specBill(spec);
  const added = (await setSpecCount(spec, tab.tabId, spec.daily, 3)).setMenus.at(-1)!;
  await adjust(tab.tabId, null, { action: "discount_percent", percentBp: 1000 });
  const discounted = await total(tab.tabId);
  const removedLine = (await specRows(spec, tab.tabId)).find(({ id }) => id === added.lineId)!;
  expect(removedLine.lineTotal).toBeLessThan(1400);

  const after = await setSpecCount(spec, tab.tabId, spec.daily, 2);
  expect(after.setMenus.map(({ lineId }) => lineId)).toEqual([...tab.daily, ...tab.special]);
  expect(await total(tab.tabId)).toBe(discounted - removedLine.lineTotal);
});

// Passed at once: `movable` already counted comps, discounts and item payments. The plan's
// case comped Special 2's Sirloin, but that dish is covered at 0.00 and cannot be comped,
// discounted or paid by items (`adjustment.no_reduction`); on this fixture only a 0.00 dish is
// ever offered a move. So the fixed dish here is the surcharged Sirloin, and the suggestion part
// is the control.
it("the offered move never names a comped, discounted or item-paid dish", async () => {
  const sirloinFixedBy = async (fix: (billId: string, lineId: string) => Promise<unknown>) => {
    const tab = await specBill(spec);
    const sirloin = await dishAt(tab.tabId, tab.daily[1]!, 1);
    await fix(tab.tabId, sirloin.id);
    const state = await inTx(venue, (tx) => readBillSetMenus(tx, tab.tabId));
    return state.dishes.find(({ lineId }) => lineId === sirloin.id)!.movable;
  };
  expect(await sirloinFixedBy(async () => {})).toBe(true);
  expect(await sirloinFixedBy((billId, lineId) => adjust(billId, lineId, { action: "comp" }))).toBe(
    false,
  );
  expect(
    await sirloinFixedBy((billId, lineId) =>
      adjust(billId, lineId, { action: "discount_percent", percentBp: 1000 }),
    ),
  ).toBe(false);
  expect(
    await sirloinFixedBy(async (billId, lineId) =>
      payByItems(billId, await lineNoOf(billId, lineId), "5.00"),
    ),
  ).toBe(false);

  const tab = await specBill(spec);
  const third = (await setSpecCount(spec, tab.tabId, spec.daily, 3)).setMenus.at(-1)!;
  const covered = await dishAt(tab.tabId, tab.special[1]!, 1);
  expect(covered).toMatchObject({ name: "Sirloin", lineTotal: 0 });
  await expect(adjust(tab.tabId, covered.id, { action: "comp" })).rejects.toMatchObject({
    code: "adjustment.no_reduction",
  });
  const state = await inTx(venue, (tx) => readBillSetMenus(tx, tab.tabId));
  const suggestion = suggestMove(state, [], {
    id: crypto.randomUUID(),
    productId: spec.productIds["Sea bass"],
    variantId: null,
  });
  expect(suggestion?.moves).toEqual([
    {
      lineId: covered.id,
      from: { setMenuLineId: tab.special[1], place: 1 },
      to: { setMenuLineId: third.lineId, place: 1 },
      priceCents: 500,
      countsAsCourseId: expect.any(String),
    },
  ]);
  expect(suggestion?.place).toMatchObject({ setMenuLineId: tab.special[1], place: 1 });
});

// Passed at once: `deleteEmptyMenus` already ran `assertBillInvariant`.
it("an empty set menu is removed from a bill holding a contribution while the money fits", async () => {
  for (const [contribution, outcome] of [
    ["60.00", "accepted"],
    ["80.00", "bill.received_exceeds_total"],
  ] as const) {
    const tab = await specBill(spec);
    await setSpecCount(spec, tab.tabId, spec.daily, 3);
    expect(await total(tab.tabId)).toBe(8700);
    await cashContribution(venue, tab.tabId, contribution);
    const before = await specRows(spec, tab.tabId);
    const result = await setSpecCount(spec, tab.tabId, spec.daily, 2).then(
      () => "accepted",
      (error: { code?: string }) => error.code,
    );
    expect(result).toBe(outcome);
    if (outcome === "accepted") expect(await total(tab.tabId)).toBe(7300);
    else expect(await specRows(spec, tab.tabId)).toEqual(before);
  }
});
