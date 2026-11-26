import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { adjustmentEndings, createAdjustmentReason } from "@waitron/adjustments";
import { adjustmentLines, kitchenCourses, products, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addProducts,
  addSetMenuDishes,
  createExtraList,
  createOptionList,
  createProduct,
  menuItems,
  requireMenuRoot,
  setProductVariants,
  writeProductModifiers,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal, type ExtraSelection, type OptionSelection } from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { readOrderRevision } from "./working-order-context.js";
import { getHeldOrder } from "./working-order-held-read.js";
import { parkOrder } from "./working-order-open.js";
import { updateHeldOrder, updateOrderLine } from "./working-order-held-write.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import {
  addSpecDishesToFullMenu,
  sendSpecDraft,
  setupSetMenuSpecVenue,
  specDishOf,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

let spec: SpecVenue;
let venue: PartyVenue;
/** The ordinary menu's offer of each dish. */
let ordinary: Record<SpecDish, string>;
/** A Wine by the glass, in two sizes, on no set menu, with a Serve answer it must be given. */
let wine: {
  offer: string;
  small: string;
  large: string;
  serve: { listId: string; labelIds: string[] };
};
/** Soup's second paid extra, Croutons at 1.00, and Sirloin's and the Rice pot's, a Sauce at 2.00. */
let croutons: ExtraSelection;
let sauce: ExtraSelection;
/** A Rice pot in two sizes, each a Main of the Daily at no supplement. */
let ricePot: { offer: string; half: string; full: string };

async function variantDish(
  tx: Transaction,
  name: string,
  sizes: [string, string][],
  courseId: string,
) {
  const parent = await createProduct(tx, {
    categoryId: null,
    name,
    pricingUnit: "each",
    unitPrice: sizes[0]![1],
    vatClass: "reduced",
  });
  await tx.update(products).set({ courseId }).where(eq(products.id, parent.id));
  const variants = await setProductVariants(
    tx,
    parent.id,
    sizes.map(([size, unitPrice]) => ({
      name: size,
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice,
      available: true,
    })),
    venue.cfg.locale,
  );
  return { id: parent.id, variants: variants.map(({ id }) => id) };
}

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    ordinary = await addSpecDishesToFullMenu(spec);
    await inTx(venue, async (tx) => {
      const [main] = await tx
        .select({ id: kitchenCourses.id })
        .from(kitchenCourses)
        .where(eq(kitchenCourses.name, "Main"));
      const glass = await variantDish(
        tx,
        "Wine",
        [
          ["Small", "4.50"],
          ["Large", "5.50"],
        ],
        main!.id,
      );
      const serve = await createOptionList(
        tx,
        {
          name: "Serve",
          customerName: {},
          kitchenName: "Serve",
          defaultLabelId: null,
          active: true,
          labels: ["Chilled", "Room"].map((name) => ({
            name,
            customerName: {},
            kitchenName: name,
            available: true,
          })),
        },
        venue.cfg.locale,
      );
      await writeProductModifiers(tx, glass.id, [{ kind: "options", id: serve.id }]);
      const rice = await variantDish(
        tx,
        "Rice pot",
        [
          ["Half", "16.00"],
          ["Full", "20.00"],
        ],
        main!.id,
      );
      await addSetMenuDishes(tx, spec.daily.menuId, [
        { productId: rice.id, excludedVariantIds: [] },
      ]);
      const extraOf = async (name: string, price: string, dishId: string, kept: string[]) => {
        const product = await createProduct(tx, {
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice: price,
          vatClass: "reduced",
        });
        const list = await createExtraList(
          tx,
          {
            name,
            minPicks: 0,
            maxPicks: 1,
            items: [{ productId: product.id, maxQuantity: 1, price }],
          },
          venue.cfg.locale,
        );
        await writeProductModifiers(
          tx,
          dishId,
          [...kept, list.id].map((id) => ({ kind: "extras" as const, id })),
        );
        return { listId: list.id, picks: [{ productId: product.id, quantity: 1 }] };
      };
      croutons = await extraOf("Croutons", "1.00", spec.productIds.Soup, [spec.bread.listId]);
      sauce = await extraOf("Sauce", "2.00", spec.productIds.Sirloin, []);
      await writeProductModifiers(tx, rice.id, [{ kind: "extras", id: sauce.listId }]);
      const root = await requireMenuRoot(tx, venue.tables.menuId);
      await addProducts(tx, root, [glass.id, rice.id]);
      spec.daily.versionId = spec.special.versionId = await publishWorkingMenu(
        tx,
        venue.tables.menuId,
      );
      const offerOf = async (productId: string) =>
        (
          await tx
            .select({ id: menuItems.id })
            .from(menuItems)
            .where(
              and(eq(menuItems.menuId, venue.tables.menuId), eq(menuItems.productId, productId)),
            )
        )[0]!.id;
      wine = {
        offer: await offerOf(glass.id),
        small: glass.variants[0]!,
        large: glass.variants[1]!,
        serve: { listId: serve.id, labelIds: serve.labels.map(({ id }) => id) },
      };
      ricePot = { offer: await offerOf(rice.id), half: rice.variants[0]!, full: rice.variants[1]! };
    });
  },
});

