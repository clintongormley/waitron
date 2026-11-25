import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  adjustmentLines,
  insertInChunks,
  lineServiceCancellations,
  statementChunks,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createAdjustmentReason } from "@waitron/adjustments";
import { addProducts, menuItems, requireMenuRoot } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  decimal,
  groupSetMenus,
  type SetMenuGrouping,
  type SetMenuGroupingInput,
} from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  setDepartmentSalePolicyField,
} from "@waitron/venue-service";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { readBillsSetMenus } from "./set-menu-bill.js";
import { readGroupingCopies, regroupBills, saveBillGrouping } from "./set-menu-regroup.js";
import { copyBillDishes } from "./split-after-print.js";
import { readOrderRevision } from "./working-order-context.js";
import { parkOrder } from "./working-order-open.js";
import { takeBillPayment } from "./testing/bill-payment-fixture.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { cancelItemForTest, cancelLine, ensureOperator } from "./testing/cancel-line.js";
import {
  inTx,
  OPERATOR,
  placeByHand,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import {
  addEmptySpecSetMenus,
  sendSpecDraft,
  setupSetMenuSpecVenue,
  specDeps,
  specRows,
  type SpecDish,
  type SpecExtra,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";

let spec: SpecVenue;
let venue: PartyVenue;
/** The ordinary menu's offer of each dish, the same in every zone. */
let ordinary: Record<SpecDish, string>;
let takeawayZoneId: string;

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    await inTx(venue, async (tx) => {
      const shop = await createDepartment(tx, { name: "Takeaway shop", orderStart: "counter" });
      await setDepartmentSalePolicyField(tx, shop.id, "dining", "takeaway");
      const zone = await createServiceZone(tx, { name: "Takeaway shop", departmentId: shop.id });
      takeawayZoneId = (await offerProducts(tx, { zone: { zoneId: zone.id } })).zoneId;
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
      await ensureOperator(tx, WAITER_A);
      await ensureOperator(tx, WAITER_B);
    });
  },
});

const WAITER_A = "cccccccc-0000-4000-8000-00000000a0a1";
const WAITER_B = "cccccccc-0000-4000-8000-00000000b0b1";

type Ordered = SpecDish | { dish: SpecDish; extras: SpecExtra[] };

async function seated() {
  return seatWithNoAllergies(venue, await venue.table(randomUUID()));
}

/** Saves and sends the dishes from the ordinary menu, in order, in one group. */
async function send(bill: { partyId: string; tabId: string }, ...dishes: Ordered[]) {
  return sendReleased("hold", bill, ...dishes);
}

async function sendReleased(
  release: "hold" | "fire",
  bill: { partyId: string; tabId: string },
  ...dishes: Ordered[]
) {
  const draft = await saveSetMenuDraft(
    venue,
    bill,
    ...dishes.map((ordered) => {
      const { dish, extras } = typeof ordered === "string" ? { dish: ordered } : ordered;
      return {
        menuItemId: ordinary[dish],
        quantity: "1",
        ...(extras === undefined ? {} : { extras }),
      };
    }),
  );
  await sendSpecDraft(spec, draft.partyId, draft.id, release);
}

/** Puts a sent bill back as a send left it before sends regrouped: no set-menu row, every dish a
 *  la carte. */
async function ungroup(billId: string) {
  await inTx(venue, async (tx) => {
    await tx
      .delete(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, billId),
          eq(workingOrderLines.setMenuRole, "set_menu"),
        ),
      );
    await tx
      .update(workingOrderLines)
      .set({
        setMenuRole: null,
        setMenuLineId: null,
        setMenuPlace: null,
        unitPriceGross: sql`${workingOrderLines.aLaCarteUnitPrice}`,
        lineTotal: sql`${workingOrderLines.aLaCarteUnitPrice}`,
      })
      .where(
        and(
          eq(workingOrderLines.workingOrderId, billId),
          eq(workingOrderLines.setMenuRole, "dish"),
        ),
      );
  });
}

