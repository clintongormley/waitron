import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import {
  billAdvances,
  invoiceSeries,
  sales,
  taxpayer,
  withTransaction,
  workingOrders,
  type Database,
} from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { createCategory, createProduct } from "@waitron/menu";
import { receiptLabelsFor } from "@waitron/country-packs";
import { localCalendarDate, type Dining } from "@waitron/shared";
import type { BillPaymentRequest } from "../bill-payments.js";
import { receiptDayNumeric } from "../receipt-dates.js";
import { formatReceipt } from "../receipt-ticket.js";
import type { TillSaleResult } from "../till-sale.js";
import { readTransactionReceipt } from "../transaction-receipt.js";
import { createTable } from "./live-table.js";
import { fireAll, openPartyTab } from "./serve-line.js";
import { offerProducts } from "./zone-offers.js";
import { printedLines, withoutRules } from "./decode-ticket.js";
import { inTx, provisionBillVenue, send, type Answer, type BillVenue } from "./bill-venue.js";

// Bills that take advances off their invoice (advances plan, worked examples 1, 2, 6 and 8), each
// at a table of its own, against a venue that files real Veri*Factu records.
const DISHES: {
  name: string;
  price: string;
  vatClass: "reduced" | "general";
  takeawayVatRate: string;
}[] = [
  { name: "Tasting menu", price: "120.00", vatClass: "reduced", takeawayVatRate: "10.00" },
  { name: "Bread roll", price: "1.05", vatClass: "reduced", takeawayVatRate: "10.00" },
  { name: "Salad bowl", price: "20.00", vatClass: "reduced", takeawayVatRate: "10.00" },
  { name: "Seafood platter", price: "30.05", vatClass: "reduced", takeawayVatRate: "10.00" },
  { name: "Wine case", price: "80.00", vatClass: "general", takeawayVatRate: "21.00" },
];

export const spanish = receiptLabelsFor("es-ES");

export interface AdvanceVenue {
  venue: BillVenue;
  offerFor(name: string): string;
}

export async function provisionAdvanceVenue(db: Database): Promise<AdvanceVenue> {
  const venue = await provisionBillVenue(db);
  await inTx(venue, (tx) =>
    tx.update(taxpayer).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" }),
  );
  const ids = new Map<string, string>();
  const offers = await inTx(venue, async (tx) => {
    const category = await createCategory(tx, { name: "Advance dishes" });
    for (const dish of DISHES) {
      const product = await createProduct(tx, {
        categoryId: category.id,
        name: dish.name,
        customerName: { es: `${dish.name} (customer)` },
        kitchenName: dish.name.toUpperCase(),
        pricingUnit: "each",
        unitPrice: dish.price,
        vatClass: dish.vatClass,
        takeawayVatRate: dish.takeawayVatRate,
      });
      ids.set(dish.name, product.id);
    }
    return offerProducts(tx, { zone: { zoneId: venue.zoneId }, orderStart: "table" });
  });
  return { venue, offerFor: (name) => offers.offerFor(ids.get(name)!) };
}

