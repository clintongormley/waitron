import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  billSetMenuCopies,
  kitchenCourses,
  products,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addMember,
  addProductToMenu,
  addSetMenuDishes,
  createMenu,
  createProduct,
  deactivateMenu,
  requireMenuRoot,
  saveSetMenuDishCourse,
  setMenuVariants,
  setProductVariants,
  updateMenuDetails,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ExtraSelection } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  setDepartmentSalePolicyField,
} from "@waitron/venue-service";
import { insertPartyBill } from "./parties.js";
import { switchOrderDining } from "./order-dining.js";
import { parkOrder } from "./working-order-open.js";
import { addTabRound, updateHeldOrder, updateOrderLine } from "./testing/order-writer-fixture.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import {
  billRow,
  commandFor,
  counterOrder,
  inTx,
  OPERATOR,
  order,
  orderForParty,
  seatWithNoAllergies,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { setMenuOnFullMenu } from "./testing/set-menu-bill-fixture.js";
import { setupSetMenuReaders } from "./testing/set-menu-readers-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { addExtraList } from "./testing/working-order.test-support.js";

let fixture: Awaited<ReturnType<typeof setupSetMenuReaders>>;
let special: typeof fixture.copy;
let coffee: { offerId: string; large: string; small: string; setMenuId: string };
let takeaway: { zoneId: string; flanItem: string; burgerItem: string };

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
    coffee = await inTx(venue, async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Coffee",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      const offer = await addProductToMenu(tx, {
        menuId: copy.fullMenuId,
        productId: product.id,
        grossPrice: "1.50",
      });
      const [large, small] = await setProductVariants(
        tx,
        product.id,
        ["Large", "Small"].map((name) => ({
          name,
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "2.00",
          available: true,
        })),
        venue.cfg.locale,
      );
      await setMenuVariants(tx, offer.id, [
        { variantId: large!.id, price: "2.00" },
        { variantId: small!.id, price: "2.00" },
      ]);
      const [{ id: courseId }] = await tx
        .insert(kitchenCourses)
        .values({ name: "Coffees", displayOrder: 6 })
        .returning({ id: kitchenCourses.id });
      await tx.update(products).set({ courseId }).where(eq(products.id, product.id));
      const { id: setMenuId } = await createMenu(tx, {
        kind: "set_menu",
        name: "Coffee menu",
        setPrice: "3.00",
        setVatClass: "reduced",
        setTakeawayVatClass: "general",
      });
      await addSetMenuDishes(tx, setMenuId, [
        { productId: product.id, excludedVariantIds: [small!.id] },
      ]);
      await addMember(tx, await requireMenuRoot(tx, copy.fullMenuId), {
        kind: "set_menu",
        menuId: setMenuId,
      });
      await publishWorkingMenu(tx, copy.fullMenuId);
      return { offerId: offer.id, large: large!.id, small: small!.id, setMenuId };
    });
    takeaway = await inTx(venue, async (tx) => {
      const shop = await createDepartment(tx, { name: "Takeaway shop", orderStart: "counter" });
      await setDepartmentSalePolicyField(tx, shop.id, "dining", "takeaway");
      const zone = await createServiceZone(tx, { name: "Takeaway shop", departmentId: shop.id });
      const offers = await offerProducts(tx, { zone: { zoneId: zone.id } });
      return {
        zoneId: offers.zoneId,
        flanItem: offers.offerFor(copy.productId),
        burgerItem: offers.offerFor(venue.productId("Burger")),
      };
    });
  },
});

function links(billId: string) {
  return fixture.venue.db
    .select({ menuId: billSetMenuCopies.setMenuId, versionId: billSetMenuCopies.menuVersionId })
    .from(billSetMenuCopies)
    .where(eq(billSetMenuCopies.workingOrderId, billId))
    .orderBy(billSetMenuCopies.setMenuId);
}

/** Publishes the full menu and answers its live version, which every copy it holds is sold from. */
function currentVersion() {
  const { venue, copy } = fixture;
  return inTx(venue, (tx) => publishWorkingMenu(tx, copy.fullMenuId));
}

