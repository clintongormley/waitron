import { and, eq, type Query } from "drizzle-orm";
import { SQLiteSelectBase } from "drizzle-orm/sqlite-core";
import { expect, it, vi } from "vitest";
import {
  adjustmentLines,
  billPaymentLines,
  billSetMenuCopies,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { recordAdjustment } from "@waitron/adjustments";
import { decimal } from "@waitron/shared";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addMember,
  createMenu,
  requireMenuRoot,
  saveSetMenuDishCourse,
  updateMenuDetails,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { listZoneOffers } from "@waitron/venue-service";
import {
  readBillSetMenus,
  refuseUnlessSetMenuBill,
  setMenuDishColumns,
  setMenuLineDescriptions,
} from "./set-menu-bill.js";
import { setMenuOfferLookup } from "./set-menu-offers.js";
import { createCourse } from "./kitchen.js";
import {
  cashContribution,
  counterOrder,
  inTx,
  order,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { seedBillSetMenu, setMenuOnFullMenu } from "./testing/set-menu-bill-fixture.js";

let venue: PartyVenue;
let daily: Awaited<ReturnType<typeof setMenuOnFullMenu>>;
let special: typeof daily;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
    const fullMenuId = venue.tables.menuId;
    [daily, special] = await inTx(venue, async (tx) => {
      const daily = await setMenuOnFullMenu(tx, fullMenuId, venue.productId("Flan"));
      const special = await setMenuOnFullMenu(
        tx,
        fullMenuId,
        venue.productId("Water"),
        "Special menu",
        "21.00",
      );
      return [daily, special];
    });
  },
});

async function tableBill() {
  return (await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()))).tabId;
}

const read = (id: string) => inTx(venue, (tx) => readBillSetMenus(tx, id));

async function placeDish(id: string, setMenuLineId: string) {
  await order(venue, id, "Flan");
  return inTx(venue, async (tx) => {
    const [{ id: lineId }] = await tx
      .update(workingOrderLines)
      .set({
        setMenuRole: "dish",
        setMenuId: daily.menuId,
        setMenuLineId,
        setMenuPlace: 0,
        setMenuCountsAsCourseId: daily.courseId,
        unitPriceGross: 0,
        lineTotal: 0,
      })
      .where(
        and(
          eq(workingOrderLines.workingOrderId, id),
          eq(workingOrderLines.productId, daily.productId),
        ),
      )
      .returning({ id: workingOrderLines.id });
    return lineId;
  });
}

it("admits a seated bill and refuses an eat-in counter order", async () => {
  const seated = await tableBill();
  const counter = await counterOrder(venue, "Burger");
  await inTx(venue, (tx) => refuseUnlessSetMenuBill(tx, seated));
  await expect(inTx(venue, (tx) => refuseUnlessSetMenuBill(tx, counter))).rejects.toMatchObject({
    code: "set_menu.not_seated",
  });
});

it("admits a takeaway counter order", async () => {
  const id = await counterOrder(venue, "Burger");
  await inTx(venue, (tx) =>
    tx.update(workingOrders).set({ dining: "takeaway" }).where(eq(workingOrders.id, id)),
  );
  await inTx(venue, (tx) => refuseUnlessSetMenuBill(tx, id));
});

it("reads the old copy and the copy a moved line brought with it", async () => {
  const id = await tableBill();
  const lineId = await inTx(venue, (tx) => seedBillSetMenu(tx, id, daily, 1));
  const dishId = await placeDish(id, lineId);
  const next = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, daily.menuId, { setPrice: "16.00" });
    const versionId = await publishWorkingMenu(tx, daily.fullMenuId);
    const lineId = await seedBillSetMenu(tx, id, { ...daily, versionId }, 3, 1600);
    return { versionId, lineId };
  });
  const state = await read(id);
  expect(state.recorded).toEqual({ [daily.menuId]: daily.versionId });
  expect(state.copies.map(({ versionId, priceCents }) => [versionId, priceCents])).toEqual([
    [daily.versionId, 1400],
    [next.versionId, 1600],
  ]);
  expect(state.setMenus).toEqual([
    { lineId, lineNo: 1, copyId: state.copies[0]!.id },
    { lineId: next.lineId, lineNo: 3, copyId: state.copies[1]!.id },
  ]);
  expect(state.dishes).toEqual([
    {
      lineId: dishId,
      productId: daily.productId,
      variantId: null,
      setMenuLineId: lineId,
      place: 0,
      priceCents: 0,
      countsAsCourseId: daily.courseId,
      movable: true,
    },
  ]);
});

