import { eq, inArray, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { adjustmentLines, billSetMenuCopies, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  AppError,
  groupSetMenus,
  suggestMove,
  thousandthsToDecimal,
  type SetMenuGroupingInput,
} from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { readGroupingCopies, saveBillGrouping } from "./set-menu-regroup.js";
import { splitAfterPrint } from "./split-after-print.js";
import { readOrderRevision } from "./working-order-context.js";
import { GIVE_AWAY_REASON, reasonIdOf } from "./testing/cancel-line.js";
import { commandFor, inTx, type PartyVenue } from "./testing/party-venue.js";
import { markServed } from "./working-order-serving.js";
import {
  addEmptySpecSetMenus,
  printSpecBill,
  serveSpecBill,
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
  return splitAfterPrint(specDeps(spec), venue.cfg, billId, venue.operator);
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
  expect(copied.reduce((sum, { lineTotal }) => sum + lineTotal, 0)).toBe(7200);

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
  // Both Sirloins sit at +5.00 in a Daily menu; each is comped, so neither may be offered a move.
  const sirloins = (await specRows(spec, tab.tabId)).filter(({ name }) => name === "Sirloin");
  expect(sirloins).toHaveLength(2);
  for (const sirloin of sirloins) await comp(tab.tabId, sirloin.lineNo);
  await serveSpecBill(spec, tab.partyId, tab.tabId);
  await printSpecBill(spec, tab.partyId, tab.tabId);
  const movable = async (billId: string, lineId: string) =>
    (await inTx(venue, (tx) => readBillSetMenus(tx, billId))).dishes.find(
      (dish) => dish.lineId === lineId,
    )!.movable;
  for (const sirloin of sirloins) expect(await movable(tab.tabId, sirloin.id)).toBe(false);
  const old = await specRows(spec, tab.tabId);
  const { billId } = await split(tab.tabId);

  const copied = await specRows(spec, billId);
  const reductions = (lineId: string) =>
    venue.db
      .select({
        adjustmentId: adjustmentLines.adjustmentId,
        reduction: adjustmentLines.reduction,
        quantity: adjustmentLines.quantity,
      })
      .from(adjustmentLines)
      .where(inArray(adjustmentLines.lineId, [lineId]));
  for (const sirloin of sirloins) {
    const copy = copied.find(({ lineNo }) => lineNo === sirloin.lineNo)!;
    const setMenuLineNo = old.find(({ id }) => id === sirloin.setMenuLineId)!.lineNo;
    expect(copy).toMatchObject({
      name: "Sirloin",
      setMenuLineId: copied.find(({ lineNo }) => lineNo === setMenuLineNo)!.id,
      setMenuPlace: 1,
      unitPriceGross: 0,
      lineTotal: 0,
      listUnitPriceGross: 500,
    });
    const original = await reductions(sirloin.id);
    expect(original).toMatchObject([{ reduction: 500 }]);
    expect(await reductions(copy.id)).toEqual(original);
    expect(await movable(billId, copy.id)).toBe(false);
  }
  expect(copied.reduce((sum, { lineTotal }) => sum + lineTotal, 0)).toBe(6200);

  // Uncomped, an empty Special would draw a Sirloin off its +5.00 place to make room for a Hake.
  const [third] = await addEmptySpecSetMenus(spec, billId, spec.special);
  const suggestion = suggestMove(await inTx(venue, (tx) => readBillSetMenus(tx, billId)), [], {
    id: crypto.randomUUID(),
    productId: spec.productIds.Hake,
    variantId: null,
  });
  expect(suggestion?.moves).toEqual([]);
  expect(suggestion?.place).toMatchObject({ setMenuLineId: third, place: 1 });
});