/** The steps of a bill with advances, on the venue `current()` answers once set up. */
export function advanceBills(current: () => AdvanceVenue) {
  const venue = () => current().venue;

  /** A party at a fresh table whose bill carries one line per named dish, its dishes sent. */
  function seated(...names: string[]): Promise<string> {
    return seatedFor("eat_in", names);
  }

  /** {@link seated}, the bill taken away: each dish files at its product's takeaway rate. */
  function seatedTakeaway(...names: string[]): Promise<string> {
    return seatedFor("takeaway", names);
  }

  function seatedFor(dining: Dining, names: string[]): Promise<string> {
    return withTransaction(venue().db, async (tx) => {
      const table = await createTable(tx, {
        label: `R-${randomUUID().slice(0, 8)}`,
        zoneId: venue().zoneId,
      });
      const { tabId } = await openPartyTab(tx, venue().cfg, {
        tableId: table.id,
        lines: names.map((name) => ({ menuItemId: current().offerFor(name), quantity: "1" })),
      });
      if (dining !== "eat_in") {
        await tx.update(workingOrders).set({ dining }).where(eq(workingOrders.id, tabId));
      }
      await fireAll(tx, venue().cfg, tabId);
      return tabId;
    });
  }

  function cash(billId: string, amount: string, extra: Record<string, unknown> = {}) {
    const body = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
      ...extra,
    } as BillPaymentRequest;
    return send(
      venue().app,
      venue().cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      body,
    );
  }

  /** A cash advance of `amount` whose payer wants their own receipt; its sale's id. */
  async function advance(billId: string, amount: string): Promise<string> {
    const paid = await cash(billId, amount, { ownReceipt: true });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const rows = await inTx(venue(), (tx) =>
      tx.select().from(billAdvances).where(eq(billAdvances.workingOrderId, billId)),
    );
    return rows.at(-1)!.advanceSaleId;
  }

  /** Pays `amount`, the rest of the bill, and answers the rest's invoice as the route printed it. */
  async function payRest(billId: string, amount: string): Promise<TillSaleResult> {
    const paid: Answer = await cash(billId, amount);
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    return paid.json.invoice as TillSaleResult;
  }

  async function restId(billId: string): Promise<string> {
    const [sale] = await inTx(venue(), (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
    );
    return sale!.id;
  }

  /** The advance's number and issue day as its own ticket prints them. */
  async function advanceFacts(
    saleId: string,
  ): Promise<{ invoiceNumber: string; issuedOn: string }> {
    const [row] = await inTx(venue(), (tx) =>
      tx
        .select({ sale: sales, code: invoiceSeries.code })
        .from(sales)
        .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
        .where(eq(sales.id, saleId)),
    );
    return {
      invoiceNumber: formatInvoiceNumber(row!.code, row!.sale.invoiceNumber),
      issuedOn: localCalendarDate(new Date(row!.sale.issuedAt), row!.sale.issuedOffsetMinutes),
    };
  }

  /** The Spanish words of the line taking off `advanceSaleId`. */
  async function caption(advanceSaleId: string): Promise<string> {
    const { invoiceNumber, issuedOn } = await advanceFacts(advanceSaleId);
    return spanish.advanceTakenOff
      .replace("{paymentOnAccount}", spanish.paymentOnAccount)
      .replace("{number}", invoiceNumber)
      .replace("{date}", receiptDayNumeric(issuedOn, "es-ES"));
  }

  function readTicket(saleId: string): Promise<TillSaleResult> {
    return inTx(venue(), (tx) => readTransactionReceipt(venue().backend, tx, venue().cfg, saleId));
  }

  return {
    seated,
    seatedTakeaway,
    cash,
    advance,
    payRest,
    restId,
    advanceFacts,
    caption,
    readTicket,
  };
}

const squeezed = (line: string) => line.replace(/\s+/g, " ").trim();

/** Printed lines, spaces squeezed, each amount that wrapped onto a line of its own joined back to
 * the caption it belongs to. */
export function entries(bytes: Uint8Array): string[] {
  const joined: string[] = [];
  for (const line of withoutRules(printedLines(bytes)).map(squeezed)) {
    if (/^-?[\d.]+,\d\d( [A-Z])?$/.test(line) && joined.length > 0)
      joined.push(`${joined.pop()} ${line}`);
    else joined.push(line);
  }
  return joined;
}

/** The entries `ticket` prints on 80mm paper, in its own language. */
export function printed(ticket: TillSaleResult, duplicate = false): string[] {
  const bytes = formatReceipt({
    result: ticket,
    issuer: ticket.issuer ?? { venueName: "Venue", nif: "B12345678" },
    receipt: {},
    invoiceLocale: ticket.locale,
    namesLocale: ticket.namesLocale,
    duplicate,
    printer: { paperWidth: "80mm", resolution: "180dpi" },
  });
  return entries(bytes);
}
