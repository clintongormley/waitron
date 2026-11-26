import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  adjustmentEndings,
  adjustments,
  endAdjustment,
  endingRestores,
  readBillAdjustments,
  readReasonStanding,
  type Ending,
} from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { currentBusinessDay, resolveVenueClock } from "@waitron/reporting";
import { readRows } from "./adjustment-rows.js";
import { listFreeItems } from "./free-items.js";
import { frozenLineIdSources } from "./set-menu-freeze.js";
import { regroupDropAfter, totalAfterAdjusting } from "./set-menu-regroup.js";
import { insertPartyBill } from "./parties.js";
import { moveDishes } from "./testing/bill-action-fixture.js";
import { commandFor, inTx, seatWithNoAllergies } from "./testing/party-venue.js";
import {
  compSpecLine,
  sendSpecDishes,
  setupSetMenuSpecVenue,
  specRows,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
  },
});

/** A table's bill holding a Soup and Hake Daily (14.00), given away: its Daily row and the Free. */
async function freeDaily() {
  const bill = await seatWithNoAllergies(spec.venue, await spec.venue.table(crypto.randomUUID()));
  await sendSpecDishes(spec, bill, [
    { dish: "Soup", from: spec.daily },
    { dish: "Hake", from: spec.daily },
  ]);
  const dailyId = (await specRows(spec, bill.tabId)).find(
    ({ name }) => name === "Hake",
  )!.setMenuLineId!;
  await compSpecLine(spec, bill.tabId, dailyId);
  const [free] = await spec.venue.db
    .select({ id: adjustments.id, reasonId: adjustments.reasonId })
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, bill.tabId));
  return { bill, dailyId, free: free! };
}

/** What every reader of standing discounts says of `billId`. */
async function readers(billId: string, reasonId: string, freeId: string) {
  return inTx(spec.venue, async (tx) => {
    const lineIds = (await specRows(spec, billId)).map(({ id }) => id);
    const clock = await resolveVenueClock(tx, spec.venue.cfg.nodeId);
    const day = currentBusinessDay(clock);
    const free = await listFreeItems(tx, clock, {
      year: Number(day.slice(0, 4)),
      period: { kind: "month", month: Number(day.slice(5, 7)) },
    });
    return {
      reduced: [...(await frozenLineIdSources(tx, lineIds)).reduced],
      standing: await readReasonStanding(tx, { workingOrderId: billId, reasonId }),
      onBill: await readBillAdjustments(tx, billId),
      freeItems: free.filter(({ adjustmentId }) => adjustmentId === freeId).length,
    };
  });
}

it("a Free that came off a Daily is left out of everything that reads the bill's discounts", async () => {
  const { bill, dailyId, free } = await freeDaily();
  expect(await readers(bill.tabId, free.reasonId, free.id)).toMatchObject({
    reduced: [dailyId],
    standing: [{ reduction: "14.00" }],
    onBill: [{ lineId: dailyId, action: "comp" }],
    freeItems: 1,
  });

  await inTx(spec.venue, (tx) =>
    endAdjustment(tx, {
      adjustmentId: free.id,
      workingOrderId: bill.tabId,
      why: "dish_cancelled",
      dishName: "Hake",
    }),
  );

  expect(await readers(bill.tabId, free.reasonId, free.id)).toEqual({
    reduced: [],
    standing: [],
    onBill: [],
    freeItems: 0,
  });
  await sendSpecDishes(spec, bill, [{ dish: "Soup", from: spec.daily }]);
  const rows = await specRows(spec, bill.tabId);
  expect(rows.find(({ id }) => id === dailyId)).toMatchObject({
    unitPriceGross: 1400,
    lineTotal: 1400,
    listUnitPriceGross: null,
  });
  expect(
    rows
      .filter(({ setMenuLineId }) => setMenuLineId === dailyId)
      .map(({ name, lineTotal }) => [name, lineTotal]),
  ).toEqual([
    ["Soup", 0],
    ["Hake", 0],
  ]);
  expect(rows.reduce((sum, { lineTotal }) => sum + lineTotal, 0)).toBe(2000);
});

