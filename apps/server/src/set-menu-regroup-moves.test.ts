import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addProducts, menuItems, requireMenuRoot } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SimulatorPaymentProvider } from "@waitron/payments";
import type { SetMenuGroupingInput } from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { cancelItem } from "./line-cancel.js";
import { namedFrozenLineIds } from "./set-menu-freeze.js";
import { splitHeldLineIntoUnits } from "./order-group-edits.js";
import { insertPartyBill } from "./parties.js";
import { payForItems, priceItemPicks, type PayForItemsRequest } from "./pay-for-items.js";
import { readGroupingCopies, saveBillGrouping } from "./set-menu-regroup.js";
import { splitAfterPrint } from "./split-after-print.js";
import { readOrderRevision } from "./working-order-context.js";
import { advanceTicketItem } from "./working-order-kitchen-service.js";
import { moveOrderLines } from "./working-order-transfer.js";
import { mergeBills, moveDishes } from "./testing/bill-action-fixture.js";
import {
  cancelReasonId,
  ensureOperator,
  GIVE_AWAY_REASON,
  observedCancelItem,
  reasonIdOf,
} from "./testing/cancel-line.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import {
  cashContribution,
  commandFor,
  counterOrder,
  inTx,
  join,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  printSpecBill,
  serveSpecBill,
  setupSetMenuSpecVenue,
  specDeps,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { splitTable } from "./testing/table-action-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

/** The bills each `regroupBills` call outside its own module named, in call order. */
const regrouped = vi.hoisted(() => [] as string[][]);
vi.mock("./set-menu-regroup.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./set-menu-regroup.js")>();
  return {
    ...real,
    regroupBills: (...args: Parameters<typeof real.regroupBills>) => {
      regrouped.push([...args[1]]);
      return real.regroupBills(...args);
    },
  };
});

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
    await inTx(venue, async (tx) => {
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
      await ensureOperator(tx, venue.operator.personId);
    });
  },
});

type Bill = { partyId: string; tabId: string };

async function seated(): Promise<Bill & { tableId: string }> {
  const tableId = await venue.table(randomUUID());
  return { ...(await seatWithNoAllergies(venue, tableId)), tableId };
}

/** A second, empty bill of the bill's party. */
async function partyBill(bill: Bill): Promise<Bill> {
  return {
    partyId: bill.partyId,
    tabId: await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, bill.partyId)),
  };
}

/** Sends the dishes, from the ordinary menu, onto the bill as one round. */
function send(bill: Bill, dishes: SpecDish[], release: "hold" | "fire" = "fire") {
  return inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, bill.partyId, {
      operatorId: venue.operator.personId,
      billId: bill.tabId,
      groups: [
        { lines: dishes.map((dish) => ({ menuItemId: ordinary[dish], quantity: "1" })), release },
      ],
    }),
  );
}

function dishOf(row: { productId: string | null }): string | undefined {
  return (Object.keys(spec.productIds) as SpecDish[]).find(
    (dish) => spec.productIds[dish] === row.productId,
  );
}

/**
 * The bill's saved grouping, in line order: each top-level row's dish or set-menu name, its price,
 * and the set-menu row it is placed in, by that row's name and position among the bill's set menus.
 */
async function grouping(billId: string) {
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
            what: dishOf(row) ?? row.name,
            price: row.unitPriceGross,
            in: menuName(row.setMenuLineId),
          },
    ),
    total: rows.reduce((sum, { lineTotal }) => sum + lineTotal, 0),
  };
}

async function idOf(billId: string, what: string, nth = 0) {
  const rows = (await specRows(spec, billId)).filter(
    (row) => row.parentLineId === null && (dishOf(row) ?? row.name) === what,
  );
  return rows[nth]!.id;
}

async function move(from: Bill, to: Bill, lineIds: string[]) {
  const command = await commandFor(venue, from.partyId);
  return inTx(venue, (tx) => moveDishes(tx, venue.cfg, from.tabId, to.tabId, lineIds, command));
}

