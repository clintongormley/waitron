import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { adjustmentLines, billSetMenuCopies } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createPinThrottle } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { suggestMove } from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { splitAfterPrint } from "./split-after-print.js";
import { readOrderRevision } from "./working-order.js";
import { GIVE_AWAY_REASON, reasonIdOf } from "./testing/cancel-line.js";
import { inTx, type PartyVenue } from "./testing/party-venue.js";
import {
  printSpecBill,
  serveSpecBill,
  setSpecCount,
  setupSetMenuSpecVenue,
  specBill,
  specDeps,
  specRows,
  specSaleLines,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

let spec: SpecVenue;
let venue: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
  },
});

/** The spec bill, served and printed: answers the bill and the sale its ticket filed. */
async function printedBill() {
  const tab = await specBill(spec, "fire");
  await serveSpecBill(spec, tab.partyId, tab.tabId);
  const { saleId } = await printSpecBill(spec, tab.partyId, tab.tabId);
  return { ...tab, saleId: saleId! };
}

function split(billId: string) {
  return splitAfterPrint(specDeps(spec), venue.cfg, billId, {
    ...venue.operator,
    attempts: { throttle: createPinThrottle(), slot: "split" },
  });
}

/** Comps line `lineNo` of the bill whole, under the give-away reason. */
async function comp(billId: string, lineNo: number) {
  const line = (await specRows(spec, billId)).find((row) => row.lineNo === lineNo)!;
  await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: crypto.randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId: line.id,
        reasonId: await reasonIdOf(tx, GIVE_AWAY_REASON),
        action: "comp",
        note: null,
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
}

/** `value` with every old line id swapped for its copy's: the copies keep their lines' order. */
async function asCopied<T>(fromBillId: string, toBillId: string, value: T): Promise<T> {
  const from = await specRows(spec, fromBillId);
  const to = await specRows(spec, toBillId);
  expect(to).toHaveLength(from.length);
  let text = JSON.stringify(value);
  for (const [index, row] of from.entries()) text = text.replaceAll(row.id, to[index]!.id);
  return JSON.parse(text) as T;
}

function recordedCopies(billId: string) {
  return venue.db
    .select({ setMenuId: billSetMenuCopies.setMenuId, version: billSetMenuCopies.menuVersionId })
    .from(billSetMenuCopies)
    .where(eq(billSetMenuCopies.workingOrderId, billId))
    .orderBy(billSetMenuCopies.setMenuId);
}

it("a printed set-menu bill splits after print", async () => {
  const tab = await printedBill();
  const firstTicket = await specSaleLines(spec, tab.tabId, tab.saleId);
  const old = await specRows(spec, tab.tabId);
  const { billId } = await split(tab.tabId);

  const copied = await specRows(spec, billId);
  const newIds = new Set(copied.map(({ id }) => id));
  expect(
    copied.map(({ name, setMenuRole, setMenuPlace, unitPriceGross, lineTotal }) => [
      name,
      setMenuRole,
      setMenuPlace,
      unitPriceGross,
      lineTotal,
    ]),
  ).toEqual(
    old.map(({ name, setMenuRole, setMenuPlace, unitPriceGross, lineTotal }) => [
      name,
      setMenuRole,
      setMenuPlace,
      unitPriceGross,
      lineTotal,
    ]),
  );
  const dishes = copied.filter(({ setMenuRole }) => setMenuRole === "dish");
  expect(dishes).toHaveLength(8);
  for (const dish of dishes) {
    expect(newIds.has(dish.setMenuLineId!)).toBe(true);
    expect(copied.find(({ id }) => id === dish.setMenuLineId)!.setMenuRole).toBe("set_menu");
  }
  expect(copied.reduce((sum, { lineTotal }) => sum + lineTotal, 0)).toBe(7300);

  const before = await inTx(venue, (tx) => readBillSetMenus(tx, tab.tabId));
  const after = await inTx(venue, (tx) => readBillSetMenus(tx, billId));
  expect(after).toEqual(await asCopied(tab.tabId, billId, before));
  expect(await recordedCopies(billId)).toEqual(await recordedCopies(tab.tabId));
  expect(await recordedCopies(billId)).toHaveLength(2);

  const { saleId } = await printSpecBill(spec, tab.partyId, billId);
  const ticket = (lines: Awaited<ReturnType<typeof specSaleLines>>) =>
    lines.map(({ name, quantity, unitPrice, vatRate, lineTotal, lineGross }) => ({
      name,
      quantity,
      unitPrice,
      vatRate,
      lineTotal,
      lineGross,
    }));
  expect(ticket(await specSaleLines(spec, billId, saleId!))).toEqual(ticket(firstTicket));
});

it("a comped set-menu dish splits after print with its comp", async () => {
  const tab = await specBill(spec, "fire");
  const sirloin = (await specRows(spec, tab.tabId)).find(
    ({ name, setMenuLineId }) => name === "Sirloin" && setMenuLineId === tab.daily[1],
  )!;
  await comp(tab.tabId, sirloin.lineNo);
  await serveSpecBill(spec, tab.partyId, tab.tabId);
  await printSpecBill(spec, tab.partyId, tab.tabId);
  const movable = async (billId: string, lineId: string) =>
    (await inTx(venue, (tx) => readBillSetMenus(tx, billId))).dishes.find(
      (dish) => dish.lineId === lineId,
    )!.movable;
  expect(await movable(tab.tabId, sirloin.id)).toBe(false);
  const { billId } = await split(tab.tabId);

  const copied = await specRows(spec, billId);
  const copy = copied.find(({ lineNo }) => lineNo === sirloin.lineNo)!;
  expect(copy).toMatchObject({
    name: "Sirloin",
    setMenuLineId: copied.find(({ lineNo }) => lineNo === 2)!.id,
    setMenuPlace: 1,
    unitPriceGross: 0,
    lineTotal: 0,
    listUnitPriceGross: 500,
  });
  const reductions = (lineId: string) =>
    venue.db
      .select({
        adjustmentId: adjustmentLines.adjustmentId,
        reduction: adjustmentLines.reduction,
        quantity: adjustmentLines.quantity,
      })
      .from(adjustmentLines)
      .where(inArray(adjustmentLines.lineId, [lineId]));
  const original = await reductions(sirloin.id);
  expect(original).toMatchObject([{ reduction: 500 }]);
  expect(await reductions(copy.id)).toEqual(original);
  expect(copied.reduce((sum, { lineTotal }) => sum + lineTotal, 0)).toBe(6800);

  expect(await movable(billId, copy.id)).toBe(false);
  // Uncomped, a third Special would draw the Sirloin off its +5.00 place to make room for a Hake.
  const third = (await setSpecCount(spec, billId, spec.special, 3)).setMenus.at(-1)!;
  const suggestion = suggestMove(await inTx(venue, (tx) => readBillSetMenus(tx, billId)), [], {
    id: crypto.randomUUID(),
    productId: spec.productIds.Hake,
    variantId: null,
  });
  expect(suggestion?.moves).toEqual([]);
  expect(suggestion?.place).toMatchObject({ setMenuLineId: third.lineId, place: 1 });
});
