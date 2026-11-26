import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { adjustmentEndings } from "@waitron/adjustments";
import { adjustments } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { centsToDecimal, thousandthsToDecimal } from "@waitron/shared";
import { applyAdjustment, previewAdjustment, type AdjustmentAsk } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { splitAfterPrint } from "./split-after-print.js";
import { readOrderRevision } from "./working-order-context.js";
import { updateHeldOrder } from "./working-order-held-write.js";
import { markServed } from "./working-order-serving.js";
import {
  cancelItemForTest,
  cancelReasonId,
  COMP_BILL_REASON,
  ensureOperator,
  GIVE_AWAY_REASON,
  reasonIdOf,
} from "./testing/cancel-line.js";
import { commandFor, inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import {
  addSpecDishesToFullMenu,
  printSpecBill,
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

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    ordinary = await addSpecDishesToFullMenu(spec);
  },
});

type Bill = { partyId: string; tabId: string };
/** Free, or a percentage in basis points. */
type Given = "free" | number;

const line = (dish: SpecDish) => ({ menuItemId: ordinary[dish], quantity: "1" });

/** A seated bill eaten here, its dishes sent from the ordinary menu and grouped by the bill. */
async function billOf(dishes: readonly SpecDish[], release: "hold" | "fire" = "hold") {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  const draft = await saveSetMenuDraft(venue, bill, ...dishes.map(line));
  await sendSpecDraft(spec, draft.partyId, draft.id, release);
  return bill;
}

async function rowOf(billId: string, dish: SpecDish) {
  return (await specRows(spec, billId)).find(
    (row) => row.parentLineId === null && specDishOf(spec, row) === dish,
  )!;
}

async function total(billId: string) {
  return (await specRows(spec, billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

function endingsOn(billId: string) {
  return venue.db
    .select({
      adjustmentId: adjustmentEndings.adjustmentId,
      why: adjustmentEndings.why,
      dishName: adjustmentEndings.dishName,
    })
    .from(adjustmentEndings)
    .where(eq(adjustmentEndings.workingOrderId, billId));
}

function everyEnding() {
  return venue.db.select().from(adjustmentEndings);
}

/** Gives the bill's set menu, or the one `dailyId` names, `given`; answers the comp's or
 * discount's id. */
async function giveDaily(billId: string, given: Given, dailyId?: string): Promise<string> {
  const daily = (await specRows(spec, billId)).find(({ id, setMenuRole }) =>
    dailyId === undefined ? setMenuRole === "set_menu" : id === dailyId,
  )!;
  const { adjustmentIds } = await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId: daily.id,
        ...(given === "free"
          ? { reasonId: await reasonIdOf(tx, GIVE_AWAY_REASON), action: "comp" as const }
          : {
              reasonId: await reasonIdOf(tx, COMP_BILL_REASON),
              action: "discount_percent" as const,
              percentBp: given,
            }),
        note: null,
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
  return adjustmentIds[0]!;
}

/** Previews cancelling the dish in the comp window, or `row`'s last portion, checking it wrote
 * nothing, then cancels it; answers the preview and the cancel's recorded reduction, in cents. */
async function previewThenCancel(billId: string, dish: SpecDish, row?: string[]) {
  const target = await rowOf(billId, dish);
  const ask: AdjustmentAsk = await inTx(venue, async (tx) => ({
    orderId: billId,
    expectedEdit: await readBillEditState(tx, billId),
    expectedRevision: await readOrderRevision(tx, billId),
    lineId: target.id,
    ...(row === undefined ? {} : { lineIds: row, quantity: "1" }),
    reasonId: await cancelReasonId(tx),
    action: "cancel",
    note: null,
    operatorId: await ensureOperator(tx, venue.operator.personId),
  }));
  const before = { rows: await specRows(spec, billId), endings: await everyEnding() };
  const preview = await inTx(venue, (tx) =>
    previewAdjustment(tx, venue.cfg, ask, venue.cfg.locale),
  );
  expect({ rows: await specRows(spec, billId), endings: await everyEnding() }).toEqual(before);
  const { adjustmentIds } = await inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      { ...ask, admission: testTradingAdmission(), submissionId: randomUUID() },
      venue.cfg.locale,
    ),
  );
  const [recorded] = await venue.db
    .select({ reduction: adjustments.reduction })
    .from(adjustments)
    .where(eq(adjustments.id, adjustmentIds[0]!));
  return { preview, recorded: recorded!.reduction };
}

it.each<{
  name: string;
  dishes: SpecDish[];
  given: Given;
  cancelled: SpecDish;
  why: string;
  before: string;
  recorded: number;
  after: number;
}>([
  {
    name: "a Soup and Hake Daily at 50% (7.00), the Hake cancelled",
    dishes: ["Soup", "Hake"],
    given: 5000,
    cancelled: "Hake",
    why: "dish_cancelled",
    before: "7.00",
    recorded: 800,
    after: 600,
  },
  {
    // 19.00 less the Soup's 6.00 (D48); planned before the ending it would record 8.00.
    name: "a free Soup and Sirloin Daily (0.00), the Sirloin cancelled",
    dishes: ["Soup", "Sirloin"],
    given: "free",
    cancelled: "Sirloin",
    why: "dish_cancelled",
    before: "0.00",
    recorded: 1300,
    after: 600,
  },
  {
    name: "a free Soup and Hake Daily (0.00), the Hake cancelled",
    dishes: ["Soup", "Hake"],
    given: "free",
    cancelled: "Hake",
    why: "dish_cancelled",
    before: "0.00",
    recorded: 800,
    after: 600,
  },
  {
    name: "a lone Hake Daily at 10% (12.60), the Hake cancelled",
    dishes: ["Hake"],
    given: 1000,
    cancelled: "Hake",
    why: "set_menu_cancelled",
    before: "12.60",
    recorded: 1400,
    after: 0,
  },
])(
  "takes the set menu's discount off before the comp window cancels its dish: $name",
  async ({ dishes, given, cancelled, why, before, recorded, after }) => {
    const { tabId } = await billOf(dishes);
    const id = await giveDaily(tabId, given);

    const cancel = await previewThenCancel(tabId, cancelled);

    expect(await endingsOn(tabId)).toEqual([{ adjustmentId: id, why, dishName: cancelled }]);
    expect(cancel.recorded).toBe(recorded);
    expect(cancel.preview.reduction).toBe(centsToDecimal(recorded));
    expect(cancel.preview.billTotal).toEqual({
      before,
      after: centsToDecimal(after),
    });
    expect(await total(tabId)).toBe(after);
    if (after > 0) expect((await rowOf(tabId, "Soup")).lineTotal).toBe(600);
  },
);

it("ends nothing more when the Soup a free Daily's Hake left is cancelled too", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  await giveDaily(tabId, "free");
  await previewThenCancel(tabId, "Hake");
  const ended = await endingsOn(tabId);

  const cancel = await previewThenCancel(tabId, "Soup");

  expect(cancel.recorded).toBe(600);
  expect(await endingsOn(tabId)).toEqual(ended);
  expect(await total(tabId)).toBe(0);
});

