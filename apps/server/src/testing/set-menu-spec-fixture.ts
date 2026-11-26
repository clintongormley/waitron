import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, max } from "drizzle-orm";
import {
  devices,
  kitchenCourses,
  printers,
  products,
  saleLines,
  sales,
  ticketItems,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
import {
  addMember,
  addProducts,
  addSetMenuDishes,
  createCategory,
  createExtraList,
  createMenu,
  createProduct,
  menuItems,
  requireMenuRoot,
  setTakeawayVatRate,
  writeProductModifiers,
} from "@waitron/menu";
import { stringToCents, thousandthsToDecimal } from "@waitron/shared";
import { applyAdjustment } from "../adjustments-apply.js";
import { readBillEditState } from "../bill-editing.js";
import { cancelItem } from "../line-cancel.js";
import { endMeal } from "../meal-end.js";
import { readDrafts, submitDraft } from "../order-drafts.js";
import type { PayForItemsRequest } from "../pay-for-items.js";
import { readGroupingCopies, saveBillGrouping } from "../set-menu-regroup.js";
import { readOrderRevision } from "../working-order-context.js";
import { advanceTicketItem } from "../working-order-kitchen-service.js";
import { markServed } from "../working-order-serving.js";
import {
  cancelReasonId,
  COMP_BILL_REASON,
  GIVE_AWAY_REASON,
  observedCancelItem,
  reasonIdOf,
} from "./cancel-line.js";
import { expectedDraftEditForTest } from "./draft-command-fixture.js";
import {
  commandFor,
  inTx,
  revisionOf,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./party-venue.js";
import { publishWorkingMenu } from "./publish-menu.js";
import { saveSetMenuDraft, seedBillSetMenu } from "./set-menu-bill-fixture.js";
import { testTradingAdmission } from "./trading-admission.js";

export type SpecDish = "Soup" | "Hake" | "Sea bass" | "Sirloin";

export interface SpecSetMenu {
  menuId: string;
  versionId: string;
  name: string;
  priceCents: number;
  /** The set menu's own menu item for each dish it lists. */
  items: Partial<Record<SpecDish, string>>;
}

export interface SpecExtra {
  listId: string;
  picks: { productId: string; quantity: number }[];
}

export interface SpecVenue {
  venue: PartyVenue;
  daily: SpecSetMenu;
  special: SpecSetMenu;
  productIds: Record<SpecDish, string>;
  /** Soup's paid extra: one Bread at 1.50. */
  bread: SpecExtra;
}

const DISHES: { name: SpecDish; course: "Starter" | "Main"; price: string }[] = [
  { name: "Soup", course: "Starter", price: "6.00" },
  { name: "Hake", course: "Main", price: "16.00" },
  { name: "Sea bass", course: "Main", price: "19.00" },
  { name: "Sirloin", course: "Main", price: "24.00" },
];

/**
 * The fixture venue: Daily menu (€14.00, Sirloin +€5.00) and Special menu (€20.00, Sirloin
 * and Sea bass included), each listing Soup and Hake, with one "1 × Starter" and one "1 × Main"
 * line. Soup offers a paid extra, Bread at €1.50, which `specBill` does not order. The till has a
 * receipt printer, so Print the bill runs.
 */
export async function setupSetMenuSpecVenue(db: Database): Promise<SpecVenue> {
  const venue = await setupPartyVenue(db);
  return inTx(venue, async (tx) => {
    const [printer] = await tx
      .insert(printers)
      .values({ name: "Till printer", transport: "cloud_poll", pollId: crypto.randomUUID() })
      .returning({ id: printers.id });
    await tx
      .update(devices)
      .set({ receiptPrinterId: printer!.id })
      .where(eq(devices.id, venue.cfg.origin.deviceId!));
    const courseIds = new Map<string, string>();
    for (const [index, name] of ["Starter", "Main"].entries()) {
      const [{ id }] = await tx
        .insert(kitchenCourses)
        .values({ name, displayOrder: 10 + index })
        .returning({ id: kitchenCourses.id });
      courseIds.set(name, id);
    }
    const category = await createCategory(tx, { name: "Set menu dishes" });
    const productIds = {} as Record<SpecDish, string>;
    for (const dish of DISHES) {
      const { id } = await createProduct(tx, {
        categoryId: category.id,
        name: dish.name,
        pricingUnit: "each",
        unitPrice: dish.price,
        vatClass: "reduced",
      });
      await tx
        .update(products)
        .set({ courseId: courseIds.get(dish.course)! })
        .where(eq(products.id, id));
      productIds[dish.name] = id;
    }
    const { id: breadId } = await createProduct(tx, {
      categoryId: category.id,
      name: "Bread",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "reduced",
    });
    const breadList = await createExtraList(
      tx,
      {
        name: "Bread",
        minPicks: 0,
        maxPicks: 1,
        items: [{ productId: breadId, maxQuantity: 1, price: "1.50" }],
      },
      venue.cfg.locale,
    );
    await writeProductModifiers(tx, productIds.Soup, [{ kind: "extras", id: breadList.id }]);
    const bread = { listId: breadList.id, picks: [{ productId: breadId, quantity: 1 }] };
    const fullMenuId = venue.tables.menuId;
    const setMenu = async (
      name: string,
      price: string,
      dishes: SpecDish[],
      surcharges: Partial<Record<SpecDish, number>>,
    ) => {
      const { id: menuId } = await createMenu(tx, {
        kind: "set_menu",
        name,
        setPrice: price,
      });
      await addSetMenuDishes(
        tx,
        menuId,
        dishes.map((dish) => ({ productId: productIds[dish], excludedVariantIds: [] })),
      );
      await addMember(tx, await requireMenuRoot(tx, fullMenuId), { kind: "set_menu", menuId });
      const items: Partial<Record<SpecDish, string>> = {};
      for (const dish of dishes) {
        const [{ id }] = await tx
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(and(eq(menuItems.menuId, menuId), eq(menuItems.productId, productIds[dish])));
        items[dish] = id;
        const surcharge = surcharges[dish];
        if (surcharge !== undefined)
          await tx.update(menuItems).set({ grossPrice: surcharge }).where(eq(menuItems.id, id));
      }
      return { menuId, versionId: "", name, priceCents: stringToCents(price), items };
    };
    const daily = await setMenu("Daily menu", "14.00", ["Soup", "Hake", "Sirloin"], {
      Sirloin: 500,
    });
    const special = await setMenu(
      "Special menu",
      "20.00",
      ["Soup", "Hake", "Sea bass", "Sirloin"],
      {},
    );
    daily.versionId = special.versionId = await publishWorkingMenu(tx, fullMenuId);
    return { venue, daily, special, productIds, bread };
  });
}

/**
 * Adds the dishes to the full menu and publishes it again, every set menu of `spec` carrying the
 * new version; answers the full menu's offer of each dish.
 */
export function addSpecDishesToFullMenu(spec: SpecVenue): Promise<Record<SpecDish, string>> {
  const { venue } = spec;
  return inTx(venue, async (tx) => {
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
    return Object.fromEntries(
      (Object.keys(spec.productIds) as SpecDish[]).map((dish) => [
        dish,
        rows.find(({ productId }) => productId === spec.productIds[dish])!.id,
      ]),
    ) as Record<SpecDish, string>;
  });
}

export type LunchDish = "Soup" | "Hake" | "Lemonade";

export interface SpecLunch {
  menuId: string;
  versionId: string;
  items: Record<LunchDish, string>;
  lemonadeId: string;
}

/**
 * The plan's worked example on the spec venue: a Lunch menu at 14.00 listing Soup, Hake and a new
 * Lemonade (3.50, a Drink), one line each. Soup and Hake are taken away at 10% and Lemonade at 21%;
 * the caller sets Soup and Hake to 5.50 and 12.50. Publishes the full menu again, so every set
 * menu of `spec` carries the new version.
 */
export async function addSpecLunch(spec: SpecVenue): Promise<SpecLunch> {
  const { venue } = spec;
  return inTx(venue, async (tx) => {
    const [{ id: drinkCourse }] = await tx
      .insert(kitchenCourses)
      .values({ name: "Drink", displayOrder: 30 })
      .returning({ id: kitchenCourses.id });
    const lemonade = await createProduct(tx, {
      categoryId: null,
      name: "Lemonade",
      pricingUnit: "each",
      unitPrice: "3.50",
      vatClass: "reduced",
      takeawayVatRate: "21.00",
    });
    await tx.update(products).set({ courseId: drinkCourse }).where(eq(products.id, lemonade.id));
    const ids: Record<LunchDish, string> = {
      Soup: spec.productIds.Soup,
      Hake: spec.productIds.Hake,
      Lemonade: lemonade.id,
    };
    await setTakeawayVatRate(tx, ids.Soup, "10.00");
    await setTakeawayVatRate(tx, ids.Hake, "10.00");
    const { id: menuId } = await createMenu(tx, {
      kind: "set_menu",
      name: "Lunch menu",
      setPrice: "14.00",
    });
    await addSetMenuDishes(
      tx,
      menuId,
      Object.values(ids).map((productId) => ({ productId, excludedVariantIds: [] })),
    );
    const fullMenuId = venue.tables.menuId;
    await addMember(tx, await requireMenuRoot(tx, fullMenuId), { kind: "set_menu", menuId });
    const listed = await tx
      .select({ id: menuItems.id, productId: menuItems.productId })
      .from(menuItems)
      .where(eq(menuItems.menuId, menuId));
    const items = Object.fromEntries(
      (Object.keys(ids) as LunchDish[]).map((dish) => [
        dish,
        listed.find(({ productId }) => productId === ids[dish])!.id,
      ]),
    ) as Record<LunchDish, string>;
    const versionId = await publishWorkingMenu(tx, fullMenuId);
    spec.daily.versionId = spec.special.versionId = versionId;
    return { menuId, versionId, items, lemonadeId: lemonade.id };
  });
}

/**
 * A takeaway bill with Soup, Hake and Lemonade sent from the Lunch menu's copy `versionId`, then
 * each of `moreItems` (menu item ids of the Lunch menu), fired. Sending groups the three into one
 * Lunch menu: 14.00. The Soup takes `soupExtras` too, at their own price.
 */
export async function lunchBill(
  spec: SpecVenue,
  lunch: SpecLunch,
  versionId = lunch.versionId,
  moreItems: readonly string[] = [],
  soupExtras: SpecExtra[] = [],
) {
  const { venue } = spec;
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await inTx(venue, async (tx) => {
    await tx
      .update(workingOrders)
      .set({ dining: "takeaway" })
      .where(eq(workingOrders.id, bill.tabId));
  });
  const draft = await saveSetMenuDraft(
    venue,
    bill,
    ...[
      ...(["Soup", "Hake", "Lemonade"] as const).map((dish) => lunch.items[dish]),
      ...moreItems,
    ].map((menuItemId) => ({
      menuItemId,
      menuVersionId: versionId,
      setMenuId: lunch.menuId,
      quantity: "1",
      ...(menuItemId === lunch.items.Soup && soupExtras.length > 0 ? { extras: soupExtras } : {}),
    })),
  );
  await sendSpecDraft(spec, bill.partyId, draft.id, "fire");
  return bill;
}

/**
 * Groups the bill by hand rather than by the cheapest grouping: each of `menus` holds the dish rows
 * it names, at no charge, and every other dish row is charged a la carte. A set-menu row already on
 * the bill for the same copy is kept. For a grouping a fresh calculation of the test's order would
 * not produce, such as a dish at 0.00 inside a set menu.
 */
export function groupSpecBillByHand(
  spec: SpecVenue,
  billId: string,
  menus: readonly { menuId: string; lineIds: readonly string[] }[],
) {
  return inTx(spec.venue, async (tx) =>
    saveBillGrouping(tx, billId, await readGroupingCopies(tx, billId), (input) => {
      const saved = [...(input.previous?.setMenus ?? [])];
      const chosen = menus.map(({ menuId }, index) => {
        const offer = input.offers.find(({ id }) => id.startsWith(`${menuId}:`))!;
        const kept = saved.findIndex(({ offerId }) => offerId === offer.id);
        const id = kept === -1 ? `menu-${index}` : saved.splice(kept, 1)[0]!.id;
        return { id, offer };
      });
      const placed = new Map(
        menus.flatMap(({ lineIds }, index) => lineIds.map((lineId) => [lineId, index] as const)),
      );
      const dishes = input.dishes.map(({ id, courseId, aLaCarteCents, extrasCents }) => {
        const index = placed.get(id);
        if (index === undefined)
          return { id, place: null, chargeCents: aLaCarteCents, extrasCents };
        const { id: setMenuId, offer } = chosen[index]!;
        const lineIndex = offer.lines.findIndex(({ courseIds }) => courseIds.includes(courseId));
        return { id, place: { setMenuId, lineIndex }, chargeCents: 0, extrasCents };
      });
      return {
        exact: true,
        totalCents:
          chosen.reduce((sum, { offer }) => sum + offer.priceCents, 0) +
          dishes.reduce((sum, { chargeCents, extrasCents }) => sum + chargeCents + extrasCents, 0),
        unusedDiscountIds: [],
        setMenus: chosen.map(({ id, offer }) => ({
          id,
          offerId: offer.id,
          discountId: null,
          baseCents: offer.priceCents,
          discountCents: 0,
        })),
        dishes,
      };
    }),
  );
}

/**
 * Groups a {@link lunchBill} by hand: its first Soup, Hake, Lemonade and every other dish it sent
 * into its Lunch menu, and any Soup or Hake sent after them into one Daily menu.
 */
export async function groupLunchBillByHand(spec: SpecVenue, lunch: SpecLunch, billId: string) {
  const dishes = (await specRows(spec, billId)).filter(
    ({ setMenuRole, parentLineId }) => setMenuRole !== "set_menu" && parentLineId === null,
  );
  const named = new Set<string>();
  const inLunch: string[] = [];
  const inDaily: string[] = [];
  for (const { id, name } of dishes) {
    if (named.has(name)) inDaily.push(id);
    else {
      named.add(name);
      inLunch.push(id);
    }
  }
  return groupSpecBillByHand(spec, billId, [
    { menuId: lunch.menuId, lineIds: inLunch },
    ...(inDaily.length === 0 ? [] : [{ menuId: spec.daily.menuId, lineIds: inDaily }]),
  ]);
}

/**
 * Appends `count` set-menu rows of `setMenu` holding no dish to the bill, at its price, and returns
 * their ids.
 */
export function addEmptySpecSetMenus(
  spec: SpecVenue,
  billId: string,
  setMenu: SpecSetMenu,
  count = 1,
): Promise<string[]> {
  return inTx(spec.venue, async (tx) => {
    const [last] = await tx
      .select({ lineNo: max(workingOrderLines.lineNo) })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId));
    const ids: string[] = [];
    for (let index = 1; index <= count; index++)
      ids.push(
        await seedBillSetMenu(tx, billId, setMenu, (last?.lineNo ?? 0) + index, setMenu.priceCents),
      );
    return ids;
  });
}

