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
import { readOrderRevision } from "./working-order-context.js";
import { insertPartyBill } from "./parties.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { splitTable } from "./testing/table-action-fixture.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { REASONS } from "./testing/adjustment-venue.js";
import {
  commandFor,
  inTx,
  join,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  addEmptySpecSetMenus,
  sendSpecDishes,
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

/** The spec bill's first Sirloin, placed at 5.00 in a Daily menu. */
async function firstSirloin(billId: string) {
  const sirloin = (await specRows(spec, billId)).find(({ name }) => name === "Sirloin")!;
  expect(sirloin).toMatchObject({ setMenuRole: "dish", setMenuPlace: 1, lineTotal: 500 });
  return sirloin;
}

/** The spec bill's Daily menu holding Hake: Soup and Hake, 14.00 with no supplement. */
async function hakeDaily(billId: string) {
  return (await specRows(spec, billId)).find(({ name }) => name === "Hake")!.setMenuLineId!;
}

/** The dish placed on set menu `setMenuLineId` at `place`. */
async function dishAt(billId: string, setMenuLineId: string, place: number) {
  return (await specRows(spec, billId)).find(
    (row) => row.setMenuLineId === setMenuLineId && row.setMenuPlace === place,
  )!;
}

it("comping a set menu keeps its dishes covered", async () => {
  const tab = await specBill(spec);
  const daily = await hakeDaily(tab.tabId);
  const before = await specRows(spec, tab.tabId);
  await adjust(tab.tabId, daily, { action: "comp" });
  const after = await specRows(spec, tab.tabId);
  expect(after.find(({ id }) => id === daily)).toMatchObject({
    unitPriceGross: 0,
    lineTotal: 0,
    listUnitPriceGross: 1400,
  });
  const dishes = after.filter(({ setMenuLineId }) => setMenuLineId === daily);
  expect(dishes.map(({ name, lineTotal }) => [name, lineTotal])).toEqual([
    ["Soup", 0],
    ["Hake", 0],
  ]);
  expect(after.filter(({ id }) => id !== daily)).toEqual(before.filter(({ id }) => id !== daily));
  expect(await total(tab.tabId)).toBe(5800);
});

it("a discount on a surcharge", async () => {
  const tab = await specBill(spec);
  const sirloin = await firstSirloin(tab.tabId);
  await adjust(tab.tabId, sirloin.id, { action: "discount_percent", percentBp: 5000 });
  expect(await dishAt(tab.tabId, sirloin.setMenuLineId!, 1)).toMatchObject({
    id: sirloin.id,
    lineTotal: 250,
    listUnitPriceGross: 500,
  });
  expect(await total(tab.tabId)).toBe(6950);
});

it("a bill discount spreads over set menus and surcharges and the ticket matches", async () => {
  const tab = await specBill(spec, "fire");
  const sirloin = await firstSirloin(tab.tabId);
  const before = await specRows(spec, tab.tabId);
  await adjust(tab.tabId, null, { action: "discount_percent", percentBp: 1000 });
  const after = await specRows(spec, tab.tabId);
  expect(await total(tab.tabId)).toBe(6480);
  for (const row of before.filter(({ lineTotal }) => lineTotal === 0)) {
    expect(after.find(({ id }) => id === row.id)).toEqual(row);
  }
  for (const row of after.filter(({ setMenuRole }) => setMenuRole === "set_menu")) {
    expect(row.lineTotal).toBeLessThan(row.listUnitPriceGross!);
  }
  expect((await dishAt(tab.tabId, sirloin.setMenuLineId!, 1)).lineTotal).toBeLessThan(500);

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
      tendered: "64.80",
      applied: "64.80",
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
  expect(sale!.total).toBe(6480);
});

// With an empty Special, a new Hake draws the Daily's +5.00 Sirloin to the Special at 0.00 unless
// something holds the Sirloin where it is.
it("the offered move never names a comped or discounted dish", async () => {
  const offeredFor = async (fix: (billId: string, lineId: string) => Promise<unknown>) => {
    const tab = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
    await sendSpecDishes(spec, tab, [
      { dish: "Soup", from: spec.daily },
      { dish: "Sirloin", from: spec.daily },
    ]);
    const [third] = await addEmptySpecSetMenus(spec, tab.tabId, spec.special);
    const sirloin = await firstSirloin(tab.tabId);
    await fix(tab.tabId, sirloin.id);
    const state = await inTx(venue, (tx) => readBillSetMenus(tx, tab.tabId));
    const suggestion = suggestMove(state, [], {
      id: crypto.randomUUID(),
      productId: spec.productIds.Hake,
      variantId: null,
    });
    return { daily: sirloin.setMenuLineId!, third: third!, sirloin: sirloin.id, suggestion };
  };

  const control = await offeredFor(async () => {});
  expect(control.suggestion?.moves).toEqual([
    {
      lineId: control.sirloin,
      from: { setMenuLineId: control.daily, place: 1 },
      to: { setMenuLineId: control.third, place: 1 },
      priceCents: 0,
      countsAsCourseId: expect.any(String),
    },
  ]);
  expect(control.suggestion?.place).toMatchObject({
    setMenuLineId: control.daily,
    place: 1,
  });

  for (const fix of [
    (billId: string, lineId: string) => adjust(billId, lineId, { action: "comp" }),
    (billId: string, lineId: string) =>
      adjust(billId, lineId, { action: "discount_percent", percentBp: 1000 }),
  ]) {
    const { third, suggestion } = await offeredFor(fix);
    expect(suggestion?.moves).toEqual([]);
    expect(suggestion?.place).toMatchObject({ setMenuLineId: third, place: 1 });
  }
});

/** The spec bill, and a second bill of its party holding one Daily with both places open. */
async function twoBills() {
  const tab = await specBill(spec);
  const other = await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, tab.partyId));
  const [emptyDaily] = await addEmptySpecSetMenus(spec, other, spec.daily);
  return { tab, other, emptyDaily: emptyDaily! };
}

