import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { adjustments, createAdjustmentReason, listAdjustmentReasons } from "@waitron/adjustments";
import {
  deviceProfiles,
  devices,
  floorZones,
  incidents,
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
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { refusedByAeat } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import {
  createCategory,
  createExtraList,
  createProduct,
  writeProductModifiers,
} from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { authorityForRoles, loginWithPin, type PersonAuthority } from "@waitron/identity";
import type { ProfileAction } from "@waitron/layouts";
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
import {
  createDepartment,
  createServiceZone,
  setProfileServiceAccess,
} from "@waitron/venue-service";
import { applyAdjustment } from "./adjustments-apply.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { refundProvidersOf, type RefundProviderFor } from "./bill-refunds.js";
import { readBillEditState } from "./bill-editing.js";
import {
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
  type DeviceBinding,
} from "./device-session.js";
import { planGiveBack, type GiveBackPlan, type GiveBackRequest } from "./give-back-plan.js";
import { readGiveBack, type GiveBackView } from "./give-back-read.js";
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
import { enrolDeviceForTest } from "./testing/enrol.js";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { confineTo, personHolding } from "./testing/session-holding.js";
import { TradingAdmission } from "./trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";

/** Armed, the next corrective `recordCorrection` files is refused, as AEAT's seat refusing it. */
const filingFault = vi.hoisted(() => ({ armed: false }));
vi.mock("@waitron/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/core")>();
  return {
    ...real,
    recordCorrection: (...args: Parameters<typeof real.recordCorrection>) => {
      if (filingFault.armed) {
        filingFault.armed = false;
        return Promise.reject(new Error("filing refused"));
      }
      return real.recordCorrection(...args);
    },
  };
});

/** The credentials `withPinCheckAhead` was handed, in order. */
const pinChecks = vi.hoisted(() => ({ credentials: [] as unknown[] }));
vi.mock("./pin-check-ahead.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./pin-check-ahead.js")>();
  return {
    ...real,
    withPinCheckAhead: (...args: Parameters<typeof real.withPinCheckAhead>) => {
      pinChecks.credentials.push(args[1]);
      return real.withPinCheckAhead(...args);
    },
  };
});

/** The corrections `fileCorrectionAutomatically` was asked to file; with `refuse`, it throws; with
 * `chainBroken`, the real one runs while the seat's chain check reports an issue, as
 * `invoice-correction-alerts.test.ts`'s `standIn` makes it. */
const automaticFiling = vi.hoisted(() => ({
  refuse: false,
  chainBroken: false,
  asked: [] as string[],
}));
vi.mock("./invoice-correction-alerts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./invoice-correction-alerts.js")>();
  return {
    ...real,
    fileCorrectionAutomatically: (...args: Parameters<typeof real.fileCorrectionAutomatically>) => {
      automaticFiling.asked.push(args[1]);
      if (automaticFiling.refuse) return Promise.reject(new Error("automatic filing refused"));
      if (!automaticFiling.chainBroken) return real.fileCorrectionAutomatically(...args);
      const backend = args[0].backend;
      const check = backend.checkIntegrity;
      backend.checkIntegrity = () =>
        Promise.resolve({
          ok: false,
          checked: 1,
          issues: [{ code: "predecessor-hash-mismatch", params: {} }],
        } as Awaited<ReturnType<typeof check>>);
      return real.fileCorrectionAutomatically(...args).finally(() => {
        backend.checkIntegrity = check;
      });
    },
  };
});

/** Armed, the next `closeInvoiceCorrection` is refused, as a stepdown refusing the write. */
const discardFault = vi.hoisted(() => ({ armed: false }));
vi.mock("./invoice-corrections.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./invoice-corrections.js")>();
  return {
    ...real,
    closeInvoiceCorrection: (...args: Parameters<typeof real.closeInvoiceCorrection>) => {
      if (discardFault.armed) {
        discardFault.armed = false;
        return Promise.reject(
          new AppError("venue.time_zone_not_ready", { reason: "stepping down" } as never),
        );
      }
      return real.closeInvoiceCorrection(...args);
    },
  };
});

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
/** The administrator, holding every right, signed in on the first till. */
let adminCookie: string;

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
      const session = await loginWithPin(tx, {
        deviceId: venue.deviceId,
        personId: venue.adminId,
        pin: "1234",
      });
      adminCookie = `${SESSION_COOKIE}=${session.token}; ${deviceProofOf(venue.cookie)}`;
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

/** `tip`, when given, is that payment's own extra in place of the first payment's `tip`. */
type Part = ({ cash: string } | { card: string } | { reader: string }) & { tip?: string };

