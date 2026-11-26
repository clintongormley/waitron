import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { adjustments, kitchenCourses, products, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  addProducts,
  createProduct,
  menuItems,
  requireMenuRoot,
  setProductVariants,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ExtraSelection } from "@waitron/shared";
import { applyAdjustment, previewAdjustment, type AdjustmentAsk } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { insertPartyBill, readPartyBills } from "./parties.js";
import { readOrderRevision } from "./working-order-context.js";
import { getHeldOrder } from "./working-order-held-read.js";
import { updateHeldOrder, updateOrderLine } from "./working-order-held-write.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import {
  cancelReasonId,
  COMP_BILL_REASON,
  ensureOperator,
  GIVE_AWAY_REASON,
  reasonIdOf,
} from "./testing/cancel-line.js";
import { commandFor, inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import {
  addSpecDishesToFullMenu,
  sendSpecDraft,
  setupSetMenuSpecVenue,
  specDeps,
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
/** A Wine by the glass in two sizes, on no set menu. */
let wine: { offer: string; small: string; large: string };

async function wineByTheGlass(tx: Transaction) {
  const [main] = await tx
    .select({ id: kitchenCourses.id })
    .from(kitchenCourses)
    .where(eq(kitchenCourses.name, "Main"));
  const parent = await createProduct(tx, {
    categoryId: null,
    name: "Wine",
    pricingUnit: "each",
    unitPrice: "4.50",
    vatClass: "reduced",
  });
  await tx.update(products).set({ courseId: main!.id }).where(eq(products.id, parent.id));
  const [small, large] = await setProductVariants(
    tx,
    parent.id,
    [
      ["Small", "4.50"],
      ["Large", "5.50"],
    ].map(([name, unitPrice]) => ({
      name: name!,
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: unitPrice!,
      available: true,
    })),
    venue.cfg.locale,
  );
  await addProducts(tx, await requireMenuRoot(tx, venue.tables.menuId), [parent.id]);
  spec.daily.versionId = spec.special.versionId = await publishWorkingMenu(tx, venue.tables.menuId);
  const [offer] = await tx
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.menuId, venue.tables.menuId), eq(menuItems.productId, parent.id)));
  return { offer: offer!.id, small: small!.id, large: large!.id };
}

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    ordinary = await addSpecDishesToFullMenu(spec);
    wine = await inTx(venue, async (tx) => {
      await ensureOperator(tx, venue.operator.personId);
      return wineByTheGlass(tx);
    });
  },
});

type Bill = { partyId: string; tabId: string };
type Line = {
  menuItemId: string;
  quantity: string;
  variantId?: string;
  extras?: ExtraSelection[];
};
/** Free, or a percentage in basis points. */
type Given = "free" | number;

const dish = (name: SpecDish): Line => ({ menuItemId: ordinary[name], quantity: "1" });
const glassOf = (variantId: string): Line => ({ menuItemId: wine.offer, variantId, quantity: "1" });

/** A seated bill eaten here, its dishes sent held and grouped by the bill. */
async function billOf(lines: readonly Line[]): Promise<Bill> {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  const draft = await saveSetMenuDraft(venue, bill, ...lines);
  await sendSpecDraft(spec, draft.partyId, draft.id, "hold");
  return bill;
}

async function rowOf(billId: string, what: string) {
  return (await specRows(spec, billId)).find(
    (row) => row.parentLineId === null && (specDishOf(spec, row) ?? row.name) === what,
  )!;
}

async function askOf(
  billId: string,
  lineId: string,
  given: Given | "cancel",
  reapplies?: string,
): Promise<AdjustmentAsk> {
  return inTx(venue, async (tx) => ({
    orderId: billId,
    expectedEdit: await readBillEditState(tx, billId),
    expectedRevision: await readOrderRevision(tx, billId),
    lineId,
    ...(given === "cancel"
      ? { reasonId: await cancelReasonId(tx), action: "cancel" as const }
      : given === "free"
        ? { reasonId: await reasonIdOf(tx, GIVE_AWAY_REASON), action: "comp" as const }
        : {
            reasonId: await reasonIdOf(tx, COMP_BILL_REASON),
            action: "discount_percent" as const,
            percentBp: given,
          }),
    ...(reapplies === undefined ? {} : { reapplies }),
    note: null,
    operatorId: venue.operator.personId,
  }));
}