function regroup(...billIds: string[]) {
  return inTx(venue, (tx) => regroupBills(tx, billIds));
}

async function rows(billId: string) {
  return specRows(spec, billId);
}

async function total(billId: string) {
  return (await rows(billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

function productOf(row: { productId: string | null }): SpecDish | undefined {
  return (Object.keys(spec.productIds) as SpecDish[]).find(
    (dish) => spec.productIds[dish] === row.productId,
  );
}

/** Each top-level row as dish name or set-menu name, its price, role, set menu and place. */
async function shape(billId: string) {
  return (await rows(billId))
    .filter(({ parentLineId }) => parentLineId === null)
    .map((row) => ({
      id: row.id,
      what: row.setMenuRole === "set_menu" ? row.name : productOf(row),
      role: row.setMenuRole,
      price: row.unitPriceGross,
      total: row.lineTotal,
      setMenuLineId: row.setMenuLineId,
      place: row.setMenuPlace,
      creditedTo: row.creditedTo,
    }));
}

async function exactOf(billId: string) {
  const [bill] = await venue.db
    .select({ exact: workingOrders.setMenusExact })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return bill!.exact;
}

/** The bill's set menus as the till's read of a party's bills carries them. */
async function setMenusAnswer(billId: string) {
  return (await inTx(venue, (tx) => readBillsSetMenus(tx, [billId]))).get(billId)!.setMenus;
}

function menuRows(shaped: Awaited<ReturnType<typeof shape>>) {
  return shaped.filter(({ role }) => role === "set_menu");
}

/** Soup and Hake sent and grouped into one Daily: [daily, soup, hake]. */
async function groupedSoupAndHake(first: Ordered = "Soup", release: "hold" | "fire" = "hold") {
  const bill = await seated();
  await sendReleased(release, bill, first, "Hake");
  await regroup(bill.tabId);
  const shaped = await shape(bill.tabId);
  const daily = menuRows(shaped)[0]!;
  const soup = shaped.find(({ what }) => what === "Soup")!;
  const hake = shaped.find(({ what }) => what === "Hake")!;
  return { bill, daily, soup, hake };
}

type Action =
  | { action: "comp" }
  | { action: "discount_percent"; percentBp: number }
  | { action: "discount_amount"; amount: string };

async function adjust(billId: string, lineId: string | null, action: Action) {
  const reason = await inTx(venue, (tx) =>
    createAdjustmentReason(tx, { ...REASONS.house, name: `House ${randomUUID()}` }),
  );
  return inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: specDeps(spec).admission,
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId,
        reasonId: reason.id,
        note: null,
        operatorId: venue.operator.personId,
        ...(action.action === "discount_amount"
          ? { action: action.action, amount: decimal(action.amount) }
          : action),
      },
      venue.cfg.locale,
    ),
  );
}

/** After the frozen rows `frozen`, a new Soup and Hake are sent and the bill regrouped: every frozen
 *  row keeps its id, place and price, and the new pair forms a Daily of its own. */
async function expectFrozenThenNewPair(
  bill: { partyId: string; tabId: string },
  frozen: Awaited<ReturnType<typeof shape>>,
) {
  await send(bill, "Soup", "Hake");
  await regroup(bill.tabId);
  const after = await shape(bill.tabId);
  for (const row of frozen) {
    const now = after.find(({ id }) => id === row.id)!;
    expect({
      id: now.id,
      role: now.role,
      price: now.price,
      total: now.total,
      setMenuLineId: now.setMenuLineId,
      place: now.place,
    }).toEqual({
      id: row.id,
      role: row.role,
      price: row.price,
      total: row.total,
      setMenuLineId: row.setMenuLineId,
      place: row.place,
    });
  }
  const frozenIds = new Set(frozen.map(({ id }) => id));
  const fresh = after.filter(({ id }) => !frozenIds.has(id));
  const newDaily = menuRows(fresh);
  expect(newDaily.map(({ what, price, total }) => ({ what, price, total }))).toEqual([
    { what: "Daily menu", price: 1400, total: 1400 },
  ]);
  expect(
    fresh
      .filter(({ role }) => role !== "set_menu")
      .map(({ what, role, price, setMenuLineId, place }) => ({
        what,
        role,
        price,
        setMenuLineId,
        place,
      })),
  ).toEqual([
    { what: "Soup", role: "dish", price: 0, setMenuLineId: newDaily[0]!.id, place: 0 },
    { what: "Hake", role: "dish", price: 0, setMenuLineId: newDaily[0]!.id, place: 1 },
  ]);
}