/** Comps the bill's line whole, under the give-away reason. */
async function comp(billId: string, lineId: string) {
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

/** Soup and Hake grouped as a Special at 20.00, not the cheapest (a Daily at 14.00), through the
 *  calculation hook. */
async function seedSpecial(billId: string) {
  const soup = await idOf(billId, "Soup");
  const hake = await idOf(billId, "Hake");
  const calculate = (input: SetMenuGroupingInput) => ({
    exact: true,
    totalCents:
      2000 +
      input.dishes
        .filter(({ id }) => id !== soup && id !== hake)
        .reduce((sum, { aLaCarteCents }) => sum + aLaCarteCents, 0),
    unusedDiscountIds: [],
    setMenus: [
      {
        id: "special",
        offerId: input.offers.find(({ id }) => id.startsWith(`${spec.special.menuId}:`))!.id,
        discountId: null,
        baseCents: 2000,
        discountCents: 0,
      },
    ],
    dishes: input.dishes.map((dish) =>
      dish.id === soup || dish.id === hake
        ? {
            id: dish.id,
            place: { setMenuId: "special", lineIndex: dish.id === soup ? 0 : 1 },
            chargeCents: 0,
            extrasCents: 0,
          }
        : { id: dish.id, place: null, chargeCents: dish.aLaCarteCents, extrasCents: 0 },
    ),
  });
  await inTx(venue, async (tx) =>
    saveBillGrouping(tx, billId, await readGroupingCopies(tx, billId), calculate),
  );
}

const SOUP_AND_HAKE_DAILY = {
  rows: [
    { what: "Soup", price: 0, in: "Daily menu 1" },
    { what: "Hake", price: 0, in: "Daily menu 1" },
    { what: "Daily menu 1", price: 1400 },
  ],
  total: 1400,
};

const HAKE_DAILY = {
  rows: [
    { what: "Hake", price: 0, in: "Daily menu 1" },
    { what: "Daily menu 1", price: 1400 },
  ],
  total: 1400,
};

it("moves Hake alone out of a Daily: the source's Soup returns to 6.00 and Hake groups on the target", async () => {
  const source = await seated();
  await send(source, ["Soup", "Hake"]);
  expect(await grouping(source.tabId)).toEqual(SOUP_AND_HAKE_DAILY);
  const target = await partyBill(source);

  await move(source, target, [await idOf(source.tabId, "Hake")]);

  expect(await grouping(source.tabId)).toEqual({
    rows: [{ what: "Soup", price: 600, in: null }],
    total: 600,
  });
  expect(await grouping(target.tabId)).toEqual(HAKE_DAILY);
});

it("moves Hake alone to a bill holding a Soup, where the two form a Daily", async () => {
  const source = await seated();
  await send(source, ["Soup", "Hake"]);
  const target = await partyBill(source);
  await send(target, ["Soup"]);
  expect(await grouping(target.tabId)).toEqual({
    rows: [{ what: "Soup", price: 600, in: null }],
    total: 600,
  });

  await move(source, target, [await idOf(source.tabId, "Hake")]);

  expect((await grouping(source.tabId)).total).toBe(600);
  expect(await grouping(target.tabId)).toEqual({
    rows: [
      { what: "Soup", price: 0, in: "Daily menu 1" },
      { what: "Hake", price: 0, in: "Daily menu 1" },
      { what: "Daily menu 1", price: 1400 },
    ],
    total: 1400,
  });
});

it("refuses moving alone a dish its own comp froze, changing neither bill (D18)", async () => {
  const source = await seated();
  await send(source, ["Soup", "Sirloin"]);
  const sirloin = await idOf(source.tabId, "Sirloin");
  expect((await grouping(source.tabId)).total).toBe(1900);
  await comp(source.tabId, sirloin);
  const target = await partyBill(source);
  const before = await grouping(source.tabId);

  await expect(move(source, target, [sirloin])).rejects.toMatchObject({
    code: "set_menu.move_adjusted",
    params: { dishNames: ["Sirloin"] },
  });
  expect(await grouping(source.tabId)).toEqual(before);
  expect(await grouping(target.tabId)).toEqual({ rows: [], total: 0 });
});

it("refuses moving alone a dish a comp of its row left with only a stamped list price (D18)", async () => {
  const source = await seated();
  await send(source, ["Soup", "Soup", "Soup", "Sirloin", "Sirloin", "Sirloin"]);
  const sirloins = await Promise.all([0, 1, 2].map((nth) => idOf(source.tabId, "Sirloin", nth)));
  // One of the three-Sirloin row comped: the comp names the row's first Sirloin and the third it
  // took, and stamps the list price on every Sirloin of the row.
  await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: source.tabId,
        expectedEdit: await readBillEditState(tx, source.tabId),
        submissionId: randomUUID(),
        expectedRevision: await readOrderRevision(tx, source.tabId),
        lineId: sirloins[0]!,
        lineIds: sirloins,
        quantity: "1",
        reasonId: await reasonIdOf(tx, GIVE_AWAY_REASON),
        action: "comp",
        note: null,
        operatorId: venue.operator.personId,
      },
      venue.cfg.locale,
    ),
  );
  const middle = sirloins[1]!;
  expect(await inTx(venue, (tx) => namedFrozenLineIds(tx, [middle]))).toEqual(new Set());
  expect((await specRows(spec, source.tabId)).find(({ id }) => id === middle)).toMatchObject({
    listUnitPriceGross: 500,
  });
  const target = await partyBill(source);
  const before = await grouping(source.tabId);

  await expect(move(source, target, [middle])).rejects.toMatchObject({
    code: "set_menu.move_adjusted",
    params: { dishNames: ["Sirloin"] },
  });
  expect(await grouping(source.tabId)).toEqual(before);
  expect(await grouping(target.tabId)).toEqual({ rows: [], total: 0 });
});