/** Gives, or cancels, `lineId` through the comp window; answers the adjustment's id. */
async function give(billId: string, lineId: string, given: Given | "cancel", reapplies?: string) {
  const ask = await askOf(billId, lineId, given, reapplies);
  const { adjustmentIds } = await inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      { ...ask, admission: testTradingAdmission(), submissionId: randomUUID() },
      venue.cfg.locale,
    ),
  );
  return adjustmentIds[0]!;
}

async function preview(billId: string, lineId: string, given: Given, reapplies?: string) {
  const ask = await askOf(billId, lineId, given, reapplies);
  return inTx(venue, (tx) => previewAdjustment(tx, venue.cfg, ask, venue.cfg.locale));
}

/** The bill's notices as the party read answers them, checked to be what the counter order read
 * answers. */
async function noticesOn(bill: Bill) {
  const party = (await inTx(venue, (tx) => readPartyBills(tx, bill.partyId))).find(
    ({ workingOrderId }) => workingOrderId === bill.tabId,
  )!;
  const counter = await getHeldOrder({ db: venue.db }, bill.tabId);
  expect("discountNotices" in counter).toBe("discountNotices" in party);
  expect(counter.discountNotices).toEqual(party.discountNotices);
  return party.discountNotices;
}

const REFUSED = { code: "management.request_invalid", params: { field: "reapplies" } };

async function reasonOf(reason: typeof COMP_BILL_REASON) {
  return inTx(venue, (tx) => reasonIdOf(tx, reason));
}

async function otherBill(bill: Bill): Promise<Bill> {
  return {
    partyId: bill.partyId,
    tabId: await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, bill.partyId)),
  };
}

async function move(from: Bill, to: Bill, lineIds: string[]) {
  const command = await commandFor(venue, from.partyId);
  await inTx(venue, (tx) => moveDishes(tx, venue.cfg, from.tabId, to.tabId, lineIds, command));
}

async function editExtras(billId: string, lineNo: number, extras: ExtraSelection[]) {
  await inTx(venue, async (tx) =>
    updateOrderLine(
      tx,
      venue.cfg,
      billId,
      lineNo,
      { portionLineNos: [], extras },
      await readOrderRevision(tx, billId),
      {
        admission: testTradingAdmission(),
        operatorId: venue.operator.personId,
        expectedEdit: await readBillEditState(tx, billId),
      },
    ),
  );
}

it("answers the 50% a Daily lost when its Hake was cancelled, offering it again nowhere, until 50% on the Soup gives it again", async () => {
  const bill = await billOf([dish("Soup"), dish("Hake")]);
  const given = await give(bill.tabId, (await rowOf(bill.tabId, "Daily menu")).id, 5000);
  await give(bill.tabId, (await rowOf(bill.tabId, "Hake")).id, "cancel");

  expect(await noticesOn(bill)).toEqual([
    {
      adjustmentId: given,
      why: "dish_cancelled",
      dishName: "Hake",
      on: "Daily menu",
      action: "discount_percent",
      percentBp: 5000,
      amount: "7.00",
      reasonId: await reasonOf(COMP_BILL_REASON),
      reapplyOn: null,
    },
  ]);
  const soup = (await rowOf(bill.tabId, "Soup")).id;
  expect((await preview(bill.tabId, soup, 5000, given)).reduction).toBe("3.00");

  const again = await give(bill.tabId, soup, 5000, given);

  expect(await noticesOn(bill)).toBeUndefined();
  const [recorded] = await venue.db
    .select({ reapplies: adjustments.reappliesAdjustmentId })
    .from(adjustments)
    .where(eq(adjustments.id, again));
  expect(recorded!.reapplies).toBe(given);
  await expect(give(bill.tabId, soup, 5000, given)).rejects.toMatchObject(REFUSED);
});

it("offers a Soup's 50% again on the Soup once its Bread took it off, at 3.75 off its 7.50", async () => {
  const bill = await billOf([dish("Soup")]);
  const soup = await rowOf(bill.tabId, "Soup");
  const given = await give(bill.tabId, soup.id, 5000);

  await editExtras(bill.tabId, soup.lineNo, [spec.bread]);

  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({
      adjustmentId: given,
      why: "extras_changed",
      dishName: "Soup",
      on: "Soup",
      amount: "3.00",
      reapplyOn: { lineId: soup.id },
    }),
  ]);
  expect((await preview(bill.tabId, soup.id, 5000, given)).reduction).toBe("3.75");
});

