import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createDepartment,
  createServiceZone,
  setDepartmentSalePolicyField,
} from "@waitron/venue-service";
import { insertPartyBill } from "./parties.js";
import { payForItems, previewPayForItems, type ItemPick } from "./pay-for-items.js";
import { readGroupingCopies } from "./set-menu-regroup.js";
import { storedOrderTotal } from "./stored-order-lines.js";
import { parkOrder } from "./working-order-open.js";
import { markServed } from "./working-order-serving.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { ensureOperator } from "./testing/cancel-line.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { commandFor, inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import {
  addSpecDishesToFullMenu,
  cancelSpecLineKeepingCharge,
  compSpecLine,
  groupSpecBillByHand,
  makeSpecRowOfTwo,
  printSpecBill,
  saveSpecDishes,
  sendSpecDraft,
  serveSpecBill,
  setupSetMenuSpecVenue,
  specDeps,
  specGrouping,
  specLineId,
  specPayRequest,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { freezeBillLine } from "./testing/set-menu-bill-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";

let spec: SpecVenue;
let venue: PartyVenue;
/** The full menu's offer of each dish, the same in every zone. */
let ordinary: Record<SpecDish, string>;
let takeawayZoneId: string;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    takeawayZoneId = await inTx(venue, async (tx) => {
      const shop = await createDepartment(tx, { name: "Takeaway shop", orderStart: "counter" });
      await setDepartmentSalePolicyField(tx, shop.id, "dining", "takeaway");
      const zone = await createServiceZone(tx, { name: "Takeaway shop", departmentId: shop.id });
      await ensureOperator(tx, venue.operator.personId);
      return (await offerProducts(tx, { zone: { zoneId: zone.id } })).zoneId;
    });
    ordinary = await addSpecDishesToFullMenu(spec);
  },
});

type Bill = { partyId: string | null; tabId: string };
type SeatedBill = Bill & { partyId: string };

/** A bill at a fresh table with the dishes sent in one round. */
async function seatedBill(...dishes: SpecDish[]): Promise<SeatedBill> {
  const bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await send(
    bill,
    dishes.map((dish) => ordinary[dish]),
  );
  return bill;
}

function send(bill: SeatedBill, menuItemIds: string[]) {
  return inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, bill.partyId, {
      operatorId: venue.operator.personId,
      billId: bill.tabId,
      groups: [
        {
          lines: menuItemIds.map((menuItemId) => ({ menuItemId, quantity: "1" })),
          release: "fire",
        },
      ],
    }),
  );
}

/** Sends a Water (2.00), which no set menu lists, so that the bill keeps a dish of its own. */
async function sendWater(bill: SeatedBill): Promise<string> {
  await send(bill, [venue.item("Water")]);
  return specLineId(spec, bill.tabId, "Water");
}

/**
 * A bill of one row of two Soups, Hake and a Water, the Soups' bread one row whose columns are
 * `bread`: 12.00 + 3.00 + 14.00 + 2.00.
 */
async function soupsWithBread(
  bread = { quantity: 2000, priceQuantity: 1000 },
): Promise<SeatedBill> {
  const bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  const draft = await saveSpecDishes(spec, bill, [
    { dish: "Soup", from: spec.daily, extras: [spec.bread] },
    { dish: "Hake", from: spec.daily },
  ]);
  await sendSpecDraft(spec, bill.partyId, draft.id, "fire");
  const soup = await specLineId(spec, bill.tabId, "Soup");
  await makeSpecRowOfTwo(spec, soup, 0);
  await venue.db
    .update(workingOrderLines)
    .set({ ...bread, lineTotal: 300 })
    .where(eq(workingOrderLines.parentLineId, soup));
  await sendWater(bill);
  expect(await totalOf(bill.tabId)).toBe("31.00");
  return bill;
}

async function preview(bill: Bill, picks: ItemPick[]): Promise<string> {
  const { total } = await previewPayForItems(
    specDeps(spec),
    venue.cfg,
    bill.tabId,
    { picks, method: "cash", tendered: "100.00" },
    null,
  );
  return total;
}

