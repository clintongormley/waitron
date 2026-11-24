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
import { moveSetMenuDishes } from "./set-menu-moves.js";
import { readOrderRevision } from "./working-order-context.js";
import { insertPartyBill } from "./parties.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { splitTable } from "./testing/table-action-fixture.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { REASONS } from "./testing/adjustment-venue.js";
import {
  cashContribution,
  commandFor,
  inTx,
  join,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  sendSpecDishes,
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

// With a third Special, a new Hake draws Daily 2's +5.00 Sirloin to the Special at 0.00 unless something
// holds the Sirloin where it is.
it("the offered move never names a comped, discounted or item-paid dish", async () => {
  const offeredFor = async (fix: (billId: string, lineId: string) => Promise<unknown>) => {
    const tab = await specBill(spec);
    const third = (await setSpecCount(spec, tab.tabId, spec.special, 3)).setMenus.at(-1)!;
    const sirloin = await dishAt(tab.tabId, tab.daily[1]!, 1);
    expect(sirloin).toMatchObject({ name: "Sirloin", lineTotal: 500 });
    await fix(tab.tabId, sirloin.id);
    const state = await inTx(venue, (tx) => readBillSetMenus(tx, tab.tabId));
    const suggestion = suggestMove(state, [], {
      id: crypto.randomUUID(),
      productId: spec.productIds.Hake,
      variantId: null,
    });
    return { tab, third: third.lineId, sirloin: sirloin.id, suggestion };
  };

  const control = await offeredFor(async () => {});
  expect(control.suggestion?.moves).toEqual([
    {
      lineId: control.sirloin,
      from: { setMenuLineId: control.tab.daily[1], place: 1 },
      to: { setMenuLineId: control.third, place: 1 },
      priceCents: 0,
      countsAsCourseId: expect.any(String),
    },
  ]);
  expect(control.suggestion?.place).toMatchObject({
    setMenuLineId: control.tab.daily[1],
    place: 1,
  });

  for (const fix of [
    (billId: string, lineId: string) => adjust(billId, lineId, { action: "comp" }),
    (billId: string, lineId: string) =>
      adjust(billId, lineId, { action: "discount_percent", percentBp: 1000 }),
    async (billId: string, lineId: string) =>
      payByItems(billId, await lineNoOf(billId, lineId), "5.00"),
  ]) {
    const { third, suggestion } = await offeredFor(fix);
    expect(suggestion?.moves).toEqual([]);
    expect(suggestion?.place).toMatchObject({ setMenuLineId: third, place: 1 });
  }
});

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

/** The spec bill, and a second bill of its party holding one Daily with both places open. */
async function twoBills() {
  const tab = await specBill(spec);
  const other = await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, tab.partyId));
  const emptyDaily = (await setSpecCount(spec, other, spec.daily, 1)).setMenus[0]!.lineId;
  return { tab, other, emptyDaily };
}

async function moveAlone(partyId: string, from: string, to: string, lineIds: string[]) {
  const command = await commandFor(venue, partyId);
  return inTx(venue, (tx) => moveDishes(tx, venue.cfg, from, to, lineIds, command));
}

it("a discounted set-menu dish moves only with its set menu", async () => {
  const { tab, other, emptyDaily } = await twoBills();
  const sirloin = await dishAt(tab.tabId, tab.daily[1]!, 1);
  await adjust(tab.tabId, sirloin.id, { action: "discount_percent", percentBp: 5000 });
  const before = { from: await specRows(spec, tab.tabId), to: await specRows(spec, other) };

  await expect(moveAlone(tab.partyId, tab.tabId, other, [sirloin.id])).rejects.toMatchObject({
    code: "set_menu.move_adjusted",
    params: { dishNames: ["Sirloin"] },
  });
  expect(await specRows(spec, tab.tabId)).toEqual(before.from);
  expect(await specRows(spec, other)).toEqual(before.to);

  const leaving = await venue.table(crypto.randomUUID());
  await join(venue, tab.partyId, leaving);
  const command = await commandFor(venue, tab.partyId);
  await expect(
    inTx(venue, (tx) =>
      splitTable(
        tx,
        venue.cfg,
        tab.partyId,
        leaving,
        {
          wholeBillIds: [],
          loose: [
            { billId: other, lineIds: [emptyDaily] },
            { billId: tab.tabId, lineIds: [sirloin.id] },
          ],
        },
        command,
      ),
    ),
  ).rejects.toMatchObject({
    code: "set_menu.move_adjusted",
    params: { dishNames: ["Sirloin"] },
  });
  expect(await specRows(spec, tab.tabId)).toEqual(before.from);
  expect(await specRows(spec, other)).toEqual(before.to);
});