type Bill = { partyId: string; tabId: string };
type Line = {
  menuItemId: string;
  quantity: string;
  variantId?: string;
  extras?: ExtraSelection[];
  options?: OptionSelection[];
};

const dish = (name: SpecDish, extras?: ExtraSelection[]): Line => ({
  menuItemId: ordinary[name],
  quantity: "1",
  ...(extras === undefined ? {} : { extras }),
});
const serveAs = (nth: number): OptionSelection[] => [
  { listId: wine.serve.listId, labelId: wine.serve.labelIds[nth]! },
];
const glassOf = (variantId: string): Line => ({
  menuItemId: wine.offer,
  variantId,
  quantity: "1",
  options: serveAs(0),
});
const ricePotOf = (variantId: string): Line => ({
  menuItemId: ricePot.offer,
  variantId,
  quantity: "1",
});

/** A seated bill eaten here, its dishes sent held from the ordinary menu and grouped by the bill. */
async function billOf(lines: readonly Line[]): Promise<Bill> {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  const draft = await saveSetMenuDraft(venue, bill, ...lines);
  await sendSpecDraft(spec, draft.partyId, draft.id, "hold");
  return bill;
}

const rows = (billId: string) => specRows(spec, billId);

async function total(billId: string) {
  return (await rows(billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

/** Every top-level row and extra, in line order: what it is and its price. */
async function priced(billId: string) {
  return (await rows(billId)).map((row) => ({
    what: specDishOf(spec, row) ?? row.name,
    price: row.lineTotal,
  }));
}

async function rowOf(billId: string, what: string, nth = 0) {
  return (await rows(billId)).filter(
    (row) => row.parentLineId === null && (specDishOf(spec, row) ?? row.name) === what,
  )[nth]!;
}

function endingsOn(billId: string) {
  return venue.db
    .select({
      adjustmentId: adjustmentEndings.adjustmentId,
      why: adjustmentEndings.why,
      dishName: adjustmentEndings.dishName,
      lineId: adjustmentEndings.lineId,
    })
    .from(adjustmentEndings)
    .where(eq(adjustmentEndings.workingOrderId, billId));
}

type Given =
  | { action: "comp" }
  | { action: "discount_percent"; percentBp: number }
  | { action: "discount_amount"; amount: string };

const FREE: Given = { action: "comp" };
const percent = (percentBp: number): Given => ({ action: "discount_percent", percentBp });

/** Gives `lineId` (the whole bill when null) `given` under a reason with no limits; answers its id. */
async function give(billId: string, lineId: string | null, given: Given, lineIds?: string[]) {
  const { adjustmentIds } = await inTx(venue, async (tx) => {
    const reason = await createAdjustmentReason(tx, {
      ...REASONS.house,
      name: `House ${randomUUID()}`,
    });
    return applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId,
        ...(lineIds === undefined ? {} : { lineIds }),
        reasonId: reason.id,
        note: null,
        operatorId: venue.operator.personId,
        ...(given.action === "discount_amount"
          ? { action: given.action, amount: decimal(given.amount) }
          : given),
      },
      venue.cfg.locale,
    );
  });
  return adjustmentIds[0]!;
}

async function editLine(
  billId: string,
  lineNo: number,
  patch: {
    quantity?: string;
    note?: string | null;
    extras?: ExtraSelection[];
    options?: OptionSelection[];
  },
) {
  await inTx(venue, async (tx) =>
    updateOrderLine(
      tx,
      venue.cfg,
      billId,
      lineNo,
      { portionLineNos: [], ...patch },
      await readOrderRevision(tx, billId),
      {
        admission: testTradingAdmission(),
        operatorId: venue.operator.personId,
        expectedEdit: await readBillEditState(tx, billId),
      },
    ),
  );
}

async function saveBasket(billId: string, lines: (Line & { workingOrderLineId?: string })[]) {
  await updateHeldOrder({ db: venue.db, admission: testTradingAdmission() }, venue.cfg, billId, {
    ...(await inTx(venue, async (tx) => ({
      expectedEdit: await readBillEditState(tx, billId),
      revision: await readOrderRevision(tx, billId),
    }))),
    operatorId: venue.operator.personId,
    lines,
  });
}

it("takes an a la carte Soup's 50% off when it is given Bread", async () => {
  const { tabId } = await billOf([dish("Soup")]);
  const given = await give(tabId, (await rowOf(tabId, "Soup")).id, percent(5000));
  const soup = await rowOf(tabId, "Soup");
  expect(soup.lineTotal).toBe(300);

  await editLine(tabId, soup.lineNo, { extras: [spec.bread] });

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "extras_changed", dishName: "Soup", lineId: soup.id },
  ]);
  expect(await rowOf(tabId, "Soup")).toMatchObject({
    unitPriceGross: 600,
    lineTotal: 600,
    listUnitPriceGross: null,
  });
  expect(await priced(tabId)).toEqual([
    { what: "Soup", price: 600 },
    { what: "Bread", price: 150 },
  ]);
});

