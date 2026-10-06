import crypto, { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  devices,
  billPaymentLines,
  billPaymentRefunds,
  billPayments,
  BILL_PAYMENT_CHANGE_REFUSAL,
  captureError,
  printJobs,
  saleSettlements,
  sales,
  invoiceSeries,
  locations,
  tenders,
  tenants,
  triggerRaised,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, loginWithPin, persons } from "@waitron/identity";
import { payments, SimulatorPaymentProvider } from "@waitron/payments";
import { createPrinter, MAX_DELIVERY_ATTEMPTS, resendPrintJob } from "@waitron/printing";
import {
  confirmReceiptHandover,
  enqueueOriginalReceipt,
  readOriginalReceiptPrint,
} from "./receipt-print.js";
import { zoneSalePolicies } from "@waitron/venue-service";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import {
  assertBillInvariant,
  completeBillPayment,
  failBillPayment,
  issueIfFullyPaid,
  readBillBalance,
  readPaymentsByBill,
  takeBillPayment,
  takeReaderBillPayment,
  type BillPaymentRequest,
} from "./bill-payments.js";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { printSalePaymentSlip } from "./payment-slip-print.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import { createTable } from "./tables.js";
import { decodeTicket, opensDrawer } from "./testing/decode-ticket.js";
import { descendingIds } from "./testing/descending-ids.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import type { DeviceRequestConfig } from "./till-config.js";
import {
  collectOrder,
  payWorkingOrder,
  readBillTenderLines,
  readSettledTicket,
  printSaleReceipt,
  reprintSale,
} from "./till-sale.js";
import { creditWholeInvoice, readOrderInvoice } from "./cancel-credit.js";
import {
  abandonHeldOrder,
  updateHeldOrder,
  moveOrderLines,
  setOrderInvoiceChoice,
} from "./working-order.js";
import "./errors.js";
import { openPartyTab, splitPartyBill } from "./testing/serve-line.js";
import { cancelLine } from "./testing/cancel-line.js";
import { deviceRequestCfg } from "./testing/session-device.js";

// The bill payment guards at the level of the functions each route calls: the writers with no
// route of their own, the orderings a route cannot show, and the payment slip of a bill paid by
// several cards. The acceptance tests over HTTP are in `bill-payments-api.test.ts`.
const LOCALE = "es-ES";
const OPERATOR = "cccccccc-0000-4000-8000-000000000001";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provision(db);
  },
});

let backend: FiscalBackend;
let clock: TrustedClock;

interface Venue {
  cfg: DeviceRequestConfig;
  offers: ZoneOffers;
  productIds: Map<string, string>;
}
let venue: Venue;

const MENU: { name: string; customer: string; kitchen: string; price: string }[] = [
  { name: "Chuletón", customer: "Chuletón a la brasa", kitchen: "CHULETA", price: "25.00" },
  { name: "Tarta", customer: "Tarta de queso", kitchen: "TARTA", price: "18.00" },
  { name: "Caña", customer: "Caña de cerveza", kitchen: "CANA", price: "3.00" },
];

async function provision(db: typeof suite.db): Promise<Venue> {
  clock = {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("bill-payments.test: anchor() is not used");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
  });
  const provisioned = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "62000001M",
        legalName: "Pagos SL",
        taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Restaurante",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const cfg = await deviceRequestCfg(db, {
    nodeId: brandNodeId(provisioned.nodeId),
    seriesId: brandSeriesId(provisioned.seriesIds[0]!),
    locationId: brandLocationId(provisioned.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  });
  return withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const platos = await createCategory(tx, { name: "Platos" });
    const productIds = new Map<string, string>();
    for (const item of MENU) {
      const product = await createProduct(tx, {
        catalogueId: cat.id,
        categoryId: platos.id,
        name: item.name,
        customerName: { [LOCALE]: item.customer },
        kitchenName: item.kitchen,
        pricingUnit: "each",
        unitPrice: item.price,
        vatClass: "general",
      });
      productIds.set(item.name, product.id);
    }
    await assignCatalogueToLocation(tx, provisioned.locationId, cat.id);
    const printer = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      { name: "Recibos", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    await tx.run(
      sql`update devices set receipt_printer_id = ${printer.id}, payment_slip_printer_id = ${printer.id}`,
    );
    return { cfg, offers: await offerProducts(tx, cfg, { zone: "tables" }), productIds };
  });
}

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);
const fiscal = () => ({ db: suite.db, backend, clock });

function offer(name: string): string {
  return venue.offers.offerFor(venue.productIds.get(name)!);
}

async function freshTable(): Promise<string> {
  return inTx(async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.offers.zoneId,
    });
    return table.id;
  });
}

async function freshTableIn(tx: Transaction): Promise<string> {
  const table = await createTable(tx, venue.cfg, {
    label: `M-${randomUUID().slice(0, 8)}`,
    zoneId: venue.offers.zoneId,
  });
  return table.id;
}

async function tabWith(...names: string[]): Promise<string> {
  const tableId = await freshTable();
  return inTx(async (tx) => {
    const { tabId } = await openPartyTab(tx, venue.cfg, {
      tableId,
      lines: names.map((name) => ({ menuItemId: offer(name), quantity: "1" })),
    });
    return tabId;
  });
}

function cash(amount: string, over: Partial<BillPaymentRequest> = {}): BillPaymentRequest {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
    ...over,
  };
}

function take(billId: string, request: BillPaymentRequest) {
  return takeBillPayment(fiscal(), venue.cfg, billId, request, OPERATOR);
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(() => promise);
  return (error as { code?: string }).code;
}

async function statusOf(billId: string): Promise<string> {
  const [row] = await inTx((tx) =>
    tx
      .select({ status: workingOrders.status })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId)),
  );
  return row!.status;
}

/** A bill payment written directly, in the state a card on a reader leaves it (plan Part 3). */
async function insertPayment(
  billId: string,
  values: Partial<typeof billPayments.$inferInsert>,
): Promise<string> {
  const [row] = await inTx((tx) =>
    tx
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: "f",
        kind: "contribution",
        method: "card",
        applied: 1000,
        state: "pending",
        requestedBy: OPERATOR,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
        ...values,
      })
      .returning({ id: billPayments.id }),
  );
  return row!.id;
}

describe("invoice selection before reserving new bill money", () => {
  async function snapshot(billId: string) {
    return inTx(async (tx) => ({
      order: await tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
      billPayments: await tx
        .select()
        .from(billPayments)
        .where(eq(billPayments.workingOrderId, billId)),
      providerPayments: await tx.select().from(payments).where(eq(payments.workingOrderId, billId)),
      series: await tx.select().from(invoiceSeries),
      jobs: await tx.select().from(printJobs),
    }));
  }

  async function pay(
    billId: string,
    cfg: DeviceRequestConfig,
    method: "cash" | "manual" | "reader",
  ) {
    const req = cash("1.00", {
      method: method === "cash" ? "cash" : "card",
      tendered: method === "cash" ? "1.00" : undefined,
    });
    if (method === "reader") {
      return takeReaderBillPayment(
        { ...fiscal(), provider: new SimulatorPaymentProvider(suite.db) },
        cfg,
        billId,
        req,
        OPERATOR,
      );
    }
    return takeBillPayment(fiscal(), cfg, billId, req, OPERATOR);
  }

  it.each(["cash", "manual", "reader"] as const)(
    "refuses a %s reservation when this node does not own the saved invoice choice",
    async (method) => {
      const billId = await tabWith("Caña");
      const before = await snapshot(billId);
      const error = await captureError(() =>
        pay(billId, { ...venue.cfg, nodeId: brandNodeId(randomUUID()) }, method),
      );
      expect(error).toMatchObject({
        code: "working_order.not_open",
        params: { workingOrderId: billId },
      });
      expect(await snapshot(billId)).toEqual(before);
    },
  );

  it.each(["cash", "manual", "reader"] as const)(
    "accepts a %s reservation for this node's F2 bill at the ceiling",
    async (method) => {
      const billId = await tabWith("Caña");
      const result = await pay(
        billId,
        { ...venue.cfg, simplifiedInvoiceLimit: decimal("3.00") },
        method,
      );
      expect(result.payment).toMatchObject({ state: "received", applied: "1.00" });
      expect(result.invoice).toBeUndefined();
      expect(await statusOf(billId)).toBe("open");
      const saved = await snapshot(billId);
      expect(saved.billPayments).toHaveLength(1);
      expect(saved.billPayments[0]).toMatchObject({ applied: 100, state: "received" });
      expect(saved.providerPayments).toHaveLength(method === "cash" ? 0 : 1);
    },
  );

  it.each(["cash", "manual", "reader"] as const)(
    "retains the F2 ceiling before a %s reservation",
    async (method) => {
      const billId = await tabWith("Caña");
      const before = await snapshot(billId);
      const error = await captureError(() =>
        pay(billId, { ...venue.cfg, simplifiedInvoiceLimit: decimal("2.00") }, method),
      );
      expect(error).toMatchObject({ code: "sale.total_exceeds_simplified_limit" });
      expect(await snapshot(billId)).toEqual(before);
    },
  );

  it.each(["cash", "manual", "reader"] as const)(
    "retains the public F1 refusal before a %s reservation above the F2 ceiling",
    async (method) => {
      const billId = await tabWith("Caña");
      await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const before = await snapshot(billId);
      const error = await captureError(() =>
        pay(billId, { ...venue.cfg, simplifiedInvoiceLimit: decimal("2.00") }, method),
      );
      expect(error).toMatchObject({ code: "sale.full_invoice_unavailable" });
      expect(await snapshot(billId)).toEqual(before);
    },
  );
});

