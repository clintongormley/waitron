import crypto, { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPaymentLines,
  billPaymentRefunds,
  billPayments,
  BILL_PAYMENT_CHANGE_REFUSAL,
  captureError,
  diningTables,
  printJobs,
  sales,
  tenders,
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
import { hashPassword, hashPin } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { createPrinter } from "@waitron/printing";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import {
  assertBillInvariant,
  completeBillPayment,
  failBillPayment,
  issueIfFullyPaid,
  readBillBalance,
  readReceivedByBill,
  takeBillPayment,
  type BillPaymentRequest,
} from "./bill-payments.js";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { printSalePaymentSlip } from "./payment-slip-print.js";
import { createTable } from "./tables.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import type { TillConfig } from "./till-config.js";
import { collectOrder, payWorkingOrder, readBillTenderLines } from "./till-sale.js";
import {
  abandonHeldOrder,
  joinTable,
  moveTabLines,
  openTab,
  transferLines,
  unjoinTable,
  updateHeldOrder,
  voidTabLine,
} from "./working-order.js";
import "./errors.js";

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
  cfg: TillConfig;
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
        taxId: "62000001K",
        legalName: "Pagos SL",
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
        tillName: "Caja 1",
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
  const cfg: TillConfig = {
    tillId: brandTillId(provisioned.tillId),
    nodeId: brandNodeId(provisioned.nodeId),
    seriesId: brandSeriesId(provisioned.seriesIds[0]!),
    locationId: brandLocationId(provisioned.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  return withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const platos = await createCategory(tx, { name: { [LOCALE]: "Platos" } });
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
    await tx.run(sql`update tills set receipt_printer_id = ${printer.id}`);
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
    const { tabId } = await openTab(tx, venue.cfg, {
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
        tillId: venue.cfg.tillId,
        ...values,
      })
      .returning({ id: billPayments.id }),
  );
  return row!.id;
}

describe("the writers with no route of their own", () => {
  it("refuses moving a paid line between tabs", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    await take(billId, cash("25.00", { kind: "items", amount: undefined, lines: [{ lineNo: 1 }] }));
    const other = await tabWith("Caña");

    const code = await codeOf(inTx((tx) => moveTabLines(tx, venue.cfg, billId, other, [1])));

    expect(code).toBe("bill.line_paid");
  });

  it("refuses a move of unpaid lines that would leave the bill owing less than it received", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    await take(billId, cash("30.00"));
    const other = await tabWith("Caña");

    const error = await captureError(() =>
      inTx((tx) => moveTabLines(tx, venue.cfg, billId, other, [1])),
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

    const error = await captureError(() => inTx((tx) => voidTabLine(tx, venue.cfg, billId, 1)));

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

  it("refuses taking a paid line off a joined table", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    const second = await freshTable();
    await inTx((tx) => joinTable(tx, venue.cfg, billId, second));
    await take(billId, cash("25.00", { kind: "items", amount: undefined, lines: [{ lineNo: 1 }] }));

    const code = await codeOf(
      inTx((tx) => unjoinTable(tx, venue.cfg, billId, second, [{ lineNo: 1 }])),
    );

    expect(code).toBe("bill.line_paid");
    const [table] = await inTx((tx) =>
      tx
        .select({ tabId: diningTables.tabId })
        .from(diningTables)
        .where(eq(diningTables.id, second)),
    );
    expect(table!.tabId).toBe(billId);
  });

  it("refuses transferring more of a line than is unpaid", async () => {
    const billId = await inTx(async (tx) => {
      const { tabId } = await openTab(tx, venue.cfg, {
        tableId: await freshTableIn(tx),
        lines: [{ menuItemId: offer("Caña"), quantity: "3" }],
      });
      return tabId;
    });
    const other = await tabWith("Tarta");
    await take(
      billId,
      cash("6.00", { kind: "items", amount: undefined, lines: [{ lineNo: 1, quantity: "2" }] }),
    );
    const transfer = (quantity: string) =>
      inTx((tx) =>
        transferLines(tx, venue.cfg, billId, other, [{ lineNo: 1, quantity }], {
          operatorId: OPERATOR,
        }),
      );

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

  it("refuses a transfer of unpaid lines that would leave the bill owing less than it received", async () => {
    const billId = await tabWith("Chuletón", "Tarta");
    await take(billId, cash("30.00"));
    const other = await tabWith("Caña");

    const error = await captureError(() =>
      inTx((tx) =>
        transferLines(tx, venue.cfg, billId, other, [{ lineNo: 1 }], { operatorId: OPERATOR }),
      ),
    );

    expect(error).toMatchObject({
      code: "bill.received_exceeds_total",
      params: { workingOrderId: billId, excess: "12.00" },
    });
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
        tillId: venue.cfg.tillId,
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
        tillId: venue.cfg.tillId,
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

    const byBill = await inTx((tx) => readReceivedByBill(tx, [billId, other]));

    expect([...byBill]).toEqual([[billId, "4.00"]]);
  });
});

describe("the invoice at full payment", () => {
  it("files nothing more for a bill already settled", async () => {
    const billId = await tabWith("Caña");
    const paid = await take(billId, cash("3.00"));
    expect(paid.invoice).toBeDefined();

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
        tillId: venue.cfg.tillId,
        state: "completed",
        completedAt: new Date().toISOString(),
      }),
    );
    await inTx((tx) => voidTabLine(tx, venue.cfg, billId, 1));

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

  // Ids that sort against the order they are made in, so a tie broken by id gives the reverse of
  // the taking order on every run rather than by chance.
  function descendingIds() {
    const real = crypto.randomUUID.bind(crypto);
    let made = 0;
    return () =>
      `${(0xffffffff - made++).toString(16)}${real().slice(8)}` as ReturnType<typeof randomUUID>;
  }

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
          tillId: venue.cfg.tillId,
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
