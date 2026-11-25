import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { adjustments, persons, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { menuItems } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimal } from "@waitron/shared";
import { readRows } from "./adjustment-rows.js";
import { applyAdjustment, previewAdjustment, type CheckedApprover } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { readOrderRevision } from "./working-order-context.js";
import { atReleasedPrices } from "./set-menu-dish-release.js";
import type { TradingContext } from "./trading-context.js";
import { approverPin, REASONS } from "./testing/adjustment-venue.js";
import { cancelLine, ensureOperator } from "./testing/cancel-line.js";
import {
  cashContribution,
  inTx,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import {
  addSpecDishesToFullMenu,
  cancelSpecLineKeepingCharge,
  sendSpecDraft,
  setupSetMenuSpecVenue,
  specDeps,
  specDishOf,
  specRows,
  type SpecDish,
  type SpecExtra,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
let venue: PartyVenue;
/** The ordinary menu's offer of each dish. */
let ordinary: Record<SpecDish, string>;
/** Holds `adjustment.apply` and not `adjustment.approve`. */
const WAITER = "cccccccc-0000-4000-8000-00000000d151";

useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
    ordinary = await addSpecDishesToFullMenu(spec);
    await inTx(venue, async (tx) => {
      await ensureOperator(tx, venue.operator.personId);
      await seedPersons(tx, { id: WAITER, displayName: "Waiter", role: "staff" });
    });
  },
});

type Bill = { partyId: string; tabId: string };
type Ordered = SpecDish | { dish: SpecDish; extras: SpecExtra[] };

async function send(bill: Bill, dishes: readonly Ordered[], release: "hold" | "fire" = "hold") {
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

async function billOf(dishes: readonly Ordered[], release: "hold" | "fire" = "hold") {
  const bill: Bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await send(bill, dishes, release);
  return bill;
}

function rows(billId: string) {
  return specRows(spec, billId);
}

async function total(billId: string) {
  return (await rows(billId)).reduce((sum, { lineTotal }) => sum + lineTotal, 0);
}

/** Every row, in line order: what it is, its price and list price, and the set menu holding it. */
async function shape(billId: string) {
  const all = await rows(billId);
  const menus = all.filter(({ setMenuRole }) => setMenuRole === "set_menu").map(({ id }) => id);
  return all.map((row) => {
    expect(row.lineTotal).toBe(row.unitPriceGross);
    expect(row.setMenuRole === "dish").toBe(row.setMenuLineId !== null);
    expect(row.setMenuPlace !== null).toBe(row.setMenuLineId !== null);
    return {
      what: specDishOf(spec, row) ?? row.name,
      price: row.unitPriceGross,
      list: row.listUnitPriceGross,
      in: row.setMenuLineId === null ? null : menus.indexOf(row.setMenuLineId),
    };
  });
}

async function linesOf(billId: string, dish: SpecDish) {
  return (await rows(billId)).filter(
    (row) => row.parentLineId === null && specDishOf(spec, row) === dish,
  );
}

async function idsOf(billId: string, dish: SpecDish) {
  return (await linesOf(billId, dish)).map(({ id }) => id);
}

async function menuIds(billId: string) {
  return (await rows(billId))
    .filter(({ setMenuRole }) => setMenuRole === "set_menu")
    .map(({ id }) => id);
}

type Action =
  | { action: "comp" }
  | { action: "discount_percent"; percentBp: number }
  | { action: "discount_amount"; amount: string };

const FREE: Action = { action: "comp" };
const percent = (percentBp: number): Action => ({ action: "discount_percent", percentBp });
const off = (amount: string): Action => ({ action: "discount_amount", amount });

interface How {
  lineIds?: string[];
  quantity?: string;
  maxAmount?: string;
  operatorId?: string;
  approver?: CheckedApprover;
  cfg?: TradingContext;
}

async function askFor(billId: string, lineId: string | null, action: Action, how: How) {
  const { lineIds, quantity, maxAmount, operatorId } = how;
  return inTx(venue, async (tx) => {
    const reason = await createAdjustmentReason(tx, {
      ...REASONS.house,
      name: `House ${randomUUID()}`,
      maxAmount: maxAmount === undefined ? null : decimal(maxAmount),
    });
    return {
      orderId: billId,
      expectedEdit: await readBillEditState(tx, billId),
      expectedRevision: await readOrderRevision(tx, billId),
      lineId,
      ...(lineIds === undefined ? {} : { lineIds }),
      ...(quantity === undefined ? {} : { quantity }),
      reasonId: reason.id,
      note: null,
      operatorId: operatorId ?? venue.operator.personId,
      ...(action.action === "discount_amount"
        ? { action: action.action, amount: decimal(action.amount) }
        : action),
    };
  });
}

async function adjust(billId: string, lineId: string | null, action: Action, how: How = {}) {
  const ask = await askFor(billId, lineId, action, how);
  const { approver, cfg = venue.cfg } = how;
  return inTx(venue, (tx) =>
    applyAdjustment(
      tx,
      cfg,
      {
        ...ask,
        admission: specDeps(spec).admission,
        submissionId: randomUUID(),
        ...(approver === undefined ? {} : { approver }),
      },
      cfg.locale,
    ),
  );
}

async function preview(billId: string, lineId: string, action: Action, how: How = {}) {
  const ask = await askFor(billId, lineId, action, how);
  return inTx(venue, (tx) => previewAdjustment(tx, ask, venue.cfg.locale));
}

/** What the bill's adjustments recorded, oldest first. */
async function recorded(billId: string) {
  return venue.db
    .select({
      before: adjustments.beforeAmount,
      after: adjustments.afterAmount,
      reduction: adjustments.reduction,
    })
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, billId))
    .orderBy(adjustments.createdAt);
}