it("refuses moving alone a dish whose cancel kept its charge (D18)", async () => {
  const source = await seated();
  await send(source, ["Soup", "Hake"]);
  const hake = await idOf(source.tabId, "Hake");
  await inTx(venue, async (tx) => {
    const [ticket] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, hake));
    await advanceTicketItem(tx, ticket!.id, "preparing");
    const [row] = (await specRows(spec, source.tabId)).filter(({ id }) => id === hake);
    const { target, lineId, body } = await observedCancelItem(tx, source.tabId, row!.lineNo);
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
  const target = await partyBill(source);
  const before = await grouping(source.tabId);

  await expect(move(source, target, [hake])).rejects.toMatchObject({
    code: "set_menu.moves_with_set_menu",
    params: { dishName: "Hake" },
  });
  expect(await grouping(source.tabId)).toEqual(before);
  expect(await grouping(target.tabId)).toEqual({ rows: [], total: 0 });
});

it("moves a dish with no comp of its own out of a comped Daily, which stays on its bill (D18)", async () => {
  const source = await seated();
  await send(source, ["Soup", "Hake"]);
  await comp(source.tabId, await idOf(source.tabId, "Daily menu"));
  const before = await grouping(source.tabId);
  const target = await partyBill(source);

  await move(source, target, [await idOf(source.tabId, "Hake")]);

  expect(await grouping(source.tabId)).toEqual({
    rows: before.rows.filter(({ what }) => what !== "Hake"),
    total: before.total,
  });
  expect(await grouping(target.tabId)).toEqual(HAKE_DAILY);
});

