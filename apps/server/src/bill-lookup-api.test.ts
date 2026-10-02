import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import { sales } from "@waitron/db";
import { recordSubstitution } from "@waitron/core";
import { saleId as brandSaleId } from "@waitron/shared";
import { inTx, seatedWith, send } from "./testing/bill-venue.js";
import {
  collect,
  credit,
  placedInvoiceFirst,
  provisionOrderVenue,
  voidInvoice,
  type OrderVenue,
} from "./testing/order-venue.js";
import { lookUpBills } from "./bill-lookup-api.js";
import "./errors.js";

let venue: OrderVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
  },
});

async function namedDebt(name: string) {
  const party = await seatedWith(venue, "Botella tinto");
  const named = await send(venue.app, venue.cookie, "PUT", `/api/parties/${party.partyId}/name`, {
    name,
    expectedPartyRevision: party.revision,
  });
  expect(named.status).toBe(200);
  const [row] = venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${party.partyId}`,
  );
  const left = await send(
    venue.app,
    venue.supervisorTill,
    "POST",
    `/api/parties/${party.partyId}/unpaid-departure`,
    { expectedPartyRevision: row!.revision, reason: "Se marcharon sin pagar" },
  );
  expect(left.status).toBe(200);
  return party;
}

function lookUp(q: string, cookie = venue.cookie) {
  return send(venue.app, cookie, "GET", `/api/bills/lookup?q=${encodeURIComponent(q)}`);
}

describe("till bill lookup", () => {
  it("no longer serves the read-only counter departure list", async () => {
    const answer = await send(venue.app, venue.cookie, "GET", "/api/unpaid-departures");
    expect(answer.status).toBe(404);
  });
  it("finds a debt by invoice number, table and party name with what it owes", async () => {
    const party = await namedDebt("Familia Ruiz");
    const detail = await send(
      venue.orders,
      venue.supervisorDashboard,
      "GET",
      `/management-api/orders/${party.tabId}`,
    );
    const row = (detail.json as { row: { invoiceNumber: string; tables: string[] } }).row;
    for (const q of [row.invoiceNumber, row.tables[0]!, "ruiz"]) {
      const answer = await lookUp(q);
      expect(answer.status).toBe(200);
      expect(answer.json).toMatchObject({
        bills: [
          expect.objectContaining({
            workingOrderId: party.tabId,
            status: "left_without_paying",
            stillOwed: "30.00",
            departedAt: expect.any(String),
          }),
        ],
      });
    }
  });

  it("removes a paid debt from lookup", async () => {
    const party = await namedDebt("Lucía Sol");
    expect((await lookUp("Lucía Sol")).json).toMatchObject({
      bills: [expect.objectContaining({ workingOrderId: party.tabId })],
    });
    expect((await collect(venue, party.tabId, "30.00")).status).toBe(200);
    expect((await lookUp("Lucía Sol")).json).toEqual({ bills: [] });
  });

  it("collecting the same bill twice records one tender", async () => {
    const party = await namedDebt("Twice only");
    expect((await collect(venue, party.tabId, "30.00")).status).toBe(200);
    expect((await collect(venue, party.tabId, "30.00")).status).toBe(200);
    const [row] = venue.db.all<{ count: number }>(
      sql`select count(*) as count from tenders t join sales s on s.id = t.sale_id where s.working_order_id = ${party.tabId}`,
    );
    expect(row!.count).toBe(1);
  });

  it("leaves out a voided or fully credited debt and reports a partial credit's remaining amount", async () => {
    const voided = await namedDebt("Voided debt");
    const credited = await namedDebt("Credited debt");
    const partial = await namedDebt("Partial debt");
    await voidInvoice(venue, voided.tabId);
    await credit(venue, credited.tabId, "24.79", "-30.00");
    await credit(venue, partial.tabId, "2.00", "-2.42");
    expect((await lookUp("Voided debt")).json).toEqual({ bills: [] });
    expect((await lookUp("Credited debt")).json).toEqual({ bills: [] });
    expect((await lookUp("Partial debt")).json).toMatchObject({
      bills: [expect.objectContaining({ stillOwed: "27.58" })],
    });
  });

  it("keeps a debt whose invoice is fully substituted, at its original amount", async () => {
    const party = await namedDebt("Substituted debt");
    const [issued] = await inTx(venue, (tx) =>
      tx
        .select({ id: sales.id })
        .from(sales)
        .where(sql`${sales.workingOrderId} = ${party.tabId}`),
    );
    await inTx(venue, (tx) =>
      recordSubstitution(tx, venue.backend, {
        tillId: venue.cfg.tillId,
        nodeId: venue.cfg.nodeId,
        seriesId: venue.cfg.seriesId,
        substitutedSaleIds: [brandSaleId(issued!.id)],
        counterparty: { taxId: "B12345678", legalName: "Cliente SL", countryCode: "ES" },
        total: "30.00",
        lines: [
          {
            lineNo: 1,
            name: "Botella tinto",
            descriptions: { [venue.cfg.locale]: "Rioja crianza" },
            quantity: "1",
            unitPrice: "24.79",
            vatRate: "21.00",
            lineTotal: "24.79",
          },
        ],
        locale: venue.cfg.locale,
        invoiceLocales: venue.cfg.invoiceLocales,
        clock: venue.clock,
      }),
    );
    expect((await lookUp("Substituted debt")).json).toMatchObject({
      bills: [expect.objectContaining({ workingOrderId: party.tabId, stillOwed: "30.00" })],
    });
  });

  it("finds a placed counter debt but leaves out an open or paid bill", async () => {
    const placed = await placedInvoiceFirst(venue, "Botella tinto");
    const [invoice] = venue.db.all<{ number: number; code: string }>(
      sql`select s.invoice_number as number, i.code from sales s join invoice_series i on i.id = s.series_id where s.working_order_id = ${placed}`,
    );
    const query = `${invoice!.code}/${invoice!.number}`;
    const answer = await lookUp(query);
    expect(answer.json).toMatchObject({
      bills: expect.arrayContaining([
        expect.objectContaining({ workingOrderId: placed, status: "waiting_for_payment" }),
      ]),
    });
    expect((await collect(venue, placed, "30.00")).status).toBe(200);
    const after = await lookUp(query);
    expect(
      (after.json as { bills: { workingOrderId: string }[] }).bills.map(
        (bill) => bill.workingOrderId,
      ),
    ).not.toContain(placed);
  });

  it("finds a debt by its order number and orders results newest first", async () => {
    const first = await namedDebt("Number search first");
    const second = await namedDebt("Number search second");
    const [row] = venue.db.all<{ orderNumber: number }>(
      sql`select order_number as orderNumber from working_orders where id = ${second.tabId}`,
    );
    expect((await lookUp(String(row!.orderNumber))).json).toMatchObject({
      bills: expect.arrayContaining([expect.objectContaining({ workingOrderId: second.tabId })]),
    });
    const names = (await lookUp("Number search")).json as { bills: { workingOrderId: string }[] };
    expect(names.bills.map((bill) => bill.workingOrderId).indexOf(second.tabId)).toBeLessThan(
      names.bills.map((bill) => bill.workingOrderId).indexOf(first.tabId),
    );
  });

  it("fills the twenty results from collectible bills after excluding a full credit", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 21; index++)
      ids.push((await namedDebt(`Lookup batch ${index}`)).tabId);
    await credit(venue, ids[20]!, "24.79", "-30.00");
    const answer = (await lookUp("Lookup batch")).json as { bills: { workingOrderId: string }[] };
    expect(answer.bills).toHaveLength(20);
    expect(answer.bills.map((bill) => bill.workingOrderId)).not.toContain(ids[20]);
    expect(answer.bills.map((bill) => bill.workingOrderId)).toContain(ids[0]);
  });

  it("uses the same number of reads for one bill as for twenty", async () => {
    async function reads(q: string) {
      return withTransaction(venue.db, async (tx) => {
        const spies = [
          vi.spyOn(tx, "select"),
          vi.spyOn(tx, "selectDistinct"),
          vi.spyOn(tx, "execute"),
        ];
        try {
          await lookUpBills(tx, q);
          return spies.reduce((count, spy) => count + spy.mock.calls.length, 0);
        } finally {
          for (const spy of spies) spy.mockRestore();
        }
      });
    }
    expect(await reads("Lookup batch 0")).toBe(await reads("Lookup batch"));
  });

  it("refuses an empty search and a caller without a session", async () => {
    const empty = await lookUp(" ");
    expect(empty.status).toBe(400);
    expect(empty.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "q" },
    });
    const long = await lookUp("x".repeat(101));
    expect(long.status).toBe(400);
    expect(long.json).toMatchObject({ code: "management.request_invalid", params: { field: "q" } });
    const anonymous = await lookUp("ruiz", "");
    expect(anonymous.status).toBe(401);
    expect(anonymous.json).toMatchObject({ code: "session.required" });
  });
});
