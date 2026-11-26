import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { adjustmentEndings } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { insertPartyBill } from "./parties.js";
import { payForItems, previewPayForItems } from "./pay-for-items.js";
import { readBillSetMenus } from "./set-menu-bill.js";
import { storedOrderTotal } from "./stored-order-lines.js";
import { mergeBills, moveDishes } from "./testing/bill-action-fixture.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { ensureOperator } from "./testing/cancel-line.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  commandFor,
  inTx,
  join,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  addSpecDishesToFullMenu,
  cancelSpecLineKeepingCharge,
  compSpecLine,
  discountSpecLine,
  setupSetMenuSpecVenue,
  specDeps,
  specGrouping,
  specLineId,
  specPayRequest,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { splitTable } from "./testing/table-action-fixture.js";

let spec: SpecVenue;
let venue: PartyVenue;
/** The ordinary menu's offer of each dish. */
let ordinary: Record<SpecDish, string>;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    ordinary = await addSpecDishesToFullMenu(spec);
    await inTx(venue, (tx) => ensureOperator(tx, venue.operator.personId));
  },
});

type Bill = { partyId: string; tabId: string };

/** Sends the dishes, and `items` from the venue's other products, onto the bill as one round. */
function send(bill: Bill, dishes: readonly SpecDish[], items: readonly string[] = []) {
  return inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, bill.partyId, {
      operatorId: venue.operator.personId,
      billId: bill.tabId,
      groups: [
        {
          lines: [
            ...dishes.map((dish) => ({ menuItemId: ordinary[dish], quantity: "1" })),
            ...items.map((item) => ({ menuItemId: venue.item(item), quantity: "1" })),
          ],
          release: "fire",
        },
      ],
    }),
  );
}

/** A seated bill holding a Soup and Sirloin Daily at 10% (17.10), and `items` beside it. */
async function tenPercentDaily(items: readonly string[] = []) {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await send(bill, ["Soup", "Sirloin"], items);
  await discountSpecLine(spec, bill.tabId, await specLineId(spec, bill.tabId, "Daily menu"), 1000);
  expect(await total(bill.tabId)).toBe(1710 + 200 * items.length);
  return {
    bill,
    soup: await specLineId(spec, bill.tabId, "Soup"),
    sirloin: await specLineId(spec, bill.tabId, "Sirloin"),
    daily: await specLineId(spec, bill.tabId, "Daily menu"),
  };
}

async function otherBill(bill: Bill): Promise<Bill> {
  return {
    partyId: bill.partyId,
    tabId: await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, bill.partyId)),
  };
}

async function move(from: Bill, to: Bill, lineIds: string[]) {
  const command = await commandFor(venue, from.partyId);
  return inTx(venue, (tx) => moveDishes(tx, venue.cfg, from.tabId, to.tabId, lineIds, command));
}