/** Pays the bill in `parts`, the first carrying `tip`; answers the sale. */
async function pay(b: Tab, parts: readonly Part[], tip = "0.00") {
  for (const [index, part] of parts.entries()) {
    const partTip = part.tip ?? (index === 0 ? tip : "0.00");
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

/** The `waitron_device=…` part of a till's cookie. */
function deviceProofOf(cookie: string): string {
  return cookie.split("; ").find((part) => part.startsWith(`${DEVICE_COOKIE}=`))!;
}

/** What a give-back may write, read straight from the tables. */
function effects() {
  return venue.db.all<{
    refunds: number;
    corrections: number;
    sales: number;
    drawerJobs: number;
    drawerOpens: number;
    drawerCents: number;
  }>(sql`
    select (select count(*) from refunds) as refunds,
           (select count(*) from invoice_corrections) as corrections,
           (select count(*) from sales) as sales,
           (select count(*) from print_jobs where kind = 'drawer') as drawerJobs,
           (select count(*) from drawer_opens) as drawerOpens,
           (select coalesce(sum(amount), 0) from drawer_entries) as drawerCents`)[0]!;
}

const routePreview = (saleId: string, request: GiveBackRequest, app = venue.app) =>
  send(app, adminCookie, "POST", `/api/transactions/${saleId}/give-back/preview`, request);

/** The write's body for `request`: fresh ids, and `expected` as the preview answers it now. */
async function giveBody(saleId: string, request: GiveBackRequest) {
  const previewed = await routePreview(saleId, request);
  expect(previewed.status, JSON.stringify(previewed.json)).toBe(200);
  return {
    ...request,
    reasonId: correctionReasonId,
    note: "Cold",
    submissionIds: {
      refund: randomUUID(),
      extra: randomUUID(),
      correction: randomUUID(),
      leg: randomUUID(),
    },
    expected: (previewed.json as unknown as GiveBackPlan).parts,
  };
}

const give = (saleId: string, body: unknown, cookie = adminCookie, app = venue.app) =>
  send(app, cookie, "POST", `/api/transactions/${saleId}/give-back`, body);

/** Expects `answer` to be the refusal `code`, with nothing written since `before`. */
function expectRefusedUnwritten(
  answer: Awaited<ReturnType<typeof give>>,
  code: string,
  before: ReturnType<typeof effects>,
) {
  expect((answer.json as { code?: string }).code, JSON.stringify(answer.json)).toBe(code);
  expect(answer.status).toBeGreaterThanOrEqual(400);
  expect(effects()).toEqual(before);
}

describe("POST …/give-back in cash", () => {
  it("refunds the paella's cancel, then corrects and files the cheesecake, opening the drawer once", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const cancelId = await cancel(b, "Paella", "1", true);
    const view = await read(saleId);
    const ticked = [lineOf(view, "Paella").id, lineOf(view, "Cheesecake").id];
    const before = effects();
    const answer = await give(
      saleId,
      await giveBody(saleId, ask("dishes", "24.50", { lineIds: ticked })),
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "refund", amount: "18.50", state: "completed" },
        { kind: "correction", amount: "6.00", state: "completed" },
      ],
      refusal: null,
      underWay: null,
      rest: null,
    });
    const [refundPart, correctionPart] = (
      answer.json as { parts: { refundId?: string; correctionId?: string }[] }
    ).parts;
    const links = await venue.db.all<{ adjustment_id: string; amount: number }>(
      sql`select adjustment_id, amount from adjustment_refunds where refund_id = ${refundPart!.refundId!}`,
    );
    expect(links).toEqual([{ adjustment_id: cancelId, amount: 1850 }]);
    const [correction] = await venue.db
      .select()
      .from(invoiceCorrections)
      .where(eq(invoiceCorrections.id, correctionPart!.correctionId!));
    expect(correction).toMatchObject({ state: "filed", gross: 600 });
    expect(correction!.correctiveSaleId).not.toBeNull();
    expect(effects()).toEqual({
      refunds: before.refunds + 2,
      corrections: before.corrections + 1,
      sales: before.sales + 1,
      drawerJobs: before.drawerJobs + 1,
      drawerOpens: before.drawerOpens + 1,
      drawerCents: before.drawerCents - 2450,
    });
  });

  it("gives the extra back alone, then files the goodwill's correction, opening the drawer once", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }], "3.00");
    const before = effects();
    const answer = await give(
      saleId,
      await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00" })),
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "extra", amount: "3.00", state: "completed" },
        { kind: "correction", amount: "10.00", state: "completed" },
      ],
      refusal: null,
      underWay: null,
      rest: null,
    });
    const extraId = (answer.json as { parts: { refundId: string }[] }).parts[0]!.refundId;
    const [extra] = await venue.db.select().from(refunds).where(eq(refunds.id, extraId));
    expect(extra).toMatchObject({ appliedAmount: 0, tipAmount: 300, state: "completed" });
    expect(effects()).toEqual({
      refunds: before.refunds + 2,
      corrections: before.corrections + 1,
      sales: before.sales + 1,
      drawerJobs: before.drawerJobs + 1,
      drawerOpens: before.drawerOpens + 1,
      drawerCents: before.drawerCents - 1300,
    });
  });

  it("gives the cash back and leaves the correction open for the card's share, filing nothing yet", async () => {
    const b = await tab(["Paella", "Cheesecake", ["Croquetas", "4"], ["Bread", "3"]]);
    const saleId = await pay(b, [{ cash: "30.00" }, { card: "17.00" }]);
    const before = effects();
    const answer = await give(saleId, await giveBody(saleId, ask("goodwill", "45.00")));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [{ kind: "correction", amount: "45.00", state: "pending" }],
      refusal: null,
      underWay: { state: "open", gross: "45.00", moneyBack: "30.00", left: "15.00" },
      rest: null,
    });
    expect(effects()).toEqual({
      ...before,
      refunds: before.refunds + 1,
      corrections: before.corrections + 1,
      drawerJobs: before.drawerJobs + 1,
      drawerOpens: before.drawerOpens + 1,
      drawerCents: before.drawerCents - 3000,
    });
  });

  it("undoes the whole give-back, the extra included, when filing the corrective is refused", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }], "3.00");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00" }));
    const before = effects();
    filingFault.armed = true;
    onTestFinished(() => {
      filingFault.armed = false;
    });
    const logged: unknown[][] = [];
    const answer = await give(
      saleId,
      body,
      adminCookie,
      venue.appWith({ log: (...line: unknown[]) => void logged.push(line) }),
    );
    expect(filingFault.armed).toBe(false);
    // The boundary answers an error that is not a refusal as `server.internal` and logs it under
    // the route's tag.
    expect(answer).toEqual({ status: 500, json: { code: "server.internal" } });
    expect(logged).toContainEqual(["error", "give_back.failed", expect.anything()]);
    expect(effects()).toEqual(before);
  });

  it("refuses give_back.changed when the parts are no longer what the preview showed", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const body = await giveBody(saleId, ask("goodwill", "10.00"));
    const before = effects();
    expectRefusedUnwritten(
      await give(saleId, {
        ...body,
        expected: [{ kind: "refund", amount: "10.00", way: "cash" }],
      }),
      "give_back.changed",
      before,
    );
    const changed = await give(saleId, {
      ...body,
      expected: [{ kind: "correction", amount: "9.00", way: "cash", lineIds: [] }],
    });
    expect(changed.status).toBe(409);
    expectRefusedUnwritten(changed, "give_back.changed", before);
  });

  it("answers a resend with its first result, writing nothing and opening no drawer, and refuses the same ids with another amount (I1)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }], "3.00");
    await cancel(b, "Paella", "1", true);
    const body = await giveBody(saleId, ask("goodwill", "25.00", { extra: "3.00" }));
    const first = await give(saleId, body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json).toMatchObject({
      parts: [
        { kind: "refund", amount: "18.50", state: "completed" },
        { kind: "extra", amount: "3.00", state: "completed" },
        { kind: "correction", amount: "6.50", state: "completed" },
      ],
    });
    const after = effects();
    expect(await give(saleId, body)).toEqual(first);
    expect(effects()).toEqual(after);
    expectRefusedUnwritten(
      await give(saleId, { ...body, amount: "20.00" }),
      "submission.id_reused",
      after,
    );
    expectRefusedUnwritten(
      await give(saleId, {
        ...body,
        expected: body.expected.map((part) =>
          part.kind === "extra" ? { ...part, amount: "2.00" } : part,
        ),
        extra: "2.00",
      }),
      "submission.id_reused",
      after,
    );
  });

  it("refuses clock.unconfirmed on a give-back of a cancelled dish alone, writing nothing (I4)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    await cancel(b, "Paella", "1", true);
    const paella = [lineOf(await read(saleId), "Paella").id];
    const body = await giveBody(saleId, ask("dishes", "18.50", { lineIds: paella }));
    expect(body.expected).toEqual([expect.objectContaining({ kind: "refund", amount: "18.50" })]);
    const gated = venue.appWith({ backend: gateSeatOnStartClock(venue.backend, () => true) });
    const before = effects();
    expectRefusedUnwritten(
      await give(saleId, body, adminCookie, gated),
      "clock.unconfirmed",
      before,
    );
  });

  it("refuses a request whose device is not the session's, as assertRequestDevice refuses", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const body = await giveBody(saleId, ask("goodwill", "10.00"));
    const otherDevice = `${adminCookie.split("; ")[0]}; ${deviceProofOf(venue.cookie2)}`;
    const before = effects();
    const answer = await give(saleId, body, otherDevice);
    expect(answer).toEqual({ status: 401, json: { code: "device.unauthorized", params: {} } });
    expect(effects()).toEqual(before);
  });

  it("splits the cancelled paella and the extra over two cash payments, oldest first, opening the drawer once, and a resend writes nothing", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [
      { cash: "10.00", tip: "1.00" },
      { cash: "24.00", tip: "2.00" },
    ]);
    const cancelId = await cancel(b, "Paella", "1", true);
    const [firstCash, secondCash] = [
      await tenderOf(saleId, "cash"),
      await tenderOf(saleId, "cash", 1),
    ];
    const paella = [lineOf(await read(saleId), "Paella").id];
    const before = effects();
    const body = await giveBody(saleId, ask("dishes", "18.50", { lineIds: paella, extra: "2.50" }));
    expect(body.expected).toEqual([
      { kind: "refund", amount: "18.50", way: "cash", cancellationIds: [cancelId] },
      { kind: "extra", amount: "2.50", way: "cash" },
    ]);
    const first = await give(saleId, body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json).toMatchObject({
      parts: [
        { kind: "refund", amount: "18.50", state: "completed" },
        { kind: "extra", amount: "2.50", state: "completed" },
      ],
      refusal: null,
      underWay: null,
      rest: null,
    });
    const written = await venue.db
      .select()
      .from(refunds)
      .where(eq(refunds.saleId, saleId))
      .orderBy(asc(refunds.appliedAmount), asc(refunds.tipAmount));
    const moved = written.map((row) => ({
      tenderId: row.tenderId,
      applied: row.appliedAmount,
      tip: row.tipAmount,
      state: row.state,
    }));
    expect(moved).toEqual(
      expect.arrayContaining([
        { tenderId: firstCash, applied: 1000, tip: 0, state: "completed" },
        { tenderId: secondCash, applied: 850, tip: 0, state: "completed" },
        { tenderId: firstCash, applied: 0, tip: 100, state: "completed" },
        { tenderId: secondCash, applied: 0, tip: 150, state: "completed" },
      ]),
    );
    expect(moved).toHaveLength(4);
    const parts = (first.json as { parts: { refundId: string }[] }).parts;
    const tenderOfRefund = (id: string) => written.find((row) => row.id === id)!.tenderId;
    expect(parts.map((part) => tenderOfRefund(part.refundId))).toEqual([firstCash, firstCash]);
    const links = await venue.db.all<{ refund_id: string; adjustment_id: string; amount: number }>(
      sql`select refund_id, adjustment_id, amount from adjustment_refunds where adjustment_id = ${cancelId}`,
    );
    expect(links.reduce((sum, link) => sum + link.amount, 0)).toBe(1850);
    for (const row of written.filter((refund) => refund.appliedAmount > 0))
      expect(links.find((link) => link.refund_id === row.id)?.amount).toBe(row.appliedAmount);
    expect(lineOf(await read(saleId), "Paella").cancelled).toMatchObject({
      owed: "0.00",
      back: "18.50",
    });
    const after = effects();
    expect(after).toEqual({
      ...before,
      refunds: before.refunds + 4,
      drawerJobs: before.drawerJobs + 1,
      drawerOpens: before.drawerOpens + 1,
      drawerCents: before.drawerCents - 2100,
    });
    expect(await give(saleId, body)).toEqual(first);
    expect(effects()).toEqual(after);
  });
});