it("keeps a comped dish and its Daily in place on the copy Reopen bill makes, after Sea bass is sent there (D15)", async () => {
  const bill = await seated();
  await send(bill, ["Soup", "Sirloin"]);
  await comp(bill.tabId, await idOf(bill.tabId, "Sirloin"));
  await serveSpecBill(spec, bill.partyId, bill.tabId);
  await printSpecBill(spec, bill.partyId, bill.tabId);
  const { billId } = await splitAfterPrint(specDeps(spec), venue.cfg, bill.tabId, venue.operator);
  const copied = await grouping(billId);
  expect(copied.rows).toEqual([
    { what: "Soup", price: 0, in: "Daily menu 1" },
    { what: "Sirloin", price: expect.any(Number), in: "Daily menu 1" },
    { what: "Daily menu 1", price: 1400 },
  ]);

  const [copy] = await venue.db
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  await send({ partyId: copy!.partyId!, tabId: billId }, ["Sea bass"]);

  expect(await grouping(billId)).toEqual({
    rows: [...copied.rows, { what: "Sea bass", price: 1900, in: null }],
    total: copied.total + 1900,
  });
});

it("merges Soup on one bill and Hake on the other into one Daily", async () => {
  const into = await seated();
  await send(into, ["Soup"]);
  const from = await partyBill(into);
  await send(from, ["Hake"]);
  expect(await grouping(from.tabId)).toEqual(HAKE_DAILY);

  const command = await commandFor(venue, into.partyId);
  await inTx(venue, (tx) => mergeBills(tx, venue.cfg, into.tabId, from.tabId, command));

  expect(await grouping(from.tabId)).toEqual({ rows: [], total: 0 });
  const merged = await grouping(into.tabId);
  expect(merged.total).toBe(1400);
  expect(merged.rows.filter(({ what }) => what.startsWith("Daily menu"))).toEqual([
    { what: "Daily menu 1", price: 1400 },
  ]);
  expect(merged.rows.filter(({ what }) => !what.startsWith("Daily menu"))).toEqual([
    { what: "Soup", price: 0, in: "Daily menu 1" },
    { what: "Hake", price: 0, in: "Daily menu 1" },
  ]);
});

it("splits a table taking Hake to the new bill, and both bills work out their set menus", async () => {
  const source = await seated();
  await send(source, ["Soup", "Hake"]);
  const leaving = await venue.table(randomUUID());
  await join(venue, source.partyId, leaving);
  const command = await commandFor(venue, source.partyId);

  const moved = await inTx(venue, async (tx) =>
    splitTable(
      tx,
      venue.cfg,
      source.partyId,
      leaving,
      {
        wholeBillIds: [],
        loose: [{ billId: source.tabId, lineIds: [await idOf(source.tabId, "Hake")] }],
      },
      command,
    ),
  );

  expect(await grouping(source.tabId)).toEqual({
    rows: [{ what: "Soup", price: 600, in: null }],
    total: 600,
  });
  expect(await grouping(moved.billId)).toEqual(HAKE_DAILY);
});

it("splits a table taking Soup from one bill and Hake from another: the new bill works them out once, as a Daily", async () => {
  const first = await seated();
  await send(first, ["Soup", "Sea bass"]);
  const second = await partyBill(first);
  await send(second, ["Hake"]);
  const leaving = await venue.table(randomUUID());
  await join(venue, first.partyId, leaving);
  const command = await commandFor(venue, first.partyId);
  const soup = await idOf(first.tabId, "Soup");
  const hake = await idOf(second.tabId, "Hake");
  regrouped.length = 0;

  const moved = await inTx(venue, async (tx) =>
    splitTable(
      tx,
      venue.cfg,
      first.partyId,
      leaving,
      {
        wholeBillIds: [],
        loose: [
          { billId: first.tabId, lineIds: [soup] },
          { billId: second.tabId, lineIds: [hake] },
        ],
      },
      command,
    ),
  );

  // Opening the new bill, each source as its dishes leave, then the new bill once they have all come.
  expect(regrouped).toEqual([[moved.billId], [first.tabId], [second.tabId], [moved.billId]]);
  expect(await grouping(moved.billId)).toEqual(SOUP_AND_HAKE_DAILY);
  expect(await grouping(first.tabId)).toEqual({
    rows: [{ what: "Sea bass", price: 1900, in: null }],
    total: 1900,
  });
  expect(await grouping(second.tabId)).toEqual({ rows: [], total: 0 });
});