export interface SpecDishLine {
  dish: SpecDish;
  from: SpecSetMenu;
  extras?: SpecExtra[];
}

/** Saves one set-menu dish line per name, in order, each taken from `from`. */
export function saveSpecDishes(
  spec: SpecVenue,
  bill: { partyId: string; tabId: string },
  dishes: readonly SpecDishLine[],
) {
  return saveSetMenuDraft(
    spec.venue,
    bill,
    ...dishes.map(({ dish, from, extras }) => ({
      menuItemId: from.items[dish],
      menuVersionId: from.versionId,
      setMenuId: from.menuId,
      quantity: "1",
      ...(extras === undefined ? {} : { extras }),
    })),
  );
}

/** Sends the party's saved draft `draftId` as it stands now, every line in one group, held unless told. */
export async function sendSpecDraft(
  spec: SpecVenue,
  partyId: string,
  draftId: string,
  release: "hold" | "fire" = "hold",
) {
  const { venue } = spec;
  const command = await commandFor(venue, partyId);
  return inTx(venue, async (tx) => {
    const draft = (await readDrafts(tx, partyId)).find(({ id }) => id === draftId)!;
    return submitDraft(tx, venue.cfg, partyId, draftId, {
      ...command,
      submissionId: crypto.randomUUID(),
      expectedEdit: await expectedDraftEditForTest(tx, draft),
      draftRevision: draft.revision,
      groups: [{ lineIds: draft.lines.map(({ id }) => id), release }],
    });
  });
}