/** A till cookie for `personId` on the first till. */
async function tillCookieFor(personId: string, pin: string): Promise<string> {
  const session = await inTx(venue, (tx) =>
    loginWithPin(tx, { deviceId: venue.deviceId, personId, pin }),
  );
  return `${SESSION_COOKIE}=${session.token}; ${deviceProofOf(venue.cookie)}`;
}

/** A new person holding only `permissions`, PIN `pin`, and their cookie on the first till. */
async function signedInHolding(permissions: string[], pin: string) {
  const personId = await personHolding(venue.db, permissions, { pinHash: fixturePinHash(pin) });
  return { personId, cookie: await tillCookieFor(personId, pin) };
}

/** The ids `withPinCheckAhead` was handed a PIN for while `run` ran. */
async function pinsCheckedDuring<T>(run: () => Promise<T>): Promise<{ answer: T; pins: string[] }> {
  pinChecks.credentials.length = 0;
  const answer = await run();
  const pins = pinChecks.credentials
    .filter((credential) => credential !== undefined)
    .map((credential) => (credential as { personId: string }).personId);
  return { answer, pins };
}

async function refundRowsOf(saleId: string) {
  return venue.db
    .select()
    .from(refunds)
    .where(eq(refunds.saleId, saleId))
    .orderBy(asc(refunds.createdAt), asc(refunds.appliedAmount));
}