/** Pays for the items in cash and answers the bill they were paid on. */
async function pay(bill: Bill, picks: ItemPick[], applied: string): Promise<string> {
  const paid = await payForItems(
    specDeps(spec),
    venue.cfg,
    bill.tabId,
    await specPayRequest(spec, bill, picks, { method: "cash", applied, tendered: applied }),
    venue.operator,
    null,
  );
  expect(paid.payment.outcome).toBe("received");
  return paid.billId;
}

/** Takes `amount` in cash towards the bill with its own receipt. */
async function advance(bill: Bill, amount: string) {
  await takeBillPayment(
    specDeps(spec),
    venue.cfg,
    bill.tabId,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
      ownReceipt: true,
    },
    venue.operator,
  );
}

function totalOf(billId: string) {
  return inTx(venue, (tx) => storedOrderTotal(tx, billId));
}

function billsPaidFrom(billId: string) {
  return venue.db
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(eq(workingOrders.itemsPaidFrom, billId));
}

/** That neither the preview nor the payment takes the picks, and the refusals move nothing. */
async function refusesBoth(bill: SeatedBill, picks: ItemPick[], refusal: object) {
  const before = await specRows(spec, bill.tabId);
  await expect(preview(bill, picks)).rejects.toMatchObject(refusal);
  await expect(pay(bill, picks, "14.00")).rejects.toMatchObject(refusal);
  expect(await specRows(spec, bill.tabId)).toEqual(before);
  expect(await billsPaidFrom(bill.tabId)).toEqual([]);
}