/** Saves and sends one set-menu dish line per name, in order, each taken from `from`. */
export async function sendSpecDishes(
  spec: SpecVenue,
  bill: { partyId: string; tabId: string },
  dishes: readonly SpecDishLine[],
  release: "hold" | "fire" = "hold",
) {
  const draft = await saveSpecDishes(spec, bill, dishes);
  return sendSpecDraft(spec, draft.partyId, draft.id, release);
}

/**
 * The spec bill: a seated bill eaten here with 4 Soup, 1 Hake, 1 Sea bass and 2 Sirloin, sent in
 * that order, held unless told. Sending groups them into 3 Daily and 1 Special, 72.00 in all; the
 * set-menu rows' ids are answered by set menu, in line order.
 */
export async function specBill(spec: SpecVenue, release: "hold" | "fire" = "hold") {
  const { venue, daily, special } = spec;
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  await sendSpecDishes(
    spec,
    bill,
    [
      ...Array.from({ length: 4 }, () => ({ dish: "Soup" as const, from: daily })),
      { dish: "Hake", from: daily },
      { dish: "Sea bass", from: special },
      { dish: "Sirloin", from: special },
      { dish: "Sirloin", from: special },
    ],
    release,
  );
  const menus = (await specRows(spec, bill.tabId)).filter(
    ({ setMenuRole }) => setMenuRole === "set_menu",
  );
  const of = (menu: SpecSetMenu) =>
    menus.filter(({ setMenuId }) => setMenuId === menu.menuId).map(({ id }) => id);
  return { ...bill, daily: of(daily), special: of(special) };
}