/** `action` is refused as taking nothing off, changing and recording nothing. */
async function expectNoReduction(
  billId: string,
  lineId: string,
  action: Action = percent(1000),
  how: How = {},
) {
  const before = { rows: await rows(billId), recorded: await recorded(billId) };
  await expect(adjust(billId, lineId, action, how)).rejects.toMatchObject({
    code: "adjustment.no_reduction",
    params: { workingOrderId: billId },
  });
  expect({ rows: await rows(billId), recorded: await recorded(billId) }).toEqual(before);
}

it("charges a comped dish of a Daily a la carte less its comp, and works out the rest again", async () => {
  const { tabId } = await billOf(["Soup", "Soup", "Hake", "Hake"]);
  expect(await total(tabId)).toBe(2800);
  const dailies = await menuIds(tabId);
  expect(dailies).toHaveLength(2);
  const [first, second] = await linesOf(tabId, "Hake");

  await adjust(tabId, second!.id, FREE);

  expect((await rows(tabId)).find(({ id }) => id === second!.id)).toMatchObject({
    setMenuRole: null,
    setMenuLineId: null,
    setMenuPlace: null,
    unitPriceGross: 0,
    listUnitPriceGross: 1600,
  });
  expect(await menuIds(tabId)).toEqual([first!.setMenuLineId]);
  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 0, list: null, in: 0 },
    { what: "Soup", price: 600, list: null, in: null },
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Hake", price: 0, list: 1600, in: null },
    { what: "Daily menu", price: 1400, list: null, in: null },
  ]);
  expect(await total(tabId)).toBe(2000);
  expect(await recorded(tabId)).toEqual([{ before: 1600, after: 0, reduction: 1600 }]);
});

it("takes a percentage off a Daily's dish from its a la carte price, though the bill rises", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  expect(await total(tabId)).toBe(1400);
  const [hake] = await idsOf(tabId, "Hake");
  expect(await preview(tabId, hake!, percent(1000))).toMatchObject({
    reduction: "1.60",
    nominalValue: "16.00",
    lines: [{ lineId: hake, reduction: "1.60", rows: [{ quantity: "1.000", unitGross: "14.40" }] }],
  });

  await adjust(tabId, hake!, percent(1000));

  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 600, list: null, in: null },
    { what: "Hake", price: 1440, list: 1600, in: null },
  ]);
  expect(await total(tabId)).toBe(2040);
  expect(await recorded(tabId)).toEqual([{ before: 1600, after: 1440, reduction: 160 }]);
});

