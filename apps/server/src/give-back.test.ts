import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { adjustments, createAdjustmentReason, listAdjustmentReasons } from "@waitron/adjustments";
import {
  deviceProfiles,
  devices,
  invoiceCorrections,
  parties,
  refunds,
  readLiveSeriesIdTx,
  saleLines,
  sales,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import {
  createCategory,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { authorityForRoles, loginWithPin, type PersonAuthority } from "@waitron/identity";
import { recordReplacement } from "@waitron/core";
import {
  AppError,
  centsToDecimal,
  decimal,
  decimalToCents,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  type SaleId,
} from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { refundProvidersOf, type RefundProviderFor } from "./bill-refunds.js";
import { readBillEditState } from "./bill-editing.js";
import {
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
  type DeviceBinding,
} from "./device-session.js";
import {
  planGiveBack,
  readGiveBack,
  type GiveBackPlan,
  type GiveBackRequest,
  type GiveBackView,
} from "./give-back.js";
import { cancelItem, type CancelItemCommand } from "./line-cancel.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { gateSeatOnStartClock } from "./start-clock-gate.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import { openPartyTab } from "./testing/serve-line.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { TradingAdmission } from "./trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";

// Each product's staff, customer-facing and kitchen names differ (docs/developers/products.md).
const DISHES = [
  { name: "Paella", customer: "Seafood paella", kitchen: "PAELLA", price: "18.50" },
  { name: "Croquetas", customer: "Ham croquetas", kitchen: "CROQ", price: "4.00" },
  { name: "Cheesecake", customer: "Baked cheesecake", kitchen: "CAKE", price: "6.50" },
  { name: "Bread", customer: "Country bread", kitchen: "LOAF", price: "2.00" },
  { name: "Water", customer: "Still water", kitchen: "WATER", price: "3.00" },
] as const;
type Dish = (typeof DISHES)[number]["name"];
const customerOf = (name: Dish) => DISHES.find((dish) => dish.name === name)!.customer;

let venue: BillVenue;
let offers: ZoneOffers;
let productIds: Map<string, string>;
let voidReasonId: string;
let compReasonId: string;
/** The reason a correction is opened with, as `invoice-correction-api.test.ts` opens one. */
let correctionReasonId: string;
/** The first till's device, whose profile takes cash, hand-keyed and reader cards. */
let till: DeviceBinding;
/** The extras list offered with the Paella, holding the Aioli at €3.00. */
let sauces: string;
let aioliId: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      correctionReasonId = (await listAdjustmentReasons(tx))[0]!.id;
      const category = await createCategory(tx, { name: "Give back dishes" });
      productIds = new Map();
      for (const dish of DISHES) {
        const product = await createProduct(tx, {
          categoryId: category.id,
          name: dish.name,
          customerName: { es: dish.customer },
          kitchenName: dish.kitchen,
          pricingUnit: "each",
          unitPrice: dish.price,
          vatClass: "general",
        });
        productIds.set(dish.name, product.id);
      }
      aioliId = (
        await createProduct(tx, {
          categoryId: category.id,
          name: "Aioli",
          customerName: { es: "Garlic mayonnaise" },
          kitchenName: "AIOLI",
          pricingUnit: "each",
          unitPrice: "3.00",
          vatClass: "general",
        })
      ).id;
      sauces = (
        await createExtraList(
          tx,
          {
            name: "Sauces",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: 1,
            active: true,
            items: [{ productId: aioliId, maxQuantity: 1, preselected: false, price: "3.00" }],
          },
          "es-ES",
        )
      ).id;
      await writeProductModifiers(tx, productIds.get("Paella")!, [{ kind: "extras", id: sauces }]);
      offers = await offerProducts(tx, { zone: "tables" });
      voidReasonId = (await createAdjustmentReason(tx, REASONS.houseVoid)).id;
      compReasonId = (await createAdjustmentReason(tx, REASONS.house)).id;
      const [row] = await tx
        .select(deviceBindingColumns)
        .from(devices)
        .innerJoin(deviceProfiles, deviceProfileJoin)
        .where(eq(devices.id, venue.deviceId));
      till = toDeviceBinding(venue.deviceId, row!);
    });
  },
});

interface Tab {
  partyId: string;
  billId: string;
  /** Each top-level line's id, by its dish. */
  line: (name: Dish) => string;
}