describe("the writers with no route of their own", () => {
  it("refuses moving a paid line between bills", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    await take(billId, cash("25.00", { kind: "items", amount: undefined, lines: [{ lineNo: 1 }] }));
    const other = await tabWith("Caña");

    const code = await codeOf(inTx((tx) => moveOrderLines(tx, venue.cfg, billId, other, [1])));

    expect(code).toBe("bill.line_paid");
  });

  it("refuses a split of unpaid lines that would leave the bill owing less than it received", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    await take(billId, cash("30.00"));

    const error = await captureError(() =>
      inTx((tx) => splitPartyBill(tx, venue.cfg, billId, [{ lineNo: 1 }])),
    );

    expect(error).toMatchObject({
      code: "bill.received_exceeds_total",
      params: { workingOrderId: billId, excess: "12.00" },
    });
  });

  it("counts a pending card's reservation against the bill's total", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    await insertPayment(billId, { applied: 5000 });

    const error = await captureError(() => inTx((tx) => assertBillInvariant(tx, [billId])));

    expect(error).toMatchObject({
      code: "bill.received_exceeds_total",
      params: { excess: "7.00" },
    });
  });

  it("refuses a void while a card payment of part of the bill is pending, before the invariant", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    await insertPayment(billId, { applied: 2000 });

    const error = await captureError(() => inTx((tx) => cancelLine(tx, venue.cfg, billId, 1)));

    expect(error).toMatchObject({ code: "order.payment_in_flight" });
  });

  it("refuses removing a paid line by saving the order without it, and lets an unpaid one go", async () => {
    const billId = await tabWith("Chuletón", "Tarta", "Caña");
    await take(billId, cash("25.00", { kind: "items", amount: undefined, lines: [{ lineNo: 1 }] }));
    const lines = await inTx((tx) =>
      tx
        .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, billId))
        .orderBy(workingOrderLines.lineNo),
    );
    const [order] = await inTx((tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, billId)),
    );
    const keep = (lineNo: number, name: string) => ({
      workingOrderLineId: lines[lineNo - 1]!.id,
      menuItemId: offer(name),
      quantity: "1",
    });

    const refused = await codeOf(
      updateHeldOrder({ db: suite.db }, venue.cfg, billId, {
        lines: [keep(2, "Tarta"), keep(3, "Caña")],
        revision: order!.revision,
      }),
    );
    const saved = await updateHeldOrder({ db: suite.db }, venue.cfg, billId, {
      lines: [keep(1, "Chuletón"), keep(2, "Tarta")],
      revision: order!.revision,
    });

    expect(refused).toBe("bill.line_paid");
    expect(saved).toBe(order!.revision + 1);
  });

  it("refuses splitting off more of a line than is unpaid", async () => {
    const billId = await inTx(async (tx) => {
      const { tabId } = await openPartyTab(tx, venue.cfg, {
        tableId: await freshTableIn(tx),
        lines: [{ menuItemId: offer("Caña"), quantity: "3" }],
      });
      return tabId;
    });
    await take(
      billId,
      cash("6.00", { kind: "items", amount: undefined, lines: [{ lineNo: 1, quantity: "2" }] }),
    );
    const transfer = (quantity: string) =>
      inTx((tx) => splitPartyBill(tx, venue.cfg, billId, [{ lineNo: 1, quantity }]));

    expect(await codeOf(transfer("2"))).toBe("bill.line_paid");
    await transfer("1");
    const [line] = await inTx((tx) =>
      tx
        .select({ quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, billId)),
    );
    expect(line!.quantity).toBe(2000);
  });
});

describe("a bill holding money", () => {
  it("is refused by the cash sale before the in-flight check, naming the money", async () => {
    const billId = await tabWith("Chuletón");
    await take(billId, cash("10.00"));
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ paymentAttemptAt: new Date().toISOString() })
        .where(eq(workingOrders.id, billId)),
    );

    const code = await codeOf(
      payWorkingOrder(fiscal(), venue.cfg, {
        id: billId,
        lines: [],
        tender: { method: "cash", amount: "25.00" },
      }),
    );

    expect(code).toBe("bill.payments_received");
  });

  it("is refused by the collect of a placed order", async () => {
    const billId = await tabWith("Chuletón");
    await take(billId, cash("10.00"));
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, billId)),
    );

    const code = await codeOf(
      collectOrder(fiscal(), venue.cfg, {
        id: billId,
        lines: [],
        tender: { method: "cash", amount: "25.00" },
      }),
    );

    expect(code).toBe("bill.payments_received");
  });

  it("can be abandoned once every payment on it is refunded in full, tip included", async () => {
    const billId = await tabWith("Chuletón");
    const paid = await take(billId, cash("10.00"));
    await inTx((tx) =>
      tx.insert(billPaymentRefunds).values({
        billPaymentId: paid.payment.id,
        submissionId: randomUUID(),
        fingerprint: "f",
        appliedAmount: 1000,
        reason: "error",
        authorizedBy: OPERATOR,
        requestedBy: OPERATOR,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
        state: "completed",
        completedAt: new Date().toISOString(),
      }),
    );

    expect(await inTx((tx) => readBillBalance(tx, billId))).toMatchObject({
      received: "0.00",
      outstanding: "25.00",
    });
    await abandonHeldOrder({ db: suite.db }, venue.cfg, billId);
    expect(await statusOf(billId)).toBe("abandoned");
  });

  it("answers working_order.not_open, not its money, when discarding a bill already closed", async () => {
    const billId = await tabWith("Chuletón");
    await take(billId, cash("10.00"));
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: new Date().toISOString() })
        .where(eq(workingOrders.id, billId)),
    );

    expect(await codeOf(abandonHeldOrder({ db: suite.db }, venue.cfg, billId))).toBe(
      "working_order.not_open",
    );
    expect(await statusOf(billId)).toBe("settled");
  });
});

describe("settling a card payment of part of the bill", () => {
  it("refuses completing a payment that is no longer pending, and failing one received", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const failed = await insertPayment(billId, {
      state: "failed",
      failedAt: "2026-09-27T10:00:00Z",
    });
    const received = await insertPayment(billId, {
      state: "received",
      receivedAt: "2026-09-27T10:00:00Z",
    });

    const completing = await captureError(() =>
      inTx((tx) => completeBillPayment(tx, fiscal(), venue.cfg, failed, new Date())),
    );
    const failing = await captureError(() =>
      inTx((tx) => failBillPayment(tx, received, new Date())),
    );

    expect(triggerRaised(completing, BILL_PAYMENT_CHANGE_REFUSAL)).toBe(true);
    expect(triggerRaised(failing, BILL_PAYMENT_CHANGE_REFUSAL)).toBe(true);
  });
});

