import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { adjustmentEndings, createAdjustmentReason } from "@waitron/adjustments";
import { adjustments } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { updateMenuDetails } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import { applyAdjustment, previewAdjustment, type AdjustmentAsk } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { insertPartyBill } from "./parties.js";
import { payForItems, previewPayForItems } from "./pay-for-items.js";
import { readOrderRevision } from "./working-order-context.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { cancelReasonId, ensureOperator } from "./testing/cancel-line.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { commandFor, inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import {
  addSpecDishesToFullMenu,
  setupSetMenuSpecVenue,
  specDeps,
  specGrouping,
  specLineId,
  specPayRequest,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
let venue: PartyVenue;
/** The ordinary menu's offer of each dish. */
let ordinary: Record<SpecDish, string>;

// The Daily is priced 0.00 here, so a comp or discount on it lands only on the Sirloin's 5.00.
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    await inTx(venue, async (tx) => {
      await updateMenuDetails(tx, spec.daily.menuId, { setPrice: "0.00" });
      await ensureOperator(tx, venue.operator.personId);
    });
    ordinary = await addSpecDishesToFullMenu(spec);
  },
});

type Bill = { partyId: string; tabId: string };
type Terms = Pick<AdjustmentAsk, "action" | "percentBp" | "amount">;

const percent = (percentBp: number): Terms => ({ action: "discount_percent", percentBp });
const off = (amount: string): Terms => ({ action: "discount_amount", amount: decimal(amount) });

/** A seated bill holding a Soup and Sirloin Daily (5.00, all of it the Sirloin's supplement) and
 * `items` beside it. */
async function soupAndSirloin(items: readonly string[] = []) {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, bill.partyId, {
      operatorId: venue.operator.personId,
      billId: bill.tabId,
      groups: [
        {
          lines: [
            ...(["Soup", "Sirloin"] as const).map((dish) => ({
              menuItemId: ordinary[dish],
              quantity: "1",
            })),
            ...items.map((item) => ({ menuItemId: venue.item(item), quantity: "1" })),
          ],
          release: "fire",
        },
      ],
    }),
  );
  expect(await specGrouping(spec, bill.tabId)).toMatchObject({
    rows: expect.arrayContaining([
      { what: "Sirloin", price: 500, in: "Daily menu 1" },
      { what: "Daily menu 1", price: 0 },
    ]),
    total: 500 + 200 * items.length,
  });
  return {
    bill,
    daily: await specLineId(spec, bill.tabId, "Daily menu"),
    soup: await specLineId(spec, bill.tabId, "Soup"),
    sirloin: await specLineId(spec, bill.tabId, "Sirloin"),
  };
}

