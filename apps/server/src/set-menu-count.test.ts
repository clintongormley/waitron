import { seedPendingCardPayment } from "./testing/bill-payment-fixture.js";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { billSetMenuCopies, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal } from "@waitron/shared";
import { readBillBalance } from "./bill-payments.js";
import { removeSetMenuLines, setSetMenuCount } from "./set-menu-count.js";
import { advanceTicketItem, storedOrderTotal } from "./working-order.js";
import { cancelItemForTest } from "./testing/cancel-line.js";
import { cashContribution, inTx, order, seatWithNoAllergies } from "./testing/party-venue.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import { setMenuBill, setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";

let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    fixture = await setupSetMenuReaders(db);
  },
});

async function emptyBill() {
  const { venue } = fixture;
  return seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
}

function setCount(billId: string, count: number, limit: string | null = null) {
  const { venue, copy } = fixture;
  const cfg = { ...venue.cfg, simplifiedInvoiceLimit: limit === null ? null : decimal(limit) };
  return inTx(venue, (tx) =>
    setSetMenuCount(tx, cfg, billId, copy.menuId, count, venue.operator.personId),
  );
}

function cancel(billId: string, lineId: string) {
  return inTx(fixture.venue, (tx) => removeSetMenuLines(tx, billId, [lineId]));
}

function rowsOf(billId: string) {
  return fixture.venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}

it("charges both empty menus and stores their copy, service marks, prices and VAT classes", async () => {
  const { venue, copy } = fixture;
  const { tabId } = await emptyBill();
  const state = await setCount(tabId, 2);
  expect(state.recorded).toEqual({ [copy.menuId]: copy.versionId });
  const rows = await rowsOf(tabId);
  expect(rows).toMatchObject(
    [1, 2].map((lineNo) => ({
      lineNo,
      name: "Daily menu",
      descriptions: { "es-ES": "Daily menu" },
      quantity: 1000,
      unitPriceGross: 1400,
      lineTotal: 1400,
      vatClass: "reduced",
      takeawayVatClass: "general",
      sentAt: expect.any(String),
      servedAt: expect.any(String),
      servedQuantity: 1000,
      creditedTo: venue.operator.personId,
      groupId: null,
      courseId: null,
      setMenuRole: "set_menu",
      setMenuId: copy.menuId,
      setMenuVersionId: copy.versionId,
    })),
  );
  expect(await inTx(venue, (tx) => storedOrderTotal(tx, tabId))).toBe("28.00");
  expect((await setCount(tabId, 2)).setMenus).toEqual(state.setMenus);
});

it("lowers the count by taking the newest empty menu first and leaves the occupied menu", async () => {
  const { billId, menuLineId, dishId } = await setMenuBill(fixture);
  const {
    setMenus: [, older, newest],
  } = await setCount(billId, 3);
  const lowered = await setCount(billId, 2);
  expect(lowered.setMenus.map(({ lineId }) => lineId)).toEqual([menuLineId, older!.lineId]);
  const rows = await rowsOf(billId);
  expect(rows.map(({ id }) => id)).toEqual([menuLineId, dishId, older!.lineId]);
  expect(rows.some(({ id }) => id === newest!.lineId)).toBe(false);

  await expect(setCount(billId, 0)).rejects.toMatchObject({
    code: "set_menu.holds_dishes",
    params: { setMenuName: "Daily menu", dishNames: ["Flan"] },
  });
  expect(await rowsOf(billId)).toEqual(rows);
});

it("refuses Cancel for a menu holding a dish, then allows it once the started dish is cancelled", async () => {
  const { venue } = fixture;
  const { billId, menuLineId, dishId } = await setMenuBill(fixture);
  await expect(cancel(billId, menuLineId)).rejects.toMatchObject({
    code: "set_menu.holds_dishes",
    params: { setMenuName: "Daily menu", dishNames: ["Flan"] },
  });
  await inTx(venue, async (tx) => {
    const [ticket] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, dishId));
    await advanceTicketItem(tx, ticket!.id, "preparing");
    await cancelItemForTest(tx, venue.cfg, billId, 2);
  });
  expect((await cancel(billId, menuLineId)).setMenus).toEqual([]);
  expect(await rowsOf(billId)).toEqual([]);
});

it("refuses minus and Cancel when a saved dish would lose its only place", async () => {
  const { venue, copy } = fixture;
  const bill = await emptyBill();
  const {
    setMenus: [menu],
  } = await setCount(bill.tabId, 1);
  await saveSetMenuDraft(venue, bill, {
    menuItemId: copy.menuItemId,
    menuVersionId: copy.versionId,
    setMenuId: copy.menuId,
    quantity: "1",
  });
  const refusal = {
    code: "set_menu.needed_by_draft",
    params: { setMenuName: "Daily menu", dishNames: ["Flan"] },
  };
  await expect(setCount(bill.tabId, 0)).rejects.toMatchObject(refusal);
  await expect(cancel(bill.tabId, menu!.lineId)).rejects.toMatchObject(refusal);
  expect((await rowsOf(bill.tabId)).map(({ id }) => id)).toEqual([menu!.lineId]);
});

it("allows minus when the draft dish has a place on the remaining menu", async () => {
  const { venue, copy } = fixture;
  const bill = await emptyBill();
  const {
    setMenus: [first, second],
  } = await setCount(bill.tabId, 2);
  await saveSetMenuDraft(venue, bill, {
    menuItemId: copy.menuItemId,
    menuVersionId: copy.versionId,
    setMenuId: copy.menuId,
    quantity: "1",
    setMenuReservedLineId: second!.lineId,
    setMenuReservedPlace: 0,
  });
  expect((await setCount(bill.tabId, 1)).setMenus).toEqual([first]);
});

it("keeps a previous part payment when an empty set menu is added and cancelled", async () => {
  const { venue } = fixture;
  const { tabId } = await emptyBill();
  await order(venue, tabId, "Burger");
  const firstPayment = await cashContribution(venue, tabId, "1.00");
  const {
    setMenus: [menu],
  } = await setCount(tabId, 1);
  await expect(cashContribution(venue, tabId, "1.00")).rejects.toMatchObject({
    code: "set_menu.payment_not_ready",
  });

  await cancel(tabId, menu!.lineId);
  expect(await inTx(venue, (tx) => readBillBalance(tx, tabId))).toMatchObject({
    total: "12.00",
    received: "1.00",
    reserved: "0.00",
    outstanding: "11.00",
    payments: [{ id: firstPayment }],
  });
});

it("refuses a count change while payment is in flight", async () => {
  const { venue } = fixture;
  const { tabId } = await emptyBill();
  await inTx(venue, (tx) => seedPendingCardPayment(tx, tabId));
  await expect(setCount(tabId, 1)).rejects.toMatchObject({ code: "order.payment_in_flight" });
  expect(await rowsOf(tabId)).toEqual([]);
});

it("rolls back both the menus and their copy when the count would cross the invoice limit", async () => {
  const { venue } = fixture;
  const { tabId } = await emptyBill();
  await expect(setCount(tabId, 2, "20.00")).rejects.toMatchObject({
    code: "sale.total_exceeds_simplified_limit",
  });
  expect(await rowsOf(tabId)).toEqual([]);
  expect(
    await venue.db
      .select()
      .from(billSetMenuCopies)
      .where(eq(billSetMenuCopies.workingOrderId, tabId)),
  ).toEqual([]);
});