describe("the money a bill has received", () => {
  it("counts only received payments, net of their refunds", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const other = await tabWith("Caña");
    const received = await take(billId, cash("5.00"));
    await inTx((tx) =>
      tx.insert(billPaymentRefunds).values({
        billPaymentId: received.payment.id,
        submissionId: randomUUID(),
        fingerprint: "f",
        appliedAmount: 100,
        reason: "error",
        authorizedBy: OPERATOR,
        requestedBy: OPERATOR,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
        state: "completed",
        completedAt: new Date().toISOString(),
      }),
    );
    await insertPayment(billId, { applied: 1000 });
    await insertPayment(billId, {
      applied: 700,
      state: "failed",
      failedAt: new Date().toISOString(),
    });

    const { received: byBill } = await inTx((tx) => readPaymentsByBill(tx, [billId, other]));

    expect([...byBill]).toEqual([[billId, "4.00"]]);
  });

  it("holds a bill with a received or a pending payment, and not one whose only payment failed", async () => {
    const received = await tabWith("Chuletón");
    const pending = await tabWith("Tarta");
    const failed = await tabWith("Caña");
    const none = await tabWith("Caña");
    await take(received, cash("5.00"));
    await insertPayment(pending, { applied: 100 });
    await insertPayment(failed, {
      applied: 100,
      state: "failed",
      failedAt: new Date().toISOString(),
    });

    const { holding } = await inTx((tx) =>
      readPaymentsByBill(tx, [received, pending, failed, none]),
    );

    expect([...holding].sort()).toEqual([received, pending].sort());
  });
});