describe("POST …/give-back on a separate terminal", () => {
  it("records the goodwill refunded on the terminal, then files the corrective after commit (5.3)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ card: "34.00" }]);
    const card = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: card }));
    expect(body.expected).toEqual([
      { kind: "correction", amount: "10.00", way: card, lineIds: [] },
    ]);
    const before = effects();
    automaticFiling.asked.length = 0;
    const answer = await give(saleId, { ...body, manualConfirmed: true, override: supervisor() });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [{ kind: "correction", amount: "10.00", state: "completed" }],
      refusal: null,
      underWay: null,
      rest: null,
    });
    const correctionId = (answer.json as { parts: { correctionId: string }[] }).parts[0]!
      .correctionId;
    expect(automaticFiling.asked).toEqual([correctionId]);
    const [correction] = await venue.db
      .select()
      .from(invoiceCorrections)
      .where(eq(invoiceCorrections.id, correctionId));
    expect(correction).toMatchObject({ state: "filed", gross: 1000 });
    expect(correction!.correctiveSaleId).not.toBeNull();
    const [leg] = await refundRowsOf(saleId);
    expect(leg).toMatchObject({
      tenderId: card,
      appliedAmount: 1000,
      tipAmount: 0,
      manual: true,
      state: "completed",
      authorizedBy: venue.adminId,
    });
    expect(effects()).toEqual({
      ...before,
      refunds: before.refunds + 1,
      corrections: before.corrections + 1,
      sales: before.sales + 1,
    });
  });

  it("keeps the terminal's refund completed and the correction under way when filing it after commit is refused (case 11)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ card: "34.00" }]);
    const card = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: card }));
    const before = effects();
    automaticFiling.refuse = true;
    onTestFinished(() => {
      automaticFiling.refuse = false;
    });
    const logged: unknown[][] = [];
    const answer = await give(
      saleId,
      { ...body, manualConfirmed: true, override: supervisor() },
      adminCookie,
      venue.appWith({ log: (...line: unknown[]) => void logged.push(line) }),
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [{ kind: "correction", amount: "10.00", state: "pending" }],
      refusal: null,
      underWay: { state: "open", gross: "10.00", moneyBack: "10.00", left: "0.00" },
      rest: null,
    });
    expect(logged).toContainEqual([
      "error",
      "invoice_correction.automatic_filing_failed",
      expect.objectContaining({
        correctionId: (answer.json as { parts: { correctionId: string }[] }).parts[0]!.correctionId,
      }),
    ]);
    const [leg] = await refundRowsOf(saleId);
    expect(leg).toMatchObject({ appliedAmount: 1000, manual: true, state: "completed" });
    expect(effects()).toEqual({
      ...before,
      refunds: before.refunds + 1,
      corrections: before.corrections + 1,
    });
    expect((await read(saleId)).underWay).toMatchObject({ state: "open", moneyBack: "10.00" });
  });

  it("raises invoice_correction.filing_refused and keeps the terminal's refund completed when the filing after commit is refused (case 11)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ card: "34.00" }]);
    const card = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: card }));
    const before = effects();
    automaticFiling.chainBroken = true;
    onTestFinished(() => {
      automaticFiling.chainBroken = false;
    });
    const answer = await give(saleId, { ...body, manualConfirmed: true, override: supervisor() });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [{ kind: "correction", amount: "10.00", state: "pending" }],
      underWay: { state: "open", gross: "10.00", moneyBack: "10.00", left: "0.00" },
    });
    const correctionId = (answer.json as { parts: { correctionId: string }[] }).parts[0]!
      .correctionId;
    const raised = await venue.db
      .select({ params: incidents.params, severity: incidents.severity })
      .from(incidents)
      .where(
        and(eq(incidents.code, "invoice_correction.filing_refused"), eq(incidents.saleId, saleId)),
      );
    expect(raised).toEqual([
      {
        params: {
          correctionId,
          saleId,
          moneyBack: "10.00",
          refusal: "invoice_correction.chain_unsound",
        },
        severity: "error",
      },
    ]);
    const [leg] = await refundRowsOf(saleId);
    expect(leg).toMatchObject({ appliedAmount: 1000, manual: true, state: "completed" });
    expect(effects()).toEqual({
      ...before,
      refunds: before.refunds + 1,
      corrections: before.corrections + 1,
    });
  });

  it("writes the paella's refund and the cheesecake's leg as two completed refunds on the one capture (section 10)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ card: "34.00" }]);
    const card = await tenderOf(saleId, "card");
    const cancelId = await cancel(b, "Paella", "1", true);
    const view = await read(saleId);
    const ticked = [lineOf(view, "Paella").id, lineOf(view, "Cheesecake").id];
    const body = await giveBody(saleId, ask("dishes", "24.50", { lineIds: ticked, way: card }));
    const before = effects();
    const answer = await give(saleId, { ...body, manualConfirmed: true, override: supervisor() });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "refund", amount: "18.50", state: "completed" },
        { kind: "correction", state: "completed" },
      ],
      refusal: null,
      underWay: null,
    });
    const written = await refundRowsOf(saleId);
    expect(written.map((row) => [row.tenderId, row.manual, row.state])).toEqual([
      [card, true, "completed"],
      [card, true, "completed"],
    ]);
    expect(written.reduce((sum, row) => sum + row.appliedAmount, 0)).toBe(2450);
    const links = await venue.db.all<{ adjustment_id: string; amount: number }>(
      sql`select adjustment_id, amount from adjustment_refunds where refund_id = ${(answer.json as { parts: { refundId: string }[] }).parts[0]!.refundId}`,
    );
    expect(links).toEqual([{ adjustment_id: cancelId, amount: 1850 }]);
    expect(effects()).toEqual({
      ...before,
      refunds: before.refunds + 2,
      corrections: before.corrections + 1,
      sales: before.sales + 1,
    });
  });

  it("refuses a give-back the terminal's refund was not confirmed for, writing nothing", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ card: "34.00" }]);
    const card = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: card }));
    const before = effects();
    const answer = await give(saleId, { ...body, override: supervisor() });
    expectRefusedUnwritten(answer, "management.request_invalid", before);
    expect(answer.json).toEqual({
      code: "management.request_invalid",
      params: { field: "manualConfirmed" },
    });
  });

  it("refuses a profile that may not take hand-keyed cards, writing nothing", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ card: "34.00" }]);
    const card = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: card }));
    const cashOnly = await ownTill(["take-orders", "open-cash-drawer", "take-cash"]);
    const before = effects();
    const answer = await give(
      saleId,
      { ...body, manualConfirmed: true, override: supervisor() },
      cashOnly.cookie,
    );
    expectRefusedUnwritten(answer, "device.forbidden_action", before);
    expect(answer.status).toBe(403);
  });

  it("asks a fresh PIN even of a person holding both rights, writing nothing without one", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ card: "34.00" }]);
    const card = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: card }));
    const before = effects();
    expectRefusedUnwritten(
      await give(saleId, { ...body, manualConfirmed: true }),
      "tender.manual_refund_pin_required",
      before,
    );
  });
});

