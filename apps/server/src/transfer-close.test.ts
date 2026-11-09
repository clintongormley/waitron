import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  invoiceDeliveries,
  parties,
  sales,
  tenants,
  transferClosures,
  workingOrders,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { readBillEditState, readPartyBillIds } from "./bill-editing.js";
import { partyFamily } from "./parties.js";
import { markServed, parkOrder, readOrderRevision } from "./working-order.js";
import { placeOrder, setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  fiscalRecordCount,
  inTx,
  provisionBillVenue,
  seatedWith,
  tendersOfBill,
  type BillVenue,
} from "./testing/bill-venue.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import {
  closeBillByTransferTx,
  readTransferClosure,
  type TransferCloseDeps,
} from "./transfer-close.js";
import type { CloseByTransferRequest } from "./transfer-close-types.js";
import "./errors.js";

// Close one bill by transfer, new work only (A275 Task 2): every case calls the writer directly on
// a real venue that files Veri*Factu records, in its own transaction.
let venue: BillVenue;
let counterZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counterZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      )
    ).zoneId;
    await inTx(venue, (tx) =>
      tx.update(tenants).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
    );
  },
});

const RECIPIENT = {
  taxId: "B12345674",
  legalName: "Cliente SL",
  address: "2 Main Street, 28013 Madrid, Madrid",
  countryCode: "ES",
};

function depsWith(over: Partial<TransferCloseDeps> = {}): TransferCloseDeps {
  return {
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    admission: testTradingAdmission(),
    admitPartyRelease: () => Promise.resolve("allowed"),
    ...over,
  };
}

function close(request: CloseByTransferRequest, deps = depsWith()) {
  return withTransaction(venue.db, (tx) =>
    closeBillByTransferTx(tx, deps, venue.cfg, request, venue.operatorId),
  );
}

async function refusal(run: Promise<unknown>): Promise<AppError> {
  const error = await run.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AppError)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error;
}

async function partyEdits(tx: Transaction, partyId: string) {
  const edits = [];
  for (const billId of (await readPartyBillIds(tx, await partyFamily(tx, partyId))).sort())
    edits.push(await readBillEditState(tx, billId));
  return edits;
}

async function requestFor(
  billId: string,
  expectedTotal: string,
  partyId: string | null,
  over: Partial<CloseByTransferRequest> = {},
): Promise<CloseByTransferRequest> {
  return inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision, invoiceType: workingOrders.invoiceType })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    const [party] =
      partyId === null ? [] : await tx.select().from(parties).where(eq(parties.id, partyId));
    return {
      id: billId,
      operationId: randomUUID(),
      expectedRevision: order!.revision,
      expectedEdit: partyId === null ? null : await readBillEditState(tx, billId),
      expectedTotal,
      invoiceType: order!.invoiceType,
      recipient: order!.invoiceType === "F1" ? RECIPIENT : null,
      receiptLanguage: venue.cfg.locale,
      delivery: null,
      partyFinish:
        party === undefined
          ? null
          : {
              partyId: party.id,
              expectedPartyRevision: party.revision,
              expectedEdits: await partyEdits(tx, party.id),
            },
      ...over,
    };
  });
}

/** Every row a rolled-back close must leave as it was: fiscal, numbering, outbox and delivery. */
function ledger() {
  return Object.fromEntries(
    [
      "sales",
      "registros_facturacion",
      "fiscal_allocations",
      "fiscal_reservations",
      "envios",
      "cadenas",
      "invoice_series",
      "invoice_deliveries",
      "tenders",
      "sale_settlements",
      "transfer_closures",
      "working_orders",
      "parties",
      "order_amendments",
    ].map((table) => [
      table,
      venue.db.all(sql`select * from ${sql.identifier(table)} order by rowid`),
    ]),
  );
}

function effects(billId: string) {
  return {
    billPayments: venue.db.all(
      sql`select id from bill_payments where working_order_id = ${billId}`,
    ),
    payments: venue.db.all(sql`select id from payments where working_order_id = ${billId}`),
    unpaid: venue.db.all(sql`select id from unpaid_departures where working_order_id = ${billId}`),
    drawers: venue.db.all(sql`select id from print_jobs where kind = 'drawer'`),
  };
}