it("answers no notice once the Soup whose Bread took its 50% off is cancelled", async () => {
  const bill = await billOf([dish("Soup")]);
  const soup = await rowOf(bill.tabId, "Soup");
  await give(bill.tabId, soup.id, 5000);
  await editExtras(bill.tabId, soup.lineNo, [spec.bread]);

  await give(bill.tabId, soup.id, "cancel");

  expect(await noticesOn(bill)).toBeUndefined();
});

it("offers a glass's 10% again on the new line once a basket save changed its size", async () => {
  const bill = await billOf([glassOf(wine.small)]);
  const small = await rowOf(bill.tabId, "Wine");
  const given = await give(bill.tabId, small.id, 1000);

  await updateHeldOrder(
    { db: venue.db, admission: testTradingAdmission() },
    venue.cfg,
    bill.tabId,
    {
      ...(await inTx(venue, async (tx) => ({
        expectedEdit: await readBillEditState(tx, bill.tabId),
        revision: await readOrderRevision(tx, bill.tabId),
      }))),
      operatorId: venue.operator.personId,
      lines: [{ workingOrderLineId: small.id, ...glassOf(wine.large) }],
    },
  );

  const large = await rowOf(bill.tabId, "Wine");
  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({
      adjustmentId: given,
      why: "variant_changed",
      reapplyOn: { lineId: large.id },
    }),
  ]);
});

it("keeps a free Daily's notice once the Soup its Hake left is cancelled too", async () => {
  const bill = await billOf([dish("Soup"), dish("Hake")]);
  const given = await give(bill.tabId, (await rowOf(bill.tabId, "Daily menu")).id, "free");
  await give(bill.tabId, (await rowOf(bill.tabId, "Hake")).id, "cancel");
  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({ adjustmentId: given, action: "comp", reapplyOn: null }),
  ]);

  await give(bill.tabId, (await rowOf(bill.tabId, "Soup")).id, "cancel");

  // Nothing records a set menu's dishes once it breaks up, so its notice stays (ruling of 26 Nov).
  expect(await noticesOn(bill)).toEqual([expect.objectContaining({ adjustmentId: given })]);
});

it("answers the 10% a Daily lost when its Sirloin moved alone on the bill it left, not the one it went to", async () => {
  const bill = await billOf([dish("Soup"), dish("Sirloin")]);
  const given = await give(bill.tabId, (await rowOf(bill.tabId, "Daily menu")).id, 1000);
  const target = await otherBill(bill);

  await move(bill, target, [(await rowOf(bill.tabId, "Sirloin")).id]);

  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({
      adjustmentId: given,
      why: "dish_moved",
      dishName: "Sirloin",
      reapplyOn: null,
    }),
  ]);
  expect(await noticesOn(target)).toBeUndefined();
  const sirloin = (await rowOf(target.tabId, "Daily menu")).id;
  await expect(give(target.tabId, sirloin, 1000, given)).rejects.toMatchObject(REFUSED);
});

it("answers a 10% Daily's notice on the bill it moved to whole once its Sirloin is cancelled there", async () => {
  const bill = await billOf([dish("Soup"), dish("Sirloin")]);
  const given = await give(bill.tabId, (await rowOf(bill.tabId, "Daily menu")).id, 1000);
  const target = await otherBill(bill);
  await move(bill, target, [
    (await rowOf(bill.tabId, "Soup")).id,
    (await rowOf(bill.tabId, "Sirloin")).id,
  ]);

  await give(target.tabId, (await rowOf(target.tabId, "Sirloin")).id, "cancel");

  expect(await noticesOn(target)).toEqual([
    expect.objectContaining({ adjustmentId: given, why: "dish_cancelled", dishName: "Sirloin" }),
  ]);
  expect(await noticesOn(bill)).toBeUndefined();
  const soup = (await rowOf(target.tabId, "Soup")).id;
  const draft = await saveSetMenuDraft(venue, bill, dish("Soup"));
  await sendSpecDraft(spec, draft.partyId, draft.id, "hold");
  await expect(
    give(bill.tabId, (await rowOf(bill.tabId, "Soup")).id, 1000, given),
  ).rejects.toMatchObject(REFUSED);
  await give(target.tabId, soup, 1000, given);
  expect(await noticesOn(target)).toBeUndefined();
});