it("takes a Daily's Free off when the comp window cancels one portion of a till row of two Hakes", async () => {
  const { tabId } = await billOf(["Soup", "Soup", "Hake", "Hake"]);
  const rows = await specRows(spec, tabId);
  const hakes = rows.filter((row) => specDishOf(spec, row) === "Hake").map(({ id }) => id);
  const last = rows.find(({ id }) => id === hakes.at(-1))!;
  const id = await giveDaily(tabId, "free", last.setMenuLineId!);
  expect(await total(tabId)).toBe(1400);

  const cancel = await previewThenCancel(tabId, "Hake", hakes);

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: id, why: "dish_cancelled", dishName: "Hake" },
  ]);
  expect(cancel.recorded).toBe(800);
  expect(cancel.preview.billTotal).toEqual({ before: "14.00", after: "20.00" });
  expect(await total(tabId)).toBe(2000);
});

it("leaves a dish's own discount alone when the comp window cancels the dish (3a)", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  const hake = await rowOf(tabId, "Hake");
  await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: tabId,
        expectedEdit: await readBillEditState(tx, tabId),
        submissionId: randomUUID(),
        expectedRevision: await readOrderRevision(tx, tabId),
        lineId: hake.id,
        reasonId: await reasonIdOf(tx, COMP_BILL_REASON),
        action: "discount_percent",
        percentBp: 1000,
        note: null,
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
  expect(await total(tabId)).toBe(2040);

  const cancel = await previewThenCancel(tabId, "Hake");

  expect(cancel.recorded).toBe(1440);
  expect(cancel.preview.billTotal).toEqual({ before: "20.40", after: "6.00" });
  expect(await endingsOn(tabId)).toEqual([]);
});

it("takes a Daily's 50% off when Cancel item takes its unstarted Hake off", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  const given = await giveDaily(tabId, 5000);
  const hake = await rowOf(tabId, "Hake");

  await inTx(venue, (tx) => cancelItemForTest(tx, venue.cfg, tabId, hake.lineNo));

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "dish_cancelled", dishName: "Hake" },
  ]);
  expect((await rowOf(tabId, "Soup")).lineTotal).toBe(600);
  expect(await total(tabId)).toBe(600);
});

it("takes a Daily's 50% off the reopened bill when reopening stops its unserved Hake", async () => {
  const bill = await billOf(["Soup", "Hake"], "fire");
  const given = await giveDaily(bill.tabId, 5000);
  const soup = await rowOf(bill.tabId, "Soup");
  const command = await commandFor(venue, bill.partyId);
  await inTx(venue, (tx) =>
    markServed(
      tx,
      venue.cfg,
      bill.partyId,
      [{ lineId: soup.id, quantity: thousandthsToDecimal(soup.quantity) }],
      { ...command, submissionId: randomUUID() },
    ),
  );
  await printSpecBill(spec, bill.partyId, bill.tabId);

  const { billId } = await splitAfterPrint(
    specDeps(spec),
    venue.cfg,
    bill.tabId,
    venue.operator,
    true,
  );

  expect(await endingsOn(billId)).toEqual([
    { adjustmentId: given, why: "dish_cancelled", dishName: "Hake" },
  ]);
  expect(await endingsOn(bill.tabId)).toEqual([]);
  expect((await rowOf(billId, "Soup")).lineTotal).toBe(600);
  expect(await total(billId)).toBe(600);
});

it("takes a Daily's 50% off when a basket save drops its Hake", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  const given = await giveDaily(tabId, 5000);
  const soup = await rowOf(tabId, "Soup");

  await updateHeldOrder({ db: venue.db, admission: testTradingAdmission() }, venue.cfg, tabId, {
    ...(await inTx(venue, async (tx) => ({
      expectedEdit: await readBillEditState(tx, tabId),
      revision: await readOrderRevision(tx, tabId),
    }))),
    operatorId: venue.operator.personId,
    lines: [{ workingOrderLineId: soup.id, ...line("Soup") }],
  });

  expect(await endingsOn(tabId)).toEqual([
    { adjustmentId: given, why: "dish_cancelled", dishName: "Hake" },
  ]);
  expect((await rowOf(tabId, "Soup")).lineTotal).toBe(600);
  expect(await total(tabId)).toBe(600);
});