it("a comped set menu splits after print with its comp", async () => {
  const tab = await specBill(spec, "fire");
  const daily = (await specRows(spec, tab.tabId)).find(({ id }) => id === tab.daily[0])!;
  expect(daily).toMatchObject({ setMenuRole: "set_menu", lineTotal: 1400 });
  await comp(tab.tabId, daily.lineNo);
  await serveSpecBill(spec, tab.partyId, tab.tabId);
  await printSpecBill(spec, tab.partyId, tab.tabId);
  const { billId } = await split(tab.tabId);

  const copied = await specRows(spec, billId);
  const copy = copied.find(({ lineNo }) => lineNo === daily.lineNo)!;
  expect(copy).toMatchObject({
    setMenuRole: "set_menu",
    unitPriceGross: 0,
    lineTotal: 0,
    listUnitPriceGross: 1400,
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
  const original = await reductions(daily.id);
  expect(original).toMatchObject([{ reduction: 1400 }]);
  expect(await reductions(copy.id)).toEqual(original);
  expect(copied.reduce((sum, { lineTotal }) => sum + lineTotal, 0)).toBe(5800);
  expect(
    copied.filter(({ setMenuLineId }) => setMenuLineId === copy.id).map(({ name }) => name),
  ).toEqual(
    (await specRows(spec, tab.tabId))
      .filter(({ setMenuLineId }) => setMenuLineId === daily.id)
      .map(({ name }) => name),
  );

  const { saleId } = await printSpecBill(spec, tab.partyId, billId);
  const refiled = (await specSaleLines(spec, billId, saleId!)).find(
    ({ lineNo }) => lineNo === daily.lineNo,
  )!;
  expect(refiled).toMatchObject({ setMenuRole: "set_menu", lineGross: 0 });
});

it("a bill whose set menus were not proven cheapest splits after print still not proven", async () => {
  const tab = await specBill(spec, "fire");
  const notProven = (input: SetMenuGroupingInput) => ({ ...groupSetMenus(input), exact: false });
  await inTx(venue, async (tx) =>
    saveBillGrouping(tx, tab.tabId, await readGroupingCopies(tx, tab.tabId), notProven),
  );
  await serveSpecBill(spec, tab.partyId, tab.tabId);
  await printSpecBill(spec, tab.partyId, tab.tabId);
  const exactOf = async (id: string) =>
    (
      await venue.db
        .select({ exact: workingOrders.setMenusExact })
        .from(workingOrders)
        .where(eq(workingOrders.id, id))
    )[0]!.exact;
  expect(await exactOf(tab.tabId)).toBe(false);
  const { billId } = await split(tab.tabId);

  expect(await exactOf(billId)).toBe(false);
  expect((await inTx(venue, (tx) => readBillSetMenus(tx, billId))).exact).toBe(false);
});

it("Reopen with stopUnserved takes a set-menu dish that never came off the new bill", async () => {
  const tab = await specBill(spec, "fire");
  const rows = await specRows(spec, tab.tabId);
  const [unserved, ...served] = rows.filter(
    ({ parentLineId, setMenuRole }) => parentLineId === null && setMenuRole !== "set_menu",
  );
  const command = await commandFor(venue, tab.partyId);
  await inTx(venue, (tx) =>
    markServed(
      tx,
      venue.cfg,
      tab.partyId,
      served.map(({ id, quantity }) => ({ lineId: id, quantity: thousandthsToDecimal(quantity) })),
      { ...command, submissionId: crypto.randomUUID() },
    ),
  );
  await printSpecBill(spec, tab.partyId, tab.tabId);

  const { billId } = await splitAfterPrint(
    specDeps(spec),
    venue.cfg,
    tab.tabId,
    venue.operator,
    true,
  );

  // One Soup fewer leaves the Sea bass without a Special menu: the bill is worked out again as a
  // waiter taking the Soup off would leave it.
  const copied = await specRows(spec, billId);
  expect(
    copied.map(({ name, setMenuRole, servedQuantity, lineTotal }) => [
      name,
      setMenuRole,
      servedQuantity,
      lineTotal,
    ]),
  ).toEqual([
    ["Soup", "dish", 1000, 0],
    ["Soup", "dish", 1000, 0],
    ["Soup", "dish", 1000, 0],
    ["Hake", "dish", 1000, 0],
    ["Sea bass", null, 1000, 1900],
    ["Sirloin", "dish", 1000, 500],
    ["Sirloin", "dish", 1000, 500],
    ["Daily menu", "set_menu", 1000, 1400],
    ["Daily menu", "set_menu", 1000, 1400],
    ["Daily menu", "set_menu", 1000, 1400],
  ]);
  expect(unserved!.name).toBe("Soup");
  const { saleId } = await printSpecBill(spec, tab.partyId, billId);
  const ticket = await specSaleLines(spec, billId, saleId!);
  expect(ticket.reduce((sum, { lineGross }) => sum + lineGross!, 0)).toBe(7100);
});

it("Reopen with stopUnserved refuses a set-menu bill nothing on which was served, writing nothing", async () => {
  const tab = await specBill(spec, "fire");
  await printSpecBill(spec, tab.partyId, tab.tabId);
  const written = () =>
    venue.db.all(sql`select
      (select count(*) from sales) as sales,
      (select count(*) from working_orders) as bills,
      (select count(*) from working_order_lines) as lines,
      (select count(*) from kitchen_notices) as notices,
      (select count(*) from line_service_cancellations) as stops`)[0];
  const before = written();

  const refused = await splitAfterPrint(
    specDeps(spec),
    venue.cfg,
    tab.tabId,
    venue.operator,
    true,
  ).catch((error: unknown) => error);

  expect(refused).toBeInstanceOf(AppError);
  expect(refused).toMatchObject({
    code: "bill.unserved_dishes",
    params: { workingOrderId: tab.tabId, canStop: false },
  });
  expect(written()).toEqual(before);
});