describe("the invoice at full payment", () => {
  it("refuses a filed F1 whole credit without changing its sale, settlement or series", async () => {
    const billId = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    await insertPayment(billId, {
      applied: 300,
      state: "received",
      receivedAt: new Date().toISOString(),
    });
    await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR));
    const invoice = (await inTx((tx) => readOrderInvoice(tx, billId)))!;
    const session = await inTx(async (tx) => {
      const [admin] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.role, "admin"));
      return loginWithPin(tx, {
        deviceId: venue.cfg.origin.deviceId,
        personId: admin!.id,
        pin: "1234",
      });
    });
    const before = await inTx((tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, invoice.id)),
    );
    const settledBefore = await inTx((tx) =>
      tx.select().from(saleSettlements).where(eq(saleSettlements.saleId, invoice.id)),
    );
    const [rectificativeBefore] = await inTx((tx) =>
      tx
        .select({ nextNumber: invoiceSeries.nextNumber })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.purpose, "rectificative")),
    );
    expect(before).toEqual([]);
    expect(settledBefore).toHaveLength(1);
    expect(rectificativeBefore).toBeDefined();

    await expect(
      inTx((tx) => creditWholeInvoice(tx, fiscal(), venue.cfg, invoice, { sessionId: session.id })),
    ).rejects.toMatchObject({ code: "sale.correction_unsupported" });

    expect(
      await inTx((tx) =>
        tx.select({ id: sales.id }).from(sales).where(eq(sales.correctsSaleId, invoice.id)),
      ),
    ).toEqual(before);
    expect(
      await inTx((tx) =>
        tx.select().from(saleSettlements).where(eq(saleSettlements.saleId, invoice.id)),
      ),
    ).toEqual(settledBefore);
    const [rectificativeAfter] = await inTx((tx) =>
      tx
        .select({ nextNumber: invoiceSeries.nextNumber })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.purpose, "rectificative")),
    );
    expect(rectificativeAfter).toEqual(rectificativeBefore);
  });

  it("finds a settled F1 by its invoice number or saved customer name without changing sale or print rows", async () => {
    const billId = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Recovery O'Brien 100%_SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const paymentId = await insertPayment(billId, { applied: 300 });
    const completed = await inTx((tx) =>
      completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
    );
    expect(completed.invoice).toMatchObject({ invoiceType: "F1", total: "3.00" });
    const wildcardBill = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, wildcardBill, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Wildcard control 100XXSL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const wildcardPayment = await insertPayment(wildcardBill, { applied: 300 });
    await inTx((tx) => completeBillPayment(tx, fiscal(), venue.cfg, wildcardPayment, new Date()));
    const [saved] = await inTx((tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
    );
    const session = await inTx(async (tx) => {
      const [admin] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.role, "admin"));
      return loginWithPin(tx, {
        deviceId: venue.cfg.origin.deviceId,
        personId: admin!.id,
        pin: "1234",
      });
    });
    const app = new Hono();
    mountTillApi(
      app,
      { ...fiscal(), cfg: venue.cfg, secureCookies: false, venueLocale: LOCALE },
      () => {},
    );
    const snapshot = () =>
      inTx(async (tx) => ({
        sales: await tx.select().from(sales),
        payments: await tx.select().from(payments),
        portions: await tx.select().from(billPayments),
        tenders: await tx.select().from(tenders),
        series: await tx.select().from(invoiceSeries),
        jobs: await tx.select().from(printJobs),
      }));
    const before = await snapshot();
    for (const q of [
      completed.invoice!.invoiceNumber,
      "o'brien",
      "100%_",
      "  Recovery O'Brien 100%_SL  ",
    ]) {
      const res = await app.request(`/api/invoices/lookup?q=${encodeURIComponent(q)}`, {
        headers: { cookie: `${SESSION_COOKIE}=${session.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({
        invoices: [
          {
            workingOrderId: billId,
            invoiceNumber: completed.invoice!.invoiceNumber,
            issuedAt: saved!.issuedAt,
            customerName: "Recovery O'Brien 100%_SL",
            total: "3.00",
          },
        ],
      });
    }
    for (const q of ["Recovery O'Brien 100XXSL", "no such filed invoice", "' OR 1=1 --"]) {
      const res = await app.request(`/api/invoices/lookup?q=${encodeURIComponent(q)}`, {
        headers: { cookie: `${SESSION_COOKIE}=${session.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ invoices: [] });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("limits invoice lookup to twenty newest filed F1 bills before returning rows", async () => {
    const expected: { workingOrderId: string; invoiceNumber: string }[] = [];
    for (let index = 0; index < 21; index++) {
      const billId = await tabWith("Caña");
      await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Lookup batch SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const paymentId = await insertPayment(billId, { applied: 300 });
      const completed = await inTx((tx) =>
        completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
      );
      expected.unshift({ workingOrderId: billId, invoiceNumber: completed.invoice!.invoiceNumber });
    }
    const unissued = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, unissued, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Lookup batch SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const f2Id = await tabWith("Caña");
    const f2Payment = await insertPayment(f2Id, { applied: 300 });
    const f2 = await inTx((tx) =>
      completeBillPayment(tx, fiscal(), venue.cfg, f2Payment, new Date()),
    );
    expect(f2.invoice).toMatchObject({ invoiceType: "F2" });
    const session = await inTx(async (tx) => {
      const [admin] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.role, "admin"));
      return loginWithPin(tx, {
        deviceId: venue.cfg.origin.deviceId,
        personId: admin!.id,
        pin: "1234",
      });
    });
    const app = new Hono();
    mountTillApi(
      app,
      { ...fiscal(), cfg: venue.cfg, secureCookies: false, venueLocale: LOCALE },
      () => {},
    );
    const lookup = (q: string) =>
      app.request(`/api/invoices/lookup?q=${encodeURIComponent(q)}`, {
        headers: { cookie: `${SESSION_COOKIE}=${session.token}` },
      });
    const res = await lookup("Lookup batch SL");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invoices: { workingOrderId: string; invoiceNumber: string; total: string }[];
    };
    expect(
      body.invoices.map(({ workingOrderId, invoiceNumber }) => ({ workingOrderId, invoiceNumber })),
    ).toEqual(expected.slice(0, 20));
    expect(body.invoices.every((row) => row.total === "3.00")).toBe(true);
    const f2Res = await lookup(f2.invoice!.invoiceNumber);
    expect(f2Res.status).toBe(200);
    expect(await f2Res.json()).toEqual({ invoices: [] });
    const byNumber = await lookup(expected[20]!.invoiceNumber);
    expect(byNumber.status).toBe(200);
    expect(await byNumber.json()).toMatchObject({
      invoices: [
        {
          workingOrderId: expected[20]!.workingOrderId,
          invoiceNumber: expected[20]!.invoiceNumber,
        },
      ],
    });
  });

  it("requires a session and a bounded nonempty invoice search", async () => {
    const session = await inTx(async (tx) => {
      const [admin] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.role, "admin"));
      return loginWithPin(tx, {
        deviceId: venue.cfg.origin.deviceId,
        personId: admin!.id,
        pin: "1234",
      });
    });
    const app = new Hono();
    mountTillApi(
      app,
      { ...fiscal(), cfg: venue.cfg, secureCookies: false, venueLocale: LOCALE },
      () => {},
    );
    const anonymous = await app.request("/api/invoices/lookup?q=FF/1");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "session.required" } });
    for (const q of [undefined, "", "   ", "x".repeat(101)]) {
      const res = await app.request(
        `/api/invoices/lookup${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`,
        {
          headers: { cookie: `${SESSION_COOKIE}=${session.token}` },
        },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "q" } },
      });
    }
  });

  it("reads a captured-card F1 over HTTP after changing live invoice identity without taking or refiling payment", async () => {
    const billId = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const paymentId = await insertPayment(billId, { applied: 300 });
    const completed = await inTx((tx) =>
      completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
    );
    expect(completed.invoice).toMatchObject({ invoiceType: "F1", total: "3.00" });
    const originalDomicile = (await inTx((tx) => tx.select().from(tenants)))[0]!.taxpayerDomicile;
    try {
      await inTx((tx) => tx.update(tenants).set({ taxpayerDomicile: "Changed live domicile" }));
      const session = await inTx(async (tx) => {
        const [admin] = await tx
          .select({ id: persons.id })
          .from(persons)
          .where(eq(persons.role, "admin"));
        return loginWithPin(tx, {
          deviceId: venue.cfg.origin.deviceId,
          personId: admin!.id,
          pin: "1234",
        });
      });
      const snapshot = () =>
        inTx(async (tx) => ({
          sales: await tx.select().from(sales),
          payments: await tx.select().from(payments),
          portions: await tx.select().from(billPayments),
          tenders: await tx.select().from(tenders),
          series: await tx.select().from(invoiceSeries),
          jobs: await tx.select().from(printJobs),
        }));
      const before = await snapshot();
      const app = new Hono();
      mountTillApi(
        app,
        { ...fiscal(), cfg: venue.cfg, secureCookies: false, venueLocale: LOCALE },
        () => {},
      );
      for (let read = 0; read < 2; read++) {
        const res = await app.request(`/api/sales/${billId}`, {
          headers: { cookie: `${SESSION_COOKIE}=${session.token}` },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
          invoiceType: "F1",
          invoiceNumber: completed.invoice!.invoiceNumber,
          total: "3.00",
          issuer: { domicile: "Calle Fiscal 8, 28013 Madrid" },
          recipient: {
            taxId: "B12345674",
            legalName: "Cliente SL",
            address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
            countryCode: "ES",
          },
          lines: [
            {
              descriptions: { "es-ES": "Caña de cerveza" },
              quantity: "1",
              gross: "3.00",
              net: { base: "2.48", tax: "0.52" },
            },
          ],
        });
      }
      expect(await snapshot()).toEqual(before);
    } finally {
      await inTx((tx) => tx.update(tenants).set({ taxpayerDomicile: originalDomicile }));
    }
  });

  it("files the saved full invoice when a captured card completes the bill", async () => {
    const billId = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const paymentId = await insertPayment(billId, { applied: 300 });

    const completed = await inTx((tx) =>
      completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
    );
    const [filed] = await inTx((tx) =>
      tx
        .select({
          purpose: invoiceSeries.purpose,
          taxId: sales.counterpartyTaxId,
          address: sales.counterpartyAddress,
        })
        .from(sales)
        .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
        .where(eq(sales.workingOrderId, billId)),
    );

    expect(completed.invoice).toMatchObject({
      total: "3.00",
      issuer: {
        venueName: "Pagos SL",
        nif: "62000001M",
        domicile: "Calle Fiscal 8, 28013 Madrid",
      },
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    expect(filed).toEqual({
      purpose: "full",
      taxId: "B12345674",
      address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
    });
    const [sale] = await inTx((tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
    );
    expect(await inTx((tx) => readReceiptIssuer(backend, tx, brandSaleId(sale!.id)))).toMatchObject(
      {
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      },
    );
  });

  it.each([
    { invoiceType: "F1", mode: "auto", documents: 1 },
    { invoiceType: "F1", mode: "on_request", documents: 1 },
    { invoiceType: "F1", mode: "never", documents: 1 },
    { invoiceType: "F2", mode: "auto", documents: 1 },
    { invoiceType: "F2", mode: "on_request", documents: 0 },
    { invoiceType: "F2", mode: "never", documents: 0 },
  ] as const)(
    "captured-card completion queues $documents original for $invoiceType in $mode mode",
    async ({ invoiceType, mode, documents }) => {
      const [policy] = await inTx((tx) =>
        tx.select().from(zoneSalePolicies).where(eq(zoneSalePolicies.zoneId, venue.offers.zoneId)),
      );
      try {
        await inTx((tx) =>
          tx
            .insert(zoneSalePolicies)
            .values({ zoneId: venue.offers.zoneId, receiptPrintMode: mode })
            .onConflictDoUpdate({
              target: zoneSalePolicies.zoneId,
              set: { receiptPrintMode: mode },
            }),
        );
        const billId = await tabWith("Caña");
        if (invoiceType === "F1") {
          await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
            revision: 0,
            invoiceType,
            recipient: {
              taxId: "B12345674",
              legalName: "Cliente SL",
              address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
              countryCode: "ES",
            },
          });
        }
        const paymentId = await insertPayment(billId, { applied: 300 });
        const completed = await inTx((tx) =>
          completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
        );
        const [sale] = await inTx((tx) =>
          tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
        );
        const jobs = await inTx((tx) =>
          tx.select().from(printJobs).where(eq(printJobs.saleId, sale!.id)),
        );
        expect(completed.invoice).toMatchObject({ invoiceType, total: "3.00" });
        expect(jobs).toHaveLength(documents);
        for (const job of jobs) {
          expect(job.kind).toBe("document");
          expect(opensDrawer(new Uint8Array(job.payload))).toBe(false);
          expect(decodeTicket(new Uint8Array(job.payload))).toContain(
            completed.invoice!.invoiceNumber,
          );
          expect(decodeTicket(new Uint8Array(job.payload))).not.toContain("DUPLICADO");
        }
        if (invoiceType === "F1") {
          expect(decodeTicket(new Uint8Array(jobs[0]!.payload))).toContain("Factura completa");
          expect(decodeTicket(new Uint8Array(jobs[0]!.payload))).toContain("Cliente SL");
        }
        expect(await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId))).toBeNull();
        const replay = await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId));
        expect(replay.invoiceNumber).toBe(completed.invoice!.invoiceNumber);
        expect(
          await inTx((tx) => tx.select().from(printJobs).where(eq(printJobs.saleId, sale!.id))),
        ).toEqual(jobs);
        expect(
          await inTx((tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId))),
        ).toEqual([sale]);
      } finally {
        if (policy === undefined) {
          await inTx((tx) =>
            tx.delete(zoneSalePolicies).where(eq(zoneSalePolicies.zoneId, venue.offers.zoneId)),
          );
        } else {
          await inTx((tx) =>
            tx
              .update(zoneSalePolicies)
              .set({ receiptPrintMode: policy.receiptPrintMode })
              .where(eq(zoneSalePolicies.zoneId, venue.offers.zoneId)),
          );
        }
      }
    },
  );

  it("tracks the captured-card F1 original separately from its manual copy", async () => {
    const billId = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const paymentId = await insertPayment(billId, { applied: 300 });
    const completed = await inTx((tx) =>
      completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
    );
    const before = await inTx((tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
    );
    await reprintSale({ db: suite.db, backend }, venue.cfg, billId);
    const jobs = await inTx((tx) =>
      tx.select().from(printJobs).where(eq(printJobs.saleId, before[0]!.id)),
    );
    expect(jobs).toHaveLength(2);
    const original = jobs.find((job) => job.receiptCopy === false);
    const copy = jobs.find((job) => job.receiptCopy === true);
    expect(original).toBeDefined();
    expect(copy).toBeDefined();
    for (const job of [original!, copy!]) {
      const bytes = new Uint8Array(job.payload);
      expect(decodeTicket(bytes)).toContain(completed.invoice!.invoiceNumber);
      expect(decodeTicket(bytes)).toContain("Cliente SL");
      expect(opensDrawer(bytes)).toBe(false);
    }
    expect(decodeTicket(new Uint8Array(original!.payload))).not.toContain("DUPLICADO");
    expect(decodeTicket(new Uint8Array(copy!.payload))).toContain("DUPLICADO");
    expect(
      await inTx((tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId))),
    ).toEqual(before);
  });

  it.each([
    { missingPrinter: true, copyFirst: false, status: "queued", count: 1 },
    { missingPrinter: true, copyFirst: true, status: "queued", count: 2 },
    { missingPrinter: false, copyFirst: false, status: "queued", count: 1 },
    { missingPrinter: false, copyFirst: false, status: "printing", count: 1 },
    { missingPrinter: false, copyFirst: false, status: "done", count: 1 },
    { missingPrinter: false, copyFirst: false, status: "failed", count: 1 },
  ] as const)(
    "queues only one F1 original across repeated requests (missing=$missingPrinter, copy=$copyFirst, status=$status)",
    async ({ missingPrinter, copyFirst, status, count }) => {
      const [device] = await inTx((tx) =>
        tx.select().from(devices).where(eq(devices.id, venue.cfg.origin.deviceId!)),
      );
      try {
        if (missingPrinter)
          await inTx((tx) =>
            tx.update(devices).set({ receiptPrinterId: null }).where(eq(devices.id, device!.id)),
          );
        const billId = await tabWith("Caña");
        await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
          revision: 0,
          invoiceType: "F1",
          recipient: {
            taxId: "B12345674",
            legalName: "Cliente SL",
            address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
            countryCode: "ES",
          },
        });
        const paymentId = await insertPayment(billId, { applied: 300 });
        const completed = await inTx((tx) =>
          completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
        );
        const before = await inTx((tx) =>
          tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
        );
        if (!missingPrinter)
          await inTx((tx) =>
            tx
              .update(printJobs)
              .set({ status, attempts: status === "failed" ? 5 : 0 })
              .where(eq(printJobs.saleId, before[0]!.id)),
          );
        const beforeJobs = await inTx((tx) =>
          tx.select().from(printJobs).where(eq(printJobs.saleId, before[0]!.id)),
        );
        expect(beforeJobs).toHaveLength(missingPrinter ? 0 : 1);
        await inTx((tx) =>
          tx
            .update(devices)
            .set({ receiptPrinterId: device!.receiptPrinterId })
            .where(eq(devices.id, device!.id)),
        );
        if (copyFirst) await reprintSale({ db: suite.db, backend }, venue.cfg, billId);
        await printSaleReceipt({ db: suite.db, backend }, venue.cfg, billId, false);
        await printSaleReceipt({ db: suite.db, backend }, venue.cfg, billId, false);
        const jobs = await inTx((tx) =>
          tx.select().from(printJobs).where(eq(printJobs.saleId, before[0]!.id)),
        );
        expect(jobs).toHaveLength(count);
        const originals = jobs.filter((job) => job.receiptCopy === false);
        expect(originals).toHaveLength(1);
        if (copyFirst) expect(jobs.filter((job) => job.receiptCopy === true)).toHaveLength(1);
        if (!missingPrinter) expect(jobs).toEqual(beforeJobs);
        const bytes = new Uint8Array(originals[0]!.payload);
        expect(decodeTicket(bytes)).toContain(completed.invoice!.invoiceNumber);
        expect(decodeTicket(bytes)).not.toContain("DUPLICADO");
        expect(opensDrawer(bytes)).toBe(false);
        expect(
          await inTx((tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId))),
        ).toEqual(before);
      } finally {
        await inTx((tx) =>
          tx
            .update(devices)
            .set({ receiptPrinterId: device!.receiptPrinterId })
            .where(eq(devices.id, device!.id)),
        );
      }
    },
  );

  it.each(["queued", "printing", "done", "failed"] as const)(
    "retains the complete F1 original job when the issuance hook repeats after %s",
    async (status) => {
      const billId = await tabWith("Caña");
      await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const paymentId = await insertPayment(billId, { applied: 300 });
      const completed = await inTx((tx) =>
        completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
      );
      expect(completed.invoice!.invoiceType).toBe("F1");
      const [sale] = await inTx((tx) =>
        tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
      );
      await inTx((tx) =>
        tx
          .update(printJobs)
          .set({ status, attempts: status === "failed" ? 5 : 0 })
          .where(eq(printJobs.saleId, sale!.id)),
      );
      const before = await inTx((tx) => tx.select().from(printJobs));
      expect(
        before.filter((job) => job.saleId === sale!.id && job.receiptCopy === false),
      ).toHaveLength(1);
      await inTx((tx) => enqueueOriginalReceipt(tx, venue.cfg, completed.invoice!, sale!.id));
      await inTx((tx) => enqueueOriginalReceipt(tx, venue.cfg, completed.invoice!, sale!.id));
      expect(await inTx((tx) => tx.select().from(printJobs))).toEqual(before);
      expect(await inTx((tx) => tx.select().from(sales).where(eq(sales.id, sale!.id)))).toEqual([
        sale,
      ]);
    },
  );

  it("keeps an F1 handover confirmation after a later original resend completes", async () => {
    const billId = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const paymentId = await insertPayment(billId, { applied: 300 });
    await inTx((tx) => completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()));
    const [sale] = await inTx((tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
    );
    expect(
      (await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId))).invoiceType,
    ).toBe("F1");
    const [original] = await inTx((tx) =>
      tx.select().from(printJobs).where(eq(printJobs.saleId, sale!.id)),
    );
    await inTx((tx) =>
      tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, original!.id)),
    );
    const confirmed = await inTx((tx) => confirmReceiptHandover(tx, sale!.id, OPERATOR));
    expect(confirmed).toEqual({
      status: "done",
      jobId: original!.id,
      canRetry: false,
      handover: { personId: OPERATOR, confirmedAt: expect.any(String) },
    });
    const resend = await inTx((tx) => resendPrintJob(tx, original!.id));
    await inTx((tx) =>
      tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, resend.jobId)),
    );
    const later = await inTx((tx) => readOriginalReceiptPrint(tx, sale!.id));
    expect(later).toEqual({ ...confirmed, jobId: resend.jobId });
    expect(await inTx((tx) => tx.select().from(sales).where(eq(sales.id, sale!.id)))).toEqual([
      sale,
    ]);
  });

  it("reads an F1 original's print attempts without treating its duplicate as the original", async () => {
    const billId = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const paymentId = await insertPayment(billId, { applied: 300 });
    await inTx((tx) => completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()));
    const [sale] = await inTx((tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
    );
    const [original] = await inTx((tx) =>
      tx.select().from(printJobs).where(eq(printJobs.saleId, sale!.id)),
    );
    const read = () => inTx((tx) => readOriginalReceiptPrint(tx, sale!.id));
    expect(await read()).toEqual({ status: "queued", jobId: original!.id, canRetry: false });
    await reprintSale({ db: suite.db, backend }, venue.cfg, billId);
    const copy = (
      await inTx((tx) => tx.select().from(printJobs).where(eq(printJobs.saleId, sale!.id)))
    ).find((job) => job.receiptCopy === true)!;
    await inTx((tx) =>
      tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, copy.id)),
    );
    expect(await read()).toEqual({ status: "queued", jobId: original!.id, canRetry: false });
    await inTx((tx) =>
      tx.update(printJobs).set({ status: "printing" }).where(eq(printJobs.id, original!.id)),
    );
    expect(await read()).toEqual({ status: "printing", jobId: original!.id, canRetry: false });
    await inTx((tx) =>
      tx
        .update(printJobs)
        .set({ status: "failed", attempts: 1 })
        .where(eq(printJobs.id, original!.id)),
    );
    expect(await read()).toEqual({ status: "failed", jobId: original!.id, canRetry: false });
    await inTx((tx) =>
      tx
        .update(printJobs)
        .set({ attempts: MAX_DELIVERY_ATTEMPTS })
        .where(eq(printJobs.id, original!.id)),
    );
    expect(await read()).toEqual({ status: "failed", jobId: original!.id, canRetry: true });
    const retry = await inTx((tx) => resendPrintJob(tx, original!.id));
    // Matching timestamps deliberately leave row insertion order to distinguish the retry.
    await inTx((tx) =>
      tx
        .update(printJobs)
        .set({ createdAt: original!.createdAt })
        .where(eq(printJobs.saleId, sale!.id)),
    );
    expect(await read()).toEqual({ status: "queued", jobId: retry.jobId, canRetry: false });
    await inTx((tx) =>
      tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, retry.jobId)),
    );
    expect(await read()).toEqual({ status: "done", jobId: retry.jobId, canRetry: false });
    const extra = await inTx((tx) => resendPrintJob(tx, retry.jobId));
    await inTx((tx) =>
      tx
        .update(printJobs)
        .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
        .where(eq(printJobs.id, extra.jobId)),
    );
    expect(await read()).toEqual({ status: "done", jobId: retry.jobId, canRetry: false });
    expect(await inTx((tx) => tx.select().from(sales).where(eq(sales.id, sale!.id)))).toEqual([
      sale,
    ]);
  });

  it("reports no queued original after printerless F1 issuance, even with a completed duplicate", async () => {
    const [device] = await inTx((tx) =>
      tx.select().from(devices).where(eq(devices.id, venue.cfg.origin.deviceId!)),
    );
    try {
      await inTx((tx) =>
        tx.update(devices).set({ receiptPrinterId: null }).where(eq(devices.id, device!.id)),
      );
      const billId = await tabWith("Caña");
      await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const paymentId = await insertPayment(billId, { applied: 300 });
      await inTx((tx) => completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()));
      const [sale] = await inTx((tx) =>
        tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
      );
      expect(await inTx((tx) => readOriginalReceiptPrint(tx, sale!.id))).toEqual({
        status: "not_queued",
      });
      await inTx((tx) =>
        tx
          .update(devices)
          .set({ receiptPrinterId: device!.receiptPrinterId })
          .where(eq(devices.id, device!.id)),
      );
      await reprintSale({ db: suite.db, backend }, venue.cfg, billId);
      await inTx((tx) =>
        tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.saleId, sale!.id)),
      );
      expect(await inTx((tx) => readOriginalReceiptPrint(tx, sale!.id))).toEqual({
        status: "not_queued",
      });
      await printSaleReceipt({ db: suite.db, backend }, venue.cfg, billId, false);
      const original = (
        await inTx((tx) => tx.select().from(printJobs).where(eq(printJobs.saleId, sale!.id)))
      ).find((job) => job.receiptCopy === false)!;
      expect(await inTx((tx) => readOriginalReceiptPrint(tx, sale!.id))).toEqual({
        status: "queued",
        jobId: original.id,
        canRetry: false,
      });
    } finally {
      await inTx((tx) =>
        tx
          .update(devices)
          .set({ receiptPrinterId: device!.receiptPrinterId })
          .where(eq(devices.id, device!.id)),
      );
    }
  });

  it("does not add an F1 issue offset to an F2 original or replay", async () => {
    const billId = await tabWith("Caña");
    const paymentId = await insertPayment(billId, { applied: 300 });
    const completed = await inTx((tx) =>
      completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
    );
    const replay = await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId));
    for (const invoice of [completed.invoice!, replay]) {
      expect(invoice.invoiceType).toBe("F2");
      expect(invoice).not.toHaveProperty("issuedOffsetMinutes");
    }
  });

  it.each([60, 0, -480])(
    "retains saved F1 issue offset %s across replay and a live zone change",
    async (offsetMinutes) => {
      const billId = await tabWith("Caña");
      await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const paymentId = await insertPayment(billId, { applied: 300 });
      const issueClock: TrustedClock = {
        ...clock,
        now: () => ({
          instant: new Date("2026-10-06T22:10:00Z"),
          offsetMinutes,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
      };
      const completed = await inTx((tx) =>
        completeBillPayment(
          tx,
          { ...fiscal(), clock: issueClock },
          venue.cfg,
          paymentId,
          new Date("2026-10-06T22:10:00Z"),
        ),
      );
      const [location] = await inTx((tx) =>
        tx.select().from(locations).where(eq(locations.id, venue.cfg.locationId)),
      );
      try {
        await inTx((tx) =>
          tx
            .update(locations)
            .set({ timeZone: "Pacific/Honolulu" })
            .where(eq(locations.id, venue.cfg.locationId)),
        );
        const replay = await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId));
        for (const invoice of [completed.invoice!, replay]) {
          expect(invoice).toHaveProperty("issuedOffsetMinutes", offsetMinutes);
          expect(invoice.issuedAt).toBe("2026-10-06T22:10:00.000Z");
        }
        expect(replay.invoiceNumber).toBe(completed.invoice!.invoiceNumber);
      } finally {
        await inTx((tx) =>
          tx
            .update(locations)
            .set({ timeZone: location!.timeZone })
            .where(eq(locations.id, venue.cfg.locationId)),
        );
      }
    },
  );

  it.each([
    ["2026-10-06T21:50:00Z", "2026-10-06"],
    ["2026-10-06T22:05:00Z", undefined],
  ])(
    "retains the full-invoice service date from bill opening %s across replay",
    async (openedAt, expected) => {
      const billId = await tabWith("Caña");
      await inTx((tx) =>
        tx.update(workingOrders).set({ openedAt }).where(eq(workingOrders.id, billId)),
      );
      await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      const paymentId = await insertPayment(billId, { applied: 300 });
      const issueClock: TrustedClock = {
        ...clock,
        now: () => ({
          instant: new Date("2026-10-06T22:10:00Z"),
          offsetMinutes: 120,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
      };
      const completed = await inTx((tx) =>
        completeBillPayment(
          tx,
          { ...fiscal(), clock: issueClock },
          venue.cfg,
          paymentId,
          new Date("2026-10-06T22:10:00Z"),
        ),
      );
      const [location] = await inTx((tx) =>
        tx.select().from(locations).where(eq(locations.id, venue.cfg.locationId)),
      );
      try {
        await inTx((tx) =>
          tx
            .update(locations)
            .set({ timeZone: "Pacific/Honolulu" })
            .where(eq(locations.id, venue.cfg.locationId)),
        );
        const replay = await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId));
        for (const invoice of [completed.invoice!, replay]) {
          expect(invoice.issuedAt).toBe("2026-10-06T22:10:00.000Z");
          if (expected === undefined) expect(invoice).not.toHaveProperty("operationDate");
          else expect(invoice).toMatchObject({ operationDate: expected });
        }
        expect(replay.invoiceNumber).toBe(completed.invoice!.invoiceNumber);
      } finally {
        await inTx((tx) =>
          tx
            .update(locations)
            .set({ timeZone: location!.timeZone })
            .where(eq(locations.id, venue.cfg.locationId)),
        );
      }
    },
  );

  it("returns saved line VAT on an original F1 and its settled replay", async () => {
    const billId = await tabWith("Caña", "Chuletón");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const paymentId = await insertPayment(billId, { applied: 2800 });
    const completed = await inTx((tx) =>
      completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
    );
    const replay = await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId));
    for (const invoice of [completed.invoice!, replay]) {
      expect(invoice.lines).toMatchObject([
        { net: { base: "2.48", tax: "0.52" } },
        { net: { base: "20.66", tax: "4.34" } },
      ]);
      expect(invoice.vatBreakdown).toEqual([{ rate: "21.00", base: "23.14", tax: "4.86" }]);
    }
  });

  it("returns filed net line figures on the original F1 and a settled replay", async () => {
    const billId = await tabWith("Caña", "Chuletón");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const paymentId = await insertPayment(billId, { applied: 2800 });
    const completed = await inTx((tx) =>
      completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
    );
    const replay = await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId));

    const expected = [
      {
        gross: "3.00",
        net: { unitPrice: "2.48", priceQuantity: "1.000", base: "2.48", rate: "21.00" },
      },
      {
        gross: "25.00",
        net: { unitPrice: "20.66", priceQuantity: "1.000", base: "20.66", rate: "21.00" },
      },
    ];
    expect(completed.invoice!.lines).toMatchObject(expected);
    expect(replay.lines).toMatchObject(expected);
    expect(replay.vatBreakdown).toEqual([{ rate: "21.00", base: "23.14", tax: "4.86" }]);
    expect(replay.total).toBe("28.00");
  });

  it("replays a settled F1 with the filed recipient and taxpayer domicile after setup changes", async () => {
    const billId = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    const paymentId = await insertPayment(billId, { applied: 300 });
    const completed = await inTx((tx) =>
      completeBillPayment(tx, fiscal(), venue.cfg, paymentId, new Date()),
    );
    const before = await inTx((tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
    );
    const [taxpayer] = await inTx((tx) => tx.select().from(tenants).where(eq(tenants.id, 1)));
    try {
      await inTx((tx) =>
        tx
          .update(tenants)
          .set({ taxpayerDomicile: "Calle Nueva 20, 08001 Barcelona" })
          .where(eq(tenants.id, 1)),
      );
      const replay = await inTx((tx) => readSettledTicket(backend, tx, venue.cfg, billId));

      expect(replay).toMatchObject({
        invoiceType: "F1",
        total: "3.00",
        issuer: {
          venueName: "Pagos SL",
          nif: "62000001M",
          domicile: "Calle Fiscal 8, 28013 Madrid",
        },
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      expect(replay.invoiceNumber).toBe(completed.invoice!.invoiceNumber);
      expect(replay.issuedAt).toBe(completed.invoice!.issuedAt);
      expect(
        await inTx((tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId))),
      ).toEqual(before);
    } finally {
      await inTx((tx) =>
        tx
          .update(tenants)
          .set({ taxpayerDomicile: taxpayer!.taxpayerDomicile })
          .where(eq(tenants.id, 1)),
      );
    }
  });

  it.each([
    { cap: null, legalName: "Á".repeat(121) },
    { cap: 3, legalName: "𐐀𐐀𐐀" },
  ])("saves a name allowed by the backend's name limit ($cap)", async ({ cap, legalName }) => {
    const billId = await tabWith("Caña");
    expect(
      await setOrderInvoiceChoice(suite.db, { recipientNameMaxLength: cap }, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName,
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      }),
    ).toBe(1);
    const [saved] = await inTx((tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
    );
    expect(saved!.recipientLegalName).toBe(legalName);
  });

  it("uses the backend's smaller name limit when saving a recipient", async () => {
    const billId = await tabWith("Caña");
    const [before] = await inTx((tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
    );
    await expect(
      setOrderInvoiceChoice(suite.db, { recipientNameMaxLength: 3 }, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "𐐀𐐀𐐀𐐀",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      }),
    ).rejects.toMatchObject({ code: "invoice.recipient_invalid", params: { field: "legalName" } });
    const [after] = await inTx((tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
    );
    expect(after).toEqual(before);
  });

  it.each([
    { field: "address", change: { recipientAddress: "Madrid" } },
    { field: "legalName", change: { recipientLegalName: "x".repeat(121) } },
    { field: "taxId", change: { recipientTaxId: "B12345675" } },
  ])(
    "revalidates the saved F1 $field before filing received bill money",
    async ({ field, change }) => {
      const billId = await tabWith("Caña");
      await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
        revision: 0,
        invoiceType: "F1",
        recipient: {
          taxId: "B12345674",
          legalName: "Cliente SL",
          address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          countryCode: "ES",
        },
      });
      await inTx(async (tx) => {
        await tx.update(workingOrders).set(change).where(eq(workingOrders.id, billId));
      });
      await insertPayment(billId, {
        applied: 300,
        state: "received",
        receivedAt: new Date().toISOString(),
      });
      const before = await inTx(async (tx) => ({
        order: await tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
        payments: await tx
          .select()
          .from(billPayments)
          .where(eq(billPayments.workingOrderId, billId)),
        series: await tx.select().from(invoiceSeries),
      }));

      await expect(
        inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR)),
      ).rejects.toMatchObject({ code: "invoice.recipient_invalid", params: { field } });

      const after = await inTx(async (tx) => ({
        order: await tx.select().from(workingOrders).where(eq(workingOrders.id, billId)),
        payments: await tx
          .select()
          .from(billPayments)
          .where(eq(billPayments.workingOrderId, billId)),
        series: await tx.select().from(invoiceSeries),
      }));
      expect(after).toEqual(before);
      expect(
        await inTx((tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId))),
      ).toEqual([]);
    },
  );

  it("files a saved full-invoice choice through the full series when its bill is paid", async () => {
    const billId = await tabWith("Caña");
    await setOrderInvoiceChoice(suite.db, backend, venue.cfg, billId, {
      revision: 0,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    });
    await insertPayment(billId, {
      applied: 300,
      state: "received",
      receivedAt: new Date().toISOString(),
    });

    const issued = await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR));

    expect(issued).toMatchObject({ invoiceType: "F1" });

    const [filed] = await inTx((tx) =>
      tx
        .select({
          purpose: invoiceSeries.purpose,
          taxId: sales.counterpartyTaxId,
          legalName: sales.counterpartyLegalName,
          address: sales.counterpartyAddress,
        })
        .from(sales)
        .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
        .where(eq(sales.workingOrderId, billId)),
    );
    expect(filed).toEqual({
      purpose: "full",
      taxId: "B12345674",
      legalName: "Cliente SL",
      address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
    });
  });

  it("files nothing more for a bill already settled", async () => {
    const billId = await tabWith("Caña");
    const paid = await take(billId, cash("3.00"));
    expect(paid.invoice).toBeDefined();
    expect(paid.invoice!.qrText).toEqual({ caption: "QR tributario:", legend: "VERI*FACTU" });

    const again = await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR));

    expect(again).toBeNull();
    expect(
      await inTx((tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId))),
    ).toHaveLength(1);
  });

  it("files no invoice for a bill whose lines and money are both gone", async () => {
    const billId = await tabWith("Caña");
    const paid = await take(billId, cash("1.00"));
    await inTx((tx) =>
      tx.insert(billPaymentRefunds).values({
        billPaymentId: paid.payment.id,
        submissionId: randomUUID(),
        fingerprint: "f",
        appliedAmount: 100,
        reason: "error",
        authorizedBy: OPERATOR,
        requestedBy: OPERATOR,
        source: venue.cfg.origin.source,
        deviceId: venue.cfg.origin.deviceId,
        state: "completed",
        completedAt: new Date().toISOString(),
      }),
    );
    await inTx((tx) => cancelLine(tx, venue.cfg, billId, 1));

    const issued = await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR));

    expect(issued).toBeNull();
    expect(await statusOf(billId)).toBe("open");
    expect(
      await inTx((tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId))),
    ).toEqual([]);
  });

  it("files a card payment no provider row stands behind as a card tender, linking nothing", async () => {
    const billId = await tabWith("Caña");
    const paymentId = await insertPayment(billId, {
      applied: 300,
      state: "received",
      receivedAt: new Date().toISOString(),
    });

    const issued = await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR));

    expect(issued).toMatchObject({ total: "3.00" });
    expect(await statusOf(billId)).toBe("settled");
    const [tender] = suite.db.all<{ method: string; amount: number; bill_payment_id: string }>(
      sql`select t.method, t.amount, t.bill_payment_id from tenders t
          join sales s on s.id = t.sale_id where s.working_order_id = ${billId}`,
    );
    expect(tender).toEqual({ method: "card", amount: 300, bill_payment_id: paymentId });
    expect(
      await inTx((tx) => tx.select().from(payments).where(eq(payments.workingOrderId, billId))),
    ).toEqual([]);
  });

  it("prints a slip for each card payment, each paired with its own tender", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const early = new Date(Date.now() - 60_000).toISOString();
    const late = new Date().toISOString();
    const first = await insertPayment(billId, {
      applied: 2000,
      state: "received",
      receivedAt: early,
    });
    const second = await insertPayment(billId, {
      applied: 2300,
      tip: 200,
      state: "received",
      receivedAt: late,
    });
    // The second payment's row sorts first, as the slip reads them.
    await inTx(async (tx) => {
      await tx.insert(payments).values([
        {
          id: "00000000-0000-4000-8000-000000000001",
          workingOrderId: billId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
          provider: "simulator",
          paymentRef: randomUUID(),
          amount: 2500,
          state: "captured",
          settledAt: late,
          billPaymentId: second,
        },
        {
          id: "ffffffff-0000-4000-8000-000000000001",
          workingOrderId: billId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
          provider: "simulator",
          paymentRef: randomUUID(),
          amount: 2000,
          state: "captured",
          settledAt: early,
          billPaymentId: first,
        },
      ]);
    });
    const issued = await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR));
    expect(issued).toMatchObject({ total: "43.00" });
    const [sale] = await inTx((tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
    );
    const linked = await inTx((tx) =>
      tx
        .select({ saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.workingOrderId, billId)),
    );
    expect(linked.map((row) => row.saleId)).toEqual([sale!.id, sale!.id]);
    const before = await inTx((tx) => tx.select({ id: printJobs.id }).from(printJobs));

    await printSalePaymentSlip(suite.db, venue.cfg, billId);

    // In the order they were written: `rowid`, as `print_jobs` has no sequence of its own.
    const jobs = await inTx((tx) =>
      tx
        .select({ id: printJobs.id, payload: printJobs.payload })
        .from(printJobs)
        .orderBy(sql`rowid`),
    );
    const slips = jobs.filter((job) => !before.some((old) => old.id === job.id));
    const printed = slips.map((slip) => decodeTicket(slip.payload));
    expect(printed).toHaveLength(2);
    // In the order the money moved: the €20.00 card with no tip, then the €23.00 one with its tip.
    expect(printed[0]).toContain("20,00");
    expect(printed[0]).not.toContain("Propina");
    expect(printed[1]).toContain("23,00");
    expect(printed[1]).toContain("Propina");
  });

  it("records the lines an item payment covers with what they cost when paid", async () => {
    const billId = await tabWith("Chuletón", "Tarta");

    const paid = await take(
      billId,
      cash("18.00", { kind: "items", amount: undefined, lines: [{ lineNo: 2 }] }),
    );

    const rows = await inTx((tx) =>
      tx
        .select({ quantity: billPaymentLines.quantity, amount: billPaymentLines.amount })
        .from(billPaymentLines)
        .where(eq(billPaymentLines.billPaymentId, paid.payment.id)),
    );
    expect(rows).toEqual([{ quantity: 1000, amount: 1800 }]);
  });
});