describe("POST …/give-back: one PIN for the rights it needs (5.4)", () => {
  it("refuses a person holding only refund rights, naming sale.rectify; a supervisor holding both lets it through, the PIN checked once", async () => {
    const refunder = await signedInHolding(["sale.refund"], "2468");
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const body = await giveBody(saleId, ask("goodwill", "10.00"));
    const before = effects();
    const refusedAnswer = await give(saleId, body, refunder.cookie);
    expectRefusedUnwritten(refusedAnswer, "authorization.not_permitted", before);
    expect(refusedAnswer.json).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "sale.rectify" },
    });
    const { answer, pins } = await pinsCheckedDuring(() =>
      give(saleId, { ...body, override: supervisor() }, refunder.cookie),
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(pins).toEqual([venue.adminId]);
    const correctionId = (answer.json as { parts: { correctionId: string }[] }).parts[0]!
      .correctionId;
    const [correction] = await venue.db
      .select()
      .from(invoiceCorrections)
      .where(eq(invoiceCorrections.id, correctionId));
    expect(correction).toMatchObject({
      state: "filed",
      authorizedBy: venue.adminId,
      viaOverride: true,
    });
    const [leg] = await refundRowsOf(saleId);
    expect(leg).toMatchObject({ state: "completed", authorizedBy: refunder.personId });
  });

  it("refuses a supervisor whose PIN holds only sale.refund, writing nothing", async () => {
    const refunder = await signedInHolding(["sale.refund"], "1357");
    const approver = await personHolding(venue.db, ["sale.refund"], {
      pinHash: fixturePinHash("9753"),
    });
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const body = await giveBody(saleId, ask("goodwill", "10.00"));
    const before = effects();
    const answer = await give(
      saleId,
      { ...body, override: { personId: approver, pin: "9753" } },
      refunder.cookie,
    );
    expectRefusedUnwritten(answer, "authorization.not_permitted", before);
    expect(answer.json).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "sale.rectify" },
    });
  });
});

describe("POST …/give-back: a cancel's approval covers its money only from the filled window (D9)", () => {
  it("gives the cancelled paella back for a person holding neither right, with no PIN, recording the cancel's approver; a resend without fromCancel is refused", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const cancelId = await cancel(b, "Paella", "1", true);
    const [cancelRow] = await venue.db
      .select()
      .from(adjustments)
      .where(eq(adjustments.id, cancelId));
    const approver = cancelRow!.approvedBy ?? cancelRow!.requestedBy;
    const paella = [lineOf(await read(saleId), "Paella").id];
    const body = await giveBody(
      saleId,
      ask("dishes", "18.50", { lineIds: paella, fromCancel: [cancelId] }),
    );
    const { answer, pins } = await pinsCheckedDuring(() => give(saleId, body, venue.cookie));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(pins).toEqual([]);
    const [refund] = await refundRowsOf(saleId);
    expect(refund).toMatchObject({
      appliedAmount: 1850,
      state: "completed",
      authorizedBy: approver,
      requestedBy: venue.operatorId,
    });
    const after = effects();
    expect(await give(saleId, body, venue.cookie)).toEqual(answer);
    const withoutCancel = { ...body } as Record<string, unknown>;
    delete withoutCancel.fromCancel;
    const resent = await give(saleId, withoutCancel, venue.cookie);
    expectRefusedUnwritten(resent, "authorization.not_permitted", after);
    expect(resent.json).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "sale.refund" },
    });
  });

  it("asks refund rights for the same cancelled paella without fromCancel, writing nothing", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    await cancel(b, "Paella", "1", true);
    const paella = [lineOf(await read(saleId), "Paella").id];
    const body = await giveBody(saleId, ask("dishes", "18.50", { lineIds: paella }));
    const before = effects();
    const answer = await give(saleId, body, venue.cookie);
    expectRefusedUnwritten(answer, "authorization.not_permitted", before);
    expect(answer.json).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "sale.refund" },
    });
  });

  it("asks only sale.rectify of a correction with no cash share beside a covered refund, as the preview names, on the first send and a resend", async () => {
    const corrector = await signedInHolding(["sale.rectify"], "8642");
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "18.50" }, { card: "15.50" }]);
    const cancelId = await cancel(b, "Paella", "1", true);
    const view = await read(saleId);
    const ticked = [lineOf(view, "Paella").id, lineOf(view, "Cheesecake").id];
    const request = ask("dishes", "25.00", { lineIds: ticked, fromCancel: [cancelId] });
    const previewed = await send(
      venue.app,
      corrector.cookie,
      "POST",
      `/api/transactions/${saleId}/give-back/preview`,
      request,
    );
    expect(previewed.json).toMatchObject({ needs: [], leftUnderWay: "6.50" });
    const body = await giveBody(saleId, request);
    const before = effects();
    const answer = await give(saleId, body, corrector.cookie);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "refund", amount: "18.50", state: "completed" },
        { kind: "correction", amount: "6.50", state: "pending" },
      ],
      underWay: { state: "open", gross: "6.50", moneyBack: "0.00", left: "6.50" },
    });
    expect(effects()).toMatchObject({
      refunds: before.refunds + 1,
      corrections: before.corrections + 1,
    });
    expect(await give(saleId, body, corrector.cookie)).toEqual(answer);
  });
});

/** A till of its own whose profile allows `capabilities`, the administrator signed in on it;
 * `zoned`, it serves only a zone where no test sells. */
async function ownTill(capabilities: ProfileAction[], { zoned = false } = {}) {
  const profileId = await inTx(venue, async (tx) => {
    const [profile] = await seedDeviceProfiles(tx, {
      name: `Own till ${randomUUID()}`,
      formFactor: "till",
      capabilities,
    });
    if (zoned) {
      const department = await createDepartment(tx, {
        name: `Interior ${randomUUID()}`,
        orderStart: "table",
      });
      const zone = await createServiceZone(tx, {
        name: `Interior ${randomUUID()}`,
        departmentId: department.id,
      });
      const [policy] = await tx
        .select({ departmentId: floorZones.departmentId })
        .from(floorZones)
        .where(eq(floorZones.id, zone.id));
      await setProfileServiceAccess(tx, profile!.id, {
        departmentId: policy!.departmentId,
        allowedZoneIds: [zone.id],
        startingZoneId: zone.id,
      });
    }
    return profile!.id;
  });
  const device = await enrolDeviceForTest(venue.db, venue.cfg, {
    name: `Own till ${randomUUID().slice(0, 8)}`,
    profileId,
  });
  const session = await inTx(venue, (tx) =>
    loginWithPin(tx, { deviceId: device.deviceId, personId: venue.adminId, pin: "1234" }),
  );
  return {
    deviceId: device.deviceId,
    cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
  };
}

