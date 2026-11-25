import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { computeAdjustmentReport } from "@waitron/adjustments";
import {
  adjustmentLines,
  adjustments,
  billPayments,
  persons,
  ticketItems,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loginWithPin } from "@waitron/identity";
import { addProducts, menuItems, requireMenuRoot } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { currentBusinessDay, resolveVenueClock } from "@waitron/reporting";
import { decimal } from "@waitron/shared";
import { applyAdjustment, previewAdjustment, type AdjustmentAsk } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { selectOrderInvoice } from "./invoice-selection.js";
import { cancelItem, type CancelItemAsk } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { readDrafts, submitDraft } from "./order-drafts.js";
import { partyZone } from "./parties.js";
import { mountTillApi } from "./till-api.js";
import { readOrderRevision } from "./working-order-context.js";
import { updateHeldOrder, updateOrderLine } from "./working-order-held-write.js";
import { createOpenOrder, openTab } from "./working-order-open.js";
import {
  cancelItemForTest,
  cancelReasonId,
  ensureOperator,
  observedCancelItem,
} from "./testing/cancel-line.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  cashContribution,
  commandFor,
  inTx,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { sessionCookieForTest } from "./testing/session-device.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { capturedCardPayment, saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import {
  saveSpecDishes,
  sendSpecDraft,
  setupSetMenuSpecVenue,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

vi.mock("./invoice-selection.js", async (original) => {
  const actual = await original<typeof import("./invoice-selection.js")>();
  return { ...actual, selectOrderInvoice: vi.fn(actual.selectOrderInvoice) };
});

let spec: SpecVenue;
let venue: PartyVenue;
/** The ordinary menu's offer of each dish. */
let ordinary: Record<SpecDish, string>;

const WAITER_B = "cccccccc-0000-4000-8000-00000000b2b2";

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    await inTx(venue, async (tx) => {
      const productIds = Object.values(spec.productIds);
      await addProducts(tx, await requireMenuRoot(tx, venue.tables.menuId), productIds);
      spec.daily.versionId = spec.special.versionId = await publishWorkingMenu(
        tx,
        venue.tables.menuId,
      );
      const rows = await tx
        .select({ id: menuItems.id, productId: menuItems.productId })
        .from(menuItems)
        .where(
          and(eq(menuItems.menuId, venue.tables.menuId), inArray(menuItems.productId, productIds)),
        );
      ordinary = Object.fromEntries(
        (Object.keys(spec.productIds) as SpecDish[]).map((dish) => [
          dish,
          rows.find(({ productId }) => productId === spec.productIds[dish])!.id,
        ]),
      ) as Record<SpecDish, string>;
      await ensureOperator(tx, WAITER_B);
    });
  },
});

async function seated() {
  return seatWithNoAllergies(venue, await venue.table(randomUUID()));
}

const line = (dish: SpecDish) => ({ menuItemId: ordinary[dish], quantity: "1" });

/** Saves the dishes from the ordinary menu as one draft and sends it with `cfg`. */
async function sendDraft(
  bill: { partyId: string; tabId: string },
  dishes: SpecDish[],
  cfg = venue.cfg,
  release: "hold" | "fire" = "hold",
) {
  const saved = await saveSetMenuDraft(venue, bill, ...dishes.map(line));
  const command = await commandFor(venue, bill.partyId);
  return inTx(venue, async (tx) => {
    const draft = (await readDrafts(tx, bill.partyId)).find(({ id }) => id === saved.id)!;
    return submitDraft(tx, cfg, bill.partyId, saved.id, {
      ...command,
      submissionId: randomUUID(),
      expectedEdit: await expectedDraftEditForTest(tx, draft),
      draftRevision: draft.revision,
      groups: [{ lineIds: draft.lines.map(({ id }) => id), release }],
    });
  });
}

/** Places the dishes as one held round by `operatorId`, joining `joinGroupId` when given. */
function placeHeld(
  bill: { partyId: string; tabId: string },
  dishes: SpecDish[],
  options: { joinGroupId?: string; operatorId?: string; lines?: { menuItemId: string }[] } = {},
) {
  return inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, bill.partyId, {
      operatorId: options.operatorId ?? venue.operator.personId,
      billId: bill.tabId,
      groups: [
        {
          lines: [
            ...dishes.map(line),
            ...(options.lines ?? []).map((l) => ({ ...l, quantity: "1" })),
          ],
          release: "hold",
          ...(options.joinGroupId === undefined ? {} : { joinGroupId: options.joinGroupId }),
        },
      ],
    }),
  );
}