describe("the receipt's payments, taken within one millisecond", () => {
  const AMOUNTS = [100, 200, 300, 400, 500, 2800];

  async function tenderLinesOf(billId: string) {
    const [sale] = await inTx((tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
    );
    return inTx((tx) => readBillTenderLines(tx, brandSaleId(sale!.id)));
  }

  it("lists the payments in the order they were taken", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const start = Date.now();
    const receivedAt = new Date(start + AMOUNTS.length).toISOString();
    const paymentId = descendingIds();
    for (const [taken, applied] of AMOUNTS.entries()) {
      await insertPayment(billId, {
        id: paymentId(),
        applied,
        state: "received",
        createdAt: new Date(start + taken).toISOString(),
        receivedAt,
      });
    }

    const tenderId = descendingIds();
    const tenderIds = vi.spyOn(crypto, "randomUUID").mockImplementation(tenderId);
    syncBuiltinESMExports();
    try {
      await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR));
    } finally {
      tenderIds.mockRestore();
      syncBuiltinESMExports();
    }

    const tenderIdsTaken = (
      await inTx((tx) =>
        tx
          .select({ id: tenders.id })
          .from(tenders)
          .innerJoin(billPayments, eq(billPayments.id, tenders.billPaymentId))
          .where(eq(billPayments.workingOrderId, billId))
          .orderBy(billPayments.createdAt),
      )
    ).map((row) => row.id);
    // Sorting by tender id, the old tie-break, would reverse the taking order.
    expect(tenderIdsTaken).toEqual([...tenderIdsTaken].sort().reverse());
    expect((await tenderLinesOf(billId)).map((line) => line.amount)).toEqual(
      AMOUNTS.map((cents) => (cents / 100).toFixed(2)),
    );
  });

  it("lists a payment's refunds in the order they were asked for", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const refunded = AMOUNTS.reduce((sum, cents) => sum + cents, 0);
    const paymentId = await insertPayment(billId, {
      applied: 4300 + refunded,
      state: "received",
      receivedAt: new Date().toISOString(),
    });
    const completedAt = new Date().toISOString();
    const refundId = descendingIds();
    for (const appliedAmount of AMOUNTS) {
      await inTx((tx) =>
        tx.insert(billPaymentRefunds).values({
          id: refundId(),
          billPaymentId: paymentId,
          submissionId: randomUUID(),
          fingerprint: "f",
          appliedAmount,
          reason: "error",
          authorizedBy: OPERATOR,
          requestedBy: OPERATOR,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
          state: "completed",
          completedAt,
        }),
      );
    }

    await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR));

    const [line] = await tenderLinesOf(billId);
    expect(line!.refunds.map((refund) => refund.amount)).toEqual(
      AMOUNTS.map((cents) => (cents / 100).toFixed(2)),
    );
  });
});