async function tab(
  lines: readonly (Dish | [Dish, string])[],
  { withAioli = false }: { withAioli?: boolean } = {},
): Promise<Tab> {
  const { partyId, tabId } = await inTx(venue, async (tx) => {
    const table = await createTable(tx, {
      label: `G-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const orderLines = lines.map((line) => {
      const [name, quantity] = typeof line === "string" ? [line, "1"] : line;
      return { menuItemId: offers.offerFor(productIds.get(name)!), quantity };
    });
    if (!withAioli) return openPartyTab(tx, venue.cfg, { tableId: table.id, lines: orderLines });
    const opened = await openPartyTab(tx, venue.cfg, { tableId: table.id });
    await placeGroups(tx, venue.cfg, opened.partyId, {
      groups: [
        {
          lines: orderLines.map((line) => ({
            ...line,
            ...(line.menuItemId === offers.offerFor(productIds.get("Paella")!)
              ? { extras: [{ listId: sauces, picks: [{ productId: aioliId, quantity: 1 }] }] }
              : {}),
          })),
          release: "hold",
        },
      ],
      operatorId: venue.operatorId,
      billId: opened.tabId,
    });
    return opened;
  });
  const rows = await venue.db
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      parent: workingOrderLines.parentLineId,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(asc(workingOrderLines.lineNo));
  return {
    partyId,
    billId: tabId,
    line: (name) =>
      rows.find((row) => row.parent === null && row.productId === productIds.get(name))!.id,
  };
}

type Part = { cash: string } | { card: string } | { reader: string };

/** Pays the bill in `parts`, the first carrying `tip`; answers the sale. */
async function pay(b: Tab, parts: readonly Part[], tip = "0.00") {
  for (const [index, part] of parts.entries()) {
    const partTip = index === 0 ? tip : "0.00";
    const amount = "cash" in part ? part.cash : "card" in part ? part.card : part.reader;
    const withTip = centsToDecimal(
      decimalToCents(decimal(amount)) + decimalToCents(decimal(partTip)),
    );
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${b.billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount,
        ...("cash" in part
          ? { method: "cash", tendered: withTip }
          : { method: "card", entry: "card" in part ? "manual" : "reader" }),
        applied: amount,
        tip: partTip,
        ...(partTip === "0.00" ? {} : { addedTip: partTip }),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, b.billId)),
      },
    );
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  }
  const [sale] = await venue.db.select().from(sales).where(eq(sales.workingOrderId, b.billId));
  return brandSaleId(sale!.id);
}

/** A still-charge cancel of `quantity` of the dish; `refundHandoff` is the Refund tick. */
async function cancel(b: Tab, name: Dish, quantity: string, refundHandoff: boolean) {
  const lineId = b.line(name);
  const answer = await inTx(venue, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, b.partyId));
    const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, b.billId));
    const ask: Omit<CancelItemCommand, "admission"> = {
      quantity,
      expectedEdit: await readBillEditState(tx, b.billId),
      outcome: "keep_charge",
      reasonId: voidReasonId,
      expectedPartyRevision: party!.revision,
      expectedBillRevision: order!.revision,
      expectedContext: await readCancellationContext(tx, b.partyId, lineId),
      submissionId: randomUUID(),
      ...(refundHandoff ? { refundHandoff: true } : {}),
    };
    return cancelItem(
      tx,
      venue.cfg,
      b.partyId,
      lineId,
      { ...ask, admission: testTradingAdmission() },
      venue.adminId,
    );
  });
  const linked = answer.refundLinks?.[0]?.adjustmentId;
  if (linked !== undefined) return linked;
  const rows = await venue.db.select().from(adjustments).where(eq(adjustments.lineId, lineId));
  return rows.filter((row) => row.action === "cancel").at(-1)!.id;
}

/** Gives the dish free before the bill is paid. */
async function comp(b: Tab, name: Dish) {
  await inTx(venue, async (tx) => {
    const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, b.billId));
    await applyAdjustment(
      tx,
      venue.cfg,
      {
        admission: testTradingAdmission(),
        orderId: b.billId,
        expectedEdit: await readBillEditState(tx, b.billId),
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId: b.line(name),
        action: "comp",
        reasonId: compReasonId,
        note: null,
        operatorId: venue.operatorId,
      },
      "es-ES",
    );
  });
}

const supervisor = () => ({ personId: venue.adminId, pin: "1234" });

async function tenderOf(saleId: string, method: "cash" | "card", index = 0) {
  return (await inTx(venue, (tx) => readRefundableTenders(tx, saleId))).filter(
    (row) => row.method === method,
  )[index]!.tenderId;
}

/** Refund a payment through today's route, naming `cancellationIds` when given. */
async function plainRefund(
  saleId: string,
  tenderId: string,
  amounts: { applied?: string; tip?: string },
  cancellationIds?: string[],
) {
  return send(venue.app, venue.cookie, "POST", `/api/transactions/${saleId}/refunds`, {
    submissionId: randomUUID(),
    tenderId,
    appliedAmount: amounts.applied ?? "0.00",
    tipAmount: amounts.tip ?? "0.00",
    reason: "Dish never served",
    override: supervisor(),
    ...(cancellationIds === undefined ? {} : { cancellationIds }),
  });
}

interface ReadOptions {
  device?: DeviceBinding | null;
  backend?: BillVenue["backend"];
  admission?: TradingAdmission;
  refundProviderFor?: RefundProviderFor;
}

const depsOf = (options: ReadOptions) => ({
  backend: options.backend ?? venue.backend,
  admission: options.admission ?? testTradingAdmission(),
  refundProviderFor:
    "refundProviderFor" in options
      ? options.refundProviderFor
      : refundProvidersOf({ pool: venue.pool }),
});

function read(saleId: string, options: ReadOptions = {}): Promise<GiveBackView> {
  return inTx(venue, (tx) =>
    readGiveBack(
      tx,
      depsOf(options),
      venue.cfg,
      venue.clock.now(),
      brandSaleId(saleId),
      options.device === undefined ? till : options.device,
    ),
  );
}

/** Every right, as the administrator holds them. */
const everyRight = () =>
  authorityForRoles(venue.adminId, [{ id: "admin", builtInKey: "admin", permissions: [] }]);
const holding = (...permissions: string[]) =>
  authorityForRoles(venue.operatorId, [{ id: "custom", builtInKey: null, permissions }]);

/** Rows a give-back could write: refunds, corrections and sales. */
async function rowCount(): Promise<number> {
  return inTx(venue, async (tx) => {
    const refundRows = await tx.select({ id: refunds.id }).from(refunds);
    const correctionRows = await tx.select({ id: invoiceCorrections.id }).from(invoiceCorrections);
    const saleRows = await tx.select({ id: sales.id }).from(sales);
    return refundRows.length + correctionRows.length + saleRows.length;
  });
}

type Previewed =
  | { plan: GiveBackPlan; written: number }
  | { refusal: { code: string; params: unknown }; written: number };

/** `planGiveBack`'s answer or refusal for `request`, and how many rows it wrote. */
async function preview(
  saleId: string,
  request: GiveBackRequest,
  options: ReadOptions & { authority?: PersonAuthority } = {},
): Promise<Previewed> {
  const before = await rowCount();
  const answer = await inTx(venue, (tx) =>
    planGiveBack(
      tx,
      depsOf(options),
      venue.cfg,
      venue.clock.now(),
      brandSaleId(saleId),
      {
        device: options.device === undefined ? till : options.device,
        authority: options.authority ?? everyRight(),
      },
      request,
    ),
  ).then(
    (plan) => ({ plan }),
    (error: unknown) => {
      if (!(error instanceof AppError)) throw error;
      return { refusal: { code: error.code, params: { ...error.params } } };
    },
  );
  return { ...answer, written: (await rowCount()) - before };
}

const planned = (
  parts: GiveBackPlan["parts"],
  more: Partial<Omit<GiveBackPlan, "parts">> = {},
) => ({
  plan: { parts, leftUnderWay: "0.00", needs: [], manual: false, ...more },
  written: 0,
});
const refused = (code: string, params: unknown) => ({ refusal: { code, params }, written: 0 });
const invalidField = (field: string) => refused("management.request_invalid", { field });

const lineOf = (view: GiveBackView, name: Dish) =>
  view.lines.find((line) => Object.values(line.descriptions).includes(customerOf(name)))!;

/** Answers every admission check as `reason` for the rest of the test. */
function admittingNot(reason: string) {
  const spy = vi
    .spyOn(venue.backend, "correctionAdmissionFor")
    .mockResolvedValue({ eligible: false, reason } as never);
  onTestFinished(() => spy.mockRestore());
}

const FIVE: Dish[] = ["Paella", "Croquetas", "Cheesecake", "Bread", "Water"];

describe("readGiveBack: the lines", () => {
  it("shows the paella cancelled with Refund ticked as owing its money, the other dishes with no cancel", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    await cancel(b, "Paella", "1", true);
    const view = await read(saleId);
    expect(lineOf(view, "Paella")).toMatchObject({
      quantity: "1.000",
      gross: "18.50",
      left: "18.50",
      cancelled: { quantity: "1.000", owed: "18.50", back: "0.00" },
      givenFree: false,
    });
    for (const name of FIVE.slice(1)) expect(lineOf(view, name).cancelled).toBeNull();
    expect(view.lines).toHaveLength(5);
  });

  it("takes what went back for the cancel off its owed money and off the line's left (C1)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const cancelId = await cancel(b, "Paella", "1", true);
    const cash = await tenderOf(saleId, "cash");
    expect((await plainRefund(saleId, cash, { applied: "8.50" }, [cancelId])).status).toBe(200);
    expect(lineOf(await read(saleId), "Paella")).toMatchObject({
      left: "10.00",
      cancelled: { quantity: "1.000", owed: "10.00", back: "8.50" },
    });
    expect((await plainRefund(saleId, cash, { applied: "10.00" }, [cancelId])).status).toBe(200);
    expect(lineOf(await read(saleId), "Paella")).toMatchObject({
      left: "0.00",
      cancelled: { owed: "0.00", back: "18.50" },
    });
  });

  it("counts one of two croquetas cancelled", async () => {
    const b = await tab([["Croquetas", "2"], "Bread"]);
    const saleId = await pay(b, [{ cash: "10.00" }]);
    await cancel(b, "Croquetas", "1", true);
    expect(lineOf(await read(saleId), "Croquetas").cancelled).toEqual({
      quantity: "1.000",
      owed: "4.00",
      back: "0.00",
    });
  });

  it("shows no cancel for one made without Refund ticked", async () => {
    const b = await tab(["Paella", "Bread"]);
    const saleId = await pay(b, [{ cash: "20.50" }]);
    await cancel(b, "Paella", "1", false);
    expect(lineOf(await read(saleId), "Paella").cancelled).toBeNull();
  });

  it("marks a dish given free", async () => {
    const b = await tab(["Paella", "Water"]);
    await comp(b, "Water");
    const saleId = await pay(b, [{ cash: "18.50" }]);
    const view = await read(saleId);
    expect(lineOf(view, "Water").givenFree).toBe(true);
    expect(lineOf(view, "Paella").givenFree).toBe(false);
  });

  it("lists a receipt another box filed with each line's left at its gross (I3)", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }]);
    admittingNot("wrong_node");
    const view = await read(saleId);
    expect(lineOf(view, "Paella")).toMatchObject({ gross: "18.50", left: "18.50" });
    expect(lineOf(view, "Cheesecake")).toMatchObject({ gross: "6.50", left: "6.50" });
    expect(view.choices.goodwill).toEqual({ available: true, reason: null });
  });

  it("lists a receipt AEAT refused with each line's left at its gross (I3)", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }]);
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    const view = await read(saleId);
    expect(lineOf(view, "Paella")).toMatchObject({ gross: "18.50", left: "18.50" });
    expect(lineOf(view, "Cheesecake")).toMatchObject({ gross: "6.50", left: "6.50" });
  });
});

describe("readGiveBack: the ways", () => {
  it("puts every cash payment in one way, each card in its own, with the extra paid on top", async () => {
    const b = await tab(["Paella", "Cheesecake", "Bread"]);
    const saleId = await pay(b, [{ cash: "10.00" }, { cash: "7.00" }, { reader: "10.00" }], "3.00");
    const view = await read(saleId);
    const card = (await inTx(venue, (tx) => readRefundableTenders(tx, saleId))).find(
      (row) => row.method === "card",
    )!;
    expect(view.ways).toEqual([
      {
        way: "cash",
        last4: null,
        manual: false,
        moneyLeft: "17.00",
        extraLeft: "3.00",
        pending: false,
        allowedHere: true,
        reason: null,
      },
      {
        way: card.tenderId,
        last4: card.last4,
        manual: false,
        moneyLeft: "10.00",
        extraLeft: "0.00",
        pending: false,
        allowedHere: true,
        reason: null,
      },
    ]);
    const firstCash = await tenderOf(saleId, "cash");
    expect((await plainRefund(saleId, firstCash, { tip: "1.00" })).status).toBe(200);
    expect((await read(saleId)).ways[0]).toMatchObject({ way: "cash", extraLeft: "2.00" });
  });

  it("marks a hand-keyed card, and a card this device's profile does not take", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ card: "15.00" }, { reader: "10.00" }]);
    const manual = await tenderOf(saleId, "card", 0);
    const reader = await tenderOf(saleId, "card", 1);
    const here = await read(saleId);
    expect(here.ways.find((way) => way.way === manual)).toMatchObject({
      manual: true,
      allowedHere: true,
    });
    expect(here.ways.find((way) => way.way === reader)).toMatchObject({
      manual: false,
      allowedHere: true,
    });
    const cashOnly = await read(saleId, {
      device: {
        ...till,
        capabilities: till.capabilities.filter((c) => !c.endsWith("card-payment")),
      },
    });
    expect(cashOnly.ways.map((way) => way.allowedHere)).toEqual([false, false]);
  });
});

describe("readGiveBack: what can be used now (O1)", () => {
  it("shows the open correction under way, and every choice unavailable", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }]);
    const opened = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${saleId}/corrections`,
      {
        submissionId: randomUUID(),
        gross: "5.00",
        reasonId: correctionReasonId,
        note: "Cold",
        expectedSplit: [{ rate: "10.00", base: "4.55", tax: "0.45" }],
        override: supervisor(),
      },
    );
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const correctionId = (opened.json as { correction: { id: string } }).correction.id;
    const view = await read(saleId);
    expect(view.underWay).toMatchObject({ id: correctionId, state: "open", gross: "5.00" });
    const reason = {
      code: "invoice_correction.already_open",
      params: { saleId, correctionId },
    };
    expect(view.choices).toEqual({
      dishes: { available: false, reason },
      goodwill: { available: false, reason },
      extra: { available: false, reason },
    });
  });

  it("offers every choice on an ordinary receipt, and nothing under way", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }], "2.00");
    const view = await read(saleId);
    expect(view.underWay).toBeNull();
    expect(view.choices).toEqual({
      dishes: { available: true, reason: null },
      goodwill: { available: true, reason: null },
      extra: { available: true, reason: null },
    });
    expect(lineOf(view, "Cheesecake")).toMatchObject({ available: true, reason: null });
  });

  it("on a receipt AEAT refused: goodwill waits, the cancelled paella and the extra do not", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }], "2.00");
    await cancel(b, "Paella", "1", true);
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    const view = await read(saleId);
    const refused = { code: "sale.correction_not_admitted", params: { reason: "filing_refused" } };
    expect(view.choices).toEqual({
      dishes: { available: true, reason: null },
      goodwill: { available: false, reason: refused },
      extra: { available: true, reason: null },
    });
    expect(lineOf(view, "Paella")).toMatchObject({
      available: true,
      reason: null,
      cancelled: { owed: "18.50" },
    });
    expect(lineOf(view, "Cheesecake")).toMatchObject({ available: false, reason: refused });
  });

  it("while another payment's refund is pending: goodwill waits, and that way says why", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ reader: "12.50" }, { cash: "12.50" }], "1.00");
    const card = await tenderOf(saleId, "card");
    venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
    expect(await plainRefund(saleId, card, { tip: "1.00" })).toMatchObject({
      status: 200,
      json: { state: "pending" },
    });
    const view = await read(saleId);
    expect(view.choices.goodwill).toEqual({
      available: false,
      reason: {
        code: "invoice_correction.refund_pending",
        params: { saleId, refundId: expect.any(String) },
      },
    });
    expect(view.ways.find((way) => way.way === card)).toMatchObject({
      pending: true,
      reason: { code: "tender.refund_in_progress", params: { tenderId: card } },
    });
    expect(view.ways.find((way) => way.way === "cash")).toMatchObject({
      pending: false,
      reason: null,
    });
  });

  it("while the box's time is unconfirmed, every choice waits", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }], "2.00");
    const view = await read(saleId, {
      backend: gateSeatOnStartClock(venue.backend, () => true),
    });
    const reason = { code: "clock.unconfirmed", params: {} };
    expect(view.choices).toEqual({
      dishes: { available: false, reason },
      goodwill: { available: false, reason },
      extra: { available: false, reason },
    });
  });

  it("with no extra paid, the extra is unavailable with no reason", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }]);
    expect((await read(saleId)).choices.extra).toEqual({ available: false, reason: null });
  });
});