function productOf(row: { productId: string | null }): string | undefined {
  return (Object.keys(spec.productIds) as SpecDish[]).find(
    (dish) => spec.productIds[dish] === row.productId,
  );
}

/** Each top-level row: dish or set-menu name, role, price, set menu, set-menu row and place. */
async function saved(billId: string) {
  return (await specRows(spec, billId))
    .filter(({ parentLineId }) => parentLineId === null)
    .map((row) => ({
      id: row.id,
      what: row.setMenuRole === "set_menu" ? row.name : (productOf(row) ?? row.name),
      role: row.setMenuRole,
      price: row.unitPriceGross,
      total: row.lineTotal,
      setMenuId: row.setMenuId,
      setMenuLineId: row.setMenuLineId,
      place: row.setMenuPlace,
      creditedTo: row.creditedTo,
    }));
}

async function billTotal(billId: string) {
  return (await specRows(spec, billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

/** Soup and Hake grouped into one Daily at 14.00, each dish at 0 in its place. */
async function expectSoupAndHakeDaily(billId: string) {
  const rows = await saved(billId);
  const menus = rows.filter(({ role }) => role === "set_menu");
  expect(menus.map(({ what, price, total }) => ({ what, price, total }))).toEqual([
    { what: "Daily menu", price: 1400, total: 1400 },
  ]);
  expect(
    rows
      .filter(({ role }) => role !== "set_menu")
      .map(({ what, role, price, setMenuLineId, place }) => ({
        what,
        role,
        price,
        setMenuLineId,
        place,
      })),
  ).toEqual([
    { what: "Soup", role: "dish", price: 0, setMenuLineId: menus[0]!.id, place: 0 },
    { what: "Hake", role: "dish", price: 0, setMenuLineId: menus[0]!.id, place: 1 },
  ]);
  expect(await billTotal(billId)).toBe(1400);
}

it("groups Soup and Hake sent a la carte from a draft into a Daily at 14.00", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake"]);
  await expectSoupAndHakeDaily(bill.tabId);
});

// D10: the brief named Hake, but Hake alone is cheaper in a Daily (14.00 < 16.00) and groups at
// once; Soup alone (6.00) does not, so it shows the a la carte price kept.
it("stores a dish tapped in a set-menu folder at its a la carte price until a set menu pays (D10, D11)", async () => {
  const bill = await seated();
  const draft = await saveSpecDishes(spec, bill, [{ dish: "Soup", from: spec.daily }]);
  await sendSpecDraft(spec, draft.partyId, draft.id);
  expect(
    (await saved(bill.tabId)).map(({ what, role, price, total, setMenuId }) => ({
      what,
      role,
      price,
      total,
      setMenuId,
    })),
  ).toEqual([{ what: "Soup", role: null, price: 600, total: 600, setMenuId: spec.daily.menuId }]);

  await sendDraft(bill, ["Hake"]);
  const rows = await saved(bill.tabId);
  const [daily] = rows.filter(({ role }) => role === "set_menu");
  expect(
    rows.map(({ what, role, price, setMenuId, setMenuLineId }) => ({
      what,
      role,
      price,
      setMenuId,
      setMenuLineId,
    })),
  ).toEqual([
    {
      what: "Soup",
      role: "dish",
      price: 0,
      setMenuId: spec.daily.menuId,
      setMenuLineId: daily!.id,
    },
    { what: "Hake", role: "dish", price: 0, setMenuId: null, setMenuLineId: daily!.id },
    {
      what: "Daily menu",
      role: "set_menu",
      price: 1400,
      setMenuId: spec.daily.menuId,
      setMenuLineId: null,
    },
  ]);
  expect(await billTotal(bill.tabId)).toBe(1400);
});

it("groups a held round, and a second round joining its held group, the same way", async () => {
  const held = await seated();
  await placeHeld(held, ["Soup", "Hake"]);
  await expectSoupAndHakeDaily(held.tabId);

  const joined = await seated();
  const first = await placeHeld(joined, ["Soup"]);
  expect(await billTotal(joined.tabId)).toBe(600);
  await placeHeld(joined, ["Hake"], { joinGroupId: first.groups[0]!.id });
  await expectSoupAndHakeDaily(joined.tabId);
});

it("groups Soup and Hake on a bill opened with them, and selects its invoice at the grouped total", async () => {
  const seat = await seated();
  const tableId = await venue.table(randomUUID());
  const { tabId } = await inTx(venue, (tx) =>
    openTab(tx, venue.cfg, {
      tableId,
      lines: [line("Soup"), line("Hake")],
      partyId: seat.partyId,
      operatorId: venue.operator.personId,
    }),
  );
  await expectSoupAndHakeDaily(tabId);

  vi.mocked(selectOrderInvoice).mockClear();
  const chosen = randomUUID();
  await inTx(venue, async (tx) =>
    createOpenOrder(tx, venue.cfg, chosen, [line("Soup"), line("Hake")], null, {
      zoneId: (await partyZone(tx, seat.partyId)) ?? undefined,
      partyId: seat.partyId,
      existingService: true,
      creditedTo: venue.operator.personId,
      invoiceChoice: { invoiceType: "F2", recipient: null, recipientNameMaxLength: null },
    }),
  );
  await expectSoupAndHakeDaily(chosen);
  expect(vi.mocked(selectOrderInvoice)).toHaveBeenCalledTimes(1);
  expect(vi.mocked(selectOrderInvoice).mock.calls[0]![4]).toBe("14.00");
});

it("checks the simplified-invoice limit against the grouped total, not the a la carte prices", async () => {
  const bill = await seated();
  // A la carte, Soup and Hake are 22.00, over the limit; grouped they are 14.00.
  await sendDraft(bill, ["Soup", "Hake"], {
    ...venue.cfg,
    simplifiedInvoiceLimit: decimal("20.00"),
  });
  await expectSoupAndHakeDaily(bill.tabId);
});

it("checks the simplified-invoice limit against the grouped total when a bill opens with lines", async () => {
  const seat = await seated();
  const tableId = await venue.table(randomUUID());
  // A la carte, Soup and Hake are 22.00, over the limit; grouped they are 14.00.
  const { tabId } = await inTx(venue, (tx) =>
    openTab(
      tx,
      { ...venue.cfg, simplifiedInvoiceLimit: decimal("20.00") },
      {
        tableId,
        lines: [line("Soup"), line("Hake")],
        partyId: seat.partyId,
        operatorId: venue.operator.personId,
      },
    ),
  );
  await expectSoupAndHakeDaily(tabId);
});

it("leaves every set-menu row as it is when a send adds no dish a set menu lists", async () => {
  const bill = await seated();
  await placeHeld(bill, ["Soup", "Soup", "Hake", "Sirloin"]);
  await placeHeld(bill, ["Soup", "Soup", "Sea bass", "Sirloin"], { operatorId: WAITER_B });
  const before = await saved(bill.tabId);
  const menuOf = (rows: typeof before) =>
    rows
      .filter(({ role }) => role === "set_menu")
      .map(({ id, what, price, total, creditedTo }) => ({ id, what, price, total, creditedTo }));
  const me = venue.operator.personId;
  expect(menuOf(before).map(({ what, price, creditedTo }) => [what, price, creditedTo])).toEqual([
    ["Daily menu", 1400, me],
    ["Daily menu", 1400, me],
    ["Daily menu", 1400, WAITER_B],
    ["Special menu", 2000, WAITER_B],
  ]);
  expect(await billTotal(bill.tabId)).toBe(7200);

  await placeHeld(bill, [], { operatorId: WAITER_B, lines: [{ menuItemId: venue.item("Water") }] });

  const after = await saved(bill.tabId);
  expect(menuOf(after)).toEqual(menuOf(before));
  expect(after.filter(({ what }) => what === "Water")).toHaveLength(1);
  for (const row of before) expect(after.find(({ id }) => id === row.id)).toEqual(row);
});

/** What the bill's set menus and dishes come to: each top-level row's name, role and price. */
async function charged(billId: string) {
  return (await saved(billId)).map(({ what, role, price }) => ({ what, role, price }));
}

/** The bill's observed edit state, as the till sends it with an edit. */
function observed(billId: string) {
  return inTx(venue, async (tx) => ({
    expectedEdit: await readBillEditState(tx, billId),
    revision: await readOrderRevision(tx, billId),
  }));
}

it("works out the set menus again when a line edit adds or a basket save removes a portion", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake", "Sea bass"]);
  expect(await charged(bill.tabId)).toEqual([
    { what: "Soup", role: "dish", price: 0 },
    { what: "Hake", role: "dish", price: 0 },
    { what: "Sea bass", role: null, price: 1900 },
    { what: "Daily menu", role: "set_menu", price: 1400 },
  ]);
  const soup = (await specRows(spec, bill.tabId)).find((row) => productOf(row) === "Soup")!;

  // A second Soup forms a Special with Sea bass: 20.00 beats Soup and Sea bass a la carte, 25.00.
  await inTx(venue, async (tx) =>
    updateOrderLine(
      tx,
      venue.cfg,
      bill.tabId,
      soup.lineNo,
      { portionLineNos: [], quantity: "2" },
      await readOrderRevision(tx, bill.tabId),
      {
        admission: testTradingAdmission(),
        operatorId: venue.operator.personId,
        expectedEdit: await readBillEditState(tx, bill.tabId),
      },
    ),
  );
  const raised = await saved(bill.tabId);
  expect(raised.map(({ what, role, price }) => ({ what, role, price }))).toEqual([
    { what: "Soup", role: "dish", price: 0 },
    { what: "Hake", role: "dish", price: 0 },
    { what: "Sea bass", role: "dish", price: 0 },
    { what: "Daily menu", role: "set_menu", price: 1400 },
    { what: "Soup", role: "dish", price: 0 },
    { what: "Special menu", role: "set_menu", price: 2000 },
  ]);
  const special = raised.find(({ what }) => what === "Special menu")!;
  expect(
    raised.filter(({ setMenuLineId }) => setMenuLineId === special.id).map(({ what }) => what),
  ).toEqual(["Sea bass", "Soup"]);
  expect(await billTotal(bill.tabId)).toBe(3400);

  // updateOrderLine only raises a row (rowRise), so the added Soup goes through a basket save.
  await updateHeldOrder(
    { db: venue.db, admission: testTradingAdmission() },
    venue.cfg,
    bill.tabId,
    {
      ...(await observed(bill.tabId)),
      operatorId: venue.operator.personId,
      lines: raised
        .filter(({ role, id }) => role !== "set_menu" && id !== raised[4]!.id)
        .map(({ id, what }) => ({ workingOrderLineId: id, ...line(what as SpecDish) })),
    },
  );
  expect(await charged(bill.tabId)).toEqual([
    { what: "Soup", role: "dish", price: 0 },
    { what: "Hake", role: "dish", price: 0 },
    { what: "Sea bass", role: null, price: 1900 },
    { what: "Daily menu", role: "set_menu", price: 1400 },
  ]);
  expect(await billTotal(bill.tabId)).toBe(3300);
});

it("deletes a set menu a basket save leaves too few dishes for, with no set-menu row named", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake"]);
  await expectSoupAndHakeDaily(bill.tabId);
  const soup = (await saved(bill.tabId)).find(({ what }) => what === "Soup")!;

  await updateHeldOrder(
    { db: venue.db, admission: testTradingAdmission() },
    venue.cfg,
    bill.tabId,
    {
      ...(await observed(bill.tabId)),
      operatorId: venue.operator.personId,
      lines: [{ workingOrderLineId: soup.id, ...line("Soup") }],
    },
  );
  expect(
    (await saved(bill.tabId)).map(({ id, what, role, price, total, setMenuLineId, place }) => ({
      id,
      what,
      role,
      price,
      total,
      setMenuLineId,
      place,
    })),
  ).toEqual([
    {
      id: soup.id,
      what: "Soup",
      role: null,
      price: 600,
      total: 600,
      setMenuLineId: null,
      place: null,
    },
  ]);
  expect(await billTotal(bill.tabId)).toBe(600);
});

