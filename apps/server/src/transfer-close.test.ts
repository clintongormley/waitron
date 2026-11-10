import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { invoiceDeliveries, sales, transferClosures, workingOrders } from "@waitron/db";
import { markServed, readOrderRevision } from "./working-order.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import {
  fiscalRecordCount,
  inTx,
  placedCounterBillMovedTo,
  seatedWith,
  tendersOfBill,
} from "./testing/bill-venue.js";
import {
  RECIPIENT,
  refusal,
  transferCloseVenue,
  type TransferCloseKit,
} from "./testing/transfer-close-fixture.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { readReceiptOrder } from "./receipt-order.js";
import { readTransferClosure } from "./transfer-close.js";
import "./errors.js";

// Close one bill by transfer, new work only: every case calls the writer directly on
// a real venue that files Veri*Factu records, in its own transaction.
let t: TransferCloseKit;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await transferCloseVenue(db);
  },
});

function effects(billId: string) {
  return {
    billPayments: t.venue.db.all(
      sql`select id from bill_payments where working_order_id = ${billId}`,
    ),
    payments: t.venue.db.all(sql`select id from payments where working_order_id = ${billId}`),
    unpaid: t.venue.db.all(
      sql`select id from unpaid_departures where working_order_id = ${billId}`,
    ),
    drawers: t.venue.db.all(sql`select id from print_jobs where kind = 'drawer'`),
  };
}