it("returns one copy when the recorded copy and another full-menu version have the same contents", async () => {
  const id = await tableBill();
  await inTx(venue, (tx) => seedBillSetMenu(tx, id, daily, 1));
  await inTx(venue, (tx) => seedBillSetMenu(tx, id, { ...daily, versionId: special.versionId }, 2));
  const state = await read(id);
  expect(state.recorded).toEqual({ [daily.menuId]: daily.versionId });
  expect(state.copies).toHaveLength(1);
  expect(state.setMenus.map(({ copyId }) => copyId)).toEqual([
    state.copies[0]!.id,
    state.copies[0]!.id,
  ]);
});

function observeMenuVersionReads() {
  const queries: Query[] = [];
  const prototype = SQLiteSelectBase.prototype as unknown as {
    _prepare(oneTime?: boolean): unknown;
    toSQL(): Query;
  };
  const prepare = prototype._prepare;
  const observed = vi.spyOn(prototype, "_prepare").mockImplementation(function (
    this: { toSQL(): Query },
    oneTime,
  ) {
    const query = this.toSQL();
    if (query.sql.includes('from "menu_versions"')) queries.push(query);
    return prepare.call(this, oneTime);
  });
  return { queries, restore: () => observed.mockRestore() };
}

it("does not read a menu document for an ordinary bill", async () => {
  const id = await tableBill();
  await order(venue, id, "Burger");
  const { queries, restore } = observeMenuVersionReads();
  try {
    expect(await read(id)).toEqual({ copies: [], recorded: {}, setMenus: [], dishes: [] });
    expect(queries).toHaveLength(0);
  } finally {
    restore();
  }
});

it("keeps a paid dish placed but makes it unavailable for moves", async () => {
  const id = await tableBill();
  await order(venue, id, "Burger");
  const payment = await cashContribution(venue, id, "2.00");
  const setLineId = await inTx(venue, (tx) => seedBillSetMenu(tx, id, daily, 2));
  const dishId = await placeDish(id, setLineId);
  await inTx(venue, (tx) =>
    tx.insert(billPaymentLines).values({
      billPaymentId: payment,
      lineId: dishId,
      quantity: 1000,
      amount: 0,
    }),
  );
  expect((await read(id)).dishes).toMatchObject([{ lineId: dishId, movable: false }]);
});

const asked = (copy: typeof daily, versionId = copy.versionId) => ({
  setMenuId: copy.menuId,
  menuVersionId: versionId,
  menuItemId: copy.menuItemId,
});

it("uses the recorded copy for its type and a live copy for another type", async () => {
  const id = await tableBill();
  await inTx(venue, (tx) => seedBillSetMenu(tx, id, daily, 1));
  await inTx(venue, async (tx) => {
    const { id: startersId } = await createCourse(tx, { name: "Starters", displayOrder: 6 });
    await saveSetMenuDishCourse(tx, special.menuId, special.menuItemId, startersId);
    const live = await publishWorkingMenu(tx, special.fullMenuId);
    const zone = await listZoneOffers(tx, venue.tables.zoneId);
    const oldDish = asked(daily);
    const newDish = asked(special, live);
    const lookup = await setMenuOfferLookup(tx, id, [oldDish, newDish], zone.menus);
    expect(lookup.offerFor(oldDish)).toMatchObject({
      fromRecordedCopy: true,
      copy: { versionId: daily.versionId, priceCents: 1400 },
      offer: { id: daily.menuItemId, menuId: daily.fullMenuId },
    });
    expect(lookup.offerFor(newDish)).toMatchObject({
      fromRecordedCopy: false,
      copy: { versionId: live, priceCents: 2100 },
      offer: { id: special.menuItemId, menuId: special.fullMenuId, courseId: startersId },
    });
  });
});

it.each([false, true])(
  "refuses a stale tapped version when a bill has a recorded copy: %s",
  async (recorded) => {
    const id = await tableBill();
    await inTx(venue, async (tx) => {
      const zone = await listZoneOffers(tx, venue.tables.zoneId);
      if (recorded)
        await tx.insert(billSetMenuCopies).values({
          workingOrderId: id,
          setMenuId: daily.menuId,
          menuVersionId: special.versionId,
        });
      await expect(setMenuOfferLookup(tx, id, [asked(daily)], zone.menus)).rejects.toMatchObject({
        code: "menu.version_changed",
        params: {
          menus: [
            {
              menuId: daily.fullMenuId,
              liveVersionId: zone.menus.find(({ id }) => id === daily.fullMenuId)!.versionId,
            },
          ],
        },
      });
    });
  },
);

it("returns a name for each invoice language using the menu name where its customer name is absent", async () => {
  expect(
    setMenuLineDescriptions(
      { name: "Daily menu", terms: { names: { es: "Menu of the day", en: " " } } },
      ["es-ES", "en"],
    ),
  ).toEqual({ "es-ES": "Menu of the day", en: "Daily menu" });
});