/** A note-only line edit on `billId`'s Soup, made while a card payment of the bill is pending. */
function noteOnSoupWhilePaying(billId: string) {
  return inTx(venue, async (tx) => {
    await tx.insert(billPayments).values({
      workingOrderId: billId,
      submissionId: randomUUID(),
      fingerprint: "pending-card-payment",
      kind: "contribution",
      method: "card",
      applied: 500,
      state: "pending",
      requestedBy: venue.operator.personId,
      source: venue.cfg.origin.source,
      deviceId: venue.cfg.origin.deviceId,
    });
    const soup = (await specRows(spec, billId)).find((row) => productOf(row) === "Soup")!;
    await updateOrderLine(
      tx,
      venue.cfg,
      billId,
      soup.lineNo,
      { portionLineNos: [], note: "No salt" },
      await readOrderRevision(tx, billId),
      {
        admission: testTradingAdmission(),
        operatorId: venue.operator.personId,
        expectedEdit: await readBillEditState(tx, billId),
      },
    );
  });
}

it("refuses a note edit that reprices an out-of-date set menu while a card payment is pending", async () => {
  const current = await seated();
  await sendDraft(current, ["Soup", "Hake"]);
  await noteOnSoupWhilePaying(current.tabId);
  expect(await billTotal(current.tabId)).toBe(1400);

  const stale = await staleDailyBill();
  await expect(noteOnSoupWhilePaying(stale.tabId)).rejects.toMatchObject({
    code: "order.payment_in_flight",
  });
  expect(await billTotal(stale.tabId)).toBe(1500);
});

