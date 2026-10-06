import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sales, tenders, withTransaction, workingOrderLines } from "@waitron/db";
import { inTx, seatedWith, send } from "./testing/bill-venue.js";
import {
  billlessSale,
  collect,
  credit,
  departed,
  parked,
  placedIssuedBill,
  provisionOrderVenue,
  voidInvoice,
  type OrderVenue,
} from "./testing/order-venue.js";
import { listOrders } from "./orders-list.js";
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

type Row = { id: string; [key: string]: unknown };
async function rowOf(id: string): Promise<Row> {
  const answer = await send(
    venue.orders,
    venue.supervisorDashboard,
    "GET",
    `/management-api/orders/${id}`,
  );
  expect(answer.status).toBe(200);
  return (answer.json as { row: Row }).row;
}
async function list(
  query: string,
): Promise<{ rows: Row[]; next: string | null; from: string | null; to: string | null }> {
  const answer = await send(
    venue.orders,
    venue.supervisorDashboard,
    "GET",
    `/management-api/orders?${query}`,
  );
  expect(answer.status).toBe(200);
  return answer.json as never;
}
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("facts this list relies on", () => {
  it("an open bill abandoned from the till keeps its lines", async () => {
    const id = await parked(venue, "Caña");
    const deleted = await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${id}`);
    expect(deleted.status).toBe(200);
    const lines = await inTx(venue, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)),
    );
    expect(lines).toHaveLength(1);
  });

  it("a till sale rung with no bill id is filed against a bill the sale made", async () => {
    const answer = await send(venue.app, venue.cookie, "POST", "/api/sales", {
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
      tender: { method: "cash", amount: "3.00" },
      zoneId: venue.zoneId,
    });
    expect(answer.status).toBe(200);
    const [sale] = await inTx(venue, (tx) =>
      tx
        .select({ bill: sales.workingOrderId })
        .from(sales)
        .orderBy(sql`${sales}.rowid desc`)
        .limit(1),
    );
    expect(sale!.bill).not.toBeNull();
  });
});

describe("each status, from the product's own write paths", () => {
  it("reads an open bill as Open, owing its lines, credited to who rang them", async () => {
    const party = await seatedWith(venue, "Caña");
    expect(await rowOf(party.tabId)).toMatchObject({
      kind: "bill",
      status: "open",
      total: "3.00",
      stillOwed: "3.00",
      invoiceNumber: null,
      staff: [{ id: venue.operatorId, name: "Ana" }],
      tables: [expect.stringMatching(/^Mesa /)],
      counter: false,
    });
  });

  it("reads an explicitly issued unpaid bill as Waiting for payment, with its invoice", async () => {
    const id = await placedIssuedBill(venue, "Tarta");
    expect(await rowOf(id)).toMatchObject({
      status: "waiting_for_payment",
      invoiceNumber: expect.stringMatching(/^A\/\d+$/),
      total: "18.00",
      stillOwed: "18.00",
      counter: true,
    });
  });

  it("reads a debt as Left without paying, then as Paid once collected, keeping when it left", async () => {
    const party = await departed(venue, "Botella tinto");
    const before = await rowOf(party.tabId);
    expect(before).toMatchObject({
      status: "left_without_paying",
      stillOwed: "30.00",
      departedAt: expect.any(String),
    });

    expect((await collect(venue, party.tabId, "30.00")).status).toBe(200);

    expect(await rowOf(party.tabId)).toMatchObject({
      status: "paid",
      stillOwed: null,
      departedAt: before.departedAt,
    });
  });

  const cancel = (id: string) =>
    send(venue.app, venue.supervisorTill, "POST", `/api/working-orders/${id}/cancel`, {
      reason: "Error",
    });

  it("reads a sent bill cancelled at the till as Cancelled and credited in full, with its credit note", async () => {
    const id = await placedIssuedBill(venue, "Caña");
    expect((await cancel(id)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      status: "cancelled",
      invoiceNumber: expect.stringMatching(/^A\/\d+$/),
      creditNotes: [expect.stringMatching(/^R\/\d+$/)],
      credited: "in_full",
      stillOwed: null,
    });
  });

  it("refuses to cancel a bill whose credit notes already bring its invoice to nothing, leaving its row as it was", async () => {
    const id = await placedIssuedBill(venue, "Caña");
    await credit(venue, id, "2.48", "-3.00");
    const before = await rowOf(id);
    expect(before).toMatchObject({ credited: "in_full", creditNotes: [expect.any(String)] });
    expect(await cancel(id)).toMatchObject({
      status: 409,
      json: { code: "sale.correction_exceeds_total" },
    });
    expect(await rowOf(id)).toEqual(before);
  });

  it("reads a debt cancelled at the till afterwards as Cancelled and credited in full, not Left without paying", async () => {
    const party = await departed(venue, "Caña");
    expect((await cancel(party.tabId)).status).toBe(200);
    expect(await rowOf(party.tabId)).toMatchObject({
      status: "cancelled",
      creditNotes: [expect.stringMatching(/^R\/\d+$/)],
      credited: "in_full",
      stillOwed: null,
      departedAt: expect.any(String),
    });
  });

  it("lists an open bill abandoned with lines as Cancelled, and leaves out an empty one never sent", async () => {
    const held = await parked(venue, "Caña");
    await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${held}`);
    expect(await rowOf(held)).toMatchObject({ status: "cancelled" });

    const empty = await seatedWith(venue);
    const finished = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${empty.partyId}/finish`,
      { expectedPartyRevision: empty.revision },
    );
    expect(finished.status).toBe(200);
    const answer = await send(
      venue.orders,
      venue.supervisorDashboard,
      "GET",
      `/management-api/orders/${empty.tabId}`,
    );
    expect(answer).toMatchObject({ status: 404, json: { code: "working_order.not_found" } });
  });

  it("reads a voided invoice's bill as Voided, ahead of Waiting for payment", async () => {
    const id = await placedIssuedBill(venue, "Caña");
    await voidInvoice(venue, id);
    expect(await rowOf(id)).toMatchObject({
      status: "voided",
      stillOwed: null,
    });
  });

  it("lists an invoice with no bill as its own row, by its issue time", async () => {
    const saleId = await billlessSale(venue);
    expect(await rowOf(saleId)).toMatchObject({
      kind: "sale",
      id: saleId,
      saleId,
      status: "paid",
      total: "12.10",
      staff: [{ id: venue.operatorId, name: "Ana" }],
    });
  });
});

describe("credit notes and what is still owed", () => {
  it("marks a part credit, and owes what the till's collect then charges, to the cent", async () => {
    const id = await placedIssuedBill(venue, "Botella tinto");
    await credit(venue, id, "2.00", "-2.42");
    const row = await rowOf(id);
    expect(row).toMatchObject({
      credited: "in_part",
      stillOwed: "27.58",
      creditNotes: [expect.stringMatching(/^R\/\d+$/)],
    });

    // 400: `sale.tender_shortfall` in the till's STATUS map (`apps/server/src/till-api.ts:292`).
    expect(await collect(venue, id, "27.57")).toMatchObject({
      status: 400,
      json: { code: "sale.tender_shortfall" },
    });
    expect((await collect(venue, id, row.stillOwed as string)).status).toBe(200);
    const [tender] = await inTx(venue, (tx) =>
      tx
        .select({ amount: tenders.amount })
        .from(tenders)
        .innerJoin(sales, eq(sales.id, tenders.saleId))
        .where(eq(sales.workingOrderId, id)),
    );
    expect(tender).toEqual({ amount: 2758 });
  });

  it("a debt credited to nothing stays Left without paying, Credited in full, owing nothing", async () => {
    const party = await departed(venue, "Botella tinto");
    await credit(venue, party.tabId, "24.79", "-30.00");
    expect(await rowOf(party.tabId)).toMatchObject({
      status: "left_without_paying",
      credited: "in_full",
      stillOwed: null,
    });
  });
});

describe("filters and search", () => {
  it("limits a till lookup to bills that still owe money", async () => {
    const waiting = await placedIssuedBill(venue, "Caña");
    const fullyCredited = await departed(venue, "Botella tinto");
    await credit(venue, fullyCredited.tabId, "24.79", "-30.00");
    const sale = await billlessSale(venue);
    const rows = await withTransaction(venue.db, (tx) =>
      listOrders(tx, {
        status: "all",
        dates: "any",
        credited: false,
        limit: 50,
        scope: "all",
        collectable: true,
      }),
    );
    expect(ids(rows.rows)).toContain(waiting);
    expect(ids(rows.rows)).not.toContain(fullyCredited.tabId);
    expect(ids(rows.rows)).not.toContain(sale);
  });

  it("Unpaid takes Waiting for payment and Left without paying, and nothing else", async () => {
    const waiting = await placedIssuedBill(venue, "Caña");
    const debt = await departed(venue, "Caña");
    const open = await seatedWith(venue, "Caña");
    const found = ids((await list("status=unpaid&anyDate=true&limit=200")).rows);
    expect(found).toEqual(expect.arrayContaining([waiting, debt.tabId]));
    expect(found).not.toContain(open.tabId);
  });

  it("finds an invoice by A/12, by its bare number, and by its credit note's number", async () => {
    const id = await placedIssuedBill(venue, "Croquetas");
    await credit(venue, id, "2.00", "-2.42");
    const row = await rowOf(id);
    const [, number] = (row.invoiceNumber as string).split("/");
    for (const q of [row.invoiceNumber as string, number!, (row.creditNotes as string[])[0]!]) {
      expect(
        ids((await list(`anyDate=true&limit=200&q=${encodeURIComponent(q)}`)).rows),
        q,
      ).toContain(id);
    }
  });

  it("finds a bill by its order number, before it has any invoice", async () => {
    const party = await seatedWith(venue, "Caña");
    const row = await rowOf(party.tabId);
    expect(row.invoiceNumber).toBeNull();
    expect(
      ids((await list(`anyDate=true&limit=200&q=${row.orderNumber as number}`)).rows),
    ).toContain(party.tabId);
  });

  it("matches a table in any letter case, and a % literally", async () => {
    const party = await seatedWith(venue, "Caña");
    const label = (await rowOf(party.tabId)).tables as string[];
    expect(
      ids(
        (await list(`anyDate=true&limit=200&table=${encodeURIComponent(label[0]!.toUpperCase())}`))
          .rows,
      ),
    ).toEqual([party.tabId]);
    expect((await list("anyDate=true&limit=200&q=%25")).rows).toEqual([]);
  });

  it("finds a party by its name", async () => {
    const party = await seatedWith(venue, "Caña");
    const named = await send(venue.app, venue.cookie, "PUT", `/api/parties/${party.partyId}/name`, {
      name: "Familia Ortega",
      expectedPartyRevision: party.revision,
    });
    expect(named.status).toBe(200);
    expect(ids((await list("anyDate=true&limit=200&q=ortega")).rows)).toEqual([party.tabId]);
  });

  it("filters by who a line is credited to, and by having a credit note", async () => {
    const id = await placedIssuedBill(venue, "Pulpo");
    await credit(venue, id, "2.00", "-2.42");
    expect(ids((await list(`anyDate=true&limit=200&staff=${venue.operatorId}`)).rows)).toContain(
      id,
    );
    expect(
      ids((await list(`anyDate=true&limit=200&staff=${venue.supervisorId}`)).rows),
    ).not.toContain(id);
    const credited = (await list("anyDate=true&limit=200&credited=true")).rows;
    expect(ids(credited)).toContain(id);
    expect(credited.every((row) => row.credited !== null)).toBe(true);
  });
});

describe("dates and pages", () => {
  // `opened_at` is written from `new Date()` (`nowIso`), so only `Date` is faked. Madrid is UTC+1 on
  // 2026-03-14; the venue's cut-over is 05:00 (bill-venue.ts:125).
  it("puts a bill opened a second before the cut-over on the previous business day", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-14T03:59:59.000Z") });
    let before: string, after: string;
    try {
      before = await parked(venue, "Caña");
      vi.setSystemTime(new Date("2026-03-14T04:00:00.000Z"));
      after = await parked(venue, "Caña");
    } finally {
      vi.useRealTimers();
    }
    const page = await withTransaction(venue.db, (tx) =>
      listOrders(tx, {
        status: "all",
        dates: {
          from: "2026-03-14",
          to: "2026-03-14",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        credited: false,
        limit: 200,
        scope: "all",
      }),
    );
    expect(ids(page.rows)).toEqual([after!]);
    expect(ids(page.rows)).not.toContain(before!);
  });

  it("pages across two bills opened at the same moment, newest first, then by id", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-02T12:00:00.000Z") });
    let pair: string[];
    try {
      pair = [await parked(venue, "Caña"), await parked(venue, "Caña")];
    } finally {
      vi.useRealTimers();
    }
    const query = "from=2026-02-02&to=2026-02-02&limit=1";
    const first = await list(query);
    expect(first.next).toMatch(/^2026-02-02T12:00:00\.000Z_/);
    const second = await list(`${query}&after=${encodeURIComponent(first.next!)}`);
    expect([...ids(first.rows), ...ids(second.rows)]).toEqual([...pair!].sort().reverse());
    expect(second.next).toBeNull();
  });

  it("defaults to today's business day and says which days it read", async () => {
    const page = await list("");
    expect(page.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(page.to).toBe(page.from);
    expect((await list("anyDate=true")).from).toBeNull();
  });
});