const aioliOf = (view: GiveBackView) =>
  view.lines.find((line) => Object.values(line.descriptions).includes("Garlic mayonnaise"))!;

describe("readGiveBack: a cancelled dish with a priced extra", () => {
  it("shares the cancel's money between the dish's line and its extra's, the dish's first", async () => {
    const b = await tab(["Paella", "Cheesecake"], { withAioli: true });
    const saleId = await pay(b, [{ cash: "28.00" }]);
    const cancelId = await cancel(b, "Paella", "1", true);
    const cash = await tenderOf(saleId, "cash");
    const before = await read(saleId);
    expect(lineOf(before, "Paella")).toMatchObject({
      gross: "18.50",
      left: "18.50",
      cancelled: { quantity: "1.000", owed: "18.50", back: "0.00" },
    });
    expect(aioliOf(before)).toMatchObject({
      gross: "3.00",
      left: "3.00",
      cancelled: { quantity: "1.000", owed: "3.00", back: "0.00" },
    });

    expect((await plainRefund(saleId, cash, { applied: "20.00" }, [cancelId])).status).toBe(200);
    const partly = await read(saleId);
    expect(lineOf(partly, "Paella")).toMatchObject({
      left: "0.00",
      available: false,
      cancelled: { owed: "0.00", back: "18.50" },
    });
    expect(aioliOf(partly)).toMatchObject({
      left: "1.50",
      available: true,
      cancelled: { owed: "1.50", back: "1.50" },
    });

    expect((await plainRefund(saleId, cash, { applied: "1.50" }, [cancelId])).status).toBe(200);
    const all = await read(saleId);
    for (const line of [lineOf(all, "Paella"), aioliOf(all)])
      expect(line).toMatchObject({
        left: "0.00",
        available: false,
        reason: null,
        cancelled: { owed: "0.00" },
      });
    expect(lineOf(all, "Cheesecake")).toMatchObject({ left: "6.50", available: true });
  });
});