/** A seated Soup and Hake bill whose Daily row was left at 15.00, as an out-of-date grouping. */
async function staleDailyBill() {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake"]);
  const daily = (await saved(bill.tabId)).find(({ role }) => role === "set_menu")!;
  await venue.db
    .update(workingOrderLines)
    .set({ unitPriceGross: 1500, lineTotal: 1500 })
    .where(eq(workingOrderLines.id, daily.id));
  return bill;
}

it("checks a bill's excess payment against the grouped total after a line edit", async () => {
  const bill = await staleDailyBill();
  // 26.00 captured against 15.00: regrouping to 14.00 would raise the excess from 11.00 to 12.00.
  await inTx(venue, (tx) => capturedCardPayment(tx, venue, bill.tabId));
  const soup = (await specRows(spec, bill.tabId)).find((row) => productOf(row) === "Soup")!;
  await expect(
    inTx(venue, async (tx) =>
      updateOrderLine(
        tx,
        venue.cfg,
        bill.tabId,
        soup.lineNo,
        { portionLineNos: [], note: "No salt" },
        await readOrderRevision(tx, bill.tabId),
        {
          admission: testTradingAdmission(),
          operatorId: venue.operator.personId,
          expectedEdit: await readBillEditState(tx, bill.tabId),
        },
      ),
    ),
  ).rejects.toMatchObject({ code: "bill.received_exceeds_total" });
  expect(await billTotal(bill.tabId)).toBe(1500);
});