it("takes an amount off a Daily's dish with a supplement from its a la carte price", async () => {
  const { tabId } = await billOf(["Soup", "Sirloin"]);
  expect(await total(tabId)).toBe(1900);
  const [sirloin] = await idsOf(tabId, "Sirloin");

  await adjust(tabId, sirloin!, off("4.00"));

  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 600, list: null, in: null },
    { what: "Sirloin", price: 2000, list: 2400, in: null },
  ]);
  expect(await total(tabId)).toBe(2600);
  expect(await recorded(tabId)).toEqual([{ before: 2400, after: 2000, reduction: 400 }]);
});

it("leaves the Daily row for row when the a la carte Soup beside it is discounted", async () => {
  const { tabId } = await billOf(["Soup", "Soup", "Hake"]);
  expect(await total(tabId)).toBe(2000);
  const before = await rows(tabId);
  const loose = (await linesOf(tabId, "Soup")).find(({ setMenuRole }) => setMenuRole === null)!;

  await adjust(tabId, loose.id, percent(5000));

  const after = await rows(tabId);
  expect(after.find(({ id }) => id === loose.id)).toMatchObject({
    unitPriceGross: 300,
    lineTotal: 300,
    listUnitPriceGross: 600,
    setMenuLineId: null,
  });
  expect(after.filter(({ id }) => id !== loose.id)).toEqual(
    before.filter(({ id }) => id !== loose.id),
  );
  expect(await total(tabId)).toBe(1700);
  expect(await recorded(tabId)).toEqual([{ before: 600, after: 300, reduction: 300 }]);
});

it("gives a discounted Soup's place in the Daily to the other Soup", async () => {
  const { tabId } = await billOf(["Soup", "Soup", "Hake"]);
  const soups = await linesOf(tabId, "Soup");
  const placed = soups.find(({ setMenuRole }) => setMenuRole === "dish")!;
  const loose = soups.find(({ setMenuRole }) => setMenuRole === null)!;
  const daily = await menuIds(tabId);

  await adjust(tabId, placed.id, percent(5000));

  const after = await linesOf(tabId, "Soup");
  expect(after.find(({ id }) => id === placed.id)).toMatchObject({
    setMenuRole: null,
    setMenuLineId: null,
    unitPriceGross: 300,
    listUnitPriceGross: 600,
  });
  expect(after.find(({ id }) => id === loose.id)).toMatchObject({
    setMenuRole: "dish",
    setMenuLineId: daily[0],
    setMenuPlace: 0,
    unitPriceGross: 0,
    listUnitPriceGross: null,
  });
  expect(await menuIds(tabId)).toEqual(daily);
  expect(await total(tabId)).toBe(1700);
  expect(await recorded(tabId)).toEqual([{ before: 600, after: 300, reduction: 300 }]);
});

it("records a comped Soup's a la carte price though the bill stays as it was", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  const [soup] = await idsOf(tabId, "Soup");

  await adjust(tabId, soup!, FREE);

  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 0, list: 600, in: null },
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Daily menu", price: 1400, list: null, in: null },
  ]);
  expect(await total(tabId)).toBe(1400);
  expect(await recorded(tabId)).toEqual([{ before: 600, after: 0, reduction: 600 }]);
});

it("takes a comped Soup's paid Bread with it, and the Hake alone is a Daily", async () => {
  const { tabId } = await billOf([{ dish: "Soup", extras: [spec.bread] }, "Hake"]);
  expect(await total(tabId)).toBe(1550);
  const [soup] = await idsOf(tabId, "Soup");

  await adjust(tabId, soup!, FREE);

  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 0, list: 600, in: null },
    { what: "Bread", price: 0, list: 150, in: null },
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Daily menu", price: 1400, list: null, in: null },
  ]);
  expect(await total(tabId)).toBe(1400);
  expect(await recorded(tabId)).toEqual([{ before: 750, after: 0, reduction: 750 }]);
});