function payDeps() {
  return {
    admission: testTradingAdmission(),
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    provider: new SimulatorPaymentProvider(venue.db),
  };
}

async function payRequest(
  bill: Bill,
  lineIds: string[],
  pay: Pick<PayForItemsRequest, "method" | "applied" | "tendered" | "entry" | "simulationOutcome">,
): Promise<PayForItemsRequest> {
  return {
    submissionId: randomUUID(),
    picks: lineIds.map((lineId) => ({ lineId })),
    ...(await commandFor(venue, bill.partyId)),
    partyId: bill.partyId,
    expectedEdits: [await inTx(venue, (tx) => readBillEditState(tx, bill.tabId))],
    tip: "0.00",
    ...pay,
  };
}

const DAILY_AND_SEA_BASS = {
  rows: [
    { what: "Soup", price: 0, in: "Daily menu 1" },
    { what: "Hake", price: 0, in: "Daily menu 1" },
    { what: "Sea bass", price: 1900, in: null },
    { what: "Daily menu 1", price: 1400 },
  ],
  total: 3300,
};

it("Pay for items of a Daily with its dishes pays a new bill of 14.00, and the source works out the rest", async () => {
  const source = await seated();
  await send(source, ["Soup", "Hake", "Sea bass"]);
  expect(await grouping(source.tabId)).toEqual(DAILY_AND_SEA_BASS);
  const daily = await idOf(source.tabId, "Daily menu");

  const paid = await payForItems(
    payDeps(),
    venue.cfg,
    source.tabId,
    await payRequest(source, [daily], { method: "cash", applied: "14.00", tendered: "14.00" }),
    venue.operator,
    null,
  );

  expect(paid.payment.outcome).toBe("received");
  expect(await grouping(paid.billId)).toEqual(SOUP_AND_HAKE_DAILY);
  expect(await grouping(source.tabId)).toEqual({
    rows: [{ what: "Sea bass", price: 1900, in: null }],
    total: 1900,
  });
});

it("a declined reader card for a Daily puts both bills back to their first grouping", async () => {
  const source = await seated();
  await send(source, ["Soup", "Hake", "Sea bass"]);
  const daily = await idOf(source.tabId, "Daily menu");

  const paid = await payForItems(
    payDeps(),
    venue.cfg,
    source.tabId,
    await payRequest(source, [daily], {
      method: "card",
      applied: "14.00",
      entry: "reader",
      simulationOutcome: "declined",
    }),
    venue.operator,
    null,
  );

  expect(paid.payment.outcome).toBe("declined");
  // The items come back after the Sea bass that stayed.
  expect(await grouping(source.tabId)).toEqual({
    rows: [
      { what: "Sea bass", price: 1900, in: null },
      { what: "Soup", price: 0, in: "Daily menu 1" },
      { what: "Hake", price: 0, in: "Daily menu 1" },
      { what: "Daily menu 1", price: 1400 },
    ],
    total: 3300,
  });
  expect(await grouping(paid.billId)).toEqual({ rows: [], total: 0 });
});

it("refuses Pay for items of a not-cheapest Special at its preview's 20.00, as the new bill groups to 14.00 (D21)", async () => {
  const source = await seated();
  await send(source, ["Soup", "Hake", "Sea bass"]);
  await seedSpecial(source.tabId);
  const before = await grouping(source.tabId);
  expect(before.total).toBe(3900);
  const special = await idOf(source.tabId, "Special menu");
  expect(await inTx(venue, (tx) => priceItemPicks(tx, source.tabId, [{ lineId: special }]))).toBe(
    "20.00",
  );

  await expect(
    payForItems(
      payDeps(),
      venue.cfg,
      source.tabId,
      await payRequest(source, [special], { method: "cash", applied: "20.00", tendered: "20.00" }),
      venue.operator,
      null,
    ),
  ).rejects.toMatchObject({ code: "bill.allocation_changed" });
  expect(await grouping(source.tabId)).toEqual(before);
});