const byMenu = (rows: { menuId: string; versionId: string }[]) =>
  Object.fromEntries(rows.map(({ menuId, versionId }) => [menuId, versionId]));

async function seated() {
  const { venue } = fixture;
  return seatWithNoAllergies(venue, await venue.table(randomUUID()));
}

it("links both set menus that list an ordered dish", async () => {
  const { venue, copy } = fixture;
  const versionId = await currentVersion();
  const { tabId } = await seated();
  await order(venue, tabId, "Flan");
  expect(byMenu(await links(tabId))).toEqual({
    [copy.menuId]: versionId,
    [special.menuId]: versionId,
  });
});

it("adds no row for a second dish of the same set menus", async () => {
  const { venue } = fixture;
  const { tabId } = await seated();
  await order(venue, tabId, "Flan");
  const first = await links(tabId);
  await order(venue, tabId, "Flan");
  expect(await links(tabId)).toEqual(first);
  expect(first).toHaveLength(2);
});

it("keeps the recorded copy after a newer version is published", async () => {
  const { venue, copy } = fixture;
  const { tabId } = await seated();
  await order(venue, tabId, "Flan");
  const recorded = byMenu(await links(tabId));
  expect(Object.keys(recorded).sort()).toEqual([copy.menuId, special.menuId].sort());
  const newer = await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, copy.menuId, { setPrice: "16.50" });
    return publishWorkingMenu(tx, copy.fullMenuId);
  });
  expect(newer).not.toBe(recorded[copy.menuId]);
  await order(venue, tabId, "Flan");
  expect(byMenu(await links(tabId))).toEqual(recorded);
});

it("links the set menus listing an ordered variant, and not those leaving it out", async () => {
  const { venue } = fixture;
  const versionId = await currentVersion();
  const large = await seated();
  const small = await seated();
  await inTx(venue, async (tx) => {
    await addTabRound(tx, venue.cfg, large.tabId, [
      { menuItemId: coffee.offerId, variantId: coffee.large, quantity: "1" },
    ]);
    await addTabRound(tx, venue.cfg, small.tabId, [
      { menuItemId: coffee.offerId, variantId: coffee.small, quantity: "1" },
    ]);
  });
  expect(await links(large.tabId)).toEqual([{ menuId: coffee.setMenuId, versionId }]);
  expect(await links(small.tabId)).toEqual([]);
});

it("links nothing for a dish on no set menu", async () => {
  const { venue } = fixture;
  const { tabId } = await seated();
  await order(venue, tabId, "Burger");
  expect(await links(tabId)).toEqual([]);
});

it("links nothing on a counter order eaten in, and still takes the dish", async () => {
  const { venue } = fixture;
  const id = await counterOrder(venue, "Flan");
  expect(await links(id)).toEqual([]);
  const lines = await venue.db
    .select({ name: workingOrderLines.name })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));
  expect(lines).toEqual([{ name: "Flan" }]);
});

it("links the set menus of a dish tapped in an a la carte folder", async () => {
  const { venue, copy } = fixture;
  const { tabId } = await seated();
  await order(venue, tabId, "Flan");
  const [dish] = await venue.db
    .select({ menuItemId: workingOrderLines.menuItemId, role: workingOrderLines.setMenuRole })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  expect(dish).toEqual({ menuItemId: venue.item("Flan"), role: null });
  expect((await links(tabId)).map(({ menuId }) => menuId).sort()).toEqual(
    [copy.menuId, special.menuId].sort(),
  );
});

it("links the set menus of the dishes a takeaway order is created with", async () => {
  const { venue, copy } = fixture;
  const versionId = await currentVersion();
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    zoneId: takeaway.zoneId,
    lines: [{ menuItemId: takeaway.flanItem, quantity: "1" }],
    operatorId: OPERATOR,
    dining: "takeaway",
  });
  expect((await billRow(venue, id)).dining).toBe("takeaway");
  expect(byMenu(await links(id))).toEqual({
    [copy.menuId]: versionId,
    [special.menuId]: versionId,
  });
});