it.each<{ name: string; build: () => Promise<Bill> }>([
  {
    name: "a Daily's 10% replaced by 20%",
    build: async () => {
      const bill = await billOf([dish("Soup"), dish("Hake")]);
      await give(bill.tabId, (await rowOf(bill.tabId, "Daily menu")).id, 1000);
      await give(bill.tabId, (await rowOf(bill.tabId, "Daily menu")).id, 2000);
      return bill;
    },
  },
  {
    name: "a lone Hake Daily at 10% cancelled whole",
    build: async () => {
      const bill = await billOf([dish("Hake")]);
      await give(bill.tabId, (await rowOf(bill.tabId, "Daily menu")).id, 1000);
      await give(bill.tabId, (await rowOf(bill.tabId, "Hake")).id, "cancel");
      return bill;
    },
  },
  {
    name: "a Soup's own 50% cancelled with it",
    build: async () => {
      const bill = await billOf([dish("Soup")]);
      await give(bill.tabId, (await rowOf(bill.tabId, "Soup")).id, 5000);
      await give(bill.tabId, (await rowOf(bill.tabId, "Soup")).id, "cancel");
      return bill;
    },
  },
  { name: "a bill nothing came off", build: () => billOf([dish("Soup")]) },
])("answers no notice key for $name", async ({ build }) => {
  expect(await noticesOn(await build())).toBeUndefined();
});

it("refuses to give again a comp or discount that still stands", async () => {
  const bill = await billOf([dish("Soup")]);
  const soup = (await rowOf(bill.tabId, "Soup")).id;
  const given = await give(bill.tabId, soup, 5000);

  await expect(preview(bill.tabId, soup, 1000, given)).rejects.toMatchObject(REFUSED);
  await expect(give(bill.tabId, soup, 1000, given)).rejects.toMatchObject(REFUSED);
});

it("answers no notice on a paid bill while its party stays open", async () => {
  const bill = await billOf([dish("Soup"), dish("Sirloin")]);
  await give(bill.tabId, (await rowOf(bill.tabId, "Daily menu")).id, 1000);
  const target = await otherBill(bill);
  await move(bill, target, [(await rowOf(bill.tabId, "Sirloin")).id]);
  expect(await noticesOn(bill)).toHaveLength(1);

  await takeBillPayment(
    specDeps(spec),
    venue.cfg,
    bill.tabId,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "6.00",
      method: "cash",
      tendered: "6.00",
      applied: "6.00",
      tip: "0.00",
      ownReceipt: true,
    },
    venue.operator,
  );

  const bills = await inTx(venue, (tx) => readPartyBills(tx, bill.partyId));
  const paid = bills.find(({ workingOrderId }) => workingOrderId === bill.tabId)!;
  expect(paid.status).toBe("settled");
  expect("discountNotices" in paid).toBe(false);
  expect(bills.find(({ workingOrderId }) => workingOrderId === target.tabId)!.status).toBe("open");
});

/** Two Soups as two portion rows, 50% off given over both: 3.00 off each. */
async function halfOffTwoSoups() {
  const bill = await billOf([{ menuItemId: ordinary.Soup, quantity: "2" }]);
  const [first, second] = (await specRows(spec, bill.tabId)).filter(
    (row) => specDishOf(spec, row) === "Soup",
  );
  const ask = await askOf(bill.tabId, first!.id, 5000);
  const { adjustmentIds } = await inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        ...ask,
        lineIds: [first!.id, second!.id],
        admission: testTradingAdmission(),
        submissionId: randomUUID(),
      },
      venue.cfg.locale,
    ),
  );
  return { bill, given: adjustmentIds[0]!, first: first!, second: second! };
}

it("answers what came off the one Soup given Bread, 3.00 of a 6.00 off two Soups, then 6.00 once the other is given Bread too", async () => {
  const { bill, given, first, second } = await halfOffTwoSoups();

  await editExtras(bill.tabId, first.lineNo, [spec.bread]);

  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({
      adjustmentId: given,
      amount: "3.00",
      reapplyOn: { lineId: first.id },
    }),
  ]);

  await editExtras(bill.tabId, second.lineNo, [spec.bread]);

  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({
      adjustmentId: given,
      amount: "6.00",
      reapplyOn: { lineId: first.id },
    }),
  ]);
});

