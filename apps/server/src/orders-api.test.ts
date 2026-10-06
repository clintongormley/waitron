import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { hashPin, deactivatePerson, persons } from "@waitron/identity";
import { invoiceSeries, tenants, withTransaction } from "@waitron/db";
import { recordSale } from "@waitron/core";
import { and, eq } from "drizzle-orm";
import { seriesId as brandSeriesId } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { send } from "./testing/bill-venue.js";
import {
  billlessSale,
  collect,
  credit,
  departed,
  parked,
  parkedBy,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";

let venue: OrderVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
  },
});

const get = (cookie: string, path: string) =>
  send(venue.orders, cookie, "GET", `/management-api/orders${path}`);

describe("Orders routes", () => {
  it("requires a dashboard session and accepts staff and supervisor sessions", async () => {
    expect(await get("", "?anyDate=true")).toMatchObject({
      status: 401,
      json: { code: "management_session.required" },
    });
    expect((await get(venue.staffDashboard, "?anyDate=true")).status).toBe(200);
    expect((await get(venue.supervisorDashboard, "?anyDate=true")).status).toBe(200);
  });

  it("lists active receipt printers for a staff dashboard reprint", async () => {
    expect(await get("", "/printers")).toMatchObject({ status: 401 });
    const answer = await get(venue.staffDashboard, "/printers");
    expect(answer).toMatchObject({ status: 200 });
    expect(answer.json).toEqual(expect.arrayContaining([{ id: venue.printerId, name: "Recibos" }]));
  });

  it("shows staff unfinished bills at any date and finished bills only from today's business day", async () => {
    const open = await parked(venue, "Caña");
    const waiting = await placedIssuedBill(venue, "Caña");
    const left = (await departed(venue, "Caña")).tabId;
    const paid = await placedIssuedBill(venue, "Caña");
    expect((await collect(venue, paid, "3.00")).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    let oldPaid: string;
    let oldOpen: string;
    try {
      oldPaid = await placedIssuedBill(venue, "Caña");
      expect((await collect(venue, oldPaid, "3.00")).status).toBe(200);
      oldOpen = await parked(venue, "Caña");
    } finally {
      vi.useRealTimers();
    }
    const cancelled = await placedIssuedBill(venue, "Caña");
    expect(
      (
        await send(
          venue.app,
          venue.supervisorTill,
          "POST",
          `/api/working-orders/${cancelled}/cancel`,
          {
            reason: "Error",
          },
        )
      ).status,
    ).toBe(200);
    const sale = await billlessSale(venue);

    const staff = await get(venue.staffDashboard, "?anyDate=true&limit=200");
    const manager = await get(venue.supervisorDashboard, "?anyDate=true&limit=200");
    expect(staff.status).toBe(200);
    expect(manager.status).toBe(200);
    const staffIds = (staff.json as { rows: { id: string }[] }).rows.map((row) => row.id);
    const managerIds = (manager.json as { rows: { id: string }[] }).rows.map((row) => row.id);
    expect(staffIds).toEqual(
      expect.arrayContaining([open, oldOpen, waiting, left, paid, cancelled]),
    );
    expect(staffIds).not.toEqual(expect.arrayContaining([oldPaid, sale]));
    expect(staffIds).not.toContain(oldPaid);
    expect(staffIds).not.toContain(sale);
    expect(managerIds).toEqual(
      expect.arrayContaining([open, oldOpen, waiting, left, paid, oldPaid, cancelled, sale]),
    );
    expect(await get(venue.staffDashboard, `/${oldPaid}`)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect((await get(venue.staffDashboard, `/${paid}`)).status).toBe(200);
    expect((await get(venue.supervisorDashboard, `/${paid}`)).status).toBe(200);
    expect(await get(venue.staffDashboard, `/${sale}`)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect((await get(venue.supervisorDashboard, `/${sale}`)).status).toBe(200);
    const staffPaid = await get(venue.staffDashboard, "?status=paid&anyDate=true");
    expect(staffPaid.status).toBe(200);
    expect((staffPaid.json as { rows: { id: string }[] }).rows.map((row) => row.id)).toContain(
      paid,
    );
    expect((staffPaid.json as { rows: { id: string }[] }).rows.map((row) => row.id)).not.toContain(
      oldPaid,
    );
    expect((staffPaid.json as { rows: { id: string }[] }).rows.map((row) => row.id)).not.toContain(
      cancelled,
    );
    const staffCancelled = await get(venue.staffDashboard, "?status=cancelled&anyDate=true");
    expect(staffCancelled.status).toBe(200);
    expect((staffCancelled.json as { rows: { id: string }[] }).rows.map((row) => row.id)).toContain(
      cancelled,
    );
    expect((await get(venue.staffDashboard, "?status=unpaid&anyDate=true")).status).toBe(200);
    expect((await get(venue.staffDashboard, "/staff")).status).toBe(200);
  });

  it.each([
    ["status=bogus", "status"],
    ["from=2026-02-30&to=2026-03-01", "from"],
    ["from=2026-03-02&to=2026-03-01", "range"],
    ["from=2026-03-01", "to"],
    ["anyDate=true&from=2026-03-01&to=2026-03-01", "anyDate"],
    ["anyDate=yes", "anyDate"],
    ["credited=1", "credited"],
    ["staff=nobody", "staff"],
    [`table=${"x".repeat(101)}`, "table"],
    [`q=${"x".repeat(101)}`, "q"],
    ["limit=0", "limit"],
    ["limit=201", "limit"],
    ["after=2026-03-01_x", "after"],
  ])("refuses %s beside %s", async (query, field) => {
    expect(await get(venue.supervisorDashboard, `?${query}`)).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field } },
    });
  });

  it("answers not found for malformed and unknown ids", async () => {
    for (const id of ["not-a-uuid", randomUUID()]) {
      expect(await get(venue.supervisorDashboard, `/${id}`)).toMatchObject({
        status: 404,
        json: { code: "working_order.not_found" },
      });
    }
  });

  it("keeps a deactivated colleague in the Staff filter", async () => {
    const [person] = await withTransaction(venue.db, (tx) =>
      tx
        .insert(persons)
        .values({ displayName: "Pablo", pinHash: hashPin("8888"), role: "staff" })
        .returning({ id: persons.id }),
    );
    await parkedBy(venue, person!.id, "Caña");
    await withTransaction(venue.db, (tx) =>
      deactivatePerson(tx, {
        managementSessionId: venue.adminDashboard.split("=")[1]!,
        personId: person!.id,
      }),
    );
    const answer = await get(venue.staffDashboard, "/staff");
    expect(answer).toMatchObject({
      status: 200,
      json: { staff: expect.arrayContaining([{ id: person!.id, name: "Pablo" }]) },
    });
  });

  it("reads a departed, part credited, collected bill's parts", async () => {
    const party = await departed(venue, "Botella tinto");
    await credit(venue, party.tabId, "2.00", "-2.42");
    const before = await get(venue.supervisorDashboard, `/${party.tabId}`);
    expect(before.status).toBe(200);
    const due = (before.json as { row: { stillOwed: string } }).row.stillOwed;
    expect((await collect(venue, party.tabId, due)).status).toBe(200);
    const answer = await get(venue.supervisorDashboard, `/${party.tabId}`);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      row: { status: "paid" },
      lines: [{ creditedTo: venue.operatorId }],
      invoices: [{ kind: "invoice" }, { kind: "credit_note" }],
      tenders: [{ method: "cash", amount: due }],
      party: { tables: [expect.stringMatching(/^Mesa /)] },
      departure: { reason: "Se marcharon sin pagar", recordedBy: "Sofía", authorizedBy: "Sofía" },
    });
  });

  it("identifies filed full and simplified invoices in order details", async () => {
    const simplified = await billlessSale(venue);
    const [tenant] = await venue.db.select({ domicile: tenants.taxpayerDomicile }).from(tenants);
    await withTransaction(venue.db, (tx) =>
      tx.update(tenants).set({ taxpayerDomicile: "Calle Fiscal 1, Madrid" }),
    );
    let full: string;
    try {
      full = await withTransaction(venue.db, async (tx) => {
        const [series] = await tx
          .select({ id: invoiceSeries.id })
          .from(invoiceSeries)
          .where(
            and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "full")),
          );
        const filed = await recordSale(tx, venue.backend, {
          origin: venue.cfg.origin,
          nodeId: venue.cfg.nodeId,
          seriesId: brandSeriesId(series!.id),
          locale: venue.cfg.locale,
          invoiceLocales: venue.cfg.invoiceLocales,
          counterparty: { taxId: "B12345674", legalName: "Cliente SL", countryCode: "ES" },
          recipientAddress: "Calle Mayor 2, 28013 Madrid, Madrid, España",
          total: "12.10",
          lines: [
            {
              lineNo: 1,
              name: "Venta suelta",
              descriptions: { [venue.cfg.locale]: "Venta suelta" },
              quantity: "1",
              unitPrice: "10.00",
              vatRate: "21.00",
              lineTotal: "10.00",
            },
          ],
          clock: venue.clock,
          settlement: {
            kind: "immediate",
            tenders: [
              { method: "cash", amount: "12.10", tipAmount: "0.00", settledAt: new Date() },
            ],
          },
          operatorId: venue.operatorId,
        });
        return filed.saleId;
      });
    } finally {
      await withTransaction(venue.db, (tx) =>
        tx.update(tenants).set({ taxpayerDomicile: tenant!.domicile }),
      );
    }

    const simplifiedDetail = await get(venue.supervisorDashboard, `/${simplified}`);
    const fullDetail = await get(venue.supervisorDashboard, `/${full}`);
    expect(simplifiedDetail.status).toBe(200);
    expect(fullDetail.status).toBe(200);
    expect((simplifiedDetail.json.invoices as object[])[0]).toMatchObject({
      kind: "invoice",
      invoiceType: "F2",
    });
    expect((fullDetail.json.invoices as object[])[0]).toMatchObject({
      kind: "invoice",
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        countryCode: "ES",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
      },
    });
    expect((fullDetail.json.invoices as object[])[0]).toMatchObject({
      taxpayerDomicile: "Calle Fiscal 1, Madrid",
    });

    const page = await get(venue.supervisorDashboard, "?anyDate=true&limit=200");
    expect(page.status).toBe(200);
    const rows = page.json.rows as { id: string; invoiceType: string | null }[];
    expect(rows.find((row) => row.id === simplified)?.invoiceType).toBe("F2");
    expect(rows.find((row) => row.id === full)?.invoiceType).toBe("F1");
  });
});