/** A seated bill of Soup and Hake held as a Special at 20.00, and two waters in one held row. */
async function specialBill() {
  const bill = await seated();
  await send(bill, ["Soup", "Hake"], "hold");
  await inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, bill.partyId, {
      operatorId: venue.operator.personId,
      billId: bill.tabId,
      groups: [{ lines: [{ menuItemId: venue.item("Water"), quantity: "1" }], release: "hold" }],
    }),
  );
  const [water] = (await specRows(spec, bill.tabId)).filter(({ name }) => name === "Water");
  // Two waters as one row, as a counted product leaves them: a send stores one row a portion.
  await inTx(venue, async (tx) => {
    await tx
      .update(workingOrderLines)
      .set({ quantity: 2000, lineTotal: 400, countAsPortions: false })
      .where(eq(workingOrderLines.id, water!.id));
    await tx
      .update(ticketItems)
      .set({ quantity: 2000 })
      .where(and(eq(ticketItems.workingOrderLineId, water!.id), isNotNull(ticketItems.quantity)));
  });
  expect((await specRows(spec, bill.tabId)).find(({ id }) => id === water!.id)!.quantity).toBe(
    2000,
  );
  await seedSpecial(bill.tabId);
  return bill;
}

/** The Special's rows, and its dishes', exactly as stored. */
async function specialRows(billId: string) {
  return (await specRows(spec, billId))
    .filter(({ setMenuRole }) => setMenuRole !== null)
    .map(({ id, name, setMenuRole, setMenuLineId, setMenuPlace, unitPriceGross, lineTotal }) => ({
      id,
      name,
      setMenuRole,
      setMenuLineId,
      setMenuPlace,
      unitPriceGross,
      lineTotal,
    }));
}

it("leaves a not-cheapest Special row for row when its bill moves to another table (D17)", async () => {
  const bill = await specialBill();
  const before = await specialRows(bill.tabId);
  expect(before.find(({ setMenuRole }) => setMenuRole === "set_menu")).toMatchObject({
    name: "Special menu",
    unitPriceGross: 2000,
  });
  const tableId = await venue.table(randomUUID());
  const command = await commandFor(venue, bill.partyId);

  await inTx(venue, (tx) =>
    moveBill(tx, venue.cfg, bill.tabId, { tableId }, { ...command, otherPartyId: null }),
  );

  expect(await specialRows(bill.tabId)).toEqual(before);
});

it("leaves a not-cheapest Special row for row when a held row splits into units (D17)", async () => {
  const bill = await specialBill();
  const before = await specialRows(bill.tabId);
  const waters = await idOf(bill.tabId, "Water");

  const command = await commandFor(venue, bill.partyId);
  await inTx(venue, async (tx) =>
    splitHeldLineIntoUnits(tx, venue.cfg, bill.partyId, waters, {
      ...command,
      submissionId: randomUUID(),
      expectedEdit: await readBillEditState(tx, bill.tabId),
    }),
  );

  expect((await specRows(spec, bill.tabId)).filter(({ name }) => name === "Water")).toHaveLength(2);
  expect(await specialRows(bill.tabId)).toEqual(before);
});

it("copies a not-cheapest Special row for row when a printed bill is reopened to split (D17)", async () => {
  const bill = await seated();
  await send(bill, ["Soup", "Hake"]);
  await seedSpecial(bill.tabId);
  await serveSpecBill(spec, bill.partyId, bill.tabId);
  await printSpecBill(spec, bill.partyId, bill.tabId);
  const before = await grouping(bill.tabId);
  expect(before.total).toBe(2000);

  const { billId } = await splitAfterPrint(specDeps(spec), venue.cfg, bill.tabId, venue.operator);

  const copied = await grouping(billId);
  expect(copied).toEqual({
    rows: before.rows.map((row) =>
      "in" in row ? { ...row, in: row.in === null ? null : expect.any(String) } : row,
    ),
    total: 2000,
  });
});

