import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invoiceSeries, sales, tenants, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { inTx, seatedWith, send } from "./testing/bill-venue.js";
import { parked, provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { placeOrder, setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import { createOpenOrder, readOrderRevision } from "./working-order.js";
import { selectOrderInvoice } from "./invoice-selection.js";
import { decimal, saleId as brandSaleId } from "@waitron/shared";
import { readPartyBills } from "./parties.js";
import { readOrderDetail } from "./orders-list.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { readReceiptIssuer } from "./receipt-issuer.js";
import type { InvoiceRecipient } from "./invoice-selection.js";

let venue: OrderVenue;
let walkupZone: string;
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await db.update(tenants).set({ taxpayerDomicile: "8 Fiscal Street" });
    walkupZone = (
      await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, {
          zone: "counter",
          orderStart: "counter",
          paidWhen: "prepay",
        }),
      )
    ).zoneId;
  },
});
const foreign: InvoiceRecipient = {
  taxId: " Ab-09 /xy ",
  identifierType: "passport",
  identifierCountryCode: "FR",
  legalName: "Customer",
  countryCode: "ES",
  address: "2 Main Street, 28013 Madrid, Madrid",
};
const domestic: InvoiceRecipient = {
  taxId: "B12345674",
  legalName: "Customer",
  countryCode: "FR",
  address: "2 Main Street, Paris",
};
const cases = [
  { name: "foreign document, Spanish address", recipient: foreign },
  { name: "Spanish identifier, French address", recipient: domestic },
];

async function state() {
  return inTx(venue, async (tx) => ({
    series: await tx.select().from(invoiceSeries),
    rows: tx.all(
      sql`select (select count(*) from sales) sales, (select count(*) from registros_facturacion) records, (select count(*) from tenders) tenders, (select count(*) from payments) payments, (select count(*) from bill_payments) billPayments, (select count(*) from drawer_opens) drawers, (select count(*) from print_jobs) jobs`,
    ),
  }));
}
async function saved(orderId: string, recipient: InvoiceRecipient) {
  const [row] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, orderId));
  expect(row).toMatchObject({
    recipientTaxId: recipient.taxId,
    recipientIdentifierType: recipient.identifierType ?? null,
    recipientIdentifierCountryCode: recipient.identifierCountryCode ?? null,
    recipientCountryCode: recipient.countryCode,
    recipientAddress: recipient.address,
  });
}
async function issued(orderId: string, recipient: InvoiceRecipient) {
  const [row] = await suite.db.select().from(sales).where(eq(sales.workingOrderId, orderId));
  const saleId = row!.id;
  expect(row).toMatchObject({
    counterpartyTaxId: recipient.taxId,
    counterpartyIdentifierType: recipient.identifierType ?? null,
    counterpartyIdentifierCountryCode: recipient.identifierCountryCode ?? null,
    counterpartyCountryCode: recipient.countryCode,
    counterpartyAddress: recipient.address,
  });
  const facts = await inTx(venue, async (tx) => ({
    replay: await readTransactionReceipt(venue.backend, tx, venue.cfg, saleId),
    document: await readInvoiceDocument(venue.backend, tx, venue.cfg, saleId),
    issuer: await readReceiptIssuer(venue.backend, tx, brandSaleId(row!.id)),
    detail: await readOrderDetail(tx, orderId, "all", false),
  }));
  expect(facts.replay.recipient).toEqual(recipient);
  expect(facts.document.result.recipient).toEqual(recipient);
  expect("recipient" in facts.issuer && facts.issuer.recipient).toEqual(recipient);
  expect(facts.detail.invoices[0]!.recipient).toEqual(recipient);
}
async function choose(id: string, recipient: InvoiceRecipient, revision?: number) {
  revision ??= await inTx(venue, (tx) => readOrderRevision(tx, id));
  return setOrderInvoiceChoice(suite.db, venue.backend, venue.cfg, id, {
    revision,
    invoiceType: "F1",
    recipient,
  });
}