describe("Pay for items prices chosen items as their own bill groups them", () => {
  it("prices Hake alone from a Daily at the 14.00 Daily its new bill makes of it, and Soup returns to 6.00", async () => {
    const bill = await seatedBill("Soup", "Hake");
    expect(await totalOf(bill.tabId)).toBe("14.00");
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Hake") }];

    expect(await preview(bill, picks)).toBe("14.00");
    const newBill = await pay(bill, picks, "14.00");

    expect(await totalOf(newBill)).toBe("14.00");
    expect(await totalOf(bill.tabId)).toBe("6.00");
  });

  it("prices Soup alone from a Daily at its a la carte 6.00, and Hake stays at 14.00", async () => {
    const bill = await seatedBill("Soup", "Hake");
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Soup") }];

    expect(await preview(bill, picks)).toBe("6.00");
    const newBill = await pay(bill, picks, "6.00");

    expect(await totalOf(newBill)).toBe("6.00");
    expect(await totalOf(bill.tabId)).toBe("14.00");
  });

  it("prices Soup and Hake from two different Dailies as one Daily", async () => {
    const bill = await seatedBill("Soup", "Hake", "Soup", "Hake");
    expect(await totalOf(bill.tabId)).toBe("28.00");
    const rows = await specRows(spec, bill.tabId);
    const soup = rows.find(({ productId }) => productId === spec.productIds.Soup)!;
    const hake = rows.find(
      ({ productId, setMenuLineId }) =>
        productId === spec.productIds.Hake && setMenuLineId !== soup.setMenuLineId,
    )!;
    const picks = [{ lineId: soup.id }, { lineId: hake.id }];

    expect(await preview(bill, picks)).toBe("14.00");
    const newBill = await pay(bill, picks, "14.00");

    expect(await totalOf(newBill)).toBe("14.00");
    expect(await totalOf(bill.tabId)).toBe("14.00");
  });

  it("prices a Daily chosen with its dishes at 14.00, once", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await sendWater(bill);
    const picks = [
      { lineId: await specLineId(spec, bill.tabId, "Daily menu") },
      { lineId: await specLineId(spec, bill.tabId, "Soup") },
      { lineId: await specLineId(spec, bill.tabId, "Hake") },
    ];

    expect(await preview(bill, picks)).toBe("14.00");
    const newBill = await pay(bill, picks, "14.00");

    expect(await totalOf(newBill)).toBe("14.00");
    expect(await totalOf(bill.tabId)).toBe("2.00");
  });

  it("prices Sirloin chosen with Soup, without their Daily, at 19.00", async () => {
    const bill = await seatedBill("Soup", "Sirloin");
    await sendWater(bill);
    const picks = [
      { lineId: await specLineId(spec, bill.tabId, "Sirloin") },
      { lineId: await specLineId(spec, bill.tabId, "Soup") },
    ];

    expect(await preview(bill, picks)).toBe("19.00");
    const newBill = await pay(bill, picks, "19.00");

    expect(await totalOf(newBill)).toBe("19.00");
    expect(await totalOf(bill.tabId)).toBe("2.00");
  });

  it("keeps a comped dish that is in no set menu at its stored price", async () => {
    const bill = await seatedBill("Sea bass");
    const seaBass = await specLineId(spec, bill.tabId, "Sea bass");
    await compSpecLine(spec, bill.tabId, seaBass);
    await send(bill, [ordinary.Soup]);
    await sendWater(bill);
    const picks = [{ lineId: seaBass }, { lineId: await specLineId(spec, bill.tabId, "Soup") }];

    expect(await preview(bill, picks)).toBe("6.00");
    const newBill = await pay(bill, picks, "6.00");

    expect(await totalOf(newBill)).toBe("6.00");
    expect(await totalOf(bill.tabId)).toBe("2.00");
  });

  it("prices one of two waters beside a dish of a Daily", async () => {
    const bill = await seatedBill("Soup", "Hake");
    const water = await sendWater(bill);
    await makeSpecRowOfTwo(spec, water, 400);
    const picks = [
      { lineId: water, quantity: "1" },
      { lineId: await specLineId(spec, bill.tabId, "Hake") },
    ];

    expect(await preview(bill, picks)).toBe("16.00");
    const newBill = await pay(bill, picks, "16.00");

    expect(await totalOf(newBill)).toBe("16.00");
    expect(await totalOf(bill.tabId)).toBe("8.00");
  });

  it("groups one of two Hakes held in one row as the single Hake its new bill holds", async () => {
    const bill = await seatedBill("Hake");
    const hake = await specLineId(spec, bill.tabId, "Hake");
    await makeSpecRowOfTwo(spec, hake, 0);
    await sendWater(bill);
    expect(await totalOf(bill.tabId)).toBe("34.00");
    const picks = [{ lineId: hake, quantity: "1" }];

    expect(await preview(bill, picks)).toBe("14.00");
    const newBill = await pay(bill, picks, "14.00");

    expect(await totalOf(newBill)).toBe("14.00");
    expect(await totalOf(bill.tabId)).toBe("16.00");
  });

  it("prices one of two Soups held in one row with its own part of their bread", async () => {
    const bill = await soupsWithBread();
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Soup"), quantity: "1" }];

    expect(await preview(bill, picks)).toBe("7.50");
    const newBill = await pay(bill, picks, "7.50");

    expect(await totalOf(newBill)).toBe("7.50");
    expect(await totalOf(bill.tabId)).toBe("17.50");
  });

  it("prices one of two Soups with its part of their bread, and Hake, as a Daily and the bread", async () => {
    const bill = await soupsWithBread();
    const picks = [
      { lineId: await specLineId(spec, bill.tabId, "Soup"), quantity: "1" },
      { lineId: await specLineId(spec, bill.tabId, "Hake") },
    ];

    expect(await preview(bill, picks)).toBe("15.50");
    const newBill = await pay(bill, picks, "15.50");

    expect(await totalOf(newBill)).toBe("15.50");
    expect(await totalOf(bill.tabId)).toBe("9.50");
  });

  it("prices a part's extra that is sold by measure per the amount its price buys", async () => {
    const bill = await soupsWithBread({ quantity: 100, priceQuantity: 50 });
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Soup"), quantity: "1" }];

    expect(await preview(bill, picks)).toBe("7.50");
    const newBill = await pay(bill, picks, "7.50");

    expect(await totalOf(newBill)).toBe("7.50");
    expect(await totalOf(bill.tabId)).toBe("17.50");
  });

  it("keeps a paid extra in the price of a dish chosen without its set menu", async () => {
    const bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
    const draft = await saveSpecDishes(spec, bill, [
      { dish: "Soup", from: spec.daily, extras: [spec.bread] },
      { dish: "Hake", from: spec.daily },
    ]);
    await sendSpecDraft(spec, bill.partyId, draft.id, "fire");
    expect(await totalOf(bill.tabId)).toBe("15.50");
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Soup") }];

    expect(await preview(bill, picks)).toBe("7.50");
    const newBill = await pay(bill, picks, "7.50");

    expect(await totalOf(newBill)).toBe("7.50");
    expect(await totalOf(bill.tabId)).toBe("14.00");
  });

  it("keeps a dish's paid extra when its set menu is chosen", async () => {
    const bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
    const draft = await saveSpecDishes(spec, bill, [
      { dish: "Soup", from: spec.daily, extras: [spec.bread] },
      { dish: "Hake", from: spec.daily },
    ]);
    await sendSpecDraft(spec, bill.partyId, draft.id, "fire");
    await sendWater(bill);
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Daily menu") }];

    expect(await preview(bill, picks)).toBe("15.50");
    const newBill = await pay(bill, picks, "15.50");

    expect(await totalOf(newBill)).toBe("15.50");
    expect(await totalOf(bill.tabId)).toBe("2.00");
  });

  it("prices a dish with no comp of its own out of a comped Daily, which stays (D18)", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await compSpecLine(spec, bill.tabId, await specLineId(spec, bill.tabId, "Daily menu"));
    expect(await totalOf(bill.tabId)).toBe("0.00");
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Hake") }];

    expect(await preview(bill, picks)).toBe("14.00");
    const newBill = await pay(bill, picks, "14.00");

    expect(await totalOf(newBill)).toBe("14.00");
    expect((await specGrouping(spec, bill.tabId)).rows).toEqual([
      { what: "Soup", price: 0, in: "Daily menu 1" },
      { what: "Daily menu 1", price: 0 },
    ]);
  });

  it("keeps a comped Daily at its stored price when it is chosen", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await compSpecLine(spec, bill.tabId, await specLineId(spec, bill.tabId, "Daily menu"));
    const water = await sendWater(bill);
    await sendWater(bill);
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Daily menu") }, { lineId: water }];

    expect(await preview(bill, picks)).toBe("2.00");
    const newBill = await pay(bill, picks, "2.00");

    expect(await totalOf(newBill)).toBe("2.00");
    expect(await totalOf(bill.tabId)).toBe("2.00");
  });

  it("takes a comped dish without the Soup its set menu held, at 0.00, when something else is paid for", async () => {
    const bill = await seatedBill("Soup", "Sirloin");
    const sirloin = await specLineId(spec, bill.tabId, "Sirloin");
    await compSpecLine(spec, bill.tabId, sirloin);
    const water = await sendWater(bill);

    await refusesBoth(bill, [{ lineId: sirloin }], {
      code: "bill.nothing_outstanding",
    });
    const picks = [{ lineId: sirloin }, { lineId: water }];
    expect(await preview(bill, picks)).toBe("2.00");
    const newBill = await pay(bill, picks, "2.00");

    expect((await specGrouping(spec, newBill)).rows).toEqual([
      { what: "Sirloin", price: 0, in: null },
      { what: "Water", price: 200, in: null },
    ]);
    expect((await specGrouping(spec, bill.tabId)).rows).toEqual([
      { what: "Soup", price: 600, in: null },
    ]);
  });

  it("refuses a dish reduced inside its set menu, chosen without it, in the preview as in the payment", async () => {
    const bill = await seatedBill("Soup", "Sirloin");
    const sirloin = await specLineId(spec, bill.tabId, "Sirloin");
    await inTx(venue, (tx) => freezeBillLine(tx, sirloin));

    await refusesBoth(bill, [{ lineId: sirloin }], {
      code: "set_menu.move_adjusted",
      params: { dishNames: ["Sirloin"] },
    });
  });

  it("takes a dish reduced inside its set menu, chosen with it, at what they come to", async () => {
    const bill = await seatedBill("Soup", "Sirloin");
    const sirloin = await specLineId(spec, bill.tabId, "Sirloin");
    await inTx(venue, (tx) => freezeBillLine(tx, sirloin));
    await sendWater(bill);
    const picks = [
      { lineId: await specLineId(spec, bill.tabId, "Daily menu") },
      { lineId: sirloin },
    ];

    expect(await preview(bill, picks)).toBe("19.00");
    const newBill = await pay(bill, picks, "19.00");

    expect(await totalOf(newBill)).toBe("19.00");
    expect(await totalOf(bill.tabId)).toBe("2.00");
  });

  it("refuses a dish whose cancel kept its charge, without its set menu, in the preview as in the payment", async () => {
    const bill = await seatedBill("Soup", "Hake");
    const hake = await specLineId(spec, bill.tabId, "Hake");
    await cancelSpecLineKeepingCharge(spec, bill.tabId, hake);

    await refusesBoth(bill, [{ lineId: hake }], {
      code: "set_menu.moves_with_set_menu",
      params: { dishName: "Hake" },
    });
  });

  it("prices and pays a dish of a Daily on a counter takeaway bill", async () => {
    const tabId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: tabId,
      zoneId: takeawayZoneId,
      lines: [
        { menuItemId: ordinary.Soup, quantity: "1" },
        { menuItemId: ordinary.Sirloin, quantity: "1" },
      ],
      operatorId: venue.operator.personId,
      dining: "takeaway",
    });
    const bill = { partyId: null, tabId };
    expect(await totalOf(tabId)).toBe("19.00");
    const picks = [{ lineId: await specLineId(spec, tabId, "Sirloin") }];

    expect(await preview(bill, picks)).toBe("19.00");
    const newBill = await pay(bill, picks, "19.00");

    expect(await totalOf(newBill)).toBe("19.00");
    expect(await totalOf(tabId)).toBe("6.00");
  });

  it("answers the stored prices of a bill that takes no set menus", async () => {
    const tabId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: tabId,
      zoneId: venue.counter.zoneId,
      lines: [
        { menuItemId: ordinary.Soup, quantity: "1" },
        { menuItemId: ordinary.Hake, quantity: "1" },
      ],
      operatorId: venue.operator.personId,
    });
    const bill = { partyId: null, tabId };
    const picks = [{ lineId: await specLineId(spec, tabId, "Hake") }];

    expect(await preview(bill, picks)).toBe("16.00");
    const newBill = await pay(bill, picks, "16.00");

    expect(await totalOf(newBill)).toBe("16.00");
    expect(await totalOf(tabId)).toBe("6.00");
  });

  it("answers the stored prices of a bill holding set-menu copies that now takes no set menus", async () => {
    const tabId = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id: tabId,
      zoneId: takeawayZoneId,
      lines: [
        { menuItemId: ordinary.Soup, quantity: "1" },
        { menuItemId: ordinary.Hake, quantity: "1" },
        { menuItemId: ordinary.Soup, quantity: "1" },
      ],
      operatorId: venue.operator.personId,
      dining: "takeaway",
    });
    await groupSpecBillByHand(spec, tabId, []);
    await venue.db
      .update(workingOrders)
      .set({ dining: "eat_in" })
      .where(eq(workingOrders.id, tabId));
    expect(await inTx(venue, (tx) => readGroupingCopies(tx, tabId))).not.toEqual([]);
    const bill = { partyId: null, tabId };
    const picks = [
      { lineId: await specLineId(spec, tabId, "Soup") },
      { lineId: await specLineId(spec, tabId, "Hake") },
    ];

    expect(await preview(bill, picks)).toBe("22.00");
    const newBill = await pay(bill, picks, "22.00");

    expect(await totalOf(newBill)).toBe("22.00");
    expect(await totalOf(tabId)).toBe("6.00");
  });
});

