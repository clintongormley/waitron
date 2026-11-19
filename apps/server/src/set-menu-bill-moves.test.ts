import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { billSetMenuCopies, kitchenCourses, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { saveSetMenuDishCourse, updateMenuDetails } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertPartyBill } from "./parties.js";
import { cancelItem } from "./line-cancel.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { advanceTicketItem, moveOrderLines, storedOrderTotal } from "./working-order.js";
import { mergeBills, moveDishes } from "./testing/bill-action-fixture.js";
import { cancelReasonId, observedCancelItem } from "./testing/cancel-line.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { commandFor, counterOrder, inTx, seatWithNoAllergies } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  saveSetMenuDraft,
  seedBillSetMenu,
  setMenuOnFullMenu,
} from "./testing/set-menu-bill-fixture.js";
import { setMenuBill, setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";

let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
let special: typeof fixture.copy;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    fixture = await setupSetMenuReaders(db);
    const { venue, copy } = fixture;
    special = await inTx(venue, async (tx) => {
      const [{ id }] = await tx
        .insert(kitchenCourses)
        .values({ name: "Sharing", displayOrder: 5 })
        .returning({ id: kitchenCourses.id });
      await saveSetMenuDishCourse(tx, copy.menuId, copy.menuItemId, id);
      return setMenuOnFullMenu(tx, copy.fullMenuId, copy.productId, "Special menu", "21.00");
    });
  },
});

async function bills() {
  const { venue } = fixture;
  const source = await setMenuBill(fixture);
  const target = await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, source.partyId));
  return { ...source, target };
}

async function move(
  source: Pick<Awaited<ReturnType<typeof bills>>, "partyId" | "billId" | "target">,
  ...lineIds: string[]
) {
  const { venue } = fixture;
  const command = await commandFor(venue, source.partyId);
  return inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, source.billId, source.target, lineIds, command),
  );
}

function lines(billId: string) {
  return fixture.venue.db
    .select({
      id: workingOrderLines.id,
      setMenuLineId: workingOrderLines.setMenuLineId,
      place: workingOrderLines.setMenuPlace,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
      versionId: workingOrderLines.setMenuVersionId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}

function copies(billId: string) {
  return fixture.venue.db
    .select({ menuId: billSetMenuCopies.setMenuId, versionId: billSetMenuCopies.menuVersionId })
    .from(billSetMenuCopies)
    .where(eq(billSetMenuCopies.workingOrderId, billId));
}

it("refuses to move the only menu with a place for a saved draft dish", async () => {
  const { venue, copy } = fixture;
  const { partyId, tabId: billId } = await seatWithNoAllergies(
    venue,
    await venue.table(crypto.randomUUID()),
  );
  const [menuLineId, target] = await inTx(venue, async (tx) => {
    const menuLineId = await seedBillSetMenu(tx, billId, copy, 1);
    return [menuLineId, await insertPartyBill(tx, venue.cfg, partyId)];
  });
  await saveSetMenuDraft(
    venue,
    { partyId, tabId: billId },
    {
      menuItemId: copy.menuItemId,
      menuVersionId: copy.versionId,
      setMenuId: copy.menuId,
      quantity: "1",
      setMenuReservedLineId: menuLineId,
      setMenuReservedPlace: 0,
    },
  );

  await expect(move({ partyId, billId, target }, menuLineId)).rejects.toMatchObject({
    code: "set_menu.needed_by_draft",
    params: { setMenuName: "Daily menu", dishNames: ["Flan"] },
  });
  expect((await lines(billId)).map(({ id }) => id)).toEqual([menuLineId]);
  expect(await lines(target)).toEqual([]);
});

it("moves a menu and its dishes together, with their original places, prices and recorded copy", async () => {
  const source = await bills();
  const { venue, copy } = fixture;
  const stayingId = await inTx(venue, async (tx) => {
    await tx
      .update(workingOrderLines)
      .set({ unitPriceGross: 500, lineTotal: 500 })
      .where(eq(workingOrderLines.id, source.dishId));
    return seedBillSetMenu(tx, source.billId, special, 3, 2100);
  });
  const before = await lines(source.billId);
  await move(source, source.menuLineId, source.dishId);
  expect(await lines(source.billId)).toEqual(before.filter(({ id }) => id === stayingId));
  expect(await lines(source.target)).toEqual(before.filter(({ id }) => id !== stayingId));
  expect(new Set(await copies(source.billId))).toEqual(
    new Set([
      { menuId: copy.menuId, versionId: copy.versionId },
      { menuId: special.menuId, versionId: special.versionId },
    ]),
  );
  expect(await copies(source.target)).toEqual([{ menuId: copy.menuId, versionId: copy.versionId }]);
});

it("places a dish moved alone on a Special and takes the target surcharge", async () => {
  const source = await bills();
  const { venue } = fixture;
  const targetMenu = await inTx(venue, (tx) =>
    seedBillSetMenu(tx, source.target, special, 1, 2100),
  );
  await inTx(venue, (tx) =>
    tx
      .update(workingOrderLines)
      .set({ unitPriceGross: 500, lineTotal: 500 })
      .where(eq(workingOrderLines.id, source.dishId)),
  );
  await move(source, source.dishId);
  expect((await lines(source.billId)).map(({ id }) => id)).toEqual([source.menuLineId]);
  expect((await lines(source.target))[1]).toEqual({
    id: source.dishId,
    setMenuLineId: targetMenu,
    place: 0,
    unitPriceGross: 0,
    lineTotal: 0,
    versionId: null,
  });
});

it("refuses a loose dish when the target has no place and leaves both bills as they were", async () => {
  const source = await bills();
  const before = await lines(source.billId);
  await expect(move(source, source.dishId)).rejects.toMatchObject({
    code: "set_menu.no_place_on_target",
    params: { dishName: "Flan" },
  });
  expect(await lines(source.billId)).toEqual(before);
  expect(await lines(source.target)).toEqual([]);
});

it("keeps the target's recorded version while the arriving line keeps its own version and price", async () => {
  const source = await bills();
  const { venue, copy } = fixture;
  const versionId = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, copy.menuId, { setPrice: "16.00" });
    const versionId = await publishWorkingMenu(tx, copy.fullMenuId);
    await seedBillSetMenu(tx, source.target, { ...copy, versionId }, 1, 1600);
    return versionId;
  });
  await move(source, source.menuLineId);
  expect(await copies(source.target)).toEqual([{ menuId: copy.menuId, versionId }]);
  expect((await lines(source.target)).slice(1)).toMatchObject([
    { id: source.menuLineId, versionId: copy.versionId, lineTotal: 1400 },
    { id: source.dishId, setMenuLineId: source.menuLineId },
  ]);
});