describe("readGiveBack: more waits", () => {
  it("shows a reader card whose company cannot send refunds as waiting (case 8)", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ reader: "15.00" }, { card: "10.00" }]);
    const reader = await tenderOf(saleId, "card", 0);
    const manual = await tenderOf(saleId, "card", 1);
    const way = (view: GiveBackView, id: string) => view.ways.find((row) => row.way === id)!;
    const served = await read(saleId);
    expect(way(served, reader).reason).toBeNull();
    const unserved = await read(saleId, { refundProviderFor: async () => undefined });
    expect(way(unserved, reader).reason).toEqual({
      code: "tender.refund_unavailable",
      params: { tenderId: reader },
    });
    expect(way(unserved, manual).reason).toBeNull();
    const noSend = await read(saleId, {
      refundProviderFor: async () =>
        Object.assign(Object.create(venue.card) as typeof venue.card, { sendRefund: undefined }),
    });
    expect(way(noSend, reader).reason).toMatchObject({ code: "tender.refund_unavailable" });
  });

  it("offers no dishes and no goodwill once every payment's money is back", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }]);
    admittingNot("wrong_node");
    const cash = await tenderOf(saleId, "cash");
    expect((await plainRefund(saleId, cash, { applied: "25.00" })).status).toBe(200);
    const view = await read(saleId);
    expect(lineOf(view, "Paella")).toMatchObject({ left: "18.50", available: false, reason: null });
    expect(view.choices).toEqual({
      dishes: { available: false, reason: null },
      goodwill: { available: false, reason: null },
      extra: { available: false, reason: null },
    });
  });

  it("while the box cannot trade, every choice waits (case 7)", async () => {
    const b = await tab(["Paella"]);
    const saleId = await pay(b, [{ cash: "18.50" }], "1.00");
    const view = await read(saleId, { admission: new TradingAdmission() });
    const reason = { code: "venue.time_zone_not_ready", params: { reason: "unchecked" } };
    expect(view.choices).toEqual({
      dishes: { available: false, reason },
      goodwill: { available: false, reason },
      extra: { available: false, reason },
    });
  });

  it("while the box is in a fiscal conflict, every choice waits (case 6)", async () => {
    const b = await tab(["Paella"]);
    const saleId = await pay(b, [{ cash: "18.50" }], "1.00");
    const conflict = new AppError("sif.allocation_invalid", {} as never);
    const spy = vi.spyOn(venue.backend, "refuseNewRefund").mockRejectedValue(conflict);
    onTestFinished(() => spy.mockRestore());
    const view = await read(saleId);
    const reason = { code: "sif.allocation_invalid", params: { ...conflict.params } };
    expect(view.choices).toEqual({
      dishes: { available: false, reason },
      goodwill: { available: false, reason },
      extra: { available: false, reason },
    });
  });
});