export function specRows(spec: SpecVenue, billId: string) {
  return spec.venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}

/** The dish a row of the bill holds, when it is one of `spec`'s. */
export function specDishOf(spec: SpecVenue, row: { productId: string | null }): string | undefined {
  return (Object.keys(spec.productIds) as SpecDish[]).find(
    (dish) => spec.productIds[dish] === row.productId,
  );
}

/**
 * The bill's saved grouping, in line order: each top-level row's dish or set-menu name, its price,
 * and the set-menu row it is placed in, by that row's name and position among the bill's set menus.
 */
export async function specGrouping(spec: SpecVenue, billId: string) {
  const rows = (await specRows(spec, billId)).filter(({ parentLineId }) => parentLineId === null);
  const menus = rows.filter(({ setMenuRole }) => setMenuRole === "set_menu").map(({ id }) => id);
  const menuName = (id: string | null) => {
    if (id === null) return null;
    const index = menus.indexOf(id);
    return index < 0
      ? `elsewhere ${id}`
      : `${rows.find((row) => row.id === id)!.name} ${index + 1}`;
  };
  return {
    rows: rows.map((row) =>
      row.setMenuRole === "set_menu"
        ? { what: `${row.name} ${menus.indexOf(row.id) + 1}`, price: row.unitPriceGross }
        : {
            what: specDishOf(spec, row) ?? row.name,
            price: row.unitPriceGross,
            in: menuName(row.setMenuLineId),
          },
    ),
    total: rows.reduce((sum, { lineTotal }) => sum + lineTotal, 0),
  };
}