it.each([false, true])(
  "keeps the place of a cancelled dish only when its charge was kept: %s",
  async (chargeKept) => {
    const id = await tableBill();
    const setMenuLineId = await inTx(venue, (tx) => seedBillSetMenu(tx, id, daily, 1));
    const lineId = await placeDish(id, setMenuLineId);
    await inTx(venue, (tx) =>
      recordAdjustment(tx, {
        workingOrderId: id,
        line: {
          id: lineId,
          name: "Flan",
          quantity: "1",
          listUnitPriceGross: decimal("0.00"),
          creditedTo: null,
          stage: "fired",
        },
        quantity: "1",
        reason: {
          id: "cancel",
          name: "Cancel",
          policy: {
            kind: "void",
            actions: ["cancel"],
            maxAmount: null,
            maxPercentBp: null,
            maxBillComp: null,
            noteRequired: false,
          },
        },
        action: "cancel",
        chargeKept,
        percentBp: null,
        beforeAmount: decimal("0.00"),
        afterAmount: decimal("0.00"),
        reduction: decimal("0.00"),
        nominalValue: decimal("0.00"),
        requestedBy: venue.operator.personId,
        approvedBy: null,
        note: null,
      }),
    );
    expect((await read(id)).dishes.map((dish) => dish.lineId)).toEqual(chargeKept ? [lineId] : []);
  },
);

it("keeps a dish reduced by a bill-wide discount placed but unavailable for moves", async () => {
  const id = await tableBill();
  const setMenuLineId = await inTx(venue, (tx) => seedBillSetMenu(tx, id, daily, 1));
  const lineId = await placeDish(id, setMenuLineId);
  await inTx(venue, async (tx) => {
    const adjustmentId = await recordAdjustment(tx, {
      workingOrderId: id,
      line: null,
      quantity: null,
      reason: {
        id: "discount",
        name: "Discount",
        policy: {
          kind: "comp",
          actions: ["discount_amount"],
          maxAmount: null,
          maxPercentBp: null,
          maxBillComp: null,
          noteRequired: false,
        },
      },
      action: "discount_amount",
      percentBp: null,
      beforeAmount: decimal("15.00"),
      afterAmount: decimal("14.00"),
      reduction: decimal("1.00"),
      nominalValue: decimal("15.00"),
      requestedBy: venue.operator.personId,
      approvedBy: null,
      note: null,
    });
    await tx
      .insert(adjustmentLines)
      .values({ adjustmentId, lineId, quantity: 1000, reduction: 100 });
  });
  expect((await read(id)).dishes).toMatchObject([{ lineId, movable: false }]);
});

it("writes the chosen place and its surcharge without taking the menu price", () => {
  expect(
    setMenuDishColumns({
      id: "dish",
      setMenuLineId: "lunch",
      place: 2,
      priceCents: 450,
      countsAsCourseId: "starter",
    }),
  ).toEqual({
    setMenuLineId: "lunch",
    setMenuPlace: 2,
    setMenuCountsAsCourseId: "starter",
    unitPriceGross: 450,
    lineTotal: 450,
  });
});

it("loads the requested versions in a single read across the basket", async () => {
  const id = await tableBill();
  await inTx(venue, (tx) => seedBillSetMenu(tx, id, daily, 1));
  const live = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, special.menuId, { setPrice: "23.00" });
    return publishWorkingMenu(tx, special.fullMenuId);
  });
  const zoneMenus = [{ id: special.fullMenuId, versionId: live }];
  const basket = [asked(daily), asked(daily), asked(special, live), asked(special, live)];
  const { queries, restore } = observeMenuVersionReads();
  try {
    const lookup = await inTx(venue, (tx) => setMenuOfferLookup(tx, id, basket, zoneMenus));
    expect(basket.map((line) => lookup.offerFor(line)?.offer.productId)).toEqual([
      daily.productId,
      daily.productId,
      special.productId,
      special.productId,
    ]);
    expect(queries).toHaveLength(1);
  } finally {
    restore();
  }
});

it("reports the tapped full menu's live version when the bill's copy belongs to another menu", async () => {
  const id = await tableBill();
  await inTx(venue, async (tx) => {
    await seedBillSetMenu(tx, id, daily, 1);
    const other = await createMenu(tx, { name: "Dinner" });
    await addMember(tx, await requireMenuRoot(tx, other.id), {
      kind: "set_menu",
      menuId: daily.menuId,
    });
    const zoneVersion = await publishWorkingMenu(tx, other.id);
    await expect(
      setMenuOfferLookup(
        tx,
        id,
        [asked(daily, zoneVersion)],
        [{ id: other.id, versionId: zoneVersion }],
      ),
    ).rejects.toMatchObject({
      code: "menu.version_changed",
      params: { menus: [{ menuId: other.id, liveVersionId: zoneVersion }] },
    });
  });
});
