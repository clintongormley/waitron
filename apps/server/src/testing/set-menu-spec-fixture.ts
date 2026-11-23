import { and, eq } from "drizzle-orm";
import {
  devices,
  kitchenCourses,
  printers,
  products,
  workingOrderLines,
  type Database,
} from "@waitron/db";
import {
  addMember,
  addSetMenuDishes,
  createCategory,
  createMenu,
  createProduct,
  menuItems,
  requireMenuRoot,
} from "@waitron/menu";
import { readDrafts, submitDraft } from "../order-drafts.js";
import { setSetMenuCount } from "../set-menu-count.js";
import { expectedDraftEditForTest } from "./draft-command-fixture.js";
import {
  commandFor,
  inTx,
  seatWithNoAllergies,
  setupPartyVenue,
  type PartyVenue,
} from "./party-venue.js";
import { publishWorkingMenu } from "./publish-menu.js";
import { saveSetMenuDraft } from "./set-menu-bill-fixture.js";

export type SpecDish = "Soup" | "Hake" | "Sea bass" | "Sirloin";

export interface SpecSetMenu {
  menuId: string;
  versionId: string;
  name: string;
  /** The set menu's own menu item for each dish it lists. */
  items: Partial<Record<SpecDish, string>>;
}

export interface SpecVenue {
  venue: PartyVenue;
  daily: SpecSetMenu;
  special: SpecSetMenu;
  productIds: Record<SpecDish, string>;
}

const DISHES: { name: SpecDish; course: "Starter" | "Main"; price: string }[] = [
  { name: "Soup", course: "Starter", price: "6.00" },
  { name: "Hake", course: "Main", price: "16.00" },
  { name: "Sea bass", course: "Main", price: "19.00" },
  { name: "Sirloin", course: "Main", price: "24.00" },
];

/**
 * The plan's fixture venue: Daily menu (€14.00, Sirloin +€5.00) and Special menu (€20.00, Sirloin
 * and Sea bass included), each listing Soup and Hake, with one "1 × Starter" and one "1 × Main"
 * line. Soup's paid extra is not built. The till has a receipt printer, so Print the bill runs.
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
        setVatClass: "reduced",
        setTakeawayVatClass: "general",
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
      return { menuId, versionId: "", name, items };
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
    return { venue, daily, special, productIds };
  });
}

export function setSpecCount(spec: SpecVenue, billId: string, setMenu: SpecSetMenu, count: number) {
  const { venue } = spec;
  return inTx(venue, (tx) =>
    setSetMenuCount(tx, venue.cfg, billId, setMenu.menuId, count, venue.operator.personId),
  );
}

/** Saves one set-menu dish line per name, in order, each taken from `from`. */
export function saveSpecDishes(
  spec: SpecVenue,
  bill: { partyId: string; tabId: string },
  dishes: readonly { dish: SpecDish; from: SpecSetMenu }[],
) {
  return saveSetMenuDraft(
    spec.venue,
    bill,
    ...dishes.map(({ dish, from }) => ({
      menuItemId: from.items[dish],
      menuVersionId: from.versionId,
      setMenuId: from.menuId,
      quantity: "1",
    })),
  );
}

/** Sends the party's saved draft `draftId` as it stands now, every line in one held group. */
export async function sendSpecDraft(spec: SpecVenue, partyId: string, draftId: string) {
  const { venue } = spec;
  const command = await commandFor(venue, partyId);
  return inTx(venue, async (tx) => {
    const draft = (await readDrafts(tx, partyId)).find(({ id }) => id === draftId)!;
    return submitDraft(tx, venue.cfg, partyId, draftId, {
      ...command,
      submissionId: crypto.randomUUID(),
      expectedEdit: await expectedDraftEditForTest(tx, draft),
      draftRevision: draft.revision,
      groups: [{ lineIds: draft.lines.map(({ id }) => id), release: "hold" }],
    });
  });
}

/** Saves and sends one set-menu dish line per name, in order, each taken from `from`. */
export async function sendSpecDishes(
  spec: SpecVenue,
  bill: { partyId: string; tabId: string },
  dishes: readonly { dish: SpecDish; from: SpecSetMenu }[],
) {
  const draft = await saveSpecDishes(spec, bill, dishes);
  return sendSpecDraft(spec, draft.partyId, draft.id);
}

/**
 * The plan's bill: a seated bill eaten here with 2 Daily and 2 Special, added in that order, then
 * 4 Soup, 1 Hake, 1 Sea bass and 2 Sirloin, sent in that order. Total 73.00.
 */
export async function specBill(spec: SpecVenue) {
  const { venue, daily, special } = spec;
  const bill = await seatWithNoAllergies(venue, await venue.table(crypto.randomUUID()));
  const dailies = (await setSpecCount(spec, bill.tabId, daily, 2)).setMenus;
  const specials = (await setSpecCount(spec, bill.tabId, special, 2)).setMenus.slice(2);
  await sendSpecDishes(spec, bill, [
    ...Array.from({ length: 4 }, () => ({ dish: "Soup" as const, from: daily })),
    { dish: "Hake", from: daily },
    { dish: "Sea bass", from: special },
    { dish: "Sirloin", from: special },
    { dish: "Sirloin", from: special },
  ]);
  return {
    ...bill,
    daily: dailies.map(({ lineId }) => lineId),
    special: specials.map(({ lineId }) => lineId),
  };
}

export function specRows(spec: SpecVenue, billId: string) {
  return spec.venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
}