it("groups Soup and Hake into one Daily menu and answers it as exact", async () => {
  const bill = await seated();
  await send(bill, "Soup", "Hake");
  await ungroup(bill.tabId);
  expect(await total(bill.tabId)).toBe(2200);

  expect(await regroup(bill.tabId)).toEqual(new Set([bill.tabId]));

  const shaped = await shape(bill.tabId);
  const [daily] = menuRows(shaped);
  expect(
    shaped.map(({ what, role, price, total, setMenuLineId, place }) => ({
      what,
      role,
      price,
      total,
      setMenuLineId,
      place,
    })),
  ).toEqual([
    { what: "Soup", role: "dish", price: 0, total: 0, setMenuLineId: daily!.id, place: 0 },
    { what: "Hake", role: "dish", price: 0, total: 0, setMenuLineId: daily!.id, place: 1 },
    {
      what: "Daily menu",
      role: "set_menu",
      price: 1400,
      total: 1400,
      setMenuLineId: null,
      place: null,
    },
  ]);
  const [row] = (await rows(bill.tabId)).filter(({ id }) => id === daily!.id);
  expect(row).toMatchObject({
    quantity: 1000,
    setMenuId: spec.daily.menuId,
    setMenuVersionId: spec.daily.versionId,
    sentAt: expect.any(String),
    servedAt: expect.any(String),
    servedQuantity: 1000,
    vatClass: "reduced",
    takeawayVatClass: "reduced",
  });
  expect({
    name: row!.name,
    descriptions: row!.descriptions,
    unitPrecision: row!.unitPrecision,
  }).toEqual({ name: "Daily menu", descriptions: { "es-ES": "Daily menu" }, unitPrecision: 0 });
  expect(Object.keys(row!.descriptions).length).toBeGreaterThan(0);
  expect(await total(bill.tabId)).toBe(1400);
  expect(await exactOf(bill.tabId)).toBe(true);

  const answer = await setMenusAnswer(bill.tabId);
  expect(answer.exact).toBe(true);
  expect(answer.setMenus).toEqual([
    { lineId: daily!.id, lineNo: 3, copyId: expect.stringMatching(`^${spec.daily.menuId}:`) },
  ]);
});

it("groups Soup and Sirloin into a Daily with Sirloin's supplement, cheaper than a Special", async () => {
  const bill = await seated();
  await send(bill, "Soup", "Sirloin");
  await regroup(bill.tabId);
  const shaped = await shape(bill.tabId);
  expect(shaped.map(({ what, price }) => ({ what, price }))).toEqual([
    { what: "Soup", price: 0 },
    { what: "Sirloin", price: 500 },
    { what: "Daily menu", price: 1400 },
  ]);
  expect(await total(bill.tabId)).toBe(1900);
});

it("leaves Soup alone at its own price", async () => {
  const bill = await seated();
  await send(bill, "Soup");
  expect(await regroup(bill.tabId)).toEqual(new Set());
  expect((await shape(bill.tabId)).map(({ what, role, price }) => ({ what, role, price }))).toEqual(
    [{ what: "Soup", role: null, price: 600 }],
  );
});