/** Replaces the receipt as the administrator would once AEAT has refused it. */
function replace(saleId: SaleId): Promise<SaleId> {
  return inTx(venue, async (tx) => {
    await refusedByAeat(tx, saleId);
    const session = await loginWithPin(tx, {
      deviceId: venue.deviceId,
      personId: venue.adminId,
      pin: "1234",
    });
    const replaced = await recordReplacement(tx, venue.backend, {
      operationDescription: "Restaurante",
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(await readLiveSeriesIdTx(tx, venue.cfg.nodeId, "corrective")),
      correctsSaleId: saleId,
      authz: { sessionId: session.id },
      clock: venue.clock,
    });
    return replaced.saleId;
  });
}

describe("readGiveBack: a receipt replaced after AEAT refused it", () => {
  it("opened on the receipt the payments are on, lists the replacement's lines, which Correct invoice corrects", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }]);
    await cancel(b, "Paella", "1", true);
    const replacement = await replace(saleId);
    const replacementLines = await venue.db
      .select({ id: saleLines.id })
      .from(saleLines)
      .where(eq(saleLines.saleId, replacement));
    const view = await read(saleId);
    expect(view.lines.map((line) => line.id).sort()).toEqual(
      replacementLines.map((line) => line.id).sort(),
    );
    expect(lineOf(view, "Paella")).toMatchObject({
      left: "18.50",
      available: true,
      cancelled: { quantity: "1.000", owed: "18.50", back: "0.00" },
    });
    expect(view.choices.goodwill).toEqual({ available: true, reason: null });
  });
});