it("keeps a discounted Hake out of a Daily another Hake then makes with the Soup", async () => {
  const bill = await billOf(["Soup", "Hake"]);
  const [hake] = await idsOf(bill.tabId, "Hake");
  await adjust(bill.tabId, hake!, percent(1000));

  await send(bill, ["Hake"]);

  expect(await shape(bill.tabId)).toEqual([
    { what: "Soup", price: 0, list: null, in: 0 },
    { what: "Hake", price: 1440, list: 1600, in: null },
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Daily menu", price: 1400, list: null, in: null },
  ]);
  expect(await total(bill.tabId)).toBe(2840);
});

it("takes only the last of a row of two Hakes, the one left carrying no list price", async () => {
  const bill = await billOf(["Soup", "Soup", "Hake", "Hake"]);
  const { tabId } = bill;
  const hakes = await idsOf(tabId, "Hake");

  await adjust(tabId, hakes[0]!, FREE, { lineIds: hakes, quantity: "1" });

  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 0, list: null, in: 0 },
    { what: "Soup", price: 600, list: null, in: null },
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Hake", price: 0, list: 1600, in: null },
    { what: "Daily menu", price: 1400, list: null, in: null },
  ]);
  expect(await idsOf(tabId, "Hake")).toEqual(hakes);
  expect(await total(tabId)).toBe(2000);
  expect(await recorded(tabId)).toEqual([{ before: 1600, after: 0, reduction: 1600 }]);

  await send(bill, ["Hake"]);
  expect((await shape(tabId)).filter(({ what }) => what === "Soup")).toEqual([
    { what: "Soup", price: 0, list: null, in: 0 },
    { what: "Soup", price: 0, list: null, in: 1 },
  ]);
  expect((await shape(tabId)).filter(({ what }) => what === "Hake")).toEqual([
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Hake", price: 0, list: 1600, in: null },
    { what: "Hake", price: 0, list: null, in: 1 },
  ]);
  expect(await total(tabId)).toBe(2800);
});

it("takes out only the Hake of a row of two that a one-cent discount reaches", async () => {
  const { tabId } = await billOf(["Soup", "Soup", "Hake", "Hake"]);
  const hakes = await idsOf(tabId, "Hake");

  await adjust(tabId, hakes[0]!, off("0.01"), { lineIds: hakes });

  expect((await shape(tabId)).filter(({ what }) => what === "Hake")).toEqual([
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Hake", price: 1599, list: 1600, in: null },
  ]);
  expect(await total(tabId)).toBe(1400 + 600 + 1599);
  expect(await recorded(tabId)).toEqual([{ before: 3200, after: 3199, reduction: 1 }]);
});

it.each(["first", "second"] as const)(
  "takes nothing off a row of two Hakes whose %s is in a comped Daily",
  async (which) => {
    const { tabId } = await billOf(["Soup", "Soup", "Hake", "Hake"]);
    const hakes = await linesOf(tabId, "Hake");
    const comped = hakes[which === "first" ? 0 : 1]!.setMenuLineId!;
    expect(hakes[0]!.setMenuLineId).not.toBe(hakes[1]!.setMenuLineId);
    await adjust(tabId, comped, FREE);
    expect(await total(tabId)).toBe(1400);

    const lineIds = hakes.map(({ id }) => id);
    await expectNoReduction(tabId, lineIds[0]!, percent(1000), { lineIds });
  },
);

