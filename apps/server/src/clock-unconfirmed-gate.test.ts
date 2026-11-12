import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  captureError,
  deviceProfiles,
  devices,
  sales,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalBackend, SaleForFiscalRecord } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError, decimal, jobOrigin, saleId as brandSaleId } from "@waitron/shared";
import { startClockState } from "./start-clock-check.js";
import { gateSeatOnStartClock, startClockGateHolds } from "./start-clock-gate.js";
import {
  fiscalRecordCount,
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  tabWith,
  type Answer,
  type BillVenue,
} from "./testing/bill-venue.js";
import { giveAway } from "./testing/cancel-line.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";
import "./errors.js";

let venue: BillVenue;
let counter: ZoneOffers;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counter = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    // Every till profile may close by transfer, so that route's row reaches its clock check.
    await inTx(venue, async (tx) => {
      const [device] = await tx
        .select({ profileId: devices.deviceProfileId })
        .from(devices)
        .where(eq(devices.id, venue.deviceId));
      const [profile] = await tx
        .select({ capabilities: deviceProfiles.capabilities })
        .from(deviceProfiles)
        .where(eq(deviceProfiles.id, device!.profileId));
      await tx
        .update(deviceProfiles)
        .set({ capabilities: [...(profile!.capabilities as string[]), "close-by-transfer"] })
        .where(eq(deviceProfiles.id, device!.profileId));
    });
  },
});

let invoiceNumber = 9_000;

/** A sale row of its own and the record input for it: positive and simplified unless told. */
async function saleInput(
  options: { total?: string; counterparty?: SaleForFiscalRecord["counterparty"] } = {},
): Promise<SaleForFiscalRecord> {
  const id = brandSaleId(randomUUID());
  const number = invoiceNumber++;
  const issuedAt = venue.clock.now().instant;
  const negative = options.total?.startsWith("-") === true;
  await venue.db.insert(sales).values({
    id,
    ...jobOrigin("readiness_test"),
    nodeId: venue.cfg.nodeId,
    seriesId: venue.seriesId,
    invoiceNumber: number,
    issuedAt: issuedAt.toISOString(),
    issuedOffsetMinutes: 60,
    total: 0,
    vatBreakdown: [],
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
  });
  return {
    origin: jobOrigin("readiness_test"),
    nodeId: venue.cfg.nodeId,
    saleId: id,
    seriesId: venue.seriesId,
    seriesCode: "A",
    invoiceNumber: number,
    issuedAt,
    offsetMinutes: 60,
    descriptionOfOperation: "Restaurante",
    total: decimal(negative ? "-12.10" : "12.10"),
    vatBreakdown: [
      {
        rate: decimal("21.00"),
        base: decimal(negative ? "-10.00" : "10.00"),
        tax: decimal(negative ? "-2.10" : "2.10"),
      },
    ],
    counterparty: options.counterparty ?? null,
  };
}

/** A sale recorded through the ungated seat, for the writers that cite one. */
async function recordedOriginal(): Promise<SaleForFiscalRecord> {
  const original = await saleInput();
  await withTransaction(venue.db, (tx) => venue.backend.recordSale(tx, original));
  return original;
}

type Write = (seat: FiscalBackend) => Promise<unknown>;

const writers: Record<string, () => Promise<Write>> = {
  recordSale: async () => {
    const input = await saleInput();
    return (seat) => withTransaction(venue.db, (tx) => seat.recordSale(tx, input));
  },
  recordVoid: async () => {
    const original = await recordedOriginal();
    return (seat) =>
      withTransaction(venue.db, (tx) =>
        seat.recordVoid(tx, original.saleId, "Wrong charge", venue.cfg.nodeId),
      );
  },
  recordCorrection: async () => {
    const original = await recordedOriginal();
    const input = await saleInput({ total: "-12.10" });
    return (seat) =>
      withTransaction(venue.db, (tx) =>
        seat.recordCorrection(tx, input, { correctsSaleId: original.saleId }),
      );
  },
  recordSubstitution: async () => {
    const original = await recordedOriginal();
    const input = await saleInput({
      counterparty: { taxId: "B12345674", legalName: "Customer Ltd", countryCode: "ES" },
    });
    return (seat) =>
      withTransaction(venue.db, (tx) =>
        seat.recordSubstitution(tx, input, { substitutedSaleIds: [original.saleId] }),
      );
  },
};