const ask = (
  purpose: GiveBackRequest["purpose"],
  amount: string,
  more: Partial<GiveBackRequest> = {},
): GiveBackRequest => ({ purpose, amount, extra: "0.00", way: "cash", ...more });

describe("planGiveBack: cancelled and served dishes", () => {
  it("pays the paella's cancel back first, then corrects the cheesecake, naming no lines past what the ticked lines hold (I2)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const cancelId = await cancel(b, "Paella", "1", true);
    const view = await read(saleId);
    const ticked = [lineOf(view, "Paella").id, lineOf(view, "Cheesecake").id];
    expect(await preview(saleId, ask("dishes", "24.50", { lineIds: ticked }))).toEqual(
      planned([
        { kind: "refund", amount: "18.50", way: "cash", cancellationIds: [cancelId] },
        { kind: "correction", amount: "6.00", way: "cash", lineIds: [ticked[1]!] },
      ]),
    );
    expect(await preview(saleId, ask("dishes", "30.00", { lineIds: ticked }))).toEqual(
      planned([
        { kind: "refund", amount: "18.50", way: "cash", cancellationIds: [cancelId] },
        { kind: "correction", amount: "11.50", way: "cash", lineIds: [] },
      ]),
    );
  });

  it("gives the paella alone back as a refund up to what its cancel owes, then corrects once it owes nothing", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const cancelId = await cancel(b, "Paella", "1", true);
    const paella = [lineOf(await read(saleId), "Paella").id];
    expect(await preview(saleId, ask("dishes", "18.50", { lineIds: paella }))).toEqual(
      planned([{ kind: "refund", amount: "18.50", way: "cash", cancellationIds: [cancelId] }]),
    );
    expect(await preview(saleId, ask("dishes", "10.00", { lineIds: paella }))).toEqual(
      planned([{ kind: "refund", amount: "10.00", way: "cash", cancellationIds: [cancelId] }]),
    );
    const cash = await tenderOf(saleId, "cash");
    expect((await plainRefund(saleId, cash, { applied: "18.50" }, [cancelId])).status).toBe(200);
    expect(await preview(saleId, ask("dishes", "5.00", { lineIds: paella }))).toEqual(
      planned([{ kind: "correction", amount: "5.00", way: "cash", lineIds: [] }]),
    );
  });
});