describe("POST …/give-back: the devices Refund a payment refuses", () => {
  const cashTill: ProfileAction[] = ["take-orders", "open-cash-drawer", "take-cash"];

  it("refuses a profile that takes no cash, a till outside the receipt's zone and a kitchen screen, writing nothing", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    const body = await giveBody(saleId, ask("goodwill", "10.00"));
    const noCash = await ownTill(["take-orders", "hand-keyed-card-payment"]);
    const zoned = await ownTill(cashTill, { zoned: true });
    const kitchen = await ownTill(cashTill);
    const [screen] = await seedDeviceProfiles(venue.db, {
      name: `Kitchen ${randomUUID()}`,
      formFactor: "kds",
      capabilities: cashTill,
    });
    await venue.db
      .update(devices)
      .set({ deviceProfileId: screen!.id })
      .where(eq(devices.id, kitchen.deviceId));
    const before = effects();
    const answers = [
      await give(saleId, body, noCash.cookie),
      await give(saleId, body, zoned.cookie),
      await give(saleId, body, kitchen.cookie),
    ];
    expect(
      answers.map((answer) => [answer.status, (answer.json as { code: string }).code]),
    ).toEqual([
      [403, "device.cash_not_allowed"],
      [403, "service_zone.not_allowed"],
      [401, "session.required"],
    ]);
    expect(effects()).toEqual(before);
    expect((await give(saleId, body, (await ownTill(cashTill)).cookie)).status).toBe(200);
  });
});

/** The card company's refund calls and lookups since `start`, as amounts and refund ids. */
function cardCallsSince(start: { refunds: number; lookups: number }) {
  return {
    refunds: venue.card.refundCalls.slice(start.refunds).map((call) => String(call.amount)),
    lookups: venue.card.lookupCalls.length - start.lookups,
  };
}
const cardCallsNow = () => ({
  refunds: venue.card.refundCalls.length,
  lookups: venue.card.lookupCalls.length,
});

async function correctionsOn(saleId: string) {
  return venue.db
    .select()
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.originalSaleId, saleId));
}