it("puts Hake alone in a Daily with an empty place, cheaper than Hake a la carte", async () => {
  const bill = await seated();
  await send(bill, "Hake");
  await regroup(bill.tabId);
  const shaped = await shape(bill.tabId);
  const [daily] = menuRows(shaped);
  expect(
    shaped.map(({ what, price, setMenuLineId, place }) => ({ what, price, setMenuLineId, place })),
  ).toEqual([
    { what: "Hake", price: 0, setMenuLineId: daily!.id, place: 1 },
    { what: "Daily menu", price: 1400, setMenuLineId: null, place: null },
  ]);
});

it("keeps a saved Daily while dishes are added, and removes it when it stops paying (D5)", async () => {
  const bill = await seated();
  await send(bill, "Soup", "Hake");
  await regroup(bill.tabId);
  const [first] = menuRows(await shape(bill.tabId));

  await send(bill, "Soup", "Sea bass");
  await regroup(bill.tabId);
  const second = await shape(bill.tabId);
  const special = second.find(({ what }) => what === "Special menu")!;
  expect(
    second.map(({ id, what, price, setMenuLineId, place }) => ({
      id: what === "Daily menu" ? id : undefined,
      what,
      price,
      setMenuLineId,
      place,
    })),
  ).toEqual([
    { id: undefined, what: "Soup", price: 0, setMenuLineId: first!.id, place: 0 },
    { id: undefined, what: "Hake", price: 0, setMenuLineId: first!.id, place: 1 },
    { id: first!.id, what: "Daily menu", price: 1400, setMenuLineId: null, place: null },
    { id: undefined, what: "Soup", price: 0, setMenuLineId: special.id, place: 0 },
    { id: undefined, what: "Sea bass", price: 0, setMenuLineId: special.id, place: 1 },
    { id: undefined, what: "Special menu", price: 2000, setMenuLineId: null, place: null },
  ]);

  const hake = second.find(({ what }) => what === "Hake")!;
  const hakeLineNo = (await rows(bill.tabId)).find(({ id }) => id === hake.id)!.lineNo;
  await inTx(venue, (tx) => cancelItemForTest(tx, venue.cfg, bill.tabId, hakeLineNo));
  await regroup(bill.tabId);
  const third = await shape(bill.tabId);
  expect(third.find(({ id }) => id === first!.id)).toBeUndefined();
  expect(
    third
      .filter(({ what }) => what !== "Hake")
      .map(({ id, what, price, setMenuLineId }) => ({
        id: what === "Special menu" ? id : undefined,
        what,
        price,
        setMenuLineId,
      })),
  ).toEqual([
    { id: undefined, what: "Soup", price: 600, setMenuLineId: null },
    { id: undefined, what: "Soup", price: 0, setMenuLineId: special.id },
    { id: undefined, what: "Sea bass", price: 0, setMenuLineId: special.id },
    { id: special.id, what: "Special menu", price: 2000, setMenuLineId: null },
  ]);
});

it.each([
  ["Soup first", ["Soup", "Hake"] as const, WAITER_A],
  ["Hake first", ["Hake", "Soup"] as const, WAITER_B],
])(
  "credits a set menu to whoever is credited with its first dish: %s (D6, D19)",
  async (_, order, expected) => {
    const bill = await seated();
    await send(bill, ...order);
    await inTx(venue, async (tx) => {
      for (const [dish, waiter] of [
        ["Soup", WAITER_A],
        ["Hake", WAITER_B],
      ] as const) {
        await tx
          .update(workingOrderLines)
          .set({ creditedTo: waiter })
          .where(
            and(
              eq(workingOrderLines.workingOrderId, bill.tabId),
              eq(workingOrderLines.productId, spec.productIds[dish]),
            ),
          );
      }
    });
    await regroup(bill.tabId);
    const [daily] = menuRows(await shape(bill.tabId));
    expect(daily!.creditedTo).toBe(expected);
  },
);