describe.each(Object.keys(writers))("the seat's %s behind the start clock gate", (name) => {
  it("throws clock.unconfirmed while the start waits, writing no record, and writes one once confirmed", async () => {
    const write = await writers[name]!();
    const state = startClockState();
    const seat = gateSeatOnStartClock(
      venue.backend,
      startClockGateHolds(
        state,
        () => true,
        () => false,
      ),
    );
    const before = fiscalRecordCount(venue);

    const error = await captureError(() => write(seat));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "clock.unconfirmed", params: {} });
    // The table's triggers refuse every update and delete, so an unchanged count is unchanged rows.
    expect(fiscalRecordCount(venue)).toBe(before);

    state.confirm("by_person", {});
    await write(seat);

    expect(fiscalRecordCount(venue)).toBe(before + 1);
  });
});

const OVERRIDE = () => ({ personId: venue.adminId, pin: "1234" });

function productIdOf(name: string): string {
  const [row] = venue.db.all<{ id: string }>(sql`select id from products where name = ${name}`);
  return row!.id;
}

const tarta = () => [{ menuItemId: counter.offerFor(productIdOf("Tarta")), quantity: "1" }];

function rowCount(table: string, where = sql`1 = 1`): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where ${where}`,
  );
  return row!.n;
}

/** Everything a money route could write or set moving, counted or read whole. */
function moneyState() {
  return {
    records: rowCount("registros_facturacion"),
    sales: rowCount("sales"),
    tenders: rowCount("tenders"),
    payments: rowCount("payments"),
    billPayments: rowCount("bill_payments"),
    billRefunds: rowCount("bill_payment_refunds"),
    tenderRefunds: rowCount("tender_refunds"),
    providerRefunds: rowCount("payment_refunds"),
    departures: rowCount("unpaid_departures"),
    transferClosures: rowCount("transfer_closures"),
    drawerJobs: rowCount("print_jobs", sql`kind = 'drawer'`),
    printJobs: rowCount("print_jobs"),
    collects: venue.card.collectCalls.length,
    refundSends: venue.card.refundCalls.length,
    lookups: venue.card.lookupCalls.length,
    orders: venue.db.all(
      sql`select id, status, revision, payment_attempt_at from working_orders order by id`,
    ),
    parties: venue.db.all(sql`select id, state, revision from parties order by id`),
  };
}

type Counted = Exclude<keyof ReturnType<typeof moneyState>, "orders" | "parties">;

interface MoneyRoute {
  send: (app: Hono) => Promise<Answer>;
  /** What the confirmed request adds to: the control's proof that the refusal had work to stop. */
  grows: Counted[];
}

const as = (app: Hono, method: string, path: string, body?: unknown) =>
  send(app, venue.cookie, method, path, body);

function cashPart(amount: string) {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  };
}

function readerPart(amount: string) {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "card",
    entry: "reader",
    applied: amount,
    tip: "0.00",
  };
}

/** A Paella bill (35.00) with one part payment taken through the ungated routes. */
async function billPaid(body: Record<string, unknown>) {
  const billId = await tabWith(venue, "Paella");
  const paid = await as(venue.app, "POST", `/api/working-orders/${billId}/payments`, body);
  expect(paid.status).toBe(200);
  return { billId, paymentId: (paid.json.payment as { id: string }).id };
}

function billRefund(billId: string, paymentId: string) {
  const body = {
    submissionId: randomUUID(),
    appliedAmount: "5.00",
    tipAmount: "0.00",
    reason: "Overcharged",
    override: OVERRIDE(),
  };
  return (app: Hono) =>
    as(app, "POST", `/api/working-orders/${billId}/payments/${paymentId}/refunds`, body);
}

/** A Paella bill paid whole, which files its sale; answers the sale and its one tender. */
async function soldWhole(method: "cash" | "card") {
  const { billId } = await billPaid(method === "cash" ? cashPart("35.00") : readerPart("35.00"));
  const [tender] = await inTx(venue, (tx) =>
    tx
      .select({ saleId: tenders.saleId, tenderId: tenders.id })
      .from(tenders)
      .innerJoin(sales, eq(sales.id, tenders.saleId))
      .where(eq(sales.workingOrderId, billId)),
  );
  return tender!;
}

function tenderRefund(saleId: string, tenderId: string) {
  const body = {
    submissionId: randomUUID(),
    tenderId,
    appliedAmount: "5.00",
    tipAmount: "0.00",
    reason: "Overcharged",
    override: OVERRIDE(),
  };
  return (app: Hono) => as(app, "POST", `/api/transactions/${saleId}/refunds`, body);
}

/** A counter order of one Tarta, parked by the operator; filed and placed when `issued`. */
async function counterOrder(issued: boolean): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: tarta(),
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  if (issued) {
    const admitted = { ...deps, admission: testTradingAdmission() };
    await issueOrderInvoice(admitted, venue.cfg, id, venue.operatorId);
    await placeOrder(admitted, venue.cfg, id, venue.operatorId);
  }
  return id;
}

const LOST = { kind: "uncertain", reason: "timeout" } as const;

// Each row builds its own order, bill or sale through the ungated routes, so rows never share one.
const moneyRoutes: Record<string, () => Promise<MoneyRoute>> = {
  "POST /api/pay, a counter card sale with no saved order": async () => {
    const id = randomUUID();
    return {
      send: (app) => as(app, "POST", "/api/pay", { id, lines: tarta(), zoneId: counter.zoneId }),
      grows: ["collects", "payments", "sales", "records"],
    };
  },
  "POST /api/pay, a card payment of a stored open order": async () => {
    const id = await counterOrder(false);
    return {
      send: (app) => as(app, "POST", "/api/pay", { id, lines: [], zoneId: counter.zoneId }),
      grows: ["collects", "payments", "sales", "records"],
    };
  },
  "POST /api/pay, a card payment of an order whose invoice was filed": async () => {
    const id = await counterOrder(true);
    return {
      send: (app) => as(app, "POST", "/api/pay", { id, lines: [], zoneId: counter.zoneId }),
      grows: ["collects", "payments", "tenders"],
    };
  },
  "POST /api/pay, a bill that owes nothing": async () => {
    const { tabId } = await seatedWith(venue, "Caña");
    await giveAway(venue, tabId, 1);
    return {
      send: (app) => as(app, "POST", "/api/pay", { id: tabId, lines: [] }),
      grows: ["sales", "records"],
    };
  },
  "POST /api/sales, a cash sale": async () => {
    const id = randomUUID();
    return {
      send: (app) =>
        as(app, "POST", "/api/sales", {
          workingOrderId: id,
          zoneId: counter.zoneId,
          lines: tarta(),
          tender: { method: "cash", amount: "18.00" },
        }),
      grows: ["sales", "tenders", "records", "drawerJobs"],
    };
  },
  "POST /api/working-orders/:id/collect, cash for a filed order": async () => {
    const id = await counterOrder(true);
    return {
      send: (app) =>
        as(app, "POST", `/api/working-orders/${id}/collect`, {
          tender: { method: "cash", amount: "18.00" },
        }),
      grows: ["tenders", "drawerJobs"],
    };
  },
  "a bill's card part payment": async () => {
    const billId = await tabWith(venue, "Paella");
    const body = readerPart("10.00");
    return {
      send: (app) => as(app, "POST", `/api/working-orders/${billId}/payments`, body),
      grows: ["collects", "billPayments"],
    };
  },
  "a bill's cash part payment": async () => {
    const billId = await tabWith(venue, "Paella");
    const body = cashPart("10.00");
    return {
      send: (app) => as(app, "POST", `/api/working-orders/${billId}/payments`, body),
      grows: ["billPayments", "drawerJobs"],
    };
  },
  "a new cash bill refund": async () => {
    const { billId, paymentId } = await billPaid(cashPart("10.00"));
    return { send: billRefund(billId, paymentId), grows: ["billRefunds", "drawerJobs"] };
  },
  "a new connected card bill refund": async () => {
    const { billId, paymentId } = await billPaid(readerPart("10.00"));
    return { send: billRefund(billId, paymentId), grows: ["billRefunds", "refundSends"] };
  },
  "a pending connected card bill refund sent again": async () => {
    const { billId, paymentId } = await billPaid(readerPart("10.00"));
    const resend = billRefund(billId, paymentId);
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    expect((await resend(venue.app)).json).toMatchObject({ refund: { state: "pending" } });
    return { send: resend, grows: ["lookups"] };
  },
  "a new connected card tender refund": async () => {
    const { saleId, tenderId } = await soldWhole("card");
    return { send: tenderRefund(saleId, tenderId), grows: ["tenderRefunds", "refundSends"] };
  },
  "a new cash tender refund": async () => {
    const { saleId, tenderId } = await soldWhole("cash");
    return { send: tenderRefund(saleId, tenderId), grows: ["tenderRefunds", "drawerJobs"] };
  },
  "a pending connected card tender refund sent again": async () => {
    const { saleId, tenderId } = await soldWhole("card");
    const resend = tenderRefund(saleId, tenderId);
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    expect((await resend(venue.app)).json).toMatchObject({ state: "pending" });
    return { send: resend, grows: ["lookups"] };
  },
  "the retry of a pending tender refund": async () => {
    const { saleId, tenderId } = await soldWhole("card");
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    const asked = await tenderRefund(saleId, tenderId)(venue.app);
    expect(asked.json).toMatchObject({ state: "pending" });
    const refundId = asked.json.id as string;
    return {
      send: (app) =>
        as(app, "POST", `/api/tender-refunds/${refundId}/retry`, { override: OVERRIDE() }),
      grows: ["lookups"],
    };
  },
  "an unpaid departure": async () => {
    const { partyId } = await seatedWith(venue, "Red wine bottle");
    const [party] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${partyId}`,
    );
    const body = {
      expectedPartyRevision: party!.revision,
      reason: "Left without paying",
      override: OVERRIDE(),
    };
    return {
      send: (app) => as(app, "POST", `/api/parties/${partyId}/unpaid-departure`, body),
      grows: ["departures", "records"],
    };
  },
  "a close by bank transfer": async () => {
    const id = await counterOrder(false);
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision, invoiceType: workingOrders.invoiceType })
        .from(workingOrders)
        .where(eq(workingOrders.id, id)),
    );
    const body = {
      submissionId: randomUUID(),
      expectedRevision: order!.revision,
      expectedEdit: null,
      expectedTotal: "18.00",
      invoiceType: order!.invoiceType,
      recipient: null,
      receiptLanguage: venue.cfg.locale,
      delivery: null,
      partyFinish: null,
    };
    return {
      send: (app) => as(app, "POST", `/api/working-orders/${id}/close-by-transfer`, body),
      grows: ["transferClosures", "records"],
    };
  },
};

describe("the till's money routes behind the start clock gate", () => {
  it.each(Object.keys(moneyRoutes))(
    "%s: refuses clock.unconfirmed while the start waits, moving and writing nothing, and is served once confirmed",
    async (name) => {
      const route = await moneyRoutes[name]!();
      const state = startClockState();
      const app = venue.appWith({
        backend: gateSeatOnStartClock(
          venue.backend,
          startClockGateHolds(
            state,
            () => true,
            () => false,
          ),
        ),
      });
      const before = moneyState();

      const refused = await route.send(app);

      expect(refused.status).toBe(409);
      expect(refused.json).toEqual({ code: "clock.unconfirmed", params: {} });
      expect(moneyState()).toEqual(before);

      state.confirm("by_person", {});
      const served = await route.send(app);

      expect(served.status).toBe(200);
      const after = moneyState();
      for (const counted of route.grows)
        expect(after[counted], counted).toBeGreaterThan(before[counted]);
    },
  );
});