it("refuses a placed dish to a counter order eaten here, and moves one charged a la carte (pin)", async () => {
  const source = await seated();
  await send(source, ["Soup", "Hake", "Sea bass"]);
  const counter = await counterOrder(venue, "Burger");
  const lineNoOf = async (dish: SpecDish) =>
    (await specRows(spec, source.tabId)).find((row) => dishOf(row) === dish)!.lineNo;

  await expect(
    inTx(venue, async (tx) =>
      moveOrderLines(tx, venue.cfg, source.tabId, counter, [await lineNoOf("Hake")]),
    ),
  ).rejects.toMatchObject({ code: "set_menu.not_seated" });
  expect(await grouping(source.tabId)).toEqual(DAILY_AND_SEA_BASS);

  await inTx(venue, async (tx) =>
    moveOrderLines(tx, venue.cfg, source.tabId, counter, [await lineNoOf("Sea bass")]),
  );
  expect((await grouping(counter)).rows).toContainEqual({
    what: "Sea bass",
    price: 1900,
    in: null,
  });
  expect(await grouping(source.tabId)).toEqual(SOUP_AND_HAKE_DAILY);
});

/** A bill of Soup and Hake held as a not-cheapest Special at 20.00, with 18.00 received. */
async function partPaidSpecial(): Promise<Bill> {
  const bill = await seated();
  await send(bill, ["Soup", "Hake"]);
  await seedSpecial(bill.tabId);
  await cashContribution(venue, bill.tabId, "18.00");
  return bill;
}

function sendWater(bill: Bill) {
  return inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, bill.partyId, {
      operatorId: venue.operator.personId,
      billId: bill.tabId,
      groups: [{ lines: [{ menuItemId: venue.item("Water"), quantity: "1" }], release: "fire" }],
    }),
  );
}

it("refuses moving a Water onto a part-paid bill whose regrouping would fall below what it received, changing neither bill (D25)", async () => {
  const target = await partPaidSpecial();
  const source = await partyBill(target);
  await sendWater(source);
  const targetBefore = await grouping(target.tabId);
  const sourceBefore = await grouping(source.tabId);
  expect(targetBefore.total).toBe(2000);

  // Regrouped, Soup and Hake become a Daily at 14.00: 16.00 with the Water, below the 18.00 received.
  await expect(move(source, target, [await idOf(source.tabId, "Water")])).rejects.toMatchObject({
    code: "bill.received_exceeds_total",
  });

  expect(await grouping(target.tabId)).toEqual(targetBefore);
  expect(await grouping(source.tabId)).toEqual(sourceBefore);
});

it("refuses merging a bill into a part-paid bill whose regrouping would fall below what it received (D25)", async () => {
  const into = await partPaidSpecial();
  const from = await partyBill(into);
  await sendWater(from);
  const intoBefore = await grouping(into.tabId);
  const fromBefore = await grouping(from.tabId);
  const command = await commandFor(venue, into.partyId);

  await expect(
    inTx(venue, (tx) => mergeBills(tx, venue.cfg, into.tabId, from.tabId, command)),
  ).rejects.toMatchObject({ code: "bill.received_exceeds_total" });

  expect(await grouping(into.tabId)).toEqual(intoBefore);
  expect(await grouping(from.tabId)).toEqual(fromBefore);
});

it("refuses sending a Water to a part-paid bill whose regrouping would fall below what it received (D25)", async () => {
  const bill = await partPaidSpecial();
  const before = await grouping(bill.tabId);

  await expect(sendWater(bill)).rejects.toMatchObject({ code: "bill.received_exceeds_total" });

  expect(await grouping(bill.tabId)).toEqual(before);
});