it("leaves a set menu whose included dish was comped for nothing as it is (D2)", async () => {
  const { bill, daily, soup, hake } = await groupedSoupAndHake({
    dish: "Soup",
    extras: [spec.bread],
  });
  await adjust(bill.tabId, soup.id, { action: "comp" });
  expect(
    await venue.db.select().from(adjustmentLines).where(eq(adjustmentLines.lineId, soup.id)),
  ).toEqual([]);
  const breadLineNo = (await rows(bill.tabId)).find(
    ({ parentLineId }) => parentLineId === soup.id,
  )!.lineNo;
  await inTx(venue, (tx) => cancelLine(tx, venue.cfg, bill.tabId, breadLineNo));
  const hakeLineNo = (await rows(bill.tabId)).find(({ id }) => id === hake.id)!.lineNo;
  await inTx(venue, (tx) => cancelItemForTest(tx, venue.cfg, bill.tabId, hakeLineNo));
  await regroup(bill.tabId);
  const after = await shape(bill.tabId);
  expect(after.find(({ id }) => id === daily.id)).toMatchObject({ price: 1400, total: 1400 });
  expect(after.find(({ id }) => id === soup.id)).toMatchObject({
    price: 0,
    total: 0,
    setMenuLineId: daily.id,
    place: 0,
  });
  expect(await total(bill.tabId)).toBe(1400);
});

it("leaves a set menu whose dish's paid extra was discounted as it is (D2)", async () => {
  const bill = await seated();
  await send(bill, { dish: "Soup", extras: [spec.bread] }, "Hake");
  await regroup(bill.tabId);
  const bread = (await rows(bill.tabId)).find(({ parentLineId }) => parentLineId !== null)!;
  expect(bread.lineTotal).toBe(150);
  await adjust(bill.tabId, bread.id, { action: "discount_percent", percentBp: 1000 });
  const frozen = await shape(bill.tabId);
  expect(menuRows(frozen)).toHaveLength(1);
  await expectFrozenThenNewPair(bill, frozen);
});

it("leaves a comped Daily menu and its dishes as they are (D2)", async () => {
  const { bill, daily } = await groupedSoupAndHake();
  await adjust(bill.tabId, daily.id, { action: "comp" });
  await expectFrozenThenNewPair(bill, await shape(bill.tabId));
});

it("writes nothing on a bill discounted as a whole (D2)", async () => {
  const bill = await seated();
  await send(bill, "Soup", "Hake", "Soup");
  await adjust(bill.tabId, null, { action: "discount_percent", percentBp: 1000 });
  const before = await rows(bill.tabId);
  expect(await regroup(bill.tabId)).toEqual(new Set());
  expect(await rows(bill.tabId)).toEqual(before);
});

it("leaves a dish paid for by item as it is (D2)", async () => {
  const bill = await seated();
  await send(bill, "Hake", "Sirloin");
  await ungroup(bill.tabId);
  const hake = (await shape(bill.tabId)).find(({ what }) => what === "Hake")!;
  const hakeLineNo = (await rows(bill.tabId)).find(({ id }) => id === hake.id)!.lineNo;
  expect(
    await takeBillPayment(
      specDeps(spec),
      venue.cfg,
      bill.tabId,
      {
        submissionId: randomUUID(),
        tip: "0.00",
        kind: "items",
        lines: [{ lineNo: hakeLineNo }],
        method: "cash",
        tendered: "16.00",
        applied: "16.00",
      },
      venue.operator,
    ),
  ).toMatchObject({ outcome: "received" });
  await regroup(bill.tabId);
  const shaped = await shape(bill.tabId);
  const [daily] = menuRows(shaped);
  expect(
    shaped.map(({ id, what, role, price, setMenuLineId, place }) => ({
      id: what === "Hake" ? id : undefined,
      what,
      role,
      price,
      setMenuLineId,
      place,
    })),
  ).toEqual([
    { id: hake.id, what: "Hake", role: null, price: 1600, setMenuLineId: null, place: null },
    {
      id: undefined,
      what: "Sirloin",
      role: "dish",
      price: 500,
      setMenuLineId: daily!.id,
      place: 1,
    },
    {
      id: undefined,
      what: "Daily menu",
      role: "set_menu",
      price: 1400,
      setMenuLineId: null,
      place: null,
    },
  ]);
});

