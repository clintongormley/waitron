import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printJobs, saleLines, sales, tenders, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { enqueueReceiptCopy } from "./receipt-print.js";
import { recordTillSale } from "./till-sale.js";
import { readOrderKitchenNotes, setOrderKitchenNote } from "./order-kitchen-note.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { inTx, OPERATOR, order, revisionOf, seat, setupPartyVenue } from "./testing/party-venue.js";

import { completeBillPayment } from "./bill-payments.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { buildReceiptDocument } from "./receipt-document.js";
import { layoutInvoicePages } from "./invoice-page.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { setOrderInvoiceChoice } from "./working-order.js";
import { billPayments, tenants, workingOrders } from "@waitron/db";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

afterEach(() => vi.restoreAllMocks());

describe("whole-order instructions and issued customer documents", () => {
  it.each(["58mm", "80mm"] as const)(
    "keeps commercial rows and %s customer receipts unchanged after an instruction edit",
    async (paperWidth) => {
      const v = await setupPartyVenue(suite.db);
      const fiscal = vi.spyOn(v.backend, "recordSale");
      const workingOrderId = randomUUID();
      const ticket = await recordTillSale(
        { db: v.db, backend: v.backend, clock: v.clock },
        v.cfg,
        {
          workingOrderId,
          zoneId: v.counter.zoneId,
          lines: [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
          tender: { method: "cash", amount: "12.00" },
          kitchenNote: "KITCHEN-ONLY original instruction",
        },
        v.operator,
      );
      expect(fiscal).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(fiscal.mock.calls[0]![1])).not.toContain("KITCHEN-ONLY");
      expect(JSON.stringify(ticket)).not.toContain("KITCHEN-ONLY");
      const before = {
        sales: await v.db.select().from(sales),
        saleLines: await v.db.select().from(saleLines),
        tenders: await v.db.select().from(tenders),
        orderLines: await v.db.select().from(workingOrderLines),
      };
      expect(before.sales).toHaveLength(1);
      const p = await inTx(v, (tx) =>
        createPrinter(
          tx,
          { locationId: v.cfg.locationId },
          { name: "Receipts", transport: "cloud_poll", pollId: randomUUID() },
        ),
      );
      const receipt = async () => {
        const queued = await inTx(v, (tx) =>
          enqueueReceiptCopy(tx, v.cfg, ticket, before.sales[0]!.id, {
            id: p.id,
            paperWidth,
            resolution: "203dpi",
          }),
        );
        expect(queued).toBeDefined();
        const [job] = await v.db.select().from(printJobs).where(eq(printJobs.id, queued!.jobId));
        const text = decodeTicket(job!.payload);
        expect(text).toContain("Hamburguesa de la casa");
        expect(text).toContain("12,00");
        expect(text).not.toContain("KITCHEN-ONLY");
        return job!;
      };
      const first = await receipt();
      const current = await inTx(v, async (tx) =>
        (await readOrderKitchenNotes(tx, [workingOrderId])).get(workingOrderId)!,
      );
      await inTx(v, (tx) =>
        setOrderKitchenNote(
          tx,
          v.db,
          v.cfg,
          { workingOrderId },
          {
            submissionId: randomUUID(),
            expectedNoteRevision: current.revision,
            expectedOwnerRevision: current.ownerRevision,
            note: "KITCHEN-ONLY updated instruction",
            operatorId: OPERATOR,
            deviceId: v.cfg.origin.deviceId,
          },
        ),
      );
      const second = await receipt();
      expect(second.payload).toEqual(first.payload);
      expect(await v.db.select().from(sales)).toEqual(before.sales);
      expect(await v.db.select().from(saleLines)).toEqual(before.saleLines);
      expect(await v.db.select().from(tenders)).toEqual(before.tenders);
      expect(await v.db.select().from(workingOrderLines)).toEqual(before.orderLines);
      expect((await v.db.select().from(printJobs).where(eq(printJobs.id, first.id)))[0]).toEqual(
        first,
      );
    },
  );
  it("keeps instructions outside the stored full invoice, its A4/email layout and transaction JSON", async () => {
    const v = await setupPartyVenue(suite.db);
    await inTx(v, (tx) =>
      tx.update(tenants).set({ taxpayerDomicile: "High Street 1, 28013 Madrid, Madrid, España" }),
    );
    const party = await seat(v, await v.table("Invoice party"));
    await order(v, party.tabId, "Burger");
    const initial = await inTx(v, async (tx) =>
      (await readOrderKitchenNotes(tx, [party.tabId])).get(party.tabId)!,
    );
    await inTx(v, (tx) =>
      setOrderKitchenNote(
        tx,
        v.db,
        v.cfg,
        { partyId: party.partyId },
        {
          submissionId: randomUUID(),
          expectedNoteRevision: initial.revision,
          expectedOwnerRevision: initial.ownerRevision,
          note: "KITCHEN-ONLY train instruction",
          operatorId: OPERATOR,
          deviceId: v.cfg.origin.deviceId,
        },
      ),
    );
    const [bill] = await v.db.select().from(workingOrders).where(eq(workingOrders.id, party.tabId));
    await setOrderInvoiceChoice(v.db, v.backend, v.cfg, party.tabId, {
      revision: bill!.revision,
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Invoice customer",
        countryCode: "ES",
        address: "High Street 2, 28013 Madrid, Madrid, España",
      },
    });
    const fiscal = vi.spyOn(v.backend, "recordSale");
    await inTx(v, async (tx) => {
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: party.tabId,
          submissionId: randomUUID(),
          fingerprint: "kitchen-note-invoice-audit",
          kind: "contribution",
          method: "cash",
          applied: 1200,
          tendered: 1200,
          state: "pending",
          requestedBy: OPERATOR,
          source: v.cfg.origin.source,
          deviceId: v.cfg.origin.deviceId,
        })
        .returning();
      await completeBillPayment(tx, v, v.cfg, payment!.id, new Date());
    });
    expect(fiscal).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fiscal.mock.calls[0]![1])).not.toContain("KITCHEN-ONLY");
    const [sale] = await v.db.select().from(sales).where(eq(sales.workingOrderId, party.tabId));
    const read = () =>
      inTx(v, async (tx) => ({
        document: await readInvoiceDocument(v.backend, tx, v.cfg, sale!.id),
        transaction: await readTransactionReceipt(v.backend, tx, v.cfg, sale!.id),
      }));
    const first = await read();
    expect(first.document.result.invoiceType).toBe("F1");
    expect(first.document.result.lines[0]!.descriptions).toEqual({
      "es-ES": "Hamburguesa de la casa",
    });
    expect(JSON.stringify(first)).not.toContain("KITCHEN-ONLY");
    const printed = buildReceiptDocument({ ...first.document, surface: "a4" });
    const layout = layoutInvoicePages(first.document);
    expect(JSON.stringify(printed)).toContain("Invoice customer");
    expect(JSON.stringify(layout)).toContain("Invoice customer");
    expect(JSON.stringify(printed)).not.toContain("KITCHEN-ONLY");
    expect(JSON.stringify(layout)).not.toContain("KITCHEN-ONLY");
    const current = await inTx(v, async (tx) =>
      (await readOrderKitchenNotes(tx, [party.tabId])).get(party.tabId)!,
    );
    expect(current.ownerRevision).toBe(await revisionOf(v, party.partyId));
    await inTx(v, (tx) =>
      setOrderKitchenNote(
        tx,
        v.db,
        v.cfg,
        { partyId: party.partyId },
        {
          submissionId: randomUUID(),
          expectedNoteRevision: current.revision,
          expectedOwnerRevision: current.ownerRevision,
          note: "KITCHEN-ONLY changed train",
          operatorId: OPERATOR,
          deviceId: v.cfg.origin.deviceId,
        },
      ),
    );
    expect(await read()).toEqual(first);
    expect(fiscal).toHaveBeenCalledTimes(1);
  });
});