/** A counter order of one Tarta (18.00), parked and, unless `open`, placed. */
async function counterOrder(state: "open" | "placed", issued = false): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    zoneId: counterZone,
    operatorId: venue.operatorId,
  });
  if (issued)
    await issueOrderInvoice(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
  if (state === "placed")
    await placeOrder(
      { ...deps, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
  return id;
}

async function serveAll(party: { partyId: string; tabId: string }): Promise<void> {
  const lines = venue.db.all<{ id: string }>(
    sql`select id from working_order_lines where working_order_id = ${party.tabId} and parent_line_id is null`,
  );
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${party.partyId}`,
  );
  await inTx(venue, (tx) =>
    markServed(
      tx,
      venue.cfg,
      party.partyId,
      lines.map((line) => ({ lineId: line.id, quantity: "1" })),
      {
        expectedPartyRevision: row!.revision,
        operatorId: venue.operatorId,
        submissionId: randomUUID(),
      },
    ),
  );
}

describe("closeBillByTransferTx, new work", () => {
  it("issues a table bill's new F1 once, reserves its delivery and settles it as one transfer", async () => {
    const party = await seatedWith(venue, "Ensalada");
    await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, party.tabId, {
      revision: await inTx(venue, (tx) => readOrderRevision(tx, party.tabId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.com",
            personId: venue.operatorId,
          },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );
    const request = await requestFor(party.tabId, "12.00", party.partyId, {
      delivery: { medium: "email", recipient: "customer@example.com" },
    });

    const result = await close(request);

    const [sale] = await inTx(venue, (tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, party.tabId)),
    );
    expect(fiscalRecordCount(venue, party.tabId)).toBe(1);
    expect(
      venue.db.all(sql`select tipo_factura from registros_facturacion where sale_id = ${sale!.id}`),
    ).toEqual([{ tipo_factura: "F1" }]);
    expect(
      await inTx(venue, (tx) =>
        tx
          .select({ medium: invoiceDeliveries.medium })
          .from(invoiceDeliveries)
          .where(eq(invoiceDeliveries.saleId, sale!.id)),
      ),
    ).toEqual([{ medium: "email" }]);
    expect(await tendersOfBill(venue, party.tabId)).toEqual([
      {
        method: "transfer",
        amount: 1200,
        tip: 0,
        billPaymentId: null,
        saleDeviceId: venue.cfg.origin.deviceId,
      },
    ]);
    expect(
      venue.db.all(sql`select cash_tendered from tenders where sale_id = ${sale!.id}`),
    ).toEqual([{ cash_tendered: null }]);
    expect(
      venue.db.all(sql`select settled_at from sale_settlements where sale_id = ${sale!.id}`),
    ).toEqual([{ settled_at: result.closedAt }]);
    expect(
      venue.db.all(sql`select status, settled_at from working_orders where id = ${party.tabId}`),
    ).toEqual([{ status: "settled", settled_at: result.closedAt }]);
    expect(result).toEqual({
      operationId: request.operationId,
      workingOrderId: party.tabId,
      saleId: sale!.id,
      invoiceNumber: expect.any(String),
      classification: "to_be_paid_by_transfer",
      closedAt: expect.any(String),
      businessDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      total: "12.00",
      currency: "EUR",
      party: { state: "open", blockers: ["service"] },
    });
    expect(await inTx(venue, (tx) => readTransferClosure(tx, party.tabId))).toEqual(result);
    const [row] = await inTx(venue, (tx) =>
      tx.select().from(transferClosures).where(eq(transferClosures.workingOrderId, party.tabId)),
    );
    expect(row).toMatchObject({
      id: request.operationId,
      saleId: sale!.id,
      actorId: venue.operatorId,
      deviceId: venue.cfg.origin.deviceId,
      nodeId: venue.cfg.nodeId,
      closedAt: result.closedAt,
      businessDay: result.businessDay,
      intent: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(effects(party.tabId)).toEqual({
      billPayments: [],
      payments: [],
      unpaid: [],
      drawers: [],
    });
  });

  it("reuses an eligible invoice already issued, filing nothing new", async () => {
    const billId = await counterOrder("placed", true);
    const [before] = await inTx(venue, (tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
    );

    const result = await close(await requestFor(billId, "18.00", null));

    expect(fiscalRecordCount(venue, billId)).toBe(1);
    expect(
      await inTx(venue, (tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId))),
    ).toEqual([before]);
    expect(result).toMatchObject({
      saleId: before!.id,
      total: "18.00",
      party: { state: "not_applicable", blockers: [] },
    });
    expect(await tendersOfBill(venue, billId)).toMatchObject([
      { method: "transfer", amount: 1800, tip: 0 },
    ]);
  });

  it("refuses a Counter bill's new F1 through the full-invoice gate, writing nothing", async () => {
    const billId = await counterOrder("open");
    await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, billId, {
      revision: await inTx(venue, (tx) => readOrderRevision(tx, billId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    const before = ledger();

    const error = await refusal(close(await requestFor(billId, "18.00", null)));

    expect(error.code).toBe("sale.full_invoice_unavailable");
    expect(ledger()).toEqual(before);
  });

  it("refuses party data on a Counter bill and a bill outside the named party's family", async () => {
    const counter = await counterOrder("open");
    const party = await seatedWith(venue, "Ensalada");
    const other = await seatedWith(venue, "Ensalada");
    const before = ledger();

    const onCounter = await refusal(
      close(
        await requestFor(counter, "18.00", null, {
          partyFinish: {
            partyId: party.partyId,
            expectedPartyRevision: party.revision,
            expectedEdits: [],
          },
        }),
      ),
    );
    const elsewhere = await refusal(
      close(
        await requestFor(party.tabId, "12.00", party.partyId, {
          partyFinish: (await requestFor(other.tabId, "12.00", other.partyId)).partyFinish,
        }),
      ),
    );

    for (const error of [onCounter, elsewhere]) {
      expect(error.code).toBe("management.request_invalid");
      expect(error.params).toEqual({ field: "partyFinish" });
    }
    expect(ledger()).toEqual(before);
  });

  it("finishes the party when its service is ready, and keeps it open on a revision blocker without expectations", async () => {
    const ready = await seatedWith(venue, "Ensalada");
    await serveAll(ready);
    const finished = await close(await requestFor(ready.tabId, "12.00", ready.partyId));
    const unexpected = await seatedWith(venue, "Ensalada");
    await serveAll(unexpected);
    const kept = await close(
      await requestFor(unexpected.tabId, "12.00", unexpected.partyId, { partyFinish: null }),
    );

    expect(finished.party).toEqual({ state: "closed", blockers: [] });
    expect(kept.party).toEqual({ state: "open", blockers: ["revision"] });
    expect(
      venue.db.all(
        sql`select id, state from parties where id in (${ready.partyId}, ${unexpected.partyId})`,
      ),
    ).toEqual(
      expect.arrayContaining([
        { id: ready.partyId, state: "closed" },
        { id: unexpected.partyId, state: "open" },
      ]),
    );
  });

  it("keeps the party open when release admission refuses its family", async () => {
    const party = await seatedWith(venue, "Ensalada");
    await serveAll(party);
    const asked: string[][] = [];

    const result = await close(
      await requestFor(party.tabId, "12.00", party.partyId),
      depsWith({
        admitPartyRelease: (_tx, orderIds) => {
          asked.push([...orderIds]);
          return Promise.resolve("scope");
        },
      }),
    );

    expect(asked).toEqual([[party.tabId]]);
    expect(result.party).toEqual({ state: "open", blockers: ["scope"] });
    expect(venue.db.all(sql`select state from parties where id = ${party.partyId}`)).toEqual([
      { state: "open" },
    ]);
  });

  it("records one operation-keyed attendance capture for a bill placed before this command", async () => {
    const placed = await counterOrder("placed");
    const open = await counterOrder("open");
    const facts: Parameters<AttendanceRecorder>[1][] = [];
    const deps = depsWith({
      attendance: (_tx, fact) => {
        facts.push(fact);
        return Promise.resolve();
      },
    });

    const placedRequest = await requestFor(placed, "18.00", null);
    await close(placedRequest, deps);
    const placedFacts = facts.splice(0);
    await close(await requestFor(open, "18.00", null), deps);

    expect(placedFacts).toEqual([
      expect.objectContaining({
        source: "order",
        key: `service:${placed}:${placedRequest.operationId}`,
        personId: venue.operatorId,
      }),
    ]);
    expect(facts.filter((fact) => fact.key.startsWith("service:"))).toEqual([]);
    expect(facts).toHaveLength(1);
  });

  it("rolls back the invoice, its number, outbox, delivery reservation and settlement on a later failure", async () => {
    const party = await seatedWith(venue, "Ensalada");
    await setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, party.tabId, {
      revision: await inTx(venue, (tx) => readOrderRevision(tx, party.tabId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.com",
            personId: venue.operatorId,
          },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );
    const request = await requestFor(party.tabId, "12.00", party.partyId, {
      delivery: { medium: "email", recipient: "customer@example.com" },
    });
    const before = ledger();

    await expect(
      close(
        request,
        depsWith({
          admitPartyRelease: () => Promise.reject(new Error("injected after settlement")),
        }),
      ),
    ).rejects.toThrow("injected after settlement");

    expect(ledger()).toEqual(before);
  });
});