it("leaves a set menu whose dish was cancelled keeping its charge as it is (D15)", async () => {
  const { bill, daily, soup, hake } = await groupedSoupAndHake("Soup", "fire");
  const soupLineNo = (await rows(bill.tabId)).find(({ id }) => id === soup.id)!.lineNo;
  await inTx(venue, (tx) =>
    cancelItemForTest(tx, venue.cfg, bill.tabId, soupLineNo, undefined, undefined, undefined, {
      outcome: "keep_charge",
      preparationStarted: true,
    }),
  );
  const frozen = await shape(bill.tabId);
  await expectFrozenThenNewPair(bill, frozen);

  const hakeLineNo = (await rows(bill.tabId)).find(({ id }) => id === hake.id)!.lineNo;
  await inTx(venue, (tx) => cancelItemForTest(tx, venue.cfg, bill.tabId, hakeLineNo));
  await regroup(bill.tabId);
  const after = await shape(bill.tabId);
  expect(after.find(({ id }) => id === daily.id)).toMatchObject({ price: 1400, total: 1400 });
  expect(after.find(({ id }) => id === soup.id)).toMatchObject({
    price: 0,
    setMenuLineId: daily.id,
    place: 0,
  });
});

it("leaves a set menu whose dish carries a service cancellation, as a reopened bill's can, as it is (D15)", async () => {
  const { bill, hake } = await groupedSoupAndHake();
  await inTx(venue, (tx) =>
    tx.insert(lineServiceCancellations).values({
      lineId: hake.id,
      quantity: 1000,
      cancelledAt: new Date().toISOString(),
      wasStarted: false,
      actorId: venue.operator.personId,
    }),
  );
  const before = await rows(bill.tabId);
  const aLaCarte = vi.fn((input: SetMenuGroupingInput): SetMenuGrouping => ({
    exact: true,
    totalCents: 0,
    unusedDiscountIds: [],
    setMenus: [],
    dishes: input.dishes.map(({ id, aLaCarteCents, extrasCents }) => ({
      id,
      place: null,
      chargeCents: aLaCarteCents,
      extrasCents,
    })),
  }));
  await inTx(venue, async (tx) =>
    saveBillGrouping(tx, bill.tabId, await readGroupingCopies(tx, bill.tabId), aLaCarte),
  );
  expect(aLaCarte.mock.calls[0]![0].dishes).toEqual([]);
  expect(await rows(bill.tabId)).toEqual(before);
});

it("leaves the dishes a whole-bill discount reduced as they are, with their list price cleared (D15)", async () => {
  const bill = await seated();
  await send(bill, "Soup", "Hake");
  await ungroup(bill.tabId);
  await adjust(bill.tabId, null, { action: "discount_percent", percentBp: 1000 });
  await inTx(venue, (tx) =>
    tx
      .update(workingOrderLines)
      .set({ listUnitPriceGross: null })
      .where(eq(workingOrderLines.workingOrderId, bill.tabId)),
  );
  const reduced = await venue.db
    .select({ lineId: adjustmentLines.lineId })
    .from(adjustmentLines)
    .where(
      inArray(
        adjustmentLines.lineId,
        (await rows(bill.tabId)).map(({ id }) => id),
      ),
    );
  expect(reduced).toHaveLength(2);
  const before = await rows(bill.tabId);
  expect(await regroup(bill.tabId)).toEqual(new Set());
  expect(await rows(bill.tabId)).toEqual(before);
});

it("leaves a dish stamped with a list price and no adjustment naming it as it is (D15)", async () => {
  const { bill, soup } = await groupedSoupAndHake();
  await inTx(venue, (tx) =>
    tx
      .update(workingOrderLines)
      .set({ listUnitPriceGross: 0 })
      .where(eq(workingOrderLines.id, soup.id)),
  );
  await expectFrozenThenNewPair(bill, await shape(bill.tabId));
  const [stamped] = (await rows(bill.tabId)).filter(({ id }) => id === soup.id);
  expect(stamped!.unitPriceGross).toBe(0);
});