async function total(billId: string) {
  return (await specRows(spec, billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

function endingsOn(billId: string) {
  return venue.db
    .select({ why: adjustmentEndings.why, dishName: adjustmentEndings.dishName })
    .from(adjustmentEndings)
    .where(eq(adjustmentEndings.workingOrderId, billId));
}

function everyEnding() {
  return venue.db.select().from(adjustmentEndings);
}

const SIRLOIN_DAILY = {
  rows: [
    { what: "Sirloin", price: 500, in: "Daily menu 1" },
    { what: "Daily menu 1", price: 1400 },
  ],
  total: 1900,
};

/** The Soup and Sirloin Daily still holding its 10%. */
const DISCOUNTED_DAILY = {
  rows: [
    { what: "Soup", price: 0, in: "Daily menu 1" },
    { what: "Sirloin", price: 450, in: "Daily menu 1" },
    { what: "Daily menu 1", price: 1260 },
  ],
  total: 1710,
};

it("moves the Sirloin of a 10% Daily alone, taking the 10% off: the Soup 6.00, the Sirloin a Daily of its own (D50)", async () => {
  const { bill, sirloin } = await tenPercentDaily();
  const target = await otherBill(bill);

  await move(bill, target, [sirloin]);

  expect(await endingsOn(bill.tabId)).toEqual([{ why: "dish_moved", dishName: "Sirloin" }]);
  expect(await specGrouping(spec, bill.tabId)).toEqual({
    rows: [{ what: "Soup", price: 600, in: null }],
    total: 600,
  });
  expect(await specGrouping(spec, target.tabId)).toEqual(SIRLOIN_DAILY);
});

it("offers the Sirloin of a 10% Daily, whose supplement the 10% took, as a dish that moves alone", async () => {
  const { bill, sirloin } = await tenPercentDaily();

  const { dishes } = await inTx(venue, (tx) => readBillSetMenus(tx, bill.tabId));

  expect(dishes.find(({ lineId }) => lineId === sirloin)).toMatchObject({ movable: true });
});

it("splits a table with the Sirloin of a 10% Daily as a loose dish, taking the 10% off (D50)", async () => {
  const { bill, sirloin } = await tenPercentDaily();
  const leaving = await venue.table(randomUUID());
  await join(venue, bill.partyId, leaving);
  const command = await commandFor(venue, bill.partyId);

  const { billIds } = await inTx(venue, (tx) =>
    splitTable(
      tx,
      venue.cfg,
      bill.partyId,
      leaving,
      { wholeBillIds: [], loose: [{ billId: bill.tabId, lineIds: [sirloin] }] },
      command,
    ),
  );

  expect(await endingsOn(bill.tabId)).toEqual([{ why: "dish_moved", dishName: "Sirloin" }]);
  expect(await total(bill.tabId)).toBe(600);
  expect(await specGrouping(spec, billIds.at(-1)!)).toEqual(SIRLOIN_DAILY);
});

it.each<{ name: string; moving: (daily: Awaited<ReturnType<typeof tenPercentDaily>>) => string[] }>(
  [
    { name: "by its row", moving: ({ daily }) => [daily] },
    { name: "by naming both its dishes", moving: ({ soup, sirloin }) => [soup, sirloin] },
  ],
)("moves a 10% Daily whole $name, holding its 10% (D51)", async ({ moving }) => {
  const daily = await tenPercentDaily(["Water"]);
  const target = await otherBill(daily.bill);

  await move(daily.bill, target, moving(daily));

  expect(await everyEnding()).not.toContainEqual(
    expect.objectContaining({ workingOrderId: daily.bill.tabId }),
  );
  expect(await specGrouping(spec, daily.bill.tabId)).toEqual({
    rows: [{ what: "Water", price: 200, in: null }],
    total: 200,
  });
  expect(await specGrouping(spec, target.tabId)).toEqual(DISCOUNTED_DAILY);
  await send(target, ["Soup", "Hake"]);
  expect(await total(target.tabId)).toBe(1710 + 1400);
});

it("merges a bill holding a 10% Daily into another, the Daily keeping its 10% (D51)", async () => {
  const { bill } = await tenPercentDaily();
  const into = await otherBill(bill);
  const command = await commandFor(venue, bill.partyId);

  await inTx(venue, (tx) => mergeBills(tx, venue.cfg, into.tabId, bill.tabId, command));

  expect(await endingsOn(bill.tabId)).toEqual([]);
  expect(await endingsOn(into.tabId)).toEqual([]);
  expect(await specGrouping(spec, into.tabId)).toEqual(DISCOUNTED_DAILY);
  await send(into, ["Soup", "Hake"]);
  expect(await total(into.tabId)).toBe(1710 + 1400);
});

function payDeps() {
  return { ...specDeps(spec), provider: new SimulatorPaymentProvider(venue.db) };
}

async function preview(bill: Bill, lineIds: string[]) {
  const before = { rows: await specRows(spec, bill.tabId), endings: await everyEnding() };
  const { total } = await previewPayForItems(
    specDeps(spec),
    venue.cfg,
    bill.tabId,
    { picks: lineIds.map((lineId) => ({ lineId })), method: "cash", tendered: "100.00" },
    null,
  );
  expect({ rows: await specRows(spec, bill.tabId), endings: await everyEnding() }).toEqual(before);
  return total;
}

async function payFor(bill: Bill, lineIds: string[], applied: string, by: "cash" | "declined") {
  const paid = await payForItems(
    payDeps(),
    venue.cfg,
    bill.tabId,
    await specPayRequest(
      spec,
      bill,
      lineIds.map((lineId) => ({ lineId })),
      by === "cash"
        ? { method: "cash", applied, tendered: applied }
        : { method: "card", applied, entry: "reader", simulationOutcome: "declined" },
    ),
    venue.operator,
    null,
  );
  expect(paid.payment.outcome).toBe(by === "cash" ? "received" : "declined");
  return paid.billId;
}

it("prices the Sirloin of a 10% Daily paid alone at 19.00, taking the 10% off only once paid (D50)", async () => {
  const { bill, sirloin } = await tenPercentDaily();
  expect(await preview(bill, [sirloin])).toBe("19.00");

  const paidOn = await payFor(bill, [sirloin], "19.00", "cash");

  expect(await endingsOn(bill.tabId)).toEqual([{ why: "dish_paid_alone", dishName: "Sirloin" }]);
  expect(await inTx(venue, (tx) => storedOrderTotal(tx, paidOn))).toBe("19.00");
  expect(await specGrouping(spec, bill.tabId)).toEqual({
    rows: [{ what: "Soup", price: 600, in: null }],
    total: 600,
  });
});

it("works out what the Sirloin of a 10% Daily paid alone leaves as the Soup's 6.00, refusing it below an advance of 7.00", async () => {
  const { bill, sirloin } = await tenPercentDaily();
  await takeBillPayment(
    specDeps(spec),
    venue.cfg,
    bill.tabId,
    {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "7.00",
      method: "cash",
      tendered: "7.00",
      applied: "7.00",
      tip: "0.00",
      ownReceipt: true,
    },
    venue.operator,
  );

  await expect(preview(bill, [sirloin])).rejects.toMatchObject({
    code: "bill.below_advances",
  });
});

it("leaves the 10% off a Daily once a declined card brings back its Sirloin paid alone (D50)", async () => {
  const { bill, sirloin } = await tenPercentDaily();

  await payFor(bill, [sirloin], "19.00", "declined");

  expect(await endingsOn(bill.tabId)).toEqual([{ why: "dish_paid_alone", dishName: "Sirloin" }]);
  expect(await total(bill.tabId)).toBe(1900);
});

it("pays for both dishes of a 10% Daily at 17.10, the Daily going with them holding its 10% (D51)", async () => {
  const { bill, soup, sirloin } = await tenPercentDaily(["Water"]);
  expect(await preview(bill, [soup, sirloin])).toBe("17.10");

  const paidOn = await payFor(bill, [soup, sirloin], "17.10", "cash");

  expect(await everyEnding()).not.toContainEqual(
    expect.objectContaining({ workingOrderId: bill.tabId }),
  );
  expect(await specGrouping(spec, paidOn)).toEqual(DISCOUNTED_DAILY);
  expect(await total(bill.tabId)).toBe(200);
});

it("brings a 10% Daily back holding its 10% when the card paying for both its dishes is declined (D51)", async () => {
  const { bill, soup, sirloin } = await tenPercentDaily(["Water"]);

  await payFor(bill, [soup, sirloin], "17.10", "declined");

  expect(await endingsOn(bill.tabId)).toEqual([]);
  expect(await total(bill.tabId)).toBe(1910);
});

it("moves a Daily of a bill discounted 10% as a whole with both its dishes, holding its part (D51, until 3c)", async () => {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await send(bill, ["Soup", "Hake"], ["Water"]);
  await discountSpecLine(spec, bill.tabId, null, 1000);
  expect(await total(bill.tabId)).toBe(1440);
  const target = await otherBill(bill);

  await move(bill, target, [
    await specLineId(spec, bill.tabId, "Soup"),
    await specLineId(spec, bill.tabId, "Hake"),
  ]);

  expect(await specGrouping(spec, target.tabId)).toEqual({
    rows: [
      { what: "Soup", price: 0, in: "Daily menu 1" },
      { what: "Hake", price: 0, in: "Daily menu 1" },
      { what: "Daily menu 1", price: 1260 },
    ],
    total: 1260,
  });
  expect(await total(bill.tabId)).toBe(180);
});

it("still refuses moving a dish of a Daily held by a kept-charge cancel, alone or with every dish named (D18)", async () => {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await send(bill, ["Soup", "Hake"]);
  const soup = await specLineId(spec, bill.tabId, "Soup");
  const hake = await specLineId(spec, bill.tabId, "Hake");
  await cancelSpecLineKeepingCharge(spec, bill.tabId, hake);
  const target = await otherBill(bill);
  const before = await specRows(spec, bill.tabId);

  for (const moving of [[hake], [soup, hake]]) {
    await expect(move(bill, target, moving)).rejects.toMatchObject({
      code: "set_menu.moves_with_set_menu",
    });
  }
  expect(await specRows(spec, bill.tabId)).toEqual(before);
});

it("moves a free Daily's dish alone as any 10% one, the Free coming off (D50)", async () => {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await send(bill, ["Soup", "Hake"]);
  await compSpecLine(spec, bill.tabId, await specLineId(spec, bill.tabId, "Daily menu"));
  const target = await otherBill(bill);

  await move(bill, target, [await specLineId(spec, bill.tabId, "Hake")]);

  expect(await endingsOn(bill.tabId)).toEqual([{ why: "dish_moved", dishName: "Hake" }]);
  expect(await total(bill.tabId)).toBe(600);
  expect(await total(target.tabId)).toBe(1400);
});