async function serveAll(party: { partyId: string; tabId: string }): Promise<void> {
  const lines = t.venue.db.all<{ id: string }>(
    sql`select id from working_order_lines where working_order_id = ${party.tabId} and parent_line_id is null`,
  );
  const [row] = t.venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${party.partyId}`,
  );
  await inTx(t.venue, (tx) =>
    markServed(
      tx,
      t.venue.cfg,
      party.partyId,
      lines.map((line) => ({ lineId: line.id, quantity: "1" })),
      {
        expectedPartyRevision: row!.revision,
        operatorId: t.venue.operatorId,
        submissionId: randomUUID(),
      },
    ),
  );
}

describe("closeBillByTransferTx, new work", () => {
  it("issues a table bill's new F1 once, reserves its delivery and settles it as one transfer", async () => {
    const party = await seatedWith(t.venue, "Ensalada");
    await setOrderInvoiceChoice(t.venue.db, t.venue.backend, t.venue.cfg, party.tabId, {
      revision: await inTx(t.venue, (tx) => readOrderRevision(tx, party.tabId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    await inTx(t.venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.com",
            personId: t.venue.operatorId,
          },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );
    const request = await t.requestFor(party.tabId, "12.00", party.partyId, {
      delivery: { medium: "email", recipient: "customer@example.com" },
    });

    const result = await t.close(request);

    const [sale] = await inTx(t.venue, (tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, party.tabId)),
    );
    expect(fiscalRecordCount(t.venue, party.tabId)).toBe(1);
    expect(
      t.venue.db.all(
        sql`select tipo_factura from registros_facturacion where sale_id = ${sale!.id}`,
      ),
    ).toEqual([{ tipo_factura: "F1" }]);
    expect(
      await inTx(t.venue, (tx) =>
        tx
          .select({ medium: invoiceDeliveries.medium })
          .from(invoiceDeliveries)
          .where(eq(invoiceDeliveries.saleId, sale!.id)),
      ),
    ).toEqual([{ medium: "email" }]);
    expect(await tendersOfBill(t.venue, party.tabId)).toEqual([
      {
        method: "transfer",
        amount: 1200,
        tip: 0,
        billPaymentId: null,
        saleDeviceId: t.venue.cfg.origin.deviceId,
      },
    ]);
    expect(
      t.venue.db.all(sql`select cash_tendered from tenders where sale_id = ${sale!.id}`),
    ).toEqual([{ cash_tendered: null }]);
    expect(
      t.venue.db.all(sql`select settled_at from sale_settlements where sale_id = ${sale!.id}`),
    ).toEqual([{ settled_at: result.closedAt }]);
    expect(
      t.venue.db.all(sql`select status, settled_at from working_orders where id = ${party.tabId}`),
    ).toEqual([{ status: "settled", settled_at: result.closedAt }]);
    expect(result).toEqual({
      submissionId: request.submissionId,
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
    expect(await inTx(t.venue, (tx) => readTransferClosure(tx, party.tabId))).toEqual(result);
    const [row] = await inTx(t.venue, (tx) =>
      tx.select().from(transferClosures).where(eq(transferClosures.workingOrderId, party.tabId)),
    );
    expect(row).toMatchObject({
      id: request.submissionId,
      saleId: sale!.id,
      actorId: t.venue.operatorId,
      deviceId: t.venue.cfg.origin.deviceId,
      nodeId: t.venue.cfg.nodeId,
      closedAt: result.closedAt,
      businessDay: result.businessDay,
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(effects(party.tabId)).toEqual({
      billPayments: [],
      payments: [],
      unpaid: [],
      drawers: [],
    });
  });

  it("reuses an eligible invoice already issued, filing nothing new", async () => {
    const billId = await t.counterOrder("placed", true);
    const [before] = await inTx(t.venue, (tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
    );

    const result = await t.close(await t.requestFor(billId, "18.00", null));

    expect(fiscalRecordCount(t.venue, billId)).toBe(1);
    expect(
      await inTx(t.venue, (tx) => tx.select().from(sales).where(eq(sales.workingOrderId, billId))),
    ).toEqual([before]);
    expect(result).toMatchObject({
      saleId: before!.id,
      total: "18.00",
      party: { state: "not_applicable", blockers: [] },
    });
    expect(await tendersOfBill(t.venue, billId)).toMatchObject([
      { method: "transfer", amount: 1800, tip: 0 },
    ]);
  });

  it("freezes the receipt grouping of a presented party bill it issues", async () => {
    const party = await seatedWith(t.venue, "Ensalada");
    const billId = await placedCounterBillMovedTo(t.venue, t.counterZone, party);
    const atIssuance = await inTx(t.venue, (tx) =>
      readReceiptOrder(tx, billId, { atIssuance: true }),
    );

    await t.close(await t.requestFor(billId, "18.00", party.partyId));

    expect(atIssuance.orderLabel).toEqual(expect.stringContaining("Mesa"));
    expect(await inTx(t.venue, (tx) => readReceiptOrder(tx, billId))).toEqual(atIssuance);
  });

  it("refuses a Counter bill's new F1 through the full-invoice gate, writing nothing", async () => {
    const billId = await t.counterOrder("open");
    await setOrderInvoiceChoice(t.venue.db, t.venue.backend, t.venue.cfg, billId, {
      revision: await inTx(t.venue, (tx) => readOrderRevision(tx, billId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    const before = await t.ledger();

    const error = await refusal(t.close(await t.requestFor(billId, "18.00", null)));

    expect(error.code).toBe("sale.full_invoice_unavailable");
    expect(await t.ledger()).toEqual(before);
  });

  it("refuses party data on a Counter bill and a bill outside the named party's family", async () => {
    const counter = await t.counterOrder("open");
    const party = await seatedWith(t.venue, "Ensalada");
    const other = await seatedWith(t.venue, "Ensalada");
    const before = await t.ledger();

    const onCounter = await refusal(
      t.close(
        await t.requestFor(counter, "18.00", null, {
          partyFinish: {
            partyId: party.partyId,
            expectedPartyRevision: party.revision,
            expectedEdits: [],
          },
        }),
      ),
    );
    const elsewhere = await refusal(
      t.close(
        await t.requestFor(party.tabId, "12.00", party.partyId, {
          partyFinish: (await t.requestFor(other.tabId, "12.00", other.partyId)).partyFinish,
        }),
      ),
    );

    for (const error of [onCounter, elsewhere]) {
      expect(error.code).toBe("management.request_invalid");
      expect(error.params).toEqual({ field: "partyFinish" });
    }
    expect(await t.ledger()).toEqual(before);
  });

  it("finishes the party when its service is ready, and keeps it open on a revision blocker without expectations", async () => {
    const ready = await seatedWith(t.venue, "Ensalada");
    await serveAll(ready);
    const finished = await t.close(await t.requestFor(ready.tabId, "12.00", ready.partyId));
    const unexpected = await seatedWith(t.venue, "Ensalada");
    await serveAll(unexpected);
    const kept = await t.close(
      await t.requestFor(unexpected.tabId, "12.00", unexpected.partyId, { partyFinish: null }),
    );

    expect(finished.party).toEqual({ state: "closed", blockers: [] });
    expect(kept.party).toEqual({ state: "open", blockers: ["revision"] });
    expect(
      t.venue.db.all(
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
    const party = await seatedWith(t.venue, "Ensalada");
    await serveAll(party);
    const asked: string[][] = [];

    const result = await t.close(
      await t.requestFor(party.tabId, "12.00", party.partyId),
      t.depsWith({
        admitPartyRelease: (_tx, orderIds) => {
          asked.push([...orderIds]);
          return Promise.resolve("scope");
        },
      }),
    );

    expect(asked).toEqual([[party.tabId]]);
    expect(result.party).toEqual({ state: "open", blockers: ["scope"] });
    expect(t.venue.db.all(sql`select state from parties where id = ${party.partyId}`)).toEqual([
      { state: "open" },
    ]);
  });

  it("records one submission-keyed attendance capture for a bill placed before this command", async () => {
    const placed = await t.counterOrder("placed");
    const open = await t.counterOrder("open");
    const facts: Parameters<AttendanceRecorder>[1][] = [];
    const deps = t.depsWith({
      attendance: (_tx, fact) => {
        facts.push(fact);
        return Promise.resolve();
      },
    });

    const placedRequest = await t.requestFor(placed, "18.00", null);
    await t.close(placedRequest, deps);
    const placedFacts = facts.splice(0);
    await t.close(await t.requestFor(open, "18.00", null), deps);

    expect(placedFacts).toEqual([
      expect.objectContaining({
        source: "order",
        key: `service:${placed}:${placedRequest.submissionId}`,
        personId: t.venue.operatorId,
      }),
    ]);
    expect(facts.filter((fact) => fact.key.startsWith("service:"))).toEqual([]);
    expect(facts).toHaveLength(1);
  });

  it("rolls back the invoice, its number, outbox, delivery reservation and settlement on a later failure", async () => {
    const party = await seatedWith(t.venue, "Ensalada");
    await setOrderInvoiceChoice(t.venue.db, t.venue.backend, t.venue.cfg, party.tabId, {
      revision: await inTx(t.venue, (tx) => readOrderRevision(tx, party.tabId)),
      invoiceType: "F1",
      recipient: RECIPIENT,
    });
    await inTx(t.venue, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.com",
            personId: t.venue.operatorId,
          },
        })
        .where(eq(workingOrders.id, party.tabId)),
    );
    const request = await t.requestFor(party.tabId, "12.00", party.partyId, {
      delivery: { medium: "email", recipient: "customer@example.com" },
    });
    const before = await t.ledger();

    await expect(
      t.close(
        request,
        t.depsWith({
          admitPartyRelease: () => Promise.reject(new Error("injected after settlement")),
        }),
      ),
    ).rejects.toThrow("injected after settlement");

    expect(await t.ledger()).toEqual(before);
  });
});