it("takes a comped Soup's Free off when its comped Bread is removed", async () => {
  const { tabId } = await billOf([dish("Soup", [spec.bread])]);
  const soup = await rowOf(tabId, "Soup");
  const given = await give(tabId, soup.id, FREE);
  expect(await total(tabId)).toBe(0);

  await editLine(tabId, soup.lineNo, { extras: [] });

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "extras_changed", dishName: "Soup", lineId: soup.id },
  ]);
  expect(await priced(tabId)).toEqual([{ what: "Soup", price: 600 }]);
});

it("keeps a Free given on the Bread alone when the Soup is given Croutons", async () => {
  const { tabId } = await billOf([dish("Soup", [spec.bread])]);
  const bread = (await rows(tabId)).find(({ name }) => name === "Bread")!;
  await give(tabId, bread.id, FREE);
  expect(await total(tabId)).toBe(600);

  await editLine(tabId, (await rowOf(tabId, "Soup")).lineNo, {
    extras: [spec.bread, croutons],
  });

  expect(await endingsOn(tabId)).toEqual([]);
  expect(await priced(tabId)).toEqual([
    { what: "Soup", price: 600 },
    { what: "Bread", price: 0 },
    { what: "Croutons", price: 100 },
  ]);
});

it("keeps a Daily's 50% when its Sirloin is given a Sauce (D49)", async () => {
  const { tabId } = await billOf([dish("Soup"), dish("Sirloin")]);
  const given = await give(tabId, (await rowOf(tabId, "Daily menu")).id, percent(5000));
  expect(await total(tabId)).toBe(950);

  await editLine(tabId, (await rowOf(tabId, "Sirloin")).lineNo, { extras: [sauce] });

  expect(await endingsOn(tabId)).toEqual([]);
  const [standing] = await venue.db
    .select({ reduction: adjustmentLines.reduction })
    .from(adjustmentLines)
    .where(
      and(
        eq(adjustmentLines.adjustmentId, given),
        eq(adjustmentLines.lineId, (await rowOf(tabId, "Sirloin")).id),
      ),
    );
  expect(standing!.reduction).toBeGreaterThan(0);
  expect(await total(tabId)).toBe(1150);
});