describe("planGiveBack: goodwill and the extra", () => {
  it("corrects goodwill, paying a cancel still owed first, the extra between", async () => {
    const plain = await tab(FIVE);
    const plainSale = await pay(plain, [{ cash: "34.00" }]);
    expect(await preview(plainSale, ask("goodwill", "10.00"))).toEqual(
      planned([{ kind: "correction", amount: "10.00", way: "cash", lineIds: [] }]),
    );

    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }], "3.00");
    await cancel(b, "Paella", "1", true);
    expect(await preview(saleId, ask("goodwill", "25.00"))).toEqual(
      planned([
        { kind: "refund", amount: "18.50", way: "cash" },
        { kind: "correction", amount: "6.50", way: "cash", lineIds: [] },
      ]),
    );
    expect(await preview(saleId, ask("goodwill", "25.00", { extra: "3.00" }))).toEqual(
      planned([
        { kind: "refund", amount: "18.50", way: "cash" },
        { kind: "extra", amount: "3.00", way: "cash" },
        { kind: "correction", amount: "6.50", way: "cash", lineIds: [] },
      ]),
    );
  });

  it("gives the extra alone back, never more than was paid on top", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }], "3.00");
    expect(await preview(saleId, ask("extra", "2.00"))).toEqual(
      planned([{ kind: "extra", amount: "2.00", way: "cash" }]),
    );
    expect(await preview(saleId, ask("extra", "4.00"))).toEqual(
      refused("tender.refund_exceeds_payment", {
        tenderId: await tenderOf(saleId, "cash"),
        applied: "34.00",
        tip: "3.00",
      }),
    );
  });

  it.each(["wrong_node", "not_simplified"])(
    "gives goodwill back as a plain refund where Correct invoice can never act (%s)",
    async (reason) => {
      const b = await tab(FIVE);
      const saleId = await pay(b, [{ cash: "34.00" }]);
      admittingNot(reason);
      expect(await preview(saleId, ask("goodwill", "10.00"))).toEqual(
        planned([{ kind: "refund", amount: "10.00", way: "cash" }]),
      );
    },
  );

  it("gives goodwill back as a plain refund while the records need checking", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const unsound = vi.spyOn(venue.backend, "checkIntegrity").mockResolvedValue({
      ok: false,
      checked: 1,
      issues: [{ code: "predecessor-hash-mismatch", params: {} }],
    } as Awaited<ReturnType<typeof venue.backend.checkIntegrity>>);
    onTestFinished(() => unsound.mockRestore());
    expect(await preview(saleId, ask("goodwill", "10.00"))).toEqual(
      planned([{ kind: "refund", amount: "10.00", way: "cash" }]),
    );
  });
});