async function total(billId: string) {
  return (await specRows(spec, billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

function everyEnding() {
  return venue.db.select().from(adjustmentEndings);
}

async function askFor(billId: string, lineId: string, terms: Terms): Promise<AdjustmentAsk> {
  return inTx(venue, async (tx) => ({
    orderId: billId,
    expectedEdit: await readBillEditState(tx, billId),
    expectedRevision: await readOrderRevision(tx, billId),
    lineId,
    reasonId: (
      await createAdjustmentReason(tx, { ...REASONS.house, name: `House ${randomUUID()}` })
    ).id,
    note: null,
    operatorId: venue.operator.personId,
    ...terms,
  }));
}

/** Previews `terms` on the line, checking it wrote nothing, then applies them; answers the preview
 * and the id of what the apply recorded. */
async function previewThenApply(billId: string, lineId: string, terms: Terms) {
  const ask = await askFor(billId, lineId, terms);
  const before = { rows: await specRows(spec, billId), endings: await everyEnding() };
  const preview = await inTx(venue, (tx) =>
    previewAdjustment(tx, venue.cfg, ask, venue.cfg.locale),
  );
  expect({ rows: await specRows(spec, billId), endings: await everyEnding() }).toEqual(before);
  const { adjustmentIds } = await inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      { ...ask, admission: specDeps(spec).admission, submissionId: randomUUID() },
      venue.cfg.locale,
    ),
  );
  return { preview, id: adjustmentIds[0]! };
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

it.each([
  {
    name: "0.01 off by 0.02 off: 4.98",
    first: off("0.01"),
    second: off("0.02"),
    between: 499,
    after: 498,
    replaces: { action: "discount_amount", amount: "0.01" },
  },
  {
    name: "10% by 20%: 4.00",
    first: percent(1000),
    second: percent(2000),
    between: 450,
    after: 400,
    replaces: { action: "discount_percent", percentBp: 1000, amount: "0.50" },
  },
])(
  "replaces a discount on a Daily that fell only on the Sirloin's supplement, $name",
  async ({ first, second, between, after, replaces }) => {
    const { bill, daily } = await soupAndSirloin();
    const given = await previewThenApply(bill.tabId, daily, first);
    expect(await total(bill.tabId)).toBe(between);

    const replacing = await previewThenApply(bill.tabId, daily, second);

    expect(replacing.preview).toMatchObject({
      replaces,
      billTotal: { before: (between / 100).toFixed(2), after: (after / 100).toFixed(2) },
    });
    expect(await total(bill.tabId)).toBe(after);
    expect(
      (await everyEnding()).map(({ adjustmentId, workingOrderId, why }) => ({
        adjustmentId,
        workingOrderId,
        why,
      })),
    ).toContainEqual({ adjustmentId: given.id, workingOrderId: bill.tabId, why: "replaced" });
  },
);

it("moves a Daily whose 10% fell only on the Sirloin's supplement whole when both its dishes move, keeping the 10%", async () => {
  const { bill, soup, sirloin } = await soupAndSirloin(["Water"]);
  await previewThenApply(
    bill.tabId,
    await specLineId(spec, bill.tabId, "Daily menu"),
    percent(1000),
  );
  expect(await total(bill.tabId)).toBe(650);
  const target = await otherBill(bill);

  await move(bill, target, [soup, sirloin]);

  expect(await everyEnding()).not.toContainEqual(
    expect.objectContaining({ workingOrderId: bill.tabId }),
  );
  expect(await specGrouping(spec, target.tabId)).toEqual({
    rows: [
      { what: "Soup", price: 0, in: "Daily menu 1" },
      { what: "Sirloin", price: 450, in: "Daily menu 1" },
      { what: "Daily menu 1", price: 0 },
    ],
    total: 450,
  });
  expect(await total(bill.tabId)).toBe(200);
});

it("takes the 10% off a Daily that fell only on the Sirloin's supplement when the Sirloin moves alone", async () => {
  const { bill, daily, sirloin } = await soupAndSirloin();
  const given = await previewThenApply(bill.tabId, daily, percent(1000));
  const target = await otherBill(bill);

  await move(bill, target, [sirloin]);

  expect(
    (await everyEnding()).map(({ adjustmentId, workingOrderId, why, dishName }) => ({
      adjustmentId,
      workingOrderId,
      why,
      dishName,
    })),
  ).toContainEqual({
    adjustmentId: given.id,
    workingOrderId: bill.tabId,
    why: "dish_moved",
    dishName: "Sirloin",
  });
  expect(await total(target.tabId)).toBe(500);
  // The Soup left behind is cheapest as a Daily of its own at 0.00.
  expect(await specGrouping(spec, bill.tabId)).toEqual({
    rows: [
      { what: "Soup", price: 0, in: "Daily menu 1" },
      { what: "Daily menu 1", price: 0 },
    ],
    total: 0,
  });
});

it("previews and pays for both dishes of a Daily whose 10% fell only on the Sirloin's supplement at 4.50, the Daily going with them", async () => {
  const { bill, soup, sirloin } = await soupAndSirloin(["Water"]);
  const { id } = await previewThenApply(
    bill.tabId,
    await specLineId(spec, bill.tabId, "Daily menu"),
    percent(1000),
  );
  const picks = [soup, sirloin].map((lineId) => ({ lineId }));

  const before = { rows: await specRows(spec, bill.tabId), endings: await everyEnding() };
  const preview = await previewPayForItems(
    specDeps(spec),
    venue.cfg,
    bill.tabId,
    { picks, method: "cash", tendered: "100.00" },
    null,
  );
  expect({ rows: await specRows(spec, bill.tabId), endings: await everyEnding() }).toEqual(before);
  expect(preview.total).toBe("4.50");

  const paid = await payForItems(
    { ...specDeps(spec), provider: new SimulatorPaymentProvider(venue.db) },
    venue.cfg,
    bill.tabId,
    await specPayRequest(spec, bill, picks, { method: "cash", applied: "4.50", tendered: "4.50" }),
    venue.operator,
    null,
  );

  expect(paid.payment.outcome).toBe("received");
  expect(await total(paid.billId)).toBe(450);
  expect(await total(bill.tabId)).toBe(200);
  expect(
    await venue.db
      .select({ id: adjustmentEndings.id })
      .from(adjustmentEndings)
      .where(eq(adjustmentEndings.adjustmentId, id)),
  ).toEqual([]);
  expect(
    await venue.db
      .select({ workingOrderId: adjustments.workingOrderId })
      .from(adjustments)
      .where(eq(adjustments.id, id)),
  ).toEqual([{ workingOrderId: bill.tabId }]);
});

it("takes the 10% off a Daily that fell only on the Sirloin's supplement before the comp window cancels the Sirloin", async () => {
  const { bill, daily, sirloin } = await soupAndSirloin();
  const given = await previewThenApply(bill.tabId, daily, percent(1000));
  const ask: AdjustmentAsk = await inTx(venue, async (tx) => ({
    orderId: bill.tabId,
    expectedEdit: await readBillEditState(tx, bill.tabId),
    expectedRevision: await readOrderRevision(tx, bill.tabId),
    lineId: sirloin,
    reasonId: await cancelReasonId(tx),
    action: "cancel",
    note: null,
    operatorId: venue.operator.personId,
  }));

  const preview = await inTx(venue, (tx) =>
    previewAdjustment(tx, venue.cfg, ask, venue.cfg.locale),
  );
  const { adjustmentIds } = await inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      { ...ask, admission: specDeps(spec).admission, submissionId: randomUUID() },
      venue.cfg.locale,
    ),
  );

  // Worked out with the 10% gone: the Sirloin's 5.00 comes off, leaving the Soup's Daily at 0.00.
  expect(preview).toMatchObject({
    reduction: "5.00",
    billTotal: { before: "4.50", after: "0.00" },
  });
  const [recorded] = await venue.db
    .select({ reduction: adjustments.reduction })
    .from(adjustments)
    .where(eq(adjustments.id, adjustmentIds[0]!));
  expect(recorded).toEqual({ reduction: 500 });
  expect(
    (await everyEnding()).map(({ adjustmentId, workingOrderId, why, dishName }) => ({
      adjustmentId,
      workingOrderId,
      why,
      dishName,
    })),
  ).toContainEqual({
    adjustmentId: given.id,
    workingOrderId: bill.tabId,
    why: "dish_cancelled",
    dishName: "Sirloin",
  });
  expect(await total(bill.tabId)).toBe(0);
});