it("brings the source's recorded set menus with a dish moved to a bill without links", async () => {
  const { venue, copy } = fixture;
  const { tabId, partyId } = await seated();
  await order(venue, tabId, "Flan");
  const recorded = byMenu(await links(tabId));
  expect(Object.keys(recorded).sort()).toEqual([copy.menuId, special.menuId].sort());
  await inTx(venue, async (tx) => {
    await updateMenuDetails(tx, copy.menuId, { setPrice: "17.50" });
    await publishWorkingMenu(tx, copy.fullMenuId);
  });
  const target = await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, partyId));
  expect(await links(target)).toEqual([]);
  const [dish] = await venue.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  const command = await commandFor(venue, partyId);
  await inTx(venue, (tx) => moveDishes(tx, venue.cfg, tabId, target, [dish!.id], command));
  expect(byMenu(await links(target))).toEqual(recorded);
});

it("brings no set menus with a dish moved off a takeaway order switched to eaten in", async () => {
  const { venue, copy } = fixture;
  const choice = await inTx(venue, async (tx) => {
    const shop = await createDepartment(tx, { name: "Choice shop", orderStart: "counter" });
    await setDepartmentSalePolicyField(tx, shop.id, "dining", "till_choice");
    const zone = await createServiceZone(tx, { name: "Choice shop", departmentId: shop.id });
    return offerProducts(tx, { zone: { zoneId: zone.id } });
  });
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    zoneId: choice.zoneId,
    lines: [
      { menuItemId: choice.offerFor(copy.productId), quantity: "1" },
      { menuItemId: choice.offerFor(venue.productId("Burger")), quantity: "1" },
    ],
    operatorId: OPERATOR,
    dining: "takeaway",
  });
  expect((await links(id)).map(({ menuId }) => menuId).sort()).toEqual(
    [copy.menuId, special.menuId].sort(),
  );
  const { revision } = await billRow(venue, id);
  await inTx(venue, (tx) =>
    switchOrderDining(tx, id, "eat_in", revision, { operatorId: OPERATOR, expectedEdit: null }),
  );
  const [dish] = await venue.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, id),
        eq(workingOrderLines.productId, copy.productId),
      ),
    );
  const { billId } = await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, id, null, [dish!.id], { operatorId: OPERATOR }),
  );
  const moved = await venue.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  expect(moved).toEqual([{ id: dish!.id }]);
  expect((await billRow(venue, billId)).dining).toBe("eat_in");
  expect(await links(billId)).toEqual([]);
});

async function parkTakeaway(...menuItemIds: string[]) {
  const { venue } = fixture;
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    zoneId: takeaway.zoneId,
    lines: menuItemIds.map((menuItemId) => ({ menuItemId, quantity: "1" })),
    operatorId: OPERATOR,
    dining: "takeaway",
  });
  return id;
}

async function saveAgain(
  id: string,
  lines: { menuItemId: string; quantity: string; extras?: ExtraSelection[] }[],
) {
  const { venue } = fixture;
  const stored = await venue.db
    .select({ id: workingOrderLines.id, menuItemId: workingOrderLines.menuItemId })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  const [order] = await venue.db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  await updateHeldOrder({ db: venue.db, admission: testTradingAdmission() }, venue.cfg, id, {
    revision: order!.revision,
    operatorId: OPERATOR,
    lines: lines.map((line, index) => ({
      ...line,
      workingOrderLineId:
        stored[index]?.menuItemId === line.menuItemId ? stored[index]!.id : undefined,
    })),
  });
}

it("links the set menus of a dish added when a parked order is saved again", async () => {
  const { copy } = fixture;
  const versionId = await currentVersion();
  const id = await parkTakeaway(takeaway.burgerItem);
  expect(await links(id)).toEqual([]);
  await saveAgain(id, [
    { menuItemId: takeaway.burgerItem, quantity: "1" },
    { menuItemId: takeaway.flanItem, quantity: "1" },
  ]);
  expect(byMenu(await links(id))).toEqual({
    [copy.menuId]: versionId,
    [special.menuId]: versionId,
  });
});