it("puts a Soup taken out of its Daily by 50% back in the Hake's Daily when it is given Bread", async () => {
  const { tabId } = await billOf([dish("Soup"), dish("Hake")]);
  const soup = await rowOf(tabId, "Soup");
  const given = await give(tabId, soup.id, percent(5000));
  expect(await rowOf(tabId, "Soup")).toMatchObject({ lineTotal: 300, setMenuLineId: null });
  expect(await total(tabId)).toBe(1700);

  await editLine(tabId, (await rowOf(tabId, "Soup")).lineNo, { extras: [spec.bread] });

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "extras_changed", dishName: "Soup", lineId: soup.id },
  ]);
  const daily = await rowOf(tabId, "Daily menu");
  expect(await rowOf(tabId, "Soup")).toMatchObject({ setMenuLineId: daily.id, lineTotal: 0 });
  expect(await total(tabId)).toBe(1550);
});

it("keeps a dish's discount through a new note or options answer", async () => {
  const { tabId } = await billOf([dish("Soup"), glassOf(wine.small)]);
  await give(tabId, (await rowOf(tabId, "Soup")).id, percent(5000));
  await give(tabId, (await rowOf(tabId, "Wine")).id, percent(5000));
  const before = await priced(tabId);
  expect(before).toEqual([
    { what: "Soup", price: 300 },
    { what: "Wine", price: 225 },
  ]);

  await editLine(tabId, (await rowOf(tabId, "Soup")).lineNo, { note: "No salt" });
  await editLine(tabId, (await rowOf(tabId, "Wine")).lineNo, {
    options: serveAs(1),
  });

  expect(await endingsOn(tabId)).toEqual([]);
  expect(await rowOf(tabId, "Soup")).toMatchObject({ note: "No salt" });
  expect((await rowOf(tabId, "Wine")).optionSnapshots).toMatchObject([
    { listId: wine.serve.listId, labelKitchenName: "Room" },
  ]);
  expect(await priced(tabId)).toEqual(before);
});

it("keeps a dish's discount when more of it is ordered, the new one at full price", async () => {
  const { tabId } = await billOf([dish("Soup")]);
  await give(tabId, (await rowOf(tabId, "Soup")).id, percent(5000));

  await editLine(tabId, (await rowOf(tabId, "Soup")).lineNo, { quantity: "2" });

  expect(await endingsOn(tabId)).toEqual([]);
  expect(await priced(tabId)).toEqual([
    { what: "Soup", price: 300 },
    { what: "Soup", price: 600 },
  ]);
});

it("keeps a Soup's part of a whole-bill 10% when it is given Bread (D56)", async () => {
  const { tabId } = await billOf([dish("Soup")]);
  await give(tabId, null, percent(1000));
  expect(await total(tabId)).toBe(540);

  await editLine(tabId, (await rowOf(tabId, "Soup")).lineNo, { extras: [spec.bread] });

  expect(await endingsOn(tabId)).toEqual([]);
  expect(await priced(tabId)).toEqual([
    { what: "Soup", price: 540 },
    { what: "Bread", price: 150 },
  ]);
});

it("takes a dish's 10% off when a basket save names it at another variant, offering it on the new line", async () => {
  const { tabId } = await billOf([glassOf(wine.small)]);
  const small = await rowOf(tabId, "Wine");
  const given = await give(tabId, small.id, percent(1000));
  expect(await total(tabId)).toBe(405);

  await saveBasket(tabId, [{ workingOrderLineId: small.id, ...glassOf(wine.large) }]);

  const large = await rowOf(tabId, "Wine");
  expect(large.id).not.toBe(small.id);
  expect(large).toMatchObject({ productId: wine.large, lineTotal: 550, listUnitPriceGross: null });
  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "variant_changed", dishName: "Wine", lineId: large.id },
  ]);
  expect(await total(tabId)).toBe(550);
});

