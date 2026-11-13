import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billPayments,
  products,
  sales,
  saleLines,
  tenants,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createExtraList, updateProduct, writeProductModifiers } from "@waitron/catalogue";
import {
  billWith,
  placeGrouped,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { payWorkingOrder } from "./testing/whole-payment-fixture.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { readStoredOrder } from "./working-order.js";
import { receiptLines } from "./receipt-adjustments.js";
import { readReceiptEmailDocument, readInvoiceDocument } from "./invoice-document.js";
import { completeBillPayment } from "./bill-payments.js";
import { readTransactionReceipt } from "./transaction-receipt.js";

let venue: AdjustmentVenue;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

describe("recorded lunch receipts", () => {
  it.each(["F2", "F1"] as const)(
    "keeps %s lunch presentation after catalogue edits and on reprint",
    async (invoiceType) => {
      const { billId, partyId } = await billWith(venue, []);
      const lunchId = await withTransaction(suite.db, async (tx) => {
        const all = await tx.select().from(products);
        const lunch = all.find((row) => row.name === "Pizza")!;
        const coffee = all.find((row) => row.name === "Coffee")!;
        await updateProduct(tx, lunch.id, {
          setLunch: true,
          unitPrice: "18.00",
          vatClass: "reduced",
        });
        const list = await createExtraList(
          tx,
          {
            name: "Lunch choices",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: 2,
            active: true,
            items: [
              { productId: venue.olivesId, maxQuantity: 1, preselected: false, price: "3.00" },
              { productId: coffee.id, maxQuantity: 1, preselected: false, price: "0.00" },
            ],
          },
          venue.cfg.locale,
        );
        await writeProductModifiers(tx, lunch.id, [{ kind: "extras", id: list.id }]);
        const offers = await offerProducts(tx, venue.cfg, {
          zone: { zoneId: venue.tables.zoneId },
          orderStart: "table",
        });
        const one = {
          menuItemId: offers.offerFor(lunch.id),
          quantity: "1",
          extras: [
            {
              listId: list.id,
              picks: [
                { productId: venue.olivesId, quantity: 1 },
                { productId: coffee.id, quantity: 1 },
              ],
            },
          ],
        };
        await placeGrouped(
          tx,
          venue.cfg,
          { partyId, tabId: billId },
          [
            one,
            one,
            {
              menuItemId: offers.offerFor(all.find((row) => row.name === "Burger")!.id),
              quantity: "1",
            },
          ],
          "fire",
          venue.staffId,
        );
        const stored = await readStoredOrder(tx, billId);
        const preview = await receiptLines(tx, billId, stored.gross, stored.identities);
        expect(preview.lines.filter((line) => line.parentLineNo == null)).toMatchObject([
          { setLunch: true, gross: "18.00" },
          { setLunch: true, gross: "18.00" },
          { gross: "12.00" },
        ]);
        expect(preview.lines.map((line) => line.gross)).toEqual([
          "18.00",
          "3.00",
          "0.00",
          "18.00",
          "3.00",
          "0.00",
          "12.00",
        ]);
        return lunch.id;
      });
      if (invoiceType === "F1") {
        await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
        const [order] = await suite.db
          .select()
          .from(workingOrders)
          .where(eq(workingOrders.id, billId));
        await setOrderInvoiceChoice(suite.db, venue.backend, venue.cfg, billId, {
          revision: order!.revision,
          invoiceType,
          recipient: {
            taxId: "B12345674",
            legalName: "Customer",
            address: "2 Main Street, 28013 Madrid, Madrid",
            countryCode: "ES",
          },
        });
      }
      const original =
        invoiceType === "F2"
          ? await payWorkingOrder(
              { ...venue, admission: testTradingAdmission() },
              venue.cfg,
              { id: billId, tender: { method: "cash", amount: "54.00" }, lines: [] },
              venue.staffId,
            )
          : await withTransaction(suite.db, async (tx) => {
              const [payment] = await tx
                .insert(billPayments)
                .values({
                  workingOrderId: billId,
                  submissionId: randomUUID(),
                  fingerprint: `lunch-${billId}`,
                  kind: "contribution",
                  method: "card",
                  applied: 5400,
                  state: "pending",
                  requestedBy: venue.staffId,
                  source: venue.cfg.origin.source,
                  deviceId: venue.cfg.origin.deviceId,
                })
                .returning();
              return (
                await completeBillPayment(
                  tx,
                  { ...venue, admission: testTradingAdmission() },
                  venue.cfg,
                  payment!.id,
                  new Date(),
                )
              ).invoice!;
            });
      expect(original.total).toBe("54.00");
      expect(original.lines.filter((line) => line.parentLineNo == null)).toMatchObject([
        { setLunch: true },
        { setLunch: true },
        { gross: "12.00" },
      ]);
      expect(original.lines.at(-1)).not.toHaveProperty("setLunch");
      const [sale] = await suite.db.select().from(sales).where(eq(sales.workingOrderId, billId));
      const frozen = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, sale!.id));
      await withTransaction(suite.db, async (tx) => {
        await updateProduct(tx, lunchId, {
          setLunch: false,
          unitPrice: "99.00",
          customerName: { es: "Changed lunch" },
        });
        await offerProducts(tx, venue.cfg, {
          zone: { zoneId: venue.tables.zoneId },
          orderStart: "table",
        });
        const replay = await readTransactionReceipt(venue.backend, tx, venue.cfg, sale!.id);
        expect(replay.lines).toEqual(original.lines);
        expect(replay.total).toBe("54.00");
        const document = await readReceiptEmailDocument(venue.backend, tx, venue.cfg, sale!.id);
        expect(document.result.lines).toEqual(original.lines);
        if (invoiceType === "F1") {
          const invoice = await readInvoiceDocument(venue.backend, tx, venue.cfg, sale!.id);
          expect(invoice.result.lines).toEqual(original.lines);
        }
      });
      expect(await suite.db.select().from(saleLines).where(eq(saleLines.saleId, sale!.id))).toEqual(
        frozen,
      );
    },
  );
  it("keeps an ordinary recorded dish ordinary after the product becomes a lunch", async () => {
    const { billId } = await billWith(venue, [{ name: "Burger" }]);
    const original = await payWorkingOrder(
      { ...venue, admission: testTradingAdmission() },
      venue.cfg,
      { id: billId, tender: { method: "cash", amount: "12.00" }, lines: [] },
      venue.staffId,
    );
    expect(original.lines[0]).not.toHaveProperty("setLunch");
    await withTransaction(suite.db, async (tx) => {
      const all = await tx.select().from(products);
      await updateProduct(tx, all.find((row) => row.name === "Burger")!.id, { setLunch: true });
      await offerProducts(tx, venue.cfg, {
        zone: { zoneId: venue.tables.zoneId },
        orderStart: "table",
      });
      const [sale] = await tx.select().from(sales).where(eq(sales.workingOrderId, billId));
      const replay = await readTransactionReceipt(venue.backend, tx, venue.cfg, sale!.id);
      expect(replay.lines).toEqual(original.lines);
      expect(replay.lines[0]).not.toHaveProperty("setLunch");
    });
  });
});