it("refuses to give a Soup's 50% again on the Wine, keeping the Soup's notice", async () => {
  const bill = await billOf([dish("Soup"), glassOf(wine.small)]);
  const soup = await rowOf(bill.tabId, "Soup");
  const given = await give(bill.tabId, soup.id, 5000);
  await editExtras(bill.tabId, soup.lineNo, [spec.bread]);
  const glass = (await rowOf(bill.tabId, "Wine")).id;

  await expect(preview(bill.tabId, glass, 5000, given)).rejects.toMatchObject(REFUSED);
  await expect(give(bill.tabId, glass, 5000, given)).rejects.toMatchObject(REFUSED);

  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({ adjustmentId: given, reapplyOn: { lineId: soup.id } }),
  ]);
});

/** {@link halfOffTwoSoups}, then one edit gives both Bread, so one ending takes both Soups'
 * shares off and its notice names the first. */
async function breadOnBothSoups() {
  const soups = await halfOffTwoSoups();
  const { bill, first, second } = soups;
  await inTx(venue, async (tx) =>
    updateOrderLine(
      tx,
      venue.cfg,
      bill.tabId,
      first.lineNo,
      { portionLineNos: [second.lineNo], extras: [spec.bread] },
      await readOrderRevision(tx, bill.tabId),
      {
        admission: testTradingAdmission(),
        operatorId: venue.operator.personId,
        expectedEdit: await readBillEditState(tx, bill.tabId),
      },
    ),
  );
  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({ adjustmentId: soups.given, reapplyOn: { lineId: first.id } }),
  ]);
  return soups;
}

it("gives a 50% again over both Soups of a row when the line its notice names is among them", async () => {
  const { bill, given, first, second } = await breadOnBothSoups();
  const ask = {
    ...(await askOf(bill.tabId, second.id, 5000, given)),
    lineIds: [second.id, first.id],
  };

  expect(
    (await inTx(venue, (tx) => previewAdjustment(tx, venue.cfg, ask, venue.cfg.locale))).reduction,
  ).toBe("7.50");
  await inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      { ...ask, admission: testTradingAdmission(), submissionId: randomUUID() },
      venue.cfg.locale,
    ),
  );

  expect(await noticesOn(bill)).toBeUndefined();
});

it("refuses to give a 50% again on one Soup of a row when it would go on the Soup its notice does not name, keeping the notice", async () => {
  const { bill, given, first, second } = await breadOnBothSoups();
  const ask = {
    ...(await askOf(bill.tabId, second.id, 5000, given)),
    lineIds: [second.id, first.id],
    quantity: "1",
  };

  await expect(
    inTx(venue, (tx) => previewAdjustment(tx, venue.cfg, ask, venue.cfg.locale)),
  ).rejects.toMatchObject(REFUSED);
  await expect(
    inTx(venue, (tx) =>
      applyAdjustment(
        tx,
        venue.cfg,
        { ...ask, admission: testTradingAdmission(), submissionId: randomUUID() },
        venue.cfg.locale,
      ),
    ),
  ).rejects.toMatchObject(REFUSED);

  const soups = (await specRows(spec, bill.tabId)).filter(
    (row) => specDishOf(spec, row) === "Soup",
  );
  expect(soups.map(({ lineTotal }) => lineTotal)).toEqual([600, 600]);
  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({
      adjustmentId: given,
      amount: "6.00",
      reapplyOn: { lineId: first.id },
    }),
  ]);
});

it("gives a 50% over two Soups again on the second Soup once two edits each took a Soup's share off", async () => {
  const { bill, given, first, second } = await halfOffTwoSoups();
  await editExtras(bill.tabId, first.lineNo, [spec.bread]);
  await editExtras(bill.tabId, second.lineNo, [spec.bread]);
  expect(await noticesOn(bill)).toEqual([
    expect.objectContaining({
      adjustmentId: given,
      amount: "6.00",
      reapplyOn: { lineId: first.id },
    }),
  ]);

  expect((await preview(bill.tabId, second.id, 5000, given)).reduction).toBe("3.75");
  await give(bill.tabId, second.id, 5000, given);

  expect(await noticesOn(bill)).toBeUndefined();
});