it("ends nothing when a second basket line keeps the stored dish another line named at another variant", async () => {
  const { tabId } = await billOf([glassOf(wine.small)]);
  const small = await rowOf(tabId, "Wine");
  await give(tabId, small.id, percent(1000));

  await saveBasket(tabId, [
    { workingOrderLineId: small.id, ...glassOf(wine.large) },
    { workingOrderLineId: small.id, ...glassOf(wine.small) },
  ]);

  expect(await endingsOn(tabId)).toEqual([]);
  expect((await rows(tabId)).map(({ id, lineTotal }) => ({ id, lineTotal }))).toEqual([
    { id: small.id, lineTotal: 405 },
    { id: expect.not.stringMatching(small.id), lineTotal: 550 },
  ]);
});

it("ends nothing when a basket save swaps the variant of a dish whose extra alone is comped", async () => {
  const { tabId } = await billOf([{ ...ricePotOf(ricePot.half), extras: [sauce] }]);
  const sauceRow = (await rows(tabId)).find(({ name }) => name === "Sauce")!;
  await give(tabId, sauceRow.id, FREE);
  expect(await total(tabId)).toBe(1400);
  const half = await rowOf(tabId, "Rice pot");

  await saveBasket(tabId, [
    { workingOrderLineId: half.id, ...ricePotOf(ricePot.full), extras: [sauce] },
  ]);

  // The comp goes with the removed dish and its extras: no ending, so no notice.
  expect(await endingsOn(tabId)).toEqual([]);
  expect(await rowOf(tabId, "Rice pot")).toMatchObject({ productId: ricePot.full });
  expect((await rows(tabId)).some(({ id }) => id === sauceRow.id)).toBe(false);
  expect(await total(tabId)).toBe(1600);
});

it("ends nothing when a basket save names another menu item in a discounted dish's place", async () => {
  const { tabId } = await billOf([glassOf(wine.small)]);
  const small = await rowOf(tabId, "Wine");
  await give(tabId, small.id, percent(1000));

  await saveBasket(tabId, [{ workingOrderLineId: small.id, ...dish("Soup") }]);

  expect(await endingsOn(tabId)).toEqual([]);
  expect(await priced(tabId)).toEqual([{ what: "Soup", price: 600 }]);
});

it("takes a Daily's 50% off when a basket save names its Rice pot at another variant", async () => {
  const { tabId } = await billOf([dish("Soup"), ricePotOf(ricePot.half)]);
  const daily = await rowOf(tabId, "Daily menu");
  const given = await give(tabId, daily.id, percent(5000));
  expect(await total(tabId)).toBe(700);
  const soup = await rowOf(tabId, "Soup");
  const half = await rowOf(tabId, "Rice pot");

  await saveBasket(tabId, [
    { workingOrderLineId: soup.id, ...dish("Soup") },
    { workingOrderLineId: half.id, ...ricePotOf(ricePot.full) },
  ]);

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "variant_changed", dishName: "Rice pot", lineId: null },
  ]);
  expect(await rowOf(tabId, "Rice pot")).toMatchObject({ productId: ricePot.full });
  expect(await total(tabId)).toBe(1400);
});