it("checks the simplified-invoice limit against the grouped total when a basket save adds a dish", async () => {
  /** Adds Hake to a bill holding Soup, a la carte 22.00 and grouped 14.00, under `limit`. */
  async function addHake(limit: string) {
    const bill = await seated();
    await sendDraft(bill, ["Soup"]);
    const soup = (await saved(bill.tabId)).find(({ what }) => what === "Soup")!;
    await updateHeldOrder(
      { db: venue.db, admission: testTradingAdmission() },
      { ...venue.cfg, simplifiedInvoiceLimit: decimal(limit) },
      bill.tabId,
      {
        ...(await observed(bill.tabId)),
        operatorId: venue.operator.personId,
        lines: [{ workingOrderLineId: soup.id, ...line("Soup") }, line("Hake")],
      },
    );
    return bill;
  }
  await expectSoupAndHakeDaily((await addHake("20.00")).tabId);
  await expect(addHake("13.00")).rejects.toMatchObject({
    code: "sale.total_exceeds_simplified_limit",
  });
});

it("holds a dish added to a held bill whether or not its held dishes group into a set menu", async () => {
  /** Sends `dishes` held, then adds Water in a basket save: when Water's kitchen item was fired. */
  async function waterFiredAt(dishes: SpecDish[]) {
    const bill = await seated();
    await sendDraft(bill, dishes);
    const kept = (await saved(bill.tabId)).filter(({ role }) => role !== "set_menu");
    await updateHeldOrder(
      { db: venue.db, admission: testTradingAdmission() },
      venue.cfg,
      bill.tabId,
      {
        ...(await observed(bill.tabId)),
        operatorId: venue.operator.personId,
        lines: [
          ...kept.map(({ id, what }) => ({ workingOrderLineId: id, ...line(what as SpecDish) })),
          { menuItemId: venue.item("Water"), quantity: "1" },
        ],
      },
    );
    return venue.db
      .select({ firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(
        and(eq(workingOrderLines.workingOrderId, bill.tabId), eq(workingOrderLines.name, "Water")),
      );
  }
  expect(await waterFiredAt(["Sea bass"])).toEqual([{ firedAt: null }]);
  expect(await waterFiredAt(["Soup", "Hake"])).toEqual([{ firedAt: null }]);
});

/** `billId`'s rows of `dish`, in line order. */
async function rowsOf(billId: string, dish: SpecDish) {
  return (await specRows(spec, billId)).filter((row) => productOf(row) === dish);
}

/** Cancels the whole of `billId`'s line `lineId` through `cancelItem`, removing its charge. */
function cancelDish(billId: string, lineId: string, overrides: Partial<CancelItemAsk> = {}) {
  return inTx(venue, async (tx) => {
    const { lineNo } = (await specRows(spec, billId)).find(({ id }) => id === lineId)!;
    return cancelItemForTest(
      tx,
      venue.cfg,
      billId,
      lineNo,
      undefined,
      venue.operator.personId,
      undefined,
      overrides,
    );
  });
}

/** Cancels the portions `lineIds` of one till row through `cancelItem`, removing their charge. */
function cancelPortionsItem(billId: string, lineIds: string[]) {
  return inTx(venue, async (tx) => {
    const { lineNo } = (await specRows(spec, billId)).find(({ id }) => id === lineIds[0])!;
    const { target, lineId, body } = await observedCancelItem(
      tx,
      billId,
      lineNo,
      String(lineIds.length),
    );
    return cancelItem(
      tx,
      venue.cfg,
      target,
      lineId,
      {
        ...body,
        expectedContext: await readCancellationContext(tx, target, lineId, lineIds),
        lineIds,
        reasonId: await cancelReasonId(tx),
        admission: testTradingAdmission(),
      },
      venue.operator.personId,
    );
  });
}

/** The ask cancelling `lineIds` of `billId` as one adjustment, by `operatorId`. */
async function cancelAsk(
  tx: Transaction,
  billId: string,
  lineIds: string[],
  operatorId: string,
): Promise<AdjustmentAsk> {
  return {
    orderId: billId,
    expectedEdit: await readBillEditState(tx, billId),
    expectedRevision: await readOrderRevision(tx, billId),
    lineId: lineIds[0]!,
    ...(lineIds.length > 1 ? { lineIds, quantity: String(lineIds.length) } : {}),
    reasonId: await cancelReasonId(tx),
    action: "cancel",
    note: null,
    operatorId: await ensureOperator(tx, operatorId),
  };
}

/** Cancels `lineIds` of `billId` as one adjustment, by `operatorId`. */
function adjustmentCancel(billId: string, lineIds: string[], operatorId = venue.operator.personId) {
  return inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        ...(await cancelAsk(tx, billId, lineIds, operatorId)),
        admission: testTradingAdmission(),
        submissionId: randomUUID(),
      },
      venue.cfg.locale,
    ),
  );
}