it("a preview naming a Free as ending works the bill out without it and writes nothing", async () => {
  const { bill, dailyId, free } = await freeDaily();
  const rowsBefore = await specRows(spec, bill.tabId);
  const endingsBefore = await spec.venue.db.select().from(adjustmentEndings);

  const answers = await inTx(spec.venue, async (tx) => {
    const ending: Ending = {
      adjustmentIds: [free.id],
      restores: await endingRestores(tx, {
        workingOrderId: bill.tabId,
        adjustmentIds: [free.id],
      }),
    };
    const hake = rowsBefore.find(({ name }) => name === "Hake")!;
    return {
      total: await totalAfterAdjusting(tx, bill.tabId, (line) => [line], ending),
      totalNamingNone: await totalAfterAdjusting(tx, bill.tabId, (line) => [line]),
      dropWithoutHake: await regroupDropAfter(
        tx,
        bill.tabId,
        { deleted: new Set([hake.id]), resized: new Map() },
        ending,
      ),
      reduced: [
        ...(
          await frozenLineIdSources(
            tx,
            rowsBefore.map(({ id }) => id),
            ending,
          )
        ).reduced,
      ],
      daily: (await readRows(tx, bill.tabId, ending)).find(({ id }) => id === dailyId),
    };
  });

  expect(answers).toMatchObject({
    total: 1400,
    totalNamingNone: 0,
    dropWithoutHake: 800,
    reduced: [],
    daily: { unit: 1400, lineTotal: 1400, list: null },
  });
  expect(await specRows(spec, bill.tabId)).toEqual(rowsBefore);
  expect(await spec.venue.db.select().from(adjustmentEndings)).toEqual(endingsBefore);
});

it("an ending on a bill holding none of the discount's rows is refused, leaving this bill's readers as they were", async () => {
  const { bill, free } = await freeDaily();
  const before = await readers(bill.tabId, free.reasonId, free.id);
  const other = await seatWithNoAllergies(spec.venue, await spec.venue.table(crypto.randomUUID()));

  await expect(
    inTx(spec.venue, (tx) =>
      endAdjustment(tx, {
        adjustmentId: free.id,
        workingOrderId: other.tabId,
        why: "dish_moved",
        dishName: "Hake",
      }),
    ),
  ).rejects.toMatchObject({ code: "adjustment.not_standing" });

  expect(await readers(bill.tabId, free.reasonId, free.id)).toEqual(before);
  expect(
    await spec.venue.db
      .select()
      .from(adjustmentEndings)
      .where(eq(adjustmentEndings.adjustmentId, free.id)),
  ).toEqual([]);
});

it("a Free that came off a Soup and Sirloin Daily stays off once its dishes move to another bill", async () => {
  const bill = await seatWithNoAllergies(spec.venue, await spec.venue.table(crypto.randomUUID()));
  await sendSpecDishes(spec, bill, [
    { dish: "Soup", from: spec.daily },
    { dish: "Sirloin", from: spec.daily },
  ]);
  const dailyId = (await specRows(spec, bill.tabId)).find(
    ({ setMenuRole }) => setMenuRole === "set_menu",
  )!.id;
  await compSpecLine(spec, bill.tabId, dailyId);
  const [free] = await spec.venue.db
    .select({ id: adjustments.id, reasonId: adjustments.reasonId })
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, bill.tabId));
  await inTx(spec.venue, (tx) =>
    endAdjustment(tx, {
      adjustmentId: free!.id,
      workingOrderId: bill.tabId,
      why: "dish_cancelled",
      dishName: "Soup",
    }),
  );
  const target = {
    partyId: bill.partyId,
    tabId: await inTx(spec.venue, (tx) => insertPartyBill(tx, spec.venue.cfg, bill.partyId)),
  };
  const dishIds = (await specRows(spec, bill.tabId))
    .filter(({ setMenuRole }) => setMenuRole !== "set_menu")
    .map(({ id }) => id);
  const command = await commandFor(spec.venue, bill.partyId);
  await inTx(spec.venue, (tx) =>
    moveDishes(tx, spec.venue.cfg, bill.tabId, target.tabId, dishIds, command),
  );
  const sirloin = (await specRows(spec, target.tabId)).find(
    ({ id }) => dishIds.includes(id) && id === dishIds[1],
  );
  expect(sirloin).toMatchObject({ unitPriceGross: 500, listUnitPriceGross: null });

  expect(await readers(target.tabId, free!.reasonId, free!.id)).toEqual({
    reduced: [],
    standing: [],
    onBill: [],
    freeItems: 0,
  });
  await expect(
    inTx(spec.venue, (tx) =>
      endAdjustment(tx, {
        adjustmentId: free!.id,
        workingOrderId: target.tabId,
        why: "dish_moved",
        dishName: "Sirloin",
      }),
    ),
  ).rejects.toMatchObject({ code: "adjustment.not_standing" });
  expect(
    (await specRows(spec, target.tabId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0),
  ).toBe(1900);
});