it("links nothing when a parked order is saved again unchanged", async () => {
  const { venue } = fixture;
  const id = await parkTakeaway(takeaway.flanItem);
  await venue.db.delete(billSetMenuCopies).where(eq(billSetMenuCopies.workingOrderId, id));
  await saveAgain(id, [{ menuItemId: takeaway.flanItem, quantity: "1" }]);
  expect(await links(id)).toEqual([]);
});

it("links the set menus of a dish whose quantity a saved-again parked order raises", async () => {
  const { venue, copy } = fixture;
  const versionId = await currentVersion();
  const id = await parkTakeaway(takeaway.flanItem);
  await venue.db.delete(billSetMenuCopies).where(eq(billSetMenuCopies.workingOrderId, id));
  await saveAgain(id, [{ menuItemId: takeaway.flanItem, quantity: "2" }]);
  const dishes = await venue.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));
  expect(dishes).toHaveLength(2);
  expect(byMenu(await links(id))).toEqual({
    [copy.menuId]: versionId,
    [special.menuId]: versionId,
  });
});

it("links nothing when a saved-again parked order lowers a dish's quantity", async () => {
  const { venue } = fixture;
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    zoneId: takeaway.zoneId,
    lines: [{ menuItemId: takeaway.flanItem, quantity: "2" }],
    operatorId: OPERATOR,
    dining: "takeaway",
  });
  await venue.db.delete(billSetMenuCopies).where(eq(billSetMenuCopies.workingOrderId, id));
  await saveAgain(id, [{ menuItemId: takeaway.flanItem, quantity: "1" }]);
  const dishes = await venue.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));
  expect(dishes).toHaveLength(1);
  expect(await links(id)).toEqual([]);
});

it("links nothing when a saved-again parked order adds an extra to a dish it holds", async () => {
  const { venue } = fixture;
  const cream = await inTx(venue, (tx) => addExtraList(tx, venue.productId("Flan"), "Cream"));
  await currentVersion();
  const id = await parkTakeaway(takeaway.flanItem);
  await venue.db.delete(billSetMenuCopies).where(eq(billSetMenuCopies.workingOrderId, id));
  await saveAgain(id, [
    {
      menuItemId: takeaway.flanItem,
      quantity: "1",
      extras: [{ listId: cream.listId, picks: [{ productId: cream.productId, quantity: 1 }] }],
    },
  ]);
  const rows = await venue.db
    .select({
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id));
  expect(rows).toContainEqual({ parentLineId: expect.any(String), productId: cream.productId });
  expect(await links(id)).toEqual([]);
});

it("links the set menus of a sent dish raised on its bill", async () => {
  const { venue, copy } = fixture;
  const { tabId, partyId } = await seated();
  await orderForParty(venue, partyId, ["Flan"], tabId);
  await venue.db.delete(billSetMenuCopies).where(eq(billSetMenuCopies.workingOrderId, tabId));
  const [dish] = await venue.db
    .select({ lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  const [bill] = await venue.db
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, tabId));
  await inTx(venue, (tx) =>
    updateOrderLine(
      tx,
      venue.cfg,
      tabId,
      dish!.lineNo,
      { quantity: "2" },
      bill!.revision,
      OPERATOR,
    ),
  );
  const rows = await venue.db
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  expect(rows).toHaveLength(2);
  expect((await links(tabId)).map(({ menuId }) => menuId).sort()).toEqual(
    [copy.menuId, special.menuId].sort(),
  );
});

it("links set menus a live published menu still holds after every set menu is made inactive", async () => {
  const { venue, copy } = fixture;
  const versionId = await currentVersion();
  await inTx(venue, async (tx) => {
    for (const menuId of [copy.menuId, special.menuId, coffee.setMenuId])
      await deactivateMenu(tx, menuId);
  });
  const { tabId } = await seated();
  await order(venue, tabId, "Flan");
  expect(byMenu(await links(tabId))).toEqual({
    [copy.menuId]: versionId,
    [special.menuId]: versionId,
  });
});