/** What the till is shown before {@link adjustmentCancel} makes the same cancel. */
function previewCancel(billId: string, lineIds: string[], operatorId = venue.operator.personId) {
  return inTx(venue, async (tx) =>
    previewAdjustment(tx, await cancelAsk(tx, billId, lineIds, operatorId), venue.cfg.locale),
  );
}

it("works out the set menus again when cancelItem removes a dish of a Daily", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake"]);
  await cancelDish(bill.tabId, (await rowsOf(bill.tabId, "Hake"))[0]!.id);
  expect(await charged(bill.tabId)).toEqual([{ what: "Soup", role: null, price: 600 }]);
  expect(await billTotal(bill.tabId)).toBe(600);
});

it("breaks two Dailies up when cancelItem removes a dish of each, leaving both Soups a la carte", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake", "Soup", "Sirloin"]);
  expect(await billTotal(bill.tabId)).toBe(3300);
  await cancelDish(bill.tabId, (await rowsOf(bill.tabId, "Hake"))[0]!.id);
  await cancelDish(bill.tabId, (await rowsOf(bill.tabId, "Sirloin"))[0]!.id);
  // Two Soups in two Dailies would be 28.00; a la carte they are 12.00.
  expect(await charged(bill.tabId)).toEqual([
    { what: "Soup", role: null, price: 600 },
    { what: "Soup", role: null, price: 600 },
  ]);
  expect(await billTotal(bill.tabId)).toBe(1200);
});

it.each([
  ["cancelItem", cancelPortionsItem],
  ["an adjustment", (billId: string, ids: string[]) => adjustmentCancel(billId, ids)],
] as const)(
  "works out the set menus again when %s cancels a row's portions",
  async (_route, cancel) => {
    const bill = await seated();
    // Each Hake makes a Daily, one with an empty place: 28.00 beats 30.00 and 38.00.
    await sendDraft(bill, ["Soup", "Hake", "Hake"]);
    expect(await billTotal(bill.tabId)).toBe(2800);
    const hakes = (await rowsOf(bill.tabId, "Hake")).map(({ id }) => id);
    expect(hakes).toHaveLength(2);
    await cancel(bill.tabId, hakes);
    expect(await charged(bill.tabId)).toEqual([{ what: "Soup", role: null, price: 600 }]);
    expect(await billTotal(bill.tabId)).toBe(600);
  },
);

it("works out the set menus again when an adjustment cancels one dish of a Daily", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake"]);
  await adjustmentCancel(bill.tabId, [(await rowsOf(bill.tabId, "Hake"))[0]!.id]);
  expect(await charged(bill.tabId)).toEqual([{ what: "Soup", role: null, price: 600 }]);
});