it("saves a grouping the calculation could not prove cheapest, answering exact false", async () => {
  const bill = await seated();
  await send(bill, "Soup", "Hake");
  const calculate = vi.fn((input: SetMenuGroupingInput) => ({
    ...groupSetMenus(input),
    exact: false,
  }));
  expect(
    await inTx(venue, async (tx) =>
      saveBillGrouping(tx, bill.tabId, await readGroupingCopies(tx, bill.tabId), calculate),
    ),
  ).toEqual({ changed: true, exact: false });
  expect(calculate).toHaveBeenCalledOnce();
  expect(calculate.mock.calls[0]![0].discounts).toEqual([]);
  expect(await total(bill.tabId)).toBe(1400);
  expect(await exactOf(bill.tabId)).toBe(false);
  expect((await setMenusAnswer(bill.tabId)).exact).toBe(false);

  const grouped = await rows(bill.tabId);
  expect(await regroup(bill.tabId)).toEqual(new Set([bill.tabId]));
  expect(await exactOf(bill.tabId)).toBe(true);
  expect(await rows(bill.tabId)).toEqual(grouped);
});

it("saves a valid grouping a calculation hands it, even when not the cheapest", async () => {
  const bill = await seated();
  await send(bill, "Soup", "Hake");
  const [soup, hake] = await shape(bill.tabId);
  const calculate = (input: SetMenuGroupingInput): SetMenuGrouping => ({
    exact: true,
    totalCents: 2000,
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
    dishes: [
      {
        id: soup!.id,
        place: { setMenuId: "special", lineIndex: 0 },
        chargeCents: 0,
        extrasCents: 0,
      },
      {
        id: hake!.id,
        place: { setMenuId: "special", lineIndex: 1 },
        chargeCents: 0,
        extrasCents: 0,
      },
    ],
  });
  await inTx(venue, async (tx) =>
    saveBillGrouping(tx, bill.tabId, await readGroupingCopies(tx, bill.tabId), calculate),
  );
  const shaped = await shape(bill.tabId);
  expect(shaped.map(({ what, price }) => ({ what, price }))).toEqual([
    { what: "Soup", price: 0 },
    { what: "Hake", price: 0 },
    { what: "Special menu", price: 2000 },
  ]);
});

it("groups a takeaway bill's sent dishes into its cheapest set menu, and takes its price", async () => {
  const bill = await seated();
  await inTx(venue, (tx) =>
    tx.update(workingOrders).set({ dining: "takeaway" }).where(eq(workingOrders.id, bill.tabId)),
  );
  await send(bill, "Soup", "Hake");
  const shaped = await shape(bill.tabId);
  const daily = menuRows(shaped)[0]?.id;
  expect(
    shaped.map(({ what, role, price, setMenuLineId }) => ({ what, role, price, setMenuLineId })),
  ).toEqual([
    { what: "Soup", role: "dish", price: 0, setMenuLineId: daily },
    { what: "Hake", role: "dish", price: 0, setMenuLineId: daily },
    { what: "Daily menu", role: "set_menu", price: 1400, setMenuLineId: null },
  ]);
  await takeBillPayment(
    specDeps(spec),
    venue.cfg,
    bill.tabId,
    {
      submissionId: randomUUID(),
      tip: "0.00",
      kind: "share",
      shareOf: 1,
      applied: "14.00",
      method: "cash",
      tendered: "14.00",
    },
    venue.operator,
  );
  const [row] = await venue.db
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, bill.tabId));
  expect(row?.status).toBe("settled");
});