it("merges both menus with their places and brings across missing recorded copies", async () => {
  const source = await bills();
  const { venue, copy } = fixture;
  const otherMenu = await inTx(venue, (tx) => seedBillSetMenu(tx, source.target, special, 1, 2100));
  const command = await commandFor(venue, source.partyId);
  await inTx(venue, (tx) => mergeBills(tx, venue.cfg, source.target, source.billId, command));
  expect(await lines(source.billId)).toEqual([]);
  expect(await lines(source.target)).toMatchObject([
    { id: otherMenu, lineTotal: 2100 },
    { id: source.menuLineId, lineTotal: 1400 },
    { id: source.dishId, setMenuLineId: source.menuLineId, place: 0, lineTotal: 0 },
  ]);
  expect(await copies(source.target)).toEqual(
    expect.arrayContaining([
      { menuId: copy.menuId, versionId: copy.versionId },
      { menuId: special.menuId, versionId: special.versionId },
    ]),
  );
  expect(await copies(source.target)).toHaveLength(2);
});

it("refuses to move set-menu lines into an eat-in counter bill", async () => {
  const source = await bills();
  const { venue } = fixture;
  const counter = await counterOrder(venue, "Burger");
  await expect(
    inTx(venue, (tx) => moveOrderLines(tx, venue.cfg, source.billId, counter, undefined)),
  ).rejects.toMatchObject({ code: "set_menu.not_seated" });
  expect(await lines(source.billId)).toHaveLength(2);
  expect(await lines(counter)).toHaveLength(1);
});

async function cancelKeepingCharge(source: Awaited<ReturnType<typeof bills>>) {
  const { venue } = fixture;
  await inTx(venue, async (tx) => {
    const [ticket] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, source.dishId));
    await advanceTicketItem(tx, ticket!.id, "preparing");
    await tx
      .update(workingOrderLines)
      .set({ unitPriceGross: 500, lineTotal: 500 })
      .where(eq(workingOrderLines.id, source.dishId));
    const { target, lineId, body } = await observedCancelItem(tx, source.billId, 2);
    await cancelItem(
      tx,
      venue.cfg,
      target,
      lineId,
      {
        ...body,
        outcome: "keep_charge",
        reasonId: await cancelReasonId(tx),
        admission: testTradingAdmission(),
      },
      venue.operator.personId,
    );
  });
}

it("refuses to reprice a cancelled dish whose charge was kept", async () => {
  const source = await bills();
  const { venue } = fixture;
  await inTx(venue, (tx) => seedBillSetMenu(tx, source.target, special, 1, 2100));
  await cancelKeepingCharge(source);
  const before = await lines(source.billId);
  await expect(move(source, source.dishId)).rejects.toMatchObject({
    code: "set_menu.no_place_on_target",
  });
  expect(await lines(source.billId)).toEqual(before);
});

it("keeps a cancelled dish fixed at its charged price after moving its menu", async () => {
  const source = await bills();
  const { venue } = fixture;
  await cancelKeepingCharge(source);
  const total = (id: string) => inTx(venue, (tx) => storedOrderTotal(tx, id));
  expect(await total(source.billId)).toBe("19.00");
  await move(source, source.menuLineId);
  expect(await total(source.billId)).toBe("0.00");
  expect(await total(source.target)).toBe("19.00");
  const state = await inTx(venue, (tx) => readBillSetMenus(tx, source.target));
  expect(state.dishes).toMatchObject([
    { lineId: source.dishId, setMenuLineId: source.menuLineId, movable: false, priceCents: 500 },
  ]);
});