async function moveAlone(partyId: string, from: string, to: string, lineIds: string[]) {
  const command = await commandFor(venue, partyId);
  return inTx(venue, (tx) => moveDishes(tx, venue.cfg, from, to, lineIds, command));
}

it("a discounted set-menu dish moves only with its set menu", async () => {
  const { tab, other, emptyDaily } = await twoBills();
  const sirloin = await firstSirloin(tab.tabId);
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
  await sendSpecDishes(spec, bill, [
    { dish: "Soup", from: spec.daily, extras: [spec.bread] },
    { dish: "Hake", from: spec.daily },
  ]);
  const other = await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, bill.partyId));
  await addEmptySpecSetMenus(spec, other, spec.daily);
  const rows = await specRows(spec, bill.tabId);
  const soup = rows.find(({ name }) => name === "Soup")!;
  expect(soup).toMatchObject({ setMenuRole: "dish", setMenuPlace: 0 });
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

it("the same dish moves with its set menu", async () => {
  const { tab, other } = await twoBills();
  const sirloin = await firstSirloin(tab.tabId);
  const daily = sirloin.setMenuLineId!;
  const soup = await dishAt(tab.tabId, daily, 0);
  await adjust(tab.tabId, sirloin.id, { action: "discount_percent", percentBp: 5000 });

  await moveAlone(tab.partyId, tab.tabId, other, [daily, soup.id, sirloin.id]);
  const moved = await specRows(spec, other);
  expect(moved.find(({ id }) => id === sirloin.id)).toMatchObject({
    setMenuLineId: daily,
    setMenuPlace: 1,
    lineTotal: 250,
  });
  expect(moved.find(({ id }) => id === soup.id)).toMatchObject({ setMenuLineId: daily });
  expect((await specRows(spec, tab.tabId)).map(({ id }) => id)).not.toContain(sirloin.id);
});