it("groups a counter takeaway bill's dishes into one set menu, leaving no empty one", async () => {
  const id = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id,
    zoneId: takeawayZoneId,
    lines: [
      { menuItemId: ordinary.Soup, quantity: "1" },
      { menuItemId: ordinary.Hake, quantity: "1" },
    ],
    operatorId: OPERATOR,
    dining: "takeaway",
  });
  await addEmptySpecSetMenus(spec, id, spec.daily);
  await regroup(id);
  const shaped = await shape(id);
  const daily = menuRows(shaped)[0]?.id;
  expect(
    shaped.map(({ what, role, price, setMenuLineId }) => ({ what, role, price, setMenuLineId })),
  ).toEqual([
    { what: "Soup", role: "dish", price: 0, setMenuLineId: daily },
    { what: "Hake", role: "dish", price: 0, setMenuLineId: daily },
    { what: "Daily menu", role: "set_menu", price: 1400, setMenuLineId: null },
  ]);
});

it("writes nothing on a placed bill or a counter bill eaten here", async () => {
  const placed = await seated();
  await send(placed, "Soup", "Hake");
  await placeByHand(venue, placed.tabId);
  const counter = randomUUID();
  await parkOrder({ db: venue.db }, venue.cfg, {
    id: counter,
    zoneId: venue.counter.zoneId,
    lines: [
      { menuItemId: ordinary.Soup, quantity: "1" },
      { menuItemId: ordinary.Hake, quantity: "1" },
    ],
    operatorId: OPERATOR,
  });
  const before = [await rows(placed.tabId), await rows(counter)];
  expect(await regroup(placed.tabId, counter)).toEqual(new Set());
  expect([await rows(placed.tabId), await rows(counter)]).toEqual(before);
});

it("changes nothing when a bill is regrouped with nothing changed", async () => {
  const { bill } = await groupedSoupAndHake();
  const before = await rows(bill.tabId);
  const answer = await inTx(venue, async (tx) =>
    saveBillGrouping(tx, bill.tabId, await readGroupingCopies(tx, bill.tabId)),
  );
  expect(answer).toEqual({ changed: false, exact: true });
  expect(await regroup(bill.tabId)).toEqual(new Set());
  expect(await rows(bill.tabId)).toEqual(before);
});

it("copies a bill whose new set menu comes after its dishes in a later insert statement", async () => {
  const bill = await seated();
  await send(bill, "Soup", "Hake");
  await ungroup(bill.tabId);
  const perStatement = statementChunks(workingOrderLines, Array.from({ length: 1 << 16 }))[0]!
    .length;
  const [soupRow] = await rows(bill.tabId);
  // Rows the grouping leaves alone, so the Daily it saves is the first row of the second statement.
  await inTx(venue, (tx) =>
    insertInChunks(
      tx,
      workingOrderLines,
      Array.from({ length: perStatement - 2 }, (_, index) => ({
        ...soupRow!,
        id: randomUUID(),
        lineNo: index + 3,
        aLaCarteUnitPrice: null,
        cohortId: null,
        cohortOrdinal: null,
        wholePortion: null,
      })),
    ),
  );
  await regroup(bill.tabId);
  const source = await rows(bill.tabId);
  const daily = source.find(({ setMenuRole }) => setMenuRole === "set_menu")!;
  expect(daily.lineNo).toBe(perStatement + 1);
  expect(source.filter(({ setMenuLineId }) => setMenuLineId === daily.id)).toHaveLength(2);

  const copy = await seated();
  await inTx(venue, (tx) => copyBillDishes(tx, bill.tabId, copy.tabId));
  const copied = await rows(copy.tabId);
  expect(copied.map(({ lineNo }) => lineNo)).toEqual(source.map(({ lineNo }) => lineNo));
  const copiedDaily = copied.find(({ setMenuRole }) => setMenuRole === "set_menu")!;
  expect(copiedDaily.lineNo).toBe(daily.lineNo);
  expect(
    copied
      .filter(({ setMenuLineId }) => setMenuLineId === copiedDaily.id)
      .map(({ lineNo, setMenuPlace }) => ({ lineNo, setMenuPlace })),
  ).toEqual(
    source
      .filter(({ setMenuLineId }) => setMenuLineId === daily.id)
      .map(({ lineNo, setMenuPlace }) => ({ lineNo, setMenuPlace })),
  );
});