it("reads none of a row a la carte when one of its dishes is held, though all have one price", async () => {
  const { tabId } = await billOf(["Soup", "Soup", "Hake", "Hake"]);
  const hakes = await linesOf(tabId, "Hake");
  await adjust(tabId, hakes[1]!.setMenuLineId!, FREE);
  const lineIds = hakes.map(({ id }) => id);
  const released = await inTx(venue, async (tx) => {
    await tx
      .update(workingOrderLines)
      .set({ unitPriceGross: 1600, lineTotal: 1600 })
      .where(inArray(workingOrderLines.id, lineIds));
    const ask = { orderId: tabId, lineId: lineIds[0]!, action: "comp" as const };
    const rowsNow = await readRows(tx, tabId);
    return {
      alone: (await atReleasedPrices(tx, ask, rowsNow)).released,
      asRow: (await atReleasedPrices(tx, { ...ask, lineIds }, rowsNow)).released,
    };
  });
  expect(released).toEqual({ alone: new Set([lineIds[0]]), asRow: new Set() });
});

it("takes nothing off a row of two Hakes when one's set menu holds a cancel that kept its charge", async () => {
  const { tabId } = await billOf(["Soup", "Soup", "Hake", "Hake"], "fire");
  const hakes = await linesOf(tabId, "Hake");
  const soup = (await linesOf(tabId, "Soup")).find(
    ({ setMenuLineId }) => setMenuLineId === hakes[1]!.setMenuLineId,
  )!;
  await cancelSpecLineKeepingCharge(spec, tabId, soup.id);

  const lineIds = hakes.map(({ id }) => id);
  await expectNoReduction(tabId, lineIds[0]!, percent(1000), { lineIds });
});

it("takes nothing off a row of two Hakes whose a la carte prices differ", async () => {
  const bill = await billOf(["Soup", "Soup", "Hake"]);
  const hakeOffer = and(
    eq(menuItems.menuId, venue.tables.menuId),
    eq(menuItems.productId, spec.productIds.Hake),
  );
  const [was] = await venue.db
    .select({ grossPrice: menuItems.grossPrice })
    .from(menuItems)
    .where(hakeOffer);
  const republishAt = (grossPrice: number | null) =>
    inTx(venue, async (tx) => {
      await tx.update(menuItems).set({ grossPrice }).where(hakeOffer);
      await publishWorkingMenu(tx, venue.tables.menuId);
    });
  await republishAt(1800);
  try {
    await send(bill, ["Hake"]);
  } finally {
    await republishAt(was!.grossPrice);
  }
  const hakes = await linesOf(bill.tabId, "Hake");
  expect(
    hakes.map(({ aLaCarteUnitPrice, unitPriceGross, setMenuRole }) => ({
      aLaCarteUnitPrice,
      unitPriceGross,
      setMenuRole,
    })),
  ).toEqual([
    { aLaCarteUnitPrice: 1600, unitPriceGross: 0, setMenuRole: "dish" },
    { aLaCarteUnitPrice: 1800, unitPriceGross: 0, setMenuRole: "dish" },
  ]);

  const lineIds = hakes.map(({ id }) => id);
  await expectNoReduction(bill.tabId, lineIds[0]!, percent(1000), { lineIds });
});

it("measures a set-menu dish against its reason's limit at its a la carte price", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  const [hake] = await idsOf(tabId, "Hake");
  const limited = { maxAmount: "10.00", operatorId: WAITER };
  expect((await preview(tabId, hake!, FREE, limited)).needsApproval).toEqual({
    by: "limit",
    permission: "adjustment.approve",
    limit: { kind: "reason", amount: "10.00", percentBp: null },
  });
  await expect(adjust(tabId, hake!, FREE, limited)).rejects.toMatchObject({
    code: "adjustment.approval_required",
    params: { approval: "limit" },
  });
  expect(await total(tabId)).toBe(1400);
  expect(
    (await preview(tabId, hake!, FREE, { ...limited, maxAmount: "16.00" })).needsApproval,
  ).toBeNull();

  const [admin] = await venue.db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.email, "owner@example.test"));
  await adjust(tabId, hake!, FREE, { ...limited, approver: approverPin(admin!.id, "1234") });
  expect(await total(tabId)).toBe(600);
});