describe.each(cases)("recipient flow: $name", ({ recipient }) => {
  it("stores a walk-up choice while public counter F1 remains refused", async () => {
    const id = randomUUID();
    await inTx(venue, (tx) =>
      createOpenOrder(
        tx,
        venue.cfg,
        id,
        [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
        null,
        {
          zoneId: walkupZone,
          invoiceChoice: {
            invoiceType: "F1",
            recipient,
            recipientNameMaxLength: venue.backend.recipientNameMaxLength,
          },
        },
      ),
    );
    await saved(id, recipient);
    const selected = await inTx(venue, (tx) =>
      selectOrderInvoice(tx, venue.backend, venue.cfg, id, decimal("3.00")),
    );
    expect(selected.recipient).toEqual(recipient);
    const before = await state();
    const answer = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      workingOrderId: id,
      expectedEdit: null,
      zoneId: walkupZone,
      invoiceType: "F1",
      recipient,
      lines: [],
      tender: { method: "cash", amount: "5.00" },
    });
    expect(answer).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    expect(await state()).toEqual(before);
  });
  it("keeps a held order's identity through placement while collection stays refused", async () => {
    const id = await parked(venue, "Caña");
    await choose(id, recipient);
    await saved(id, recipient);
    await placeOrder(
      {
        admission: testTradingAdmission(),
        db: suite.db,
        backend: venue.backend,
        clock: venue.clock,
      },
      venue.cfg,
      id,
      venue.operatorId,
    );
    await saved(id, recipient);
    const selected = await inTx(venue, (tx) =>
      selectOrderInvoice(tx, venue.backend, venue.cfg, id, decimal("3.00")),
    );
    expect(selected.recipient).toEqual(recipient);
    const before = await state();
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/collect`,
      { tender: { method: "cash", amount: "5.00" } },
    );
    expect(answer).toEqual({
      status: 409,
      json: { code: "sale.full_invoice_unavailable", params: {} },
    });
    expect(await state()).toEqual(before);
  });
  it("keeps party bill reads and payment completion on the same identity", async () => {
    const party = await seatedWith(venue, "Caña");
    await choose(party.tabId, recipient);
    const bills = await inTx(venue, (tx) => readPartyBills(tx, party.partyId));
    expect(bills.find((b) => b.workingOrderId === party.tabId)!.recipient).toEqual(recipient);
    const request = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "3.00",
      method: "cash",
      tendered: "3.00",
      applied: "3.00",
      tip: "0.00",
    };
    const path = `/api/working-orders/${party.tabId}/payments`;
    const first = await send(venue.app, venue.cookie, "POST", path, request);
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const invoice = first.json.invoice as { saleId: string; recipient: InvoiceRecipient };
    expect(invoice.recipient).toEqual(recipient);
    await issued(party.tabId, recipient);
    const before = await state();
    const replay = await send(venue.app, venue.cookie, "POST", path, request);
    expect(replay.status).toBe(200);
    expect((replay.json.invoice as { recipient: InvoiceRecipient }).recipient).toEqual(recipient);
    expect(await state()).toEqual(before);
  });
});
it("revisions distinguish an identity-only edit and F2 clears both metadata fields", async () => {
  const id = await parked(venue, "Caña");
  const first = await choose(id, foreign);
  const second = await choose(
    id,
    { ...foreign, identifierType: "residence-country-id", identifierCountryCode: "GB" },
    first,
  );
  expect(second).toBe(first + 1);
  await saved(id, {
    ...foreign,
    identifierType: "residence-country-id",
    identifierCountryCode: "GB",
  });
  const before = await state();
  await expect(choose(id, foreign, first)).rejects.toMatchObject({
    code: "working_order.out_of_date",
  });
  expect(await state()).toEqual(before);
  await setOrderInvoiceChoice(suite.db, venue.backend, venue.cfg, id, {
    revision: second,
    invoiceType: "F2",
    recipient: null,
  });
  const [row] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
  expect(row).toMatchObject({
    invoiceType: "F2",
    recipientTaxId: null,
    recipientIdentifierType: null,
    recipientIdentifierCountryCode: null,
  });
});
it("refuses missing identity on a saved choice before numbering, provider or drawer changes", async () => {
  const id = await parked(venue, "Caña");
  const before = await state();
  const answer = await send(
    venue.app,
    venue.cookie,
    "PUT",
    `/api/working-orders/${id}/invoice-choice`,
    { revision: 0, expectedEdit: null, invoiceType: "F1", recipient: { ...foreign, taxId: " " } },
  );
  expect(answer).toEqual({
    status: 400,
    json: { code: "invoice.recipient_invalid", params: { field: "taxId" } },
  });
  expect(await state()).toEqual(before);
});

it.each(["cash", "manual", "reader"] as const)(
  "refuses a missing saved identifier before %s payment work",
  async (method) => {
    const party = await seatedWith(venue, "Caña");
    await choose(party.tabId, domestic);
    await suite.db
      .update(workingOrders)
      .set({ recipientTaxId: null })
      .where(eq(workingOrders.id, party.tabId));
    const before = await state();
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${party.tabId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "3.00",
        method: method === "cash" ? "cash" : "card",
        ...(method === "cash"
          ? { tendered: "3.00" }
          : { entry: method, ...(method === "manual" ? { externalRef: "refusal-test" } : {}) }),
        applied: "3.00",
        tip: "0.00",
      },
    );
    expect(answer).toEqual({
      status: 400,
      json: { code: "invoice.recipient_invalid", params: { field: "taxId" } },
    });
    expect(await state()).toEqual(before);
  },
);