/** The id of the bill's `nth` top-level row of this dish or set-menu name, in line order. */
export async function specLineId(spec: SpecVenue, billId: string, what: string, nth = 0) {
  const rows = (await specRows(spec, billId)).filter(
    (row) => row.parentLineId === null && (specDishOf(spec, row) ?? row.name) === what,
  );
  return rows[nth]!.id;
}

/** Comps the bill's line whole, under the give-away reason. */
export async function compSpecLine(spec: SpecVenue, billId: string, lineId: string) {
  const { venue } = spec;
  await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId,
        reasonId: await reasonIdOf(tx, GIVE_AWAY_REASON),
        action: "comp",
        note: null,
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
}

/** Discounts the bill's line, or the whole bill when `lineId` is null, by `percentBp`. */
export async function discountSpecLine(
  spec: SpecVenue,
  billId: string,
  lineId: string | null,
  percentBp: number,
) {
  const { venue } = spec;
  await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId,
        reasonId: await reasonIdOf(tx, COMP_BILL_REASON),
        action: "discount_percent",
        percentBp,
        note: null,
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
}

/** Cancels the bill's sent line once the kitchen has started it, keeping its charge. */
export async function cancelSpecLineKeepingCharge(spec: SpecVenue, billId: string, id: string) {
  const { venue } = spec;
  await inTx(venue, async (tx) => {
    const [ticket] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, id));
    await advanceTicketItem(tx, ticket!.id, "preparing");
    const [row] = (await specRows(spec, billId)).filter((line) => line.id === id);
    const { target, lineId, body } = await observedCancelItem(tx, billId, row!.lineNo);
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

/** Makes the bill's row hold two, as a counted product leaves them: a send stores one row a portion. */
export async function makeSpecRowOfTwo(spec: SpecVenue, lineId: string, lineTotal: number) {
  await inTx(spec.venue, async (tx) => {
    await tx
      .update(workingOrderLines)
      .set({ quantity: 2000, lineTotal, countAsPortions: false })
      .where(eq(workingOrderLines.id, lineId));
    await tx
      .update(ticketItems)
      .set({ quantity: 2000 })
      .where(and(eq(ticketItems.workingOrderLineId, lineId), isNotNull(ticketItems.quantity)));
  });
}

/** What the till sends to pay for `picks` of the bill, which is in `partyId` or in no party. */
export async function specPayRequest(
  spec: SpecVenue,
  bill: { partyId: string | null; tabId: string },
  picks: PayForItemsRequest["picks"],
  pay: Pick<PayForItemsRequest, "method" | "applied" | "tendered" | "entry" | "simulationOutcome">,
): Promise<PayForItemsRequest> {
  const { venue } = spec;
  return {
    submissionId: randomUUID(),
    picks,
    ...(bill.partyId === null
      ? {}
      : { ...(await commandFor(venue, bill.partyId)), partyId: bill.partyId }),
    expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, bill.tabId))],
    tip: "0.00",
    ...pay,
  };
}