it("a dish whose extra is comped moves only with its set menu", async () => {
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await setSpecCount(spec, bill.tabId, spec.daily, 1);
  await sendSpecDishes(spec, bill, [{ dish: "Soup", from: spec.daily, extras: [spec.bread] }]);
  const other = await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, bill.partyId));
  await setSpecCount(spec, other, spec.daily, 1);
  const rows = await specRows(spec, bill.tabId);
  const soup = rows.find(({ name }) => name === "Soup")!;
  const bread = rows.find(({ parentLineId }) => parentLineId === soup.id)!;
  await adjust(bill.tabId, bread.id, { action: "comp" });
  const before = { from: await specRows(spec, bill.tabId), to: await specRows(spec, other) };

  await expect(moveAlone(bill.partyId, bill.tabId, other, [soup.id])).rejects.toMatchObject({
    code: "set_menu.move_adjusted",
    params: { dishNames: ["Soup"] },
  });
  expect(await specRows(spec, bill.tabId)).toEqual(before.from);
  expect(await specRows(spec, other)).toEqual(before.to);
});

it("a dish whose extra is comped stays in its set menu on its own bill", async () => {
  const soupInFirstOfTwo = async () => {
    const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
    const [first, second] = (await setSpecCount(spec, bill.tabId, spec.daily, 2)).setMenus;
    await sendSpecDishes(spec, bill, [{ dish: "Soup", from: spec.daily, extras: [spec.bread] }]);
    const rows = await specRows(spec, bill.tabId);
    const soup = rows.find(({ name }) => name === "Soup")!;
    expect(soup.setMenuLineId).toBe(first!.lineId);
    const bread = rows.find(({ parentLineId }) => parentLineId === soup.id)!;
    const movable = async () =>
      (await inTx(venue, (tx) => readBillSetMenus(tx, bill.tabId))).dishes.find(
        ({ lineId }) => lineId === soup.id,
      )!.movable;
    const move = () =>
      inTx(venue, (tx) =>
        moveSetMenuDishes(tx, venue.cfg, bill.tabId, [
          { lineId: soup.id, to: { setMenuLineId: second!.lineId, place: soup.setMenuPlace! } },
        ]),
      );
    return { bill, second: second!.lineId, soup, bread, movable, move };
  };

  const control = await soupInFirstOfTwo();
  expect(await control.movable()).toBe(true);
  await control.move();
  expect(
    (await specRows(spec, control.bill.tabId)).find(({ id }) => id === control.soup.id),
  ).toMatchObject({ setMenuLineId: control.second });

  const comped = await soupInFirstOfTwo();
  await adjust(comped.bill.tabId, comped.bread.id, { action: "comp" });
  expect(await comped.movable()).toBe(false);
  const before = await specRows(spec, comped.bill.tabId);
  await expect(comped.move()).rejects.toMatchObject({
    code: "set_menu.place_taken",
    params: { dishName: "Soup" },
  });
  expect(await specRows(spec, comped.bill.tabId)).toEqual(before);
});

it("the same dish moves with its set menu", async () => {
  const { tab, other } = await twoBills();
  const sirloin = await dishAt(tab.tabId, tab.daily[1]!, 1);
  const soup = await dishAt(tab.tabId, tab.daily[1]!, 0);
  await adjust(tab.tabId, sirloin.id, { action: "discount_percent", percentBp: 5000 });

  await moveAlone(tab.partyId, tab.tabId, other, [tab.daily[1]!, soup.id, sirloin.id]);
  const moved = await specRows(spec, other);
  expect(moved.find(({ id }) => id === sirloin.id)).toMatchObject({
    setMenuLineId: tab.daily[1],
    setMenuPlace: 1,
    lineTotal: 250,
  });
  expect(moved.find(({ id }) => id === soup.id)).toMatchObject({ setMenuLineId: tab.daily[1] });
  expect((await specRows(spec, tab.tabId)).map(({ id }) => id)).not.toContain(sirloin.id);
});