it("records the bill's whole drop as a cancel's reduction, and the adjustments report counts it (D24)", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Sirloin"]);
  expect(await billTotal(bill.tabId)).toBe(1900);
  const requester = await inTx(venue, (tx) => ensureOperator(tx, randomUUID()));
  const sirloin = [(await rowsOf(bill.tabId, "Sirloin"))[0]!.id];
  const before = await saved(bill.tabId);
  // The till shows what the cancel records: Sirloin's own 5.00, and 8.00 more as Soup leaves its Daily.
  expect((await previewCancel(bill.tabId, sirloin, requester)).reduction).toBe("13.00");
  expect(await saved(bill.tabId)).toEqual(before);
  await adjustmentCancel(bill.tabId, sirloin, requester);
  expect(await billTotal(bill.tabId)).toBe(600);
  expect(
    await venue.db
      .select({
        action: adjustments.action,
        beforeAmount: adjustments.beforeAmount,
        afterAmount: adjustments.afterAmount,
        reduction: adjustments.reduction,
      })
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, bill.tabId)),
  ).toEqual([{ action: "cancel", beforeAmount: 1300, afterAmount: 0, reduction: 1300 }]);
  expect(
    await venue.db
      .select({ id: adjustmentLines.lineId })
      .from(adjustmentLines)
      .innerJoin(adjustments, eq(adjustments.id, adjustmentLines.adjustmentId))
      .where(eq(adjustments.workingOrderId, bill.tabId)),
  ).toEqual([]);
  const report = await inTx(venue, async (tx) => {
    const clock = await resolveVenueClock(tx, venue.cfg.nodeId);
    const day = currentBusinessDay(clock);
    return computeAdjustmentReport(tx, { ...clock, fromBusinessDay: day, toBusinessDay: day });
  });
  const mine = report.people.find(({ personId }) => personId === requester)!;
  expect(mine.reduction).toBe("13.00");
  expect(mine.byAction.cancel.reduction).toBe("13.00");
});

it("records the bill's whole drop as the reduction of a cancel of a row's portions (D24)", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake", "Hake"]);
  expect(await billTotal(bill.tabId)).toBe(2800);
  const hakes = (await rowsOf(bill.tabId, "Hake")).map(({ id }) => id);
  const before = await saved(bill.tabId);
  expect((await previewCancel(bill.tabId, hakes)).reduction).toBe("22.00");
  expect(await saved(bill.tabId)).toEqual(before);
  await adjustmentCancel(bill.tabId, hakes);
  expect(await billTotal(bill.tabId)).toBe(600);
  const records = await venue.db
    .select({
      action: adjustments.action,
      beforeAmount: adjustments.beforeAmount,
      afterAmount: adjustments.afterAmount,
      reduction: adjustments.reduction,
    })
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, bill.tabId));
  expect(records).toEqual([
    { action: "cancel", beforeAmount: 2200, afterAmount: 0, reduction: 2200 },
  ]);
  expect(records[0]!.beforeAmount - records[0]!.afterAmount).toBe(records[0]!.reduction);
});

it("shows and records the bill's whole drop when a cancel takes part of a line (D24)", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake"]);
  const [soup] = await rowsOf(bill.tabId, "Soup");
  const [hake] = await rowsOf(bill.tabId, "Hake");
  // No path leaves a dish line holding two portions on a seated bill (sends split them), so the
  // test writes one: Hake twice a la carte and Soup a la carte, 38.00, no Daily.
  await inTx(venue, async (tx) => {
    const alone = {
      setMenuRole: null,
      setMenuLineId: null,
      setMenuPlace: null,
      setMenuCountsAsCourseId: null,
    };
    await tx
      .update(workingOrderLines)
      .set({ ...alone, unitPriceGross: 600, lineTotal: 600 })
      .where(eq(workingOrderLines.id, soup!.id));
    await tx
      .update(workingOrderLines)
      .set({ ...alone, quantity: 2000, unitPriceGross: 1600, lineTotal: 3200 })
      .where(eq(workingOrderLines.id, hake!.id));
    await tx
      .update(ticketItems)
      .set({ quantity: 2000 })
      .where(eq(ticketItems.workingOrderLineId, hake!.id));
    await tx.delete(workingOrderLines).where(eq(workingOrderLines.id, soup!.setMenuLineId!));
  });
  expect(await billTotal(bill.tabId)).toBe(3800);
  const ask = (tx: Transaction) =>
    cancelAsk(tx, bill.tabId, [hake!.id], venue.operator.personId).then((one) => ({
      ...one,
      quantity: "1",
    }));
  const before = await saved(bill.tabId);
  // One Hake's own 16.00, and 8.00 more as the Hake left joins Soup in a Daily.
  const preview = await inTx(venue, async (tx) =>
    previewAdjustment(tx, await ask(tx), venue.cfg.locale),
  );
  expect(preview.reduction).toBe("24.00");
  expect(await saved(bill.tabId)).toEqual(before);
  await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      { ...(await ask(tx)), admission: testTradingAdmission(), submissionId: randomUUID() },
      venue.cfg.locale,
    ),
  );
  expect(await billTotal(bill.tabId)).toBe(1400);
  expect(
    await venue.db
      .select({ reduction: adjustments.reduction })
      .from(adjustments)
      .where(eq(adjustments.workingOrderId, bill.tabId)),
  ).toEqual([{ reduction: 2400 }]);
});

