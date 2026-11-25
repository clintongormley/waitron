import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { products } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addProducts, createUnit, menuItems, requireMenuRoot, updateUnit } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readBillEditState } from "./bill-editing.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { inTx, seatWithNoAllergies, type PartyVenue } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  setupSetMenuSpecVenue,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { readOrderRevision } from "./working-order-context.js";
import { updateOrderLine } from "./working-order-held-write.js";

let spec: SpecVenue;
let venue: PartyVenue;
let ordinary: Record<SpecDish, string>;
/** Hake's unit: takes decimals, so raising Hake keeps one row; not a measure until a case says so. */
let hakeUnitId: string;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    await inTx(venue, async (tx) => {
      const unit = await createUnit(
        tx,
        { staffName: "Plate", staffAbbreviation: "pl", name: {}, abbreviation: {}, precision: 2 },
        venue.cfg.locale,
      );
      hakeUnitId = unit.id;
      await tx
        .update(products)
        .set({ unitId: unit.id })
        .where(eq(products.id, spec.productIds.Hake));
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
      ordinary = Object.fromEntries(
        (Object.keys(spec.productIds) as SpecDish[]).map((dish) => [
          dish,
          rows.find(({ productId }) => productId === spec.productIds[dish])!.id,
        ]),
      ) as Record<SpecDish, string>;
    });
  },
});

/** A seated bill holding `lines` from the ordinary menu, placed as one held round. */
async function billWith(lines: { menuItemId: string; quantity: string }[]) {
  const bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await place(bill, lines);
  return bill;
}

function place(
  bill: { partyId: string; tabId: string },
  lines: { menuItemId: string; quantity: string }[],
) {
  return inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, bill.partyId, {
      operatorId: venue.operator.personId,
      billId: bill.tabId,
      groups: [{ lines, release: "hold" }],
    }),
  );
}

const dish = (name: SpecDish) => ({ menuItemId: ordinary[name], quantity: "1" });

/** Each row as the bill charges it. */
async function charged(billId: string) {
  return (await specRows(spec, billId))
    .filter(({ parentLineId }) => parentLineId === null)
    .map((row) => ({
      what: row.name,
      quantity: row.quantity,
      price: row.unitPriceGross,
      total: row.lineTotal,
      role: row.setMenuRole,
      setMenuLineId: row.setMenuLineId,
      place: row.setMenuPlace,
      countsAs: row.setMenuCountsAsCourseId,
    }));
}

const aLaCarte = { role: null, setMenuLineId: null, place: null, countsAs: null };

async function billTotal(billId: string) {
  return (await specRows(spec, billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

async function expectDaily(billId: string) {
  expect((await charged(billId)).map(({ what, price, role }) => [what, price, role])).toEqual([
    ["Soup", 0, "dish"],
    ["Hake", 0, "dish"],
    ["Daily menu", 1400, "set_menu"],
  ]);
}

it("charges Hake a la carte, two at 16.00, when a line edit raises it out of its Daily", async () => {
  const bill = await billWith([dish("Soup"), dish("Hake")]);
  await expectDaily(bill.tabId);
  const hake = (await specRows(spec, bill.tabId)).find(({ name }) => name === "Hake")!;

  await inTx(venue, async (tx) =>
    updateOrderLine(
      tx,
      venue.cfg,
      bill.tabId,
      hake.lineNo,
      { portionLineNos: [], quantity: "2" },
      await readOrderRevision(tx, bill.tabId),
      {
        admission: testTradingAdmission(),
        operatorId: venue.operator.personId,
        expectedEdit: await readBillEditState(tx, bill.tabId),
      },
    ),
  );

  expect(await charged(bill.tabId)).toEqual([
    { what: "Soup", quantity: 1000, price: 600, total: 600, ...aLaCarte },
    { what: "Hake", quantity: 2000, price: 1600, total: 3200, ...aLaCarte },
  ]);
  expect(await billTotal(bill.tabId)).toBe(3800);
});

it("charges Hake a la carte when its unit becomes a measure and an unrelated send regroups the bill", async () => {
  const bill = await billWith([dish("Soup"), dish("Hake")]);
  await expectDaily(bill.tabId);
  await inTx(venue, (tx) => updateUnit(tx, hakeUnitId, { measure: true }, venue.cfg.locale));
  try {
    await place(bill, [{ menuItemId: venue.item("Water"), quantity: "1" }]);
    const rows = await charged(bill.tabId);
    expect(rows.filter(({ what }) => what !== "Water")).toEqual([
      { what: "Soup", quantity: 1000, price: 600, total: 600, ...aLaCarte },
      { what: "Hake", quantity: 1000, price: 1600, total: 1600, ...aLaCarte },
    ]);
    const water = rows.find(({ what }) => what === "Water")!;
    expect(await billTotal(bill.tabId)).toBe(2200 + water.total);
  } finally {
    await inTx(venue, (tx) => updateUnit(tx, hakeUnitId, { measure: false }, venue.cfg.locale));
  }
});