it("refuses a comp that takes the bill below what it has received", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  await cashContribution(venue, tabId, "10.00");
  const [hake] = await idsOf(tabId, "Hake");
  const before = await rows(tabId);

  await expect(adjust(tabId, hake!, FREE)).rejects.toMatchObject({
    code: "bill.received_exceeds_total",
    params: { workingOrderId: tabId, excess: "4.00" },
  });
  expect(await rows(tabId)).toEqual(before);
  expect(await recorded(tabId)).toEqual([]);
});

it("refuses a discount that raises the bill over the simplified-invoice limit", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  const [hake] = await idsOf(tabId, "Hake");
  const before = await rows(tabId);
  const limitedTo = (limit: string): How => ({
    cfg: { ...venue.cfg, simplifiedInvoiceLimit: decimal(limit) },
  });

  await expect(adjust(tabId, hake!, percent(1000), limitedTo("20.00"))).rejects.toMatchObject({
    code: "sale.total_exceeds_simplified_limit",
  });
  expect(await rows(tabId)).toEqual(before);
  expect(await recorded(tabId)).toEqual([]);

  await adjust(tabId, hake!, percent(1000), limitedTo("20.40"));
  expect(await total(tabId)).toBe(2040);
});

it("discounts a bill already over the simplified-invoice limit when it does not rise", async () => {
  const { tabId } = await billOf(["Soup", "Soup", "Hake"]);
  const loose = (await linesOf(tabId, "Soup")).find(({ setMenuRole }) => setMenuRole === null)!;

  await adjust(tabId, loose.id, percent(5000), {
    cfg: { ...venue.cfg, simplifiedInvoiceLimit: decimal("10.00") },
  });

  expect(await total(tabId)).toBe(1700);
});

it("takes a dish out of its Daily at its a la carte price though it carries an old list price", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  const [hake] = await idsOf(tabId, "Hake");
  await inTx(venue, (tx) =>
    tx
      .update(workingOrderLines)
      .set({ listUnitPriceGross: 0 })
      .where(eq(workingOrderLines.id, hake!)),
  );

  await adjust(tabId, hake!, FREE);

  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 600, list: null, in: null },
    { what: "Hake", price: 0, list: 1600, in: null },
  ]);
  expect(await recorded(tabId)).toEqual([{ before: 1600, after: 0, reduction: 1600 }]);
});

it("still takes nothing off a dish of a comped Daily", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  const [daily] = await menuIds(tabId);
  await adjust(tabId, daily!, FREE);
  const [hake] = await idsOf(tabId, "Hake");
  await expectNoReduction(tabId, hake!);
});

it("still takes nothing off a dish of a Daily on a bill discounted as a whole", async () => {
  const { tabId } = await billOf(["Soup", "Hake"]);
  await adjust(tabId, null, percent(1000));
  expect(await total(tabId)).toBe(1260);
  const [hake] = await idsOf(tabId, "Hake");
  await expectNoReduction(tabId, hake!);
});

it("still takes nothing off a dish whose set menu holds a cancel that kept its charge", async () => {
  const { tabId } = await billOf(["Soup", "Hake"], "fire");
  const [soup] = await idsOf(tabId, "Soup");
  await cancelSpecLineKeepingCharge(spec, tabId, soup!);
  const [hake] = await idsOf(tabId, "Hake");
  await expectNoReduction(tabId, hake!);
});

it("still records a cancelled set-menu dish as the bill's whole drop (D24)", async () => {
  const { tabId } = await billOf(["Soup", "Soup", "Hake", "Hake"]);
  const [second] = (await linesOf(tabId, "Hake")).slice(-1);
  await inTx(venue, (tx) => cancelLine(tx, venue.cfg, tabId, second!.lineNo));

  expect(await shape(tabId)).toEqual([
    { what: "Soup", price: 0, list: null, in: 0 },
    { what: "Soup", price: 600, list: null, in: null },
    { what: "Hake", price: 0, list: null, in: 0 },
    { what: "Daily menu", price: 1400, list: null, in: null },
  ]);
  expect(await recorded(tabId)).toEqual([{ before: 800, after: 0, reduction: 800 }]);
});
