import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { adjustments, persons, sales, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { menuItems } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import { readRows } from "./adjustment-rows.js";
import { applyAdjustment, previewAdjustment, type CheckedApprover } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { insertPartyBill } from "./parties.js";
import { payForItems, priceItemPicks } from "./pay-for-items.js";
import { buildReceiptDocument } from "./receipt-document.js";
import { splitAfterPrint } from "./split-after-print.js";
import { readSettledTicket } from "./till-sale.js";
import { readOrderRevision } from "./working-order-context.js";
import { atReleasedPrices } from "./set-menu-dish-release.js";
import type { TradingContext } from "./trading-context.js";
import { approverPin, REASONS } from "./testing/adjustment-venue.js";
import { mergeBills, moveDishes } from "./testing/bill-action-fixture.js";
import { cancelLine, cancelReasonId, ensureOperator } from "./testing/cancel-line.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "./testing/full-invoice-fixture.js";
import {
  cashContribution,
  commandFor,
  inTx,
  join,
  seatWithNoAllergies,
  type PartyVenue,
} from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { saveSetMenuDraft } from "./testing/set-menu-bill-fixture.js";
import {
  addSpecDishesToFullMenu,
  addSpecLunch,
  cancelSpecLineKeepingCharge,
  lunchBill,
  printSpecBill,
  sendSpecDraft,
  serveSpecBill,
  setupSetMenuSpecVenue,
  specDeps,
  specDishOf,
  specPayRequest,
  specRows,
  specSaleLines,
  type SpecDish,
  type SpecExtra,
  type SpecLunch,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import { splitTable } from "./testing/table-action-fixture.js";

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
type Ordered = SpecDish | { dish: SpecDish; extras?: SpecExtra[]; quantity?: string };

async function send(bill: Bill, dishes: readonly Ordered[], release: "hold" | "fire" = "hold") {
  const draft = await saveSetMenuDraft(
    venue,
    bill,
    ...dishes.map((ordered) => {
      const {
        dish,
        extras,
        quantity = "1",
      } = typeof ordered === "string" ? { dish: ordered } : ordered;
      return {
        menuItemId: ordinary[dish],
        quantity,
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

async function preview(billId: string, lineId: string | null, action: Action, how: How = {}) {
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

const money = (cents: number) => (cents / 100).toFixed(2);

/** The preview answers the bill's total now and as applying the action leaves it, writing nothing. */
async function expectPreviewAsApplied(
  billId: string,
  lineId: string | null,
  action: Action | { action: "cancel" },
  how: How = {},
) {
  const before = await total(billId);
  const rowsBefore = await rows(billId);
  const ask = await askFor(billId, lineId, action as Action, how);
  if (action.action === "cancel") ask.reasonId = await inTx(venue, cancelReasonId);
  const { billTotal } = await inTx(venue, (tx) =>
    previewAdjustment(
      tx,
      action.action === "cancel" ? { ...ask, action: "cancel" } : ask,
      venue.cfg.locale,
    ),
  );
  expect(await rows(billId)).toEqual(rowsBefore);
  if (action.action === "cancel") {
    await inTx(venue, async (tx) =>
      cancelLine(tx, venue.cfg, billId, rowsBefore.find(({ id }) => id === lineId)!.lineNo),
    );
  } else {
    await adjust(billId, lineId, action, how);
  }
  expect(billTotal).toEqual({ before: money(before), after: money(await total(billId)) });
  return { before, after: await total(billId) };
}

const theLast = (dish: SpecDish) => async (billId: string) => (await idsOf(billId, dish)).at(-1)!;
const theLoose = (dish: SpecDish) => async (billId: string) =>
  (await linesOf(billId, dish)).find(({ setMenuRole }) => setMenuRole === null)!.id;
const thePlaced = (dish: SpecDish) => async (billId: string) =>
  (await linesOf(billId, dish)).find(({ setMenuRole }) => setMenuRole === "dish")!.id;

it.each<
  [string, Ordered[], (billId: string) => Promise<string | null>, Action, How, number, number]
>([
  [
    "a comped Hake of two Dailies",
    ["Soup", "Soup", "Hake", "Hake"],
    theLast("Hake"),
    FREE,
    {},
    2800,
    2000,
  ],
  ["10% off a Daily's Hake", ["Soup", "Hake"], theLast("Hake"), percent(1000), {}, 1400, 2040],
  [
    "4.00 off a Daily's Sirloin",
    ["Soup", "Sirloin"],
    theLast("Sirloin"),
    off("4.00"),
    {},
    1900,
    2600,
  ],
  [
    "half off the a la carte Soup",
    ["Soup", "Soup", "Hake"],
    theLoose("Soup"),
    percent(5000),
    {},
    2000,
    1700,
  ],
  [
    "half off the Daily's Soup",
    ["Soup", "Soup", "Hake"],
    thePlaced("Soup"),
    percent(5000),
    {},
    2000,
    1700,
  ],
  ["a comped Soup of a Daily", ["Soup", "Hake"], theLast("Soup"), FREE, {}, 1400, 1400],
  [
    "10% off one of two Hakes sent as one line beside a Soup",
    ["Soup", { dish: "Hake", quantity: "2" }],
    theLast("Hake"),
    percent(1000),
    { quantity: "1" },
    2800,
    2840,
  ],
  ["half off a lone Soup", ["Soup"], theLast("Soup"), percent(5000), {}, 600, 300],
  ["10% off the whole bill", ["Soup", "Hake"], async () => null, percent(1000), {}, 1400, 1260],
])(
  "previews the bill's total as applying it leaves it, writing nothing: %s",
  async (_, dishes, target, action, how, before, after) => {
    const { tabId } = await billOf(dishes);
    expect(await expectPreviewAsApplied(tabId, await target(tabId), action, how)).toEqual({
      before,
      after,
    });
  },
);

it("previews the bill's total for a comped Soup with Bread, a row of two Hakes and a cancel", async () => {
  const withBread = await billOf([{ dish: "Soup", extras: [spec.bread] }, "Hake"]);
  expect(
    await expectPreviewAsApplied(withBread.tabId, (await idsOf(withBread.tabId, "Soup"))[0]!, FREE),
  ).toEqual({ before: 1550, after: 1400 });

  const row = await billOf(["Soup", "Soup", "Hake", "Hake"]);
  const hakes = await idsOf(row.tabId, "Hake");
  expect(
    await expectPreviewAsApplied(row.tabId, hakes[0]!, FREE, { lineIds: hakes, quantity: "1" }),
  ).toEqual({ before: 2800, after: 2000 });

  const cancelled = await billOf(["Soup", "Soup", "Hake", "Hake"]);
  expect(
    await expectPreviewAsApplied(cancelled.tabId, (await idsOf(cancelled.tabId, "Hake")).at(-1)!, {
      action: "cancel",
    }),
  ).toEqual({ before: 2800, after: 2000 });
});

/** Soup and Hake with 10% off the Hake: Soup 6.00 and Hake 14.40 a la carte. */
async function discountedHakeBill(release: "hold" | "fire" = "hold") {
  const bill = await billOf(["Soup", "Hake"], release);
  const [hake] = await idsOf(bill.tabId, "Hake");
  await adjust(bill.tabId, hake!, percent(1000));
  return { ...bill, hake: hake! };
}

/** A second, empty bill of the bill's party, holding `dishes` once they are sent. */
async function partyBill(bill: Bill, dishes: readonly Ordered[] = []): Promise<Bill> {
  const other = {
    partyId: bill.partyId,
    tabId: await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, bill.partyId)),
  };
  if (dishes.length > 0) await send(other, dishes);
  return other;
}

const DISCOUNTED_HAKE = { what: "Hake", price: 1440, list: 1600, in: null };
const LOOSE_SOUP = { what: "Soup", price: 600, list: null, in: null };

it("moves a discounted Hake to a bill holding a Soup, where it joins no set menu", async () => {
  const source = await discountedHakeBill();
  const target = await partyBill(source, ["Soup"]);
  const command = await commandFor(venue, source.partyId);

  await inTx(venue, (tx) =>
    moveDishes(tx, venue.cfg, source.tabId, target.tabId, [source.hake], command),
  );

  expect(await shape(source.tabId)).toEqual([LOOSE_SOUP]);
  expect(await shape(target.tabId)).toEqual([LOOSE_SOUP, DISCOUNTED_HAKE]);
  expect(await total(target.tabId)).toBe(2040);
});

it("merges a bill holding a discounted Hake into one holding a Soup, and the Hake joins no set menu", async () => {
  const from = await discountedHakeBill();
  const into = await partyBill(from, ["Soup"]);
  const command = await commandFor(venue, from.partyId);

  await inTx(venue, (tx) => mergeBills(tx, venue.cfg, into.tabId, from.tabId, command));

  expect(await shape(from.tabId)).toEqual([]);
  expect(await shape(into.tabId)).toEqual([LOOSE_SOUP, LOOSE_SOUP, DISCOUNTED_HAKE]);
  expect(await total(into.tabId)).toBe(2640);
});

it("splits a table taking a discounted Hake and another bill's Soup: the new bill makes no Daily", async () => {
  const first = await discountedHakeBill();
  const second = await partyBill(first, ["Soup"]);
  const leaving = await venue.table(randomUUID());
  await join(venue, first.partyId, leaving);
  const command = await commandFor(venue, first.partyId);
  const [soup] = await idsOf(second.tabId, "Soup");

  const moved = await inTx(venue, (tx) =>
    splitTable(
      tx,
      venue.cfg,
      first.partyId,
      leaving,
      {
        wholeBillIds: [],
        loose: [
          { billId: first.tabId, lineIds: [first.hake] },
          { billId: second.tabId, lineIds: [soup!] },
        ],
      },
      command,
    ),
  );

  expect(await shape(first.tabId)).toEqual([LOOSE_SOUP]);
  expect(await shape(second.tabId)).toEqual([]);
  expect(await shape(moved.billId)).toEqual([DISCOUNTED_HAKE, LOOSE_SOUP]);
  expect(await total(moved.billId)).toBe(2040);
});

it("pays for a discounted Hake on its own at 14.40, in the preview as in the payment", async () => {
  const source = await discountedHakeBill();
  const picks = [{ lineId: source.hake }];
  expect(await inTx(venue, (tx) => priceItemPicks(tx, source.tabId, picks))).toBe("14.40");

  const paid = await payForItems(
    {
      admission: specDeps(spec).admission,
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      provider: new SimulatorPaymentProvider(venue.db),
    },
    venue.cfg,
    source.tabId,
    await specPayRequest(spec, source, picks, {
      method: "cash",
      applied: "14.40",
      tendered: "14.40",
    }),
    venue.operator,
    null,
  );

  expect(paid.payment.outcome).toBe("received");
  expect(await shape(paid.billId)).toEqual([DISCOUNTED_HAKE]);
  expect(await shape(source.tabId)).toEqual([LOOSE_SOUP]);
});

it("keeps a discounted Hake out of a Daily on the copy Reopen bill makes, after a Soup is sent there", async () => {
  const bill = await discountedHakeBill("fire");
  await serveSpecBill(spec, bill.partyId, bill.tabId);
  await printSpecBill(spec, bill.partyId, bill.tabId);
  const { billId } = await splitAfterPrint(specDeps(spec), venue.cfg, bill.tabId, venue.operator);
  expect(await shape(billId)).toEqual([LOOSE_SOUP, DISCOUNTED_HAKE]);

  const [copy] = await venue.db
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  await send({ partyId: copy!.partyId!, tabId: billId }, ["Soup"]);

  expect(await shape(billId)).toEqual([LOOSE_SOUP, DISCOUNTED_HAKE, LOOSE_SOUP]);
  expect(await total(billId)).toBe(2640);
});

it("prints a comped Daily's Hake at its a la carte price with its comp, and nothing else discounted", async () => {
  const bill = await billOf(["Soup", "Soup", "Hake", "Hake"], "fire");
  const [, second] = await idsOf(bill.tabId, "Hake");
  await adjust(bill.tabId, second!, FREE);
  await printSpecBill(spec, bill.partyId, bill.tabId);

  const ticket = await inTx(venue, (tx) =>
    readSettledTicket(venue.backend, tx, venue.cfg, bill.tabId),
  );
  const { elements } = buildReceiptDocument({
    ...FULL_INVOICE_DOCUMENT_FIXTURE,
    invoiceLocale: "en-GB",
    namesLocale: "en-GB",
    result: ticket,
  });
  const rules = elements.flatMap((element, at) => (element.kind === "rule" ? [at] : []));
  const printed = elements
    .slice(rules[2]! + 1, rules[3])
    .flatMap((element) => (element.kind === "amount" ? [[element.caption, element.amount]] : []));
  // A comp prints as a 100% discount, as on any dish (owner, 2026-10-28).
  expect(printed).toEqual([
    ["1  Soup", "6.00"],
    ["1  Hake", "16.00"],
    ["  Discount 100%", "-16.00"],
    ["1  Daily menu", "14.00"],
  ]);
  expect(ticket.lines.flatMap(({ adjustments }) => adjustments ?? [])).toEqual([
    { kind: "comp", amount: "16.00" },
  ]);
  expect(ticket.total).toBe("20.00");
});

describe("a takeaway Lunch whose Lemonade is given something off", () => {
  let lunch: SpecLunch;
  beforeAll(async () => {
    lunch = await addSpecLunch(spec);
  });

  /** The bill's stored rows and, once printed, its filed lines and the VAT it filed. */
  async function storedAndFiled(billId: string, partyId: string) {
    const stored = await shape(billId);
    await printSpecBill(spec, partyId, billId);
    const lines = await specSaleLines(spec, billId);
    const [sale] = await venue.db
      .select({ total: sales.total, vat: sales.vatBreakdown })
      .from(sales)
      .where(eq(sales.id, lines[0]!.saleId));
    return {
      stored,
      filed: lines.map(({ name, lineGross, vatRate, setMenuPart }) => [
        name,
        lineGross,
        vatRate,
        setMenuPart,
      ]),
      total: sale!.total,
      vat: sale!.vat,
    };
  }

  async function lemonadeOf(billId: string) {
    return (await rows(billId)).find(({ productId }) => productId === lunch.lemonadeId)!.id;
  }

  it("files half off the Lemonade at 21% and the Lunch of Soup and Hake at 10%", async () => {
    const bill = await lunchBill(spec, lunch);
    expect(await total(bill.tabId)).toBe(1400);
    await adjust(bill.tabId, await lemonadeOf(bill.tabId), percent(5000));

    expect(await storedAndFiled(bill.tabId, bill.partyId)).toEqual({
      stored: [
        { what: "Soup", price: 0, list: null, in: 0 },
        { what: "Hake", price: 0, list: null, in: 0 },
        { what: "Lemonade", price: 175, list: 350, in: null },
        { what: "Lunch menu", price: 1400, list: null, in: null },
      ],
      filed: [
        ["Soup", 0, 1000, null],
        ["Hake", 0, 1000, null],
        ["Lemonade", 175, 2100, null],
        ["Lunch menu", 1400, 1000, null],
      ],
      total: 1575,
      vat: [
        { rate: "10.00", base: "12.73", tax: "1.27" },
        { rate: "21.00", base: "1.45", tax: "0.30" },
      ],
    });
  });

  it("files a comped Lemonade's share of the Lunch at 21% and the rest at 10%", async () => {
    const bill = await lunchBill(spec, lunch);
    await adjust(bill.tabId, await lemonadeOf(bill.tabId), FREE);

    // The free Lemonade takes its share of the 14.00 paid, by its 3.50 against the Lunch's 14.00.
    expect(await storedAndFiled(bill.tabId, bill.partyId)).toEqual({
      stored: [
        { what: "Soup", price: 0, list: null, in: 0 },
        { what: "Hake", price: 0, list: null, in: 0 },
        { what: "Lemonade", price: 0, list: 350, in: null },
        { what: "Lunch menu", price: 1400, list: null, in: null },
      ],
      filed: [
        ["Soup", 0, 1000, null],
        ["Hake", 0, 1000, null],
        ["Lemonade", 280, 2100, null],
        ["Lunch menu", 1120, 1000, null],
      ],
      total: 1400,
      vat: [
        { rate: "10.00", base: "10.18", tax: "1.02" },
        { rate: "21.00", base: "2.31", tax: "0.49" },
      ],
    });
  });
});