describe("Pay for items of set menus on a printed bill, whose dishes the payment copies to a reopened bill", () => {
  async function printed(...dishes: SpecDish[]): Promise<SeatedBill> {
    const bill = await seatedBill(...dishes);
    await serveSpecBill(spec, bill.partyId, bill.tabId);
    await printSpecBill(spec, bill.partyId, bill.tabId);
    return bill;
  }

  async function reopenedFrom(billId: string): Promise<string[]> {
    const rows = await venue.db
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(eq(workingOrders.reopenedFrom, billId));
    return rows.map(({ id }) => id);
  }

  it("prices Sirloin alone from a Daily at the 19.00 it is paid at, and Soup returns to 6.00", async () => {
    const bill = await printed("Soup", "Sirloin");
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Sirloin") }];

    expect(await preview(bill, picks)).toBe("19.00");
    const newBill = await pay(bill, picks, "19.00");

    expect(await totalOf(newBill)).toBe("19.00");
    const [reopened] = await reopenedFrom(bill.tabId);
    expect(await totalOf(reopened!)).toBe("6.00");
  });

  it("takes a comped dish without the Soup its set menu held, which the reopened bill keeps at 6.00", async () => {
    const bill = await seatedBill("Soup", "Sirloin");
    const sirloin = await specLineId(spec, bill.tabId, "Sirloin");
    await compSpecLine(spec, bill.tabId, sirloin);
    const water = await sendWater(bill);
    await serveSpecBill(spec, bill.partyId, bill.tabId);
    await printSpecBill(spec, bill.partyId, bill.tabId);

    await refusesBoth(bill, [{ lineId: sirloin }], {
      code: "bill.nothing_outstanding",
    });
    expect(await reopenedFrom(bill.tabId)).toEqual([]);
    const picks = [{ lineId: sirloin }, { lineId: water }];
    expect(await preview(bill, picks)).toBe("2.00");
    const newBill = await pay(bill, picks, "2.00");

    expect((await specGrouping(spec, newBill)).rows).toEqual([
      { what: "Sirloin", price: 0, in: null },
      { what: "Water", price: 200, in: null },
    ]);
    const [reopened] = await reopenedFrom(bill.tabId);
    expect((await specGrouping(spec, reopened!)).rows).toEqual([
      { what: "Soup", price: 600, in: null },
    ]);
  });

  it("refuses a dish reduced inside its set menu, chosen without it, and reopens nothing", async () => {
    const bill = await seatedBill("Soup", "Sirloin");
    const sirloin = await specLineId(spec, bill.tabId, "Sirloin");
    await inTx(venue, (tx) => freezeBillLine(tx, sirloin));
    await serveSpecBill(spec, bill.partyId, bill.tabId);
    await printSpecBill(spec, bill.partyId, bill.tabId);

    await refusesBoth(bill, [{ lineId: sirloin }], {
      code: "set_menu.move_adjusted",
      params: { dishNames: ["Sirloin"] },
    });
    expect(await reopenedFrom(bill.tabId)).toEqual([]);
  });

  it("refuses a dish whose cancel kept its charge, without its set menu, and reopens nothing", async () => {
    const bill = await seatedBill("Soup", "Hake");
    const hake = await specLineId(spec, bill.tabId, "Hake");
    await cancelSpecLineKeepingCharge(spec, bill.tabId, hake);
    const command = await commandFor(venue, bill.partyId);
    await inTx(venue, async (tx) =>
      markServed(
        tx,
        venue.cfg,
        bill.partyId,
        [{ lineId: await specLineId(spec, bill.tabId, "Soup"), quantity: "1" }],
        { ...command, submissionId: randomUUID() },
      ),
    );
    await printSpecBill(spec, bill.partyId, bill.tabId);

    await refusesBoth(bill, [{ lineId: hake }], {
      code: "set_menu.moves_with_set_menu",
      params: { dishName: "Hake" },
    });
    expect(await reopenedFrom(bill.tabId)).toEqual([]);
  });

  it("refuses every dish chosen one by one, and reopens nothing", async () => {
    const bill = await printed("Soup", "Hake");
    const picks = [
      { lineId: await specLineId(spec, bill.tabId, "Soup") },
      { lineId: await specLineId(spec, bill.tabId, "Hake") },
    ];

    await refusesBoth(bill, picks, { code: "bill.all_items_chosen" });
    expect(await reopenedFrom(bill.tabId)).toEqual([]);
  });
});