it("takes only the cancelled Sea bass's share of a row's 5.00 off", async () => {
  const { tabId } = await billOf([{ menuItemId: ordinary["Sea bass"], quantity: "3" }]);
  const portions = (await rows(tabId)).filter((row) => specDishOf(spec, row) === "Sea bass");
  expect(portions).toHaveLength(3);
  const given = await give(
    tabId,
    portions[0]!.id,
    { action: "discount_amount", amount: "5.00" },
    portions.map(({ id }) => id),
  );
  expect(await total(tabId)).toBe(5200);
  const [kept1, kept2, cancelled] = await rows(tabId);
  const [share] = await venue.db
    .select({ reduction: adjustmentLines.reduction })
    .from(adjustmentLines)
    .where(and(eq(adjustmentLines.adjustmentId, given), eq(adjustmentLines.lineId, cancelled!.id)));

  await saveBasket(tabId, [
    { workingOrderLineId: kept1!.id, ...dish("Sea bass") },
    { workingOrderLineId: kept2!.id, ...dish("Sea bass") },
  ]);

  expect(await endingsOn(tabId)).toEqual([]);
  expect(await total(tabId)).toBe(5200 - (1900 - share!.reduction));
  expect((await rows(tabId)).map(({ id, lineTotal }) => ({ id, lineTotal }))).toEqual([
    { id: kept1!.id, lineTotal: kept1!.lineTotal },
    { id: kept2!.id, lineTotal: kept2!.lineTotal },
  ]);
});

/** Two Soups (6.00 each) as two portion rows, 6.00 off given over both: 3.00 off each. */
async function sixOffTwoSoups() {
  const { tabId } = await billOf([{ menuItemId: ordinary.Soup, quantity: "2" }]);
  const soups = (await rows(tabId)).filter((row) => specDishOf(spec, row) === "Soup");
  expect(soups).toHaveLength(2);
  const given = await give(
    tabId,
    soups[0]!.id,
    { action: "discount_amount", amount: "6.00" },
    soups.map(({ id }) => id),
  );
  expect(await priced(tabId)).toEqual([
    { what: "Soup", price: 300 },
    { what: "Soup", price: 300 },
  ]);
  return { tabId, given, first: soups[0]!, second: soups[1]! };
}

/** Each row's price by id, with its name. */
async function pricesById(billId: string) {
  return Object.fromEntries(
    (await rows(billId)).map((row) => [
      row.id,
      {
        what: specDishOf(spec, row) ?? row.name,
        unit: row.unitPriceGross,
        total: row.lineTotal,
        list: row.listUnitPriceGross,
      },
    ]),
  );
}

it("takes only the edited Soup's 3.00 share of 6.00 off two Soups when it is given Bread", async () => {
  const { tabId, given, first, second } = await sixOffTwoSoups();

  await editLine(tabId, first.lineNo, { extras: [spec.bread] });

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "extras_changed", dishName: "Soup", lineId: first.id },
  ]);
  const prices = await pricesById(tabId);
  expect(prices[first.id]).toEqual({ what: "Soup", unit: 600, total: 600, list: null });
  expect(prices[second.id]).toEqual({ what: "Soup", unit: 300, total: 300, list: 600 });
  expect(Object.values(prices).filter(({ what }) => what === "Bread")).toEqual([
    { what: "Bread", unit: 150, total: 150, list: null },
  ]);
  expect(await total(tabId)).toBe(1050);
});

it("gives both Soups' shares back in one ending when one edit gives both Bread", async () => {
  const { tabId, given, first, second } = await sixOffTwoSoups();

  await inTx(venue, async (tx) =>
    updateOrderLine(
      tx,
      venue.cfg,
      tabId,
      first.lineNo,
      { portionLineNos: [second.lineNo], extras: [spec.bread] },
      await readOrderRevision(tx, tabId),
      {
        admission: testTradingAdmission(),
        operatorId: venue.operator.personId,
        expectedEdit: await readBillEditState(tx, tabId),
      },
    ),
  );

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "extras_changed", dishName: "Soup", lineId: first.id },
  ]);
  const prices = await pricesById(tabId);
  expect(prices[first.id]).toEqual({ what: "Soup", unit: 600, total: 600, list: null });
  expect(prices[second.id]).toEqual({ what: "Soup", unit: 600, total: 600, list: null });
  expect(await total(tabId)).toBe(1500);
});