describe("the bill's payments, taken within one millisecond", () => {
  const AMOUNTS = [100, 200, 300, 400, 500, 2800];
  const decimals = AMOUNTS.map((cents) => (cents / 100).toFixed(2));

  it("shows the bill's payments in the order they were taken", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const at = new Date().toISOString();
    const paymentId = descendingIds();
    for (const applied of AMOUNTS) {
      await insertPayment(billId, {
        id: paymentId(),
        applied,
        state: "received",
        createdAt: at,
        receivedAt: at,
      });
    }

    const balance = await inTx((tx) => readBillBalance(tx, billId));

    expect(balance.payments.map((payment) => payment.applied)).toEqual(decimals);
  });

  it("shows a payment's refunds in the order they were asked for", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const at = new Date().toISOString();
    await insertPayment(billId, {
      applied: 4300 + AMOUNTS.reduce((sum, cents) => sum + cents, 0),
      state: "received",
      receivedAt: at,
    });
    const [payment] = (await inTx((tx) => readBillBalance(tx, billId))).payments;
    const refundId = descendingIds();
    for (const appliedAmount of AMOUNTS) {
      await inTx((tx) =>
        tx.insert(billPaymentRefunds).values({
          id: refundId(),
          billPaymentId: payment!.id,
          submissionId: randomUUID(),
          fingerprint: "f",
          appliedAmount,
          reason: "error",
          authorizedBy: OPERATOR,
          requestedBy: OPERATOR,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
          state: "completed",
          createdAt: at,
          completedAt: at,
        }),
      );
    }

    const balance = await inTx((tx) => readBillBalance(tx, billId));

    expect(balance.payments[0]!.refunds.map((refund) => refund.appliedAmount)).toEqual(decimals);
  });

  it("prints the card slips in the order the cards were taken", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const at = new Date().toISOString();
    const untipped = await insertPayment(billId, {
      applied: 2000,
      state: "received",
      receivedAt: at,
    });
    const tipped = await insertPayment(billId, {
      applied: 2300,
      tip: 200,
      state: "received",
      receivedAt: at,
    });
    const paymentId = descendingIds();
    // The cards are taken in the opposite order to their bill payments, so a tie broken by the
    // tenders' write order gives the wrong answer too.
    await inTx(async (tx) => {
      await tx.insert(payments).values([
        {
          id: paymentId(),
          workingOrderId: billId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
          provider: "simulator",
          paymentRef: randomUUID(),
          amount: 2500,
          state: "captured",
          settledAt: at,
          billPaymentId: tipped,
        },
        {
          id: paymentId(),
          workingOrderId: billId,
          source: venue.cfg.origin.source,
          deviceId: venue.cfg.origin.deviceId,
          provider: "simulator",
          paymentRef: randomUUID(),
          amount: 2000,
          state: "captured",
          settledAt: at,
          billPaymentId: untipped,
        },
      ]);
    });
    await inTx((tx) => issueIfFullyPaid(tx, fiscal(), venue.cfg, billId, OPERATOR));
    const before = await inTx((tx) => tx.select({ id: printJobs.id }).from(printJobs));

    await printSalePaymentSlip(suite.db, venue.cfg, billId);

    const jobs = await inTx((tx) =>
      tx
        .select({ id: printJobs.id, payload: printJobs.payload })
        .from(printJobs)
        .orderBy(sql`rowid`),
    );
    const printed = jobs
      .filter((job) => !before.some((old) => old.id === job.id))
      .map((slip) => decodeTicket(slip.payload));
    expect(printed).toHaveLength(2);
    expect(printed[0]).toContain("23,00");
    expect(printed[0]).toContain("Propina");
    expect(printed[1]).toContain("20,00");
    expect(printed[1]).not.toContain("Propina");
  });
});