describe("Pay for items of every dish", () => {
  it("refuses every dish of a Daily that is the whole bill, chosen one by one", async () => {
    const bill = await seatedBill("Soup", "Hake");
    const picks = [
      { lineId: await specLineId(spec, bill.tabId, "Soup") },
      { lineId: await specLineId(spec, bill.tabId, "Hake") },
    ];

    await refusesBoth(bill, picks, {
      code: "bill.all_items_chosen",
      params: { workingOrderId: bill.tabId },
    });
  });

  it("refuses every dish of a comped Daily that is the whole bill, chosen one by one", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await compSpecLine(spec, bill.tabId, await specLineId(spec, bill.tabId, "Daily menu"));
    const picks = [
      { lineId: await specLineId(spec, bill.tabId, "Soup") },
      { lineId: await specLineId(spec, bill.tabId, "Hake") },
    ];

    await refusesBoth(bill, picks, {
      code: "bill.all_items_chosen",
      params: { workingOrderId: bill.tabId },
    });
  });

  it("accepts every dish but a comped Daily whose own dishes have left, which stays", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await compSpecLine(spec, bill.tabId, await specLineId(spec, bill.tabId, "Daily menu"));
    const water = await sendWater(bill);
    const elsewhere = await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, bill.partyId));
    const dishes = [
      await specLineId(spec, bill.tabId, "Soup"),
      await specLineId(spec, bill.tabId, "Hake"),
    ];
    const command = await commandFor(venue, bill.partyId);
    await inTx(venue, (tx) => moveDishes(tx, venue.cfg, bill.tabId, elsewhere, dishes, command));

    const newBill = await pay(bill, [{ lineId: water }], "2.00");

    expect(await totalOf(newBill)).toBe("2.00");
    expect((await specGrouping(spec, bill.tabId)).rows).toEqual([
      { what: "Daily menu 1", price: 0 },
    ]);
  });
});