it("ends the second Soup's share at a second edit once the first edit ended the first's", async () => {
  const { tabId, given, first, second } = await sixOffTwoSoups();
  await editLine(tabId, first.lineNo, { extras: [spec.bread] });

  await editLine(tabId, second.lineNo, { extras: [spec.bread] });

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "extras_changed", dishName: "Soup", lineId: first.id },
    { adjustmentId: given, why: "extras_changed", dishName: "Soup", lineId: second.id },
  ]);
  const prices = await pricesById(tabId);
  expect(prices[first.id]).toEqual({ what: "Soup", unit: 600, total: 600, list: null });
  expect(prices[second.id]).toEqual({ what: "Soup", unit: 600, total: 600, list: null });
  expect(await total(tabId)).toBe(1500);
});

it("takes only the swapped glass's share of 4.50 off two glasses when a basket save changes its size", async () => {
  const { tabId } = await billOf([{ ...glassOf(wine.small), quantity: "2" }]);
  const [kept, swapped] = (await rows(tabId)).filter(({ name }) => name === "Wine");
  const given = await give(tabId, kept!.id, { action: "discount_amount", amount: "4.50" }, [
    kept!.id,
    swapped!.id,
  ]);
  expect(await total(tabId)).toBe(450);

  await saveBasket(tabId, [
    { workingOrderLineId: kept!.id, ...glassOf(wine.small) },
    { workingOrderLineId: swapped!.id, ...glassOf(wine.large) },
  ]);

  const large = (await rows(tabId)).find(({ productId }) => productId === wine.large)!;
  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "variant_changed", dishName: "Wine", lineId: large.id },
  ]);
  const prices = await pricesById(tabId);
  expect(prices[kept!.id]).toEqual({ what: "Wine", unit: 225, total: 225, list: 450 });
  expect(prices[large.id]).toEqual({ what: "Wine", unit: 550, total: 550, list: null });
  expect(await total(tabId)).toBe(775);
});

/** A counter order, held, no party: one Small glass of Wine, 10% off it. */
async function counterGlassAtTenPercent() {
  expect(venue.counter.menuId).toBe(venue.tables.menuId);
  const orderId = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id: orderId,
    zoneId: venue.counter.zoneId,
    lines: [glassOf(wine.small)],
    operatorId: venue.operator.personId,
  });
  const small = await rowOf(orderId, "Wine");
  const given = await give(orderId, small.id, percent(1000));
  expect(await total(orderId)).toBe(405);
  return { orderId, small, given };
}

it("takes a counter order's glass's 10% off when a basket save changes its size, answering its notice on the held order", async () => {
  const { orderId, small, given } = await counterGlassAtTenPercent();

  await saveBasket(orderId, [{ workingOrderLineId: small.id, ...glassOf(wine.large) }]);

  const large = await rowOf(orderId, "Wine");
  expect(large).toMatchObject({ productId: wine.large, lineTotal: 550, listUnitPriceGross: null });
  expect(await endingsOn(orderId)).toEqual([
    { adjustmentId: given, why: "variant_changed", dishName: "Wine", lineId: large.id },
  ]);
  expect((await getHeldOrder({ db: venue.db }, orderId)).discountNotices).toEqual([
    expect.objectContaining({
      adjustmentId: given,
      why: "variant_changed",
      amount: "0.45",
      reapplyOn: { lineId: large.id },
    }),
  ]);
});

it("offers a counter glass's 10% again on the first of two basket lines that name it at another size", async () => {
  const { orderId, small, given } = await counterGlassAtTenPercent();

  await saveBasket(orderId, [
    { workingOrderLineId: small.id, ...glassOf(wine.large) },
    { workingOrderLineId: small.id, ...glassOf(wine.large), options: serveAs(1) },
  ]);

  const glasses = (await rows(orderId)).filter(({ name }) => name === "Wine");
  expect(glasses).toHaveLength(2);
  const chilled = glasses.find(({ optionSnapshots }) =>
    JSON.stringify(optionSnapshots).includes('"Chilled"'),
  )!;
  expect(await endingsOn(orderId)).toEqual([
    { adjustmentId: given, why: "variant_changed", dishName: "Wine", lineId: chilled.id },
  ]);
  expect(await total(orderId)).toBe(1100);
});