describe("planGiveBack: waits answer what the read shows", () => {
  it("on a receipt AEAT refused: goodwill waits; the extra and the cancelled paella go back", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }], "2.00");
    const cancelId = await cancel(b, "Paella", "1", true);
    await inTx(venue, (tx) => refusedByAeat(tx, saleId));
    const view = await read(saleId);
    expect(await preview(saleId, ask("goodwill", "5.00"))).toEqual(
      refused("sale.correction_not_admitted", view.choices.goodwill.reason!.params),
    );
    expect(view.choices.goodwill.reason).toMatchObject({ params: { reason: "filing_refused" } });
    expect(await preview(saleId, ask("extra", "2.00"))).toEqual(
      planned([{ kind: "extra", amount: "2.00", way: "cash" }]),
    );
    const paella = [lineOf(view, "Paella").id];
    expect(await preview(saleId, ask("dishes", "18.50", { lineIds: paella }))).toEqual(
      planned([{ kind: "refund", amount: "18.50", way: "cash", cancellationIds: [cancelId] }]),
    );
    expect(await preview(saleId, ask("dishes", "19.00", { lineIds: paella }))).toEqual(
      refused("sale.correction_not_admitted", view.choices.goodwill.reason!.params),
    );
    expect(
      await preview(saleId, ask("dishes", "1.00", { lineIds: [lineOf(view, "Bread").id] })),
    ).toEqual(refused(lineOf(view, "Bread").reason!.code, lineOf(view, "Bread").reason!.params));
  });

  it("goodwill waits while another payment's refund is pending", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ reader: "12.50" }, { cash: "12.50" }], "1.00");
    const card = await tenderOf(saleId, "card");
    venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
    expect((await plainRefund(saleId, card, { tip: "1.00" })).status).toBe(200);
    const reason = (await read(saleId)).choices.goodwill.reason!;
    expect(reason.code).toBe("invoice_correction.refund_pending");
    expect(await preview(saleId, ask("goodwill", "5.00"))).toEqual(
      refused(reason.code, reason.params),
    );
  });

  it("every choice waits while a correction is open", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }], "2.00");
    const opened = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/transactions/${saleId}/corrections`,
      {
        submissionId: randomUUID(),
        gross: "5.00",
        reasonId: correctionReasonId,
        note: "Cold",
        expectedSplit: [{ rate: "10.00", base: "4.55", tax: "0.45" }],
        override: supervisor(),
      },
    );
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    const view = await read(saleId);
    const reason = view.choices.dishes.reason!;
    expect(reason.code).toBe("invoice_correction.already_open");
    const lineIds = [lineOf(view, "Cheesecake").id];
    for (const request of [
      ask("goodwill", "5.00"),
      ask("dishes", "5.00", { lineIds }),
      ask("extra", "1.00"),
    ])
      expect(await preview(saleId, request)).toEqual(refused(reason.code, reason.params));
  });

  it("every choice waits while the box's time is unconfirmed", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ cash: "25.00" }], "2.00");
    const backend = gateSeatOnStartClock(venue.backend, () => true);
    const reason = (await read(saleId, { backend })).choices.goodwill.reason!;
    expect(reason.code).toBe("clock.unconfirmed");
    expect(await preview(saleId, ask("extra", "1.00"), { backend })).toEqual(
      refused(reason.code, reason.params),
    );
  });

  it("dishes, goodwill and the extra wait with the reason of the only way holding money (a card that cannot refund)", async () => {
    const b = await tab(["Paella", "Cheesecake"]);
    const saleId = await pay(b, [{ reader: "25.00" }], "1.00");
    const card = await tenderOf(saleId, "card");
    const options = { refundProviderFor: async () => undefined };
    const view = await read(saleId, options);
    const reason = { code: "tender.refund_unavailable", params: { tenderId: card } };
    expect(view.choices.dishes).toEqual({ available: false, reason });
    expect(view.choices.goodwill).toEqual({ available: false, reason });
    expect(lineOf(view, "Paella")).toMatchObject({ available: false, reason });
    expect(await preview(saleId, ask("goodwill", "5.00", { way: card }), options)).toEqual(
      refused(reason.code, reason.params),
    );
    expect(view.choices.extra).toEqual({ available: false, reason });
    expect(await preview(saleId, ask("extra", "1.00", { way: card }), options)).toEqual(
      refused(reason.code, reason.params),
    );
  });
});

describe("planGiveBack: more than one payment (D10)", () => {
  it("opens one correction for the whole goodwill, leaving on it what the chosen way cannot hold, and refuses a refund the way cannot hold", async () => {
    const b = await tab(["Paella", "Cheesecake", ["Croquetas", "4"], ["Bread", "3"]]);
    const saleId = await pay(b, [{ cash: "30.00" }, { card: "17.00" }]);
    expect(await preview(saleId, ask("goodwill", "45.00"))).toEqual(
      planned([{ kind: "correction", amount: "45.00", way: "cash", lineIds: [] }], {
        leftUnderWay: "15.00",
      }),
    );
    await cancel(b, "Paella", "1", true);
    const card = await tenderOf(saleId, "card");
    const paella = [lineOf(await read(saleId), "Paella").id];
    expect(await preview(saleId, ask("dishes", "18.50", { lineIds: paella, way: card }))).toEqual(
      invalidField("amount"),
    );
  });
});

describe("planGiveBack: the rights it needs (D9)", () => {
  it("names the rights this person lacks; a cancel's approval covers its money only from the filled window", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    expect(
      await preview(saleId, ask("goodwill", "10.00"), { authority: holding("sale.refund") }),
    ).toEqual(
      planned([{ kind: "correction", amount: "10.00", way: "cash", lineIds: [] }], {
        needs: ["sale.rectify"],
      }),
    );
    const cancelId = await cancel(b, "Paella", "1", true);
    const paella = [lineOf(await read(saleId), "Paella").id];
    const refund = [
      { kind: "refund" as const, amount: "18.50", way: "cash", cancellationIds: [cancelId] },
    ];
    expect(
      await preview(saleId, ask("dishes", "18.50", { lineIds: paella, fromCancel: [cancelId] }), {
        authority: holding(),
      }),
    ).toEqual(planned(refund));
    expect(
      await preview(saleId, ask("dishes", "18.50", { lineIds: paella }), { authority: holding() }),
    ).toEqual(planned(refund, { needs: ["sale.refund"] }));
  });
});