describe("POST …/give-back on a card reader", () => {
  it("refuses a profile that may not take reader cards, writing nothing, and sends once it may", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }]);
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: reader }));
    const noReader = await ownTill(["take-orders", "open-cash-drawer", "take-cash"]);
    const calls = cardCallsNow();
    const before = effects();
    const answer = await give(saleId, body, noReader.cookie);
    expectRefusedUnwritten(answer, "device.forbidden_action", before);
    expect([answer.status, answer.json]).toEqual([
      403,
      { code: "device.forbidden_action", params: { action: "pay" } },
    ]);
    expect(cardCallsSince(calls).refunds).toEqual([]);
    const allowed = await ownTill(["take-orders", "integrated-card-payment"]);
    expect((await give(saleId, body, allowed.cookie)).status).toBe(200);
  });

  it("sends the extra, then the goodwill's leg, each completing before the next, and files the corrective", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }], "3.00");
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00", way: reader }));
    expect(body.expected).toEqual([
      { kind: "extra", amount: "3.00", way: reader },
      { kind: "correction", amount: "10.00", way: reader, lineIds: [] },
    ]);
    const calls = cardCallsNow();
    const before = effects();
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "extra", amount: "3.00", state: "completed" },
        { kind: "correction", amount: "10.00", state: "completed" },
      ],
      refusal: null,
      underWay: null,
      rest: null,
    });
    expect(cardCallsSince(calls).refunds).toEqual(["3.00", "10.00"]);
    const [extra, leg] = await refundRowsOf(saleId);
    expect(extra).toMatchObject({ tenderId: reader, appliedAmount: 0, tipAmount: 300 });
    expect(leg).toMatchObject({ tenderId: reader, appliedAmount: 1000, tipAmount: 0 });
    expect([extra!.state, leg!.state]).toEqual(["completed", "completed"]);
    const [correction] = await correctionsOn(saleId);
    expect(correction).toMatchObject({ state: "filed", gross: 1000 });
    expect(correction!.correctiveSaleId).not.toBeNull();
    expect(effects()).toEqual({
      ...before,
      refunds: before.refunds + 2,
      corrections: before.corrections + 1,
      sales: before.sales + 1,
    });
  });

  it("stops at an extra the card company leaves pending, opens no correction, and the rest sent with fresh ids once it completes finishes", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }], "3.00");
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00", way: reader }));
    venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
    const calls = cardCallsNow();
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "extra", amount: "3.00", state: "pending" },
        { kind: "correction", amount: "10.00", state: "not_started" },
      ],
      refusal: null,
      underWay: null,
      rest: { purpose: "goodwill", amount: "10.00", extra: "0.00", way: reader },
    });
    expect(cardCallsSince(calls).refunds).toEqual(["3.00"]);
    expect(await correctionsOn(saleId)).toEqual([]);

    const extraId = (answer.json as { parts: { refundId: string }[] }).parts[0]!.refundId;
    const retried = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/tender-refunds/${extraId}/retry`,
      {},
    );
    expect(retried.json, JSON.stringify(retried.json)).toMatchObject({ state: "completed" });

    const rest = (answer.json as { rest: GiveBackRequest }).rest;
    const finished = await give(saleId, await giveBody(saleId, rest));
    expect(finished.status, JSON.stringify(finished.json)).toBe(200);
    expect(finished.json).toMatchObject({
      parts: [{ kind: "correction", amount: "10.00", state: "completed" }],
      refusal: null,
      rest: null,
    });
    expect(await correctionsOn(saleId)).toEqual([
      expect.objectContaining({ state: "filed", gross: 1000 }),
    ]);
  });

  it("discards the correction when the card company declines its leg, leaving nothing open, and says why (I5)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }]);
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: reader }));
    venue.card.scriptNextRefund({ made: "failed", answer: "made" });
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const [leg] = await refundRowsOf(saleId);
    expect(leg).toMatchObject({ tenderId: reader, appliedAmount: 1000, state: "failed" });
    expect(answer.json).toMatchObject({
      parts: [{ kind: "correction", amount: "10.00", state: "failed" }],
      refusal: {
        code: "give_back.refund_failed",
        params: { refundId: leg!.id, tenderId: reader },
      },
      underWay: null,
      rest: null,
    });
    expect(await correctionsOn(saleId)).toEqual([
      expect.objectContaining({ state: "discarded", correctiveSaleId: null }),
    ]);
    const view = await read(saleId);
    expect(view.underWay).toBeNull();
    expect(view.choices.goodwill).toEqual({ available: true, reason: null });
  });

  it("keeps the extra given back when the box's time stops being confirmed before the leg, and refuses the rest with clock.unconfirmed", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }], "3.00");
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00", way: reader }));
    // As clock-unconfirmed-gate.test.ts stages it: the wait begins once the card company has
    // answered; here it begins only once that answer is recorded, before the next part.
    const extraDone = () =>
      venue.db.all<{ n: number }>(
        sql`select count(*) as n from refunds where submission_id = ${body.submissionIds.extra} and state = 'completed'`,
      )[0]!.n > 0;
    const holds = () => extraDone();
    const gated = venue.appWith({
      backend: gateSeatOnStartClock(venue.backend, holds),
      clockUnconfirmed: holds,
    });
    const calls = cardCallsNow();
    const answer = await give(saleId, body, adminCookie, gated);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "extra", amount: "3.00", state: "completed" },
        { kind: "correction", amount: "10.00", state: "not_started" },
      ],
      refusal: { code: "clock.unconfirmed", params: {} },
      underWay: null,
      rest: { purpose: "goodwill", amount: "10.00", extra: "0.00", way: reader },
    });
    expect(cardCallsSince(calls).refunds).toEqual(["3.00"]);
    expect(await correctionsOn(saleId)).toEqual([]);
    expect((await refundRowsOf(saleId)).map((row) => row.state)).toEqual(["completed"]);
  });

  it("answers a resend while the first part is pending with its state, sending and looking up nothing (I1)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }], "3.00");
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00", way: reader }));
    venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
    const first = await give(saleId, body);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json).toMatchObject({ parts: [{ state: "pending" }, { state: "not_started" }] });
    const calls = cardCallsNow();
    const after = effects();
    expect(await give(saleId, body)).toEqual(first);
    expect(cardCallsSince(calls)).toEqual({ refunds: [], lookups: 0 });
    expect(effects()).toEqual(after);
    expect(await correctionsOn(saleId)).toEqual([]);
    expect((await refundRowsOf(saleId)).map((row) => row.state)).toEqual(["pending"]);
  });
});

describe("POST …/give-back on a card reader: fix round 1", () => {
  it("answers a resend while the first send is still running with no rest, so nothing goes back twice", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }], "3.00");
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00", way: reader }));
    const calls = cardCallsNow();
    const release = venue.card.holdNextRefund();
    const first = give(saleId, body);
    await vi.waitFor(() => expect(venue.card.refundCalls.length).toBe(calls.refunds + 1));
    const resent = await give(saleId, body);
    expect(resent.status, JSON.stringify(resent.json)).toBe(200);
    expect(resent.json).toMatchObject({
      parts: [{ state: "pending" }, { state: "not_started" }],
      rest: null,
    });
    release();
    expect((await first).json).toMatchObject({
      parts: [{ state: "completed" }, { state: "completed" }],
      rest: null,
    });
    const rest = (resent.json as { rest: GiveBackRequest | null }).rest;
    if (rest !== null) await give(saleId, await giveBody(saleId, rest));
    expect(cardCallsSince(calls).refunds).toEqual(["3.00", "10.00"]);
    expect((await correctionsOn(saleId)).map((row) => [row.state, row.gross])).toEqual([
      ["filed", 1000],
    ]);
  });

  it("refuses submission.id_reused when another request reuses a reader press's ids, writing nothing", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }], "3.00");
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("extra", "3.00", { way: reader }));
    const first = await give(saleId, body);
    expect(first.json).toMatchObject({ parts: [{ kind: "extra", state: "completed" }] });
    const before = effects();
    expectRefusedUnwritten(
      await give(saleId, {
        ...body,
        purpose: "goodwill",
        amount: "10.00",
        extra: "3.00",
        expected: [
          { kind: "extra", amount: "3.00", way: reader },
          { kind: "correction", amount: "10.00", way: reader, lineIds: [] },
        ],
      }),
      "submission.id_reused",
      before,
    );
  });

  it("checks the person's rights again for each part: removed after the extra, the leg is refused and the extra stays back", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }], "3.00");
    const reader = await tenderOf(saleId, "card");
    const refunder = await signedInHolding(["sale.refund", "sale.rectify"], "9753");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00", way: reader }));
    const answerOf = venue.card.sendRefund.bind(venue.card);
    const spy = vi.spyOn(venue.card, "sendRefund").mockImplementationOnce(async (query) => {
      const answered = await answerOf(query);
      await confineTo(venue.db, refunder.personId, []);
      return answered;
    });
    onTestFinished(() => spy.mockRestore());
    const answer = await give(saleId, body, refunder.cookie);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "extra", state: "completed" },
        { kind: "correction", state: "not_started" },
      ],
      refusal: { code: "authorization.not_permitted", params: { permission: "sale.rectify" } },
    });
    expect(await correctionsOn(saleId)).toEqual([]);
    expect((await refundRowsOf(saleId)).map((row) => row.state)).toEqual(["completed"]);
  });

  it("answers the outcome, the correction under way, when discarding it after a declined leg is refused", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }], "3.00");
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00", way: reader }));
    venue.card.scriptNextRefund({ made: "completed", answer: "made" });
    venue.card.scriptNextRefund({ made: "failed", answer: "made" });
    discardFault.armed = true;
    onTestFinished(() => {
      discardFault.armed = false;
    });
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "extra", state: "completed" },
        { kind: "correction", state: "pending" },
      ],
      refusal: { code: "give_back.refund_failed" },
      underWay: { state: "open", gross: "10.00" },
      rest: null,
    });
    expect(discardFault.armed).toBe(false);
  });

  it("gives a cancelled dish's money and then corrects a served dish, stopping with the correction as rest while the first is pending", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }]);
    const reader = await tenderOf(saleId, "card");
    const cancelId = await cancel(b, "Paella", "1", true);
    const view = await read(saleId);
    const ticked = [lineOf(view, "Paella").id, lineOf(view, "Cheesecake").id];
    const body = await giveBody(saleId, ask("dishes", "24.50", { lineIds: ticked, way: reader }));
    expect(body.expected).toEqual([
      { kind: "refund", amount: "18.50", way: reader, cancellationIds: [cancelId] },
      { kind: "correction", amount: "6.00", way: reader, lineIds: [ticked[1]] },
    ]);
    venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
    const calls = cardCallsNow();
    const answer = await give(saleId, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      parts: [
        { kind: "refund", amount: "18.50", state: "pending" },
        { kind: "correction", amount: "6.00", state: "not_started" },
      ],
      refusal: null,
      rest: { purpose: "dishes", lineIds: ticked, amount: "6.00", extra: "0.00", way: reader },
    });
    expect(cardCallsSince(calls).refunds).toEqual(["18.50"]);
    const refundId = (answer.json as { parts: { refundId: string }[] }).parts[0]!.refundId;
    const retried = await send(
      venue.app,
      adminCookie,
      "POST",
      `/api/tender-refunds/${refundId}/retry`,
      {},
    );
    expect(retried.json).toMatchObject({ state: "completed" });
    const rest = (answer.json as { rest: GiveBackRequest }).rest;
    const finished = await give(saleId, await giveBody(saleId, rest));
    expect(finished.json).toMatchObject({
      parts: [{ kind: "correction", amount: "6.00", state: "completed" }],
      rest: null,
    });
    expect(cardCallsSince(calls).refunds).toEqual(["18.50", "18.50", "6.00"]);
  });
});

describe("POST …/give-back on a card reader: fix round 2", () => {
  it("refuses submission.id_reused when a reader press holding only a correction is resent as a cash press, writing nothing (P3)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "20.00" }, { cash: "14.00" }]);
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { way: reader }));
    expect(body.expected).toEqual([
      { kind: "correction", amount: "10.00", way: reader, lineIds: [] },
    ]);
    const first = await give(saleId, body);
    expect(first.json).toMatchObject({ parts: [{ kind: "correction", state: "completed" }] });
    const before = effects();
    expectRefusedUnwritten(
      await give(saleId, {
        ...body,
        way: "cash",
        expected: [{ kind: "correction", amount: "10.00", way: "cash", lineIds: [] }],
      }),
      "submission.id_reused",
      before,
    );
  });

  it("gives each part back once when the same press is sent twice at once (P5)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }], "3.00");
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "10.00", { extra: "3.00", way: reader }));
    const calls = cardCallsNow();
    const release = venue.card.holdNextRefund();
    const both = Promise.all([give(saleId, body), give(saleId, body)]);
    await vi.waitFor(() => expect(venue.card.refundCalls.length).toBe(calls.refunds + 1));
    release();
    const answers = await both;
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    for (const answer of answers) {
      const rest = (answer.json as { rest: GiveBackRequest | null }).rest;
      if (rest !== null) await give(saleId, await giveBody(saleId, rest));
    }
    expect(cardCallsSince(calls).refunds).toEqual(["3.00", "10.00"]);
    expect((await correctionsOn(saleId)).map((row) => [row.state, row.gross])).toEqual([
      ["filed", 1000],
    ]);
  });

  it("leaves a goodwill refund that pays an unnamed cancel needing sale.refund on its retry (P6)", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ reader: "34.00" }]);
    await cancel(b, "Paella", "1", true);
    const reader = await tenderOf(saleId, "card");
    const body = await giveBody(saleId, ask("goodwill", "20.00", { way: reader }));
    expect(body.expected).toEqual([
      { kind: "refund", amount: "18.50", way: reader },
      { kind: "correction", amount: "1.50", way: reader, lineIds: [] },
    ]);
    venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
    const answer = await give(saleId, body);
    expect(answer.json).toMatchObject({ parts: [{ state: "pending" }, { state: "not_started" }] });
    const refundId = (answer.json as { parts: { refundId: string }[] }).parts[0]!.refundId;
    const clerk = await signedInHolding([], "4826");
    const retried = await send(
      venue.app,
      clerk.cookie,
      "POST",
      `/api/tender-refunds/${refundId}/retry`,
      {},
    );
    expect(retried).toEqual({
      status: 403,
      json: { code: "authorization.not_permitted", params: { permission: "sale.refund" } },
    });
  });
});

describe("POST …/give-back: resends checked against the press's own fields", () => {
  it("refuses submission.id_reused when a resend names a cancel the stored refund is not linked to, writing nothing", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }]);
    await cancel(b, "Paella", "1", true);
    const otherCancel = await cancel(b, "Croquetas", "1", true);
    const paella = [lineOf(await read(saleId), "Paella").id];
    const body = await giveBody(saleId, ask("dishes", "18.50", { lineIds: paella }));
    const first = await give(saleId, body);
    expect(first.json).toMatchObject({ parts: [{ kind: "refund", state: "completed" }] });
    const before = effects();
    expectRefusedUnwritten(
      await give(saleId, { ...body, fromCancel: [otherCancel] }),
      "submission.id_reused",
      before,
    );
  });

  it("answers a cash extra-only resend as its first send, writing nothing, and refuses its ids reused for goodwill plus the extra", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ cash: "34.00" }], "3.00");
    const body = await giveBody(saleId, ask("extra", "3.00"));
    const first = await give(saleId, body);
    expect(first.json).toMatchObject({ parts: [{ kind: "extra", state: "completed" }] });
    const after = effects();
    expect(await give(saleId, body)).toEqual(first);
    expect(effects()).toEqual(after);
    expectRefusedUnwritten(
      await give(saleId, {
        ...body,
        purpose: "goodwill",
        amount: "10.00",
        extra: "3.00",
        expected: [
          { kind: "extra", amount: "3.00", way: "cash" },
          { kind: "correction", amount: "10.00", way: "cash", lineIds: [] },
        ],
      }),
      "submission.id_reused",
      after,
    );
  });

  it("answers an extra-only resend on a separate terminal as its first send, writing nothing", async () => {
    const b = await tab(FIVE);
    const saleId = await pay(b, [{ card: "34.00" }], "3.00");
    const card = await tenderOf(saleId, "card");
    const body = {
      ...(await giveBody(saleId, ask("extra", "3.00", { way: card }))),
      manualConfirmed: true,
      override: supervisor(),
    };
    const first = await give(saleId, body);
    expect(first.json).toMatchObject({ parts: [{ kind: "extra", state: "completed" }] });
    const after = effects();
    expect(await give(saleId, body)).toEqual(first);
    expect(effects()).toEqual(after);
  });
});