it("accepts a cancel on a part-paid bill the regrouped total still covers, and refuses one it does not (D25)", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake"]);
  await placeHeld(bill, [], { lines: [{ menuItemId: venue.item("Water") }] });
  const total = await billTotal(bill.tabId);
  await cashContribution(venue, bill.tabId, "14.00");

  // Hake alone keeps the Daily: 14.00 beats its own 16.00.
  const kept = await seated();
  await sendDraft(kept, ["Soup", "Hake"]);
  await placeHeld(kept, [], { lines: [{ menuItemId: venue.item("Water") }] });
  await cashContribution(venue, kept.tabId, "14.00");
  await cancelDish(kept.tabId, (await rowsOf(kept.tabId, "Soup"))[0]!.id);
  expect(await charged(kept.tabId)).toEqual([
    { what: "Hake", role: "dish", price: 0 },
    { what: "Daily menu", role: "set_menu", price: 1400 },
    { what: "Water", role: null, price: total - 1400 },
  ]);

  // Soup alone is 6.00, less than the 14.00 received.
  const before = await saved(bill.tabId);
  await expect(
    cancelDish(bill.tabId, (await rowsOf(bill.tabId, "Hake"))[0]!.id),
  ).rejects.toMatchObject({ code: "bill.received_exceeds_total" });
  expect(await saved(bill.tabId)).toEqual(before);
});

it("leaves the set menus as they are when a cancel keeps the dish's charge (D15)", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Sirloin"], venue.cfg, "fire");
  const before = await saved(bill.tabId);
  await cancelDish(bill.tabId, (await rowsOf(bill.tabId, "Sirloin"))[0]!.id, {
    outcome: "keep_charge",
    preparationStarted: true,
  });
  expect(await saved(bill.tabId)).toEqual(before);
  expect(await billTotal(bill.tabId)).toBe(1900);

  // A later send works the bill out again and leaves the kept dish and its Daily as they were.
  await placeHeld(bill, [], { lines: [{ menuItemId: venue.item("Water") }] });
  const after = await saved(bill.tabId);
  for (const row of before) expect(after.find(({ id }) => id === row.id)).toEqual(row);
});

/** The till API mounted for the venue, with the owner's session cookie. */
async function tillApp() {
  const token = await inTx(venue, async (tx) => {
    const [admin] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.email, "owner@example.test"));
    return (
      await loginWithPin(tx, {
        deviceId: venue.cfg.origin.deviceId,
        personId: admin!.id,
        pin: "1234",
      })
    ).token;
  });
  const cookie = await sessionCookieForTest(venue.db, token);
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      cfg: venue.cfg,
      venueLocale: "es-ES",
      secureCookies: false,
      admission: testTradingAdmission(),
    },
    () => {},
  );
  return { app, cookie };
}

it("no longer serves setting a count, removing a set menu or moving dishes within a bill", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake"]);
  const rows = await saved(bill.tabId);
  const menu = rows.find(({ role }) => role === "set_menu")!;
  const soup = rows.find(({ what }) => what === "Soup")!;
  const { app, cookie } = await tillApp();
  const body = {
    expectedPartyRevision: (await commandFor(venue, bill.partyId)).expectedPartyRevision,
    expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, bill.tabId)),
  };
  const send = (method: string, path: string, extra: Record<string, unknown> = {}) =>
    app.request(path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
    });
  const answers = [
    await send("PUT", `/api/bills/${bill.tabId}/set-menus/${menu.setMenuId}`, { count: 0 }),
    await send("DELETE", `/api/bills/${bill.tabId}/set-menu-lines/${menu.id}`),
    await send("POST", `/api/bills/${bill.tabId}/set-menu-moves`, {
      moves: [{ lineId: soup.id, to: { setMenuLineId: menu.id, place: 0 } }],
    }),
  ];
  expect(answers.map(({ status }) => status)).toEqual([404, 404, 404]);
  expect(await saved(bill.tabId)).toEqual(rows);
});

it("still refuses cancelling a set-menu row (set_menu.worked_out_by_bill)", async () => {
  const bill = await seated();
  await sendDraft(bill, ["Soup", "Hake"]);
  const menu = (await saved(bill.tabId)).find(({ role }) => role === "set_menu")!;
  await expect(cancelDish(bill.tabId, menu.id)).rejects.toMatchObject({
    code: "set_menu.worked_out_by_bill",
  });
});