export function specDeps(spec: SpecVenue) {
  const { venue } = spec;
  return {
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    admission: testTradingAdmission(),
  };
}

/** Print the bill, with Print anyway, since the fixture's dishes are not marked served. */
export async function printSpecBill(spec: SpecVenue, partyId: string, billId: string) {
  const { venue } = spec;
  const expectedPartyRevision = await revisionOf(venue, partyId);
  return inTx(venue, async (tx) => {
    const { editorVersion, draftId, draftRevision } = await readBillEditState(tx, billId);
    return endMeal(
      tx,
      specDeps(spec),
      venue.cfg,
      partyId,
      {
        billId,
        expectedPartyRevision,
        expectedEdits: [{ billId, editorVersion, draftId, draftRevision }],
        submissionId: crypto.randomUUID(),
        printAnyway: true,
      },
      venue.operator.personId,
      null,
    );
  });
}

/** Marks every dish of the bill served; its dishes must have been fired. A set-menu line is not served. */
export async function serveSpecBill(spec: SpecVenue, partyId: string, billId: string) {
  const { venue } = spec;
  const dishes = (await specRows(spec, billId)).filter(
    ({ parentLineId, setMenuRole }) => parentLineId === null && setMenuRole !== "set_menu",
  );
  const command = await commandFor(venue, partyId);
  return inTx(venue, (tx) =>
    markServed(
      tx,
      venue.cfg,
      partyId,
      dishes.map(({ id, quantity }) => ({ lineId: id, quantity: thousandthsToDecimal(quantity) })),
      { ...command, submissionId: crypto.randomUUID() },
    ),
  );
}

/** The lines of the one sale filed from the bill, in line order. */
export async function specSaleLines(spec: SpecVenue, billId: string, saleId?: string) {
  const { db } = spec.venue;
  const filed = await db
    .select({ id: sales.id })
    .from(sales)
    .where(saleId === undefined ? eq(sales.workingOrderId, billId) : eq(sales.id, saleId));
  if (filed.length !== 1) throw new Error(`bill ${billId} filed ${filed.length} sales`);
  return db
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, filed[0]!.id))
    .orderBy(saleLines.lineNo);
}