describe("Pay for items of a bill with advances, in the preview as in the payment", () => {
  const belowAdvances = (bill: Bill, advances: string) => ({
    code: "bill.below_advances",
    params: { workingOrderId: bill.tabId, advances },
  });

  it("refuses Hake out of a Daily, whose Soup alone is below the advances", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await advance(bill, "10.00");

    await refusesBoth(
      bill,
      [{ lineId: await specLineId(spec, bill.tabId, "Hake") }],
      belowAdvances(bill, "10.00"),
    );
  });

  it("takes Hake out of a Daily at all the bill owed, its Soup then covering the advances", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await advance(bill, "6.00");
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Hake") }];

    expect(await preview(bill, picks)).toBe("14.00");
    const newBill = await pay(bill, picks, "14.00");

    expect(await totalOf(newBill)).toBe("14.00");
    expect(await totalOf(bill.tabId)).toBe("6.00");
  });

  it("refuses a Daily chosen with its dishes when the rest is below the advances", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await sendWater(bill);
    await advance(bill, "3.00");

    await refusesBoth(
      bill,
      [{ lineId: await specLineId(spec, bill.tabId, "Daily menu") }],
      belowAdvances(bill, "3.00"),
    );
  });

  it("takes a Daily chosen with its dishes when the rest covers the advances", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await sendWater(bill);
    await advance(bill, "2.00");
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Daily menu") }];

    expect(await preview(bill, picks)).toBe("14.00");
    const newBill = await pay(bill, picks, "14.00");

    expect(await totalOf(newBill)).toBe("14.00");
    expect(await totalOf(bill.tabId)).toBe("2.00");
  });

  it("counts what a comped Daily keeps of its dishes at 0.00", async () => {
    const bill = await seatedBill("Soup", "Hake");
    await compSpecLine(spec, bill.tabId, await specLineId(spec, bill.tabId, "Daily menu"));
    const water = await sendWater(bill);
    await sendWater(bill);
    await advance(bill, "3.00");

    await refusesBoth(
      bill,
      [{ lineId: await specLineId(spec, bill.tabId, "Hake") }, { lineId: water }],
      belowAdvances(bill, "3.00"),
    );
  });

  it("refuses one of two Soups when the other, in a Daily, leaves less than the advances", async () => {
    const bill = await soupsWithBread();
    await advance(bill, "18.00");

    await refusesBoth(
      bill,
      [{ lineId: await specLineId(spec, bill.tabId, "Soup"), quantity: "1" }],
      belowAdvances(bill, "18.00"),
    );
  });

  it("takes one of two Soups when the other, in a Daily, leaves the advances", async () => {
    const bill = await soupsWithBread();
    await advance(bill, "17.50");
    const picks = [{ lineId: await specLineId(spec, bill.tabId, "Soup"), quantity: "1" }];

    expect(await preview(bill, picks)).toBe("7.50");
    const newBill = await pay(bill, picks, "7.50");

    expect(await totalOf(newBill)).toBe("7.50");
    expect(await totalOf(bill.tabId)).toBe("17.50");
  });
});
