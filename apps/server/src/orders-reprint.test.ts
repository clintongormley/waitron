import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { printJobs, printers, receiptReprints, sales } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { inTx, send } from "./testing/bill-venue.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import {
  billlessSale,
  collect,
  parked,
  placedInvoiceFirst,
  provisionOrderVenue,
  voidInvoice,
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

const post = (cookie: string, billId: string, printerId?: string) =>
  send(
    venue.orders,
    cookie,
    "POST",
    `/management-api/orders/${billId}/reprint`,
    printerId === undefined ? {} : { printerId },
  );

async function counts() {
  const [jobs, opens, saleRows, fiscalRows, settlements, tenders, reprints] = await Promise.all([
    venue.db.all<{ n: number }>(sql`select count(*) as n from print_jobs`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from drawer_opens`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from sales`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from registros_facturacion`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from sale_settlements`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from tenders`),
    venue.db.all<{ n: number }>(sql`select count(*) as n from receipt_reprints`),
  ]);
  return {
    jobs: jobs[0]!.n,
    opens: opens[0]!.n,
    saleRows: saleRows[0]!.n,
    fiscalRows: fiscalRows[0]!.n,
    settlements: settlements[0]!.n,
    tenders: tenders[0]!.n,
    reprints: reprints[0]!.n,
  };
}

describe("dashboard receipt reprint", () => {
  it("prints one marked copy on the picked printer without opening a drawer or filing", async () => {
    const billId = await placedInvoiceFirst(venue, "Caña");
    expect((await collect(venue, billId, "3.00")).status).toBe(200);
    const [sale] = await inTx(venue, (tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, billId)),
    );
    const before = await counts();
    const answer = await post(venue.adminDashboard, billId, venue.printerId);
    expect(answer.status).toBe(202);
    const jobId = (answer.json as { jobId: string }).jobId;
    const [job] = await inTx(venue, (tx) =>
      tx.select().from(printJobs).where(eq(printJobs.id, jobId)),
    );
    expect(job).toMatchObject({
      id: jobId,
      printerId: venue.printerId,
      kind: "document",
      saleId: sale!.id,
    });
    expect(decodeTicket(job!.payload)).toContain("DUPLICADO");
    const after = await counts();
    expect(after).toEqual({ ...before, jobs: before.jobs + 1, reprints: before.reprints + 1 });
    const [audit] = await inTx(venue, (tx) =>
      tx.select().from(receiptReprints).where(eq(receiptReprints.printJobId, jobId)),
    );
    expect(audit).toMatchObject({ saleId: sale!.id, printJobId: jobId, personId: venue.adminId });
    const [saleAfter] = await inTx(venue, (tx) =>
      tx.select().from(sales).where(eq(sales.id, sale!.id)),
    );
    expect(saleAfter).toEqual(sale);
    const detail = await send(
      venue.orders,
      venue.adminDashboard,
      "GET",
      `/management-api/orders/${billId}`,
    );
    expect(detail.json).toMatchObject({
      reprints: [{ personName: "Administradora", printerName: "Recibos" }],
    });
  });

  it("prints on a second printer chosen for this copy", async () => {
    const billId = await placedInvoiceFirst(venue, "Caña");
    const printer = await inTx(venue, (tx) =>
      createPrinter(
        tx,
        { locationId: venue.cfg.locationId },
        {
          name: "Oficina",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
          hasCashDrawer: true,
        },
      ),
    );
    const answer = await post(venue.adminDashboard, billId, printer.id);
    expect(answer.status).toBe(202);
    const [job] = await inTx(venue, (tx) =>
      tx
        .select()
        .from(printJobs)
        .where(eq(printJobs.id, (answer.json as { jobId: string }).jobId)),
    );
    expect(job?.printerId).toBe(printer.id);
  });

  it("refuses a session without print.resend, a void, an uninvoiced bill and an inactive printer without writing", async () => {
    const valid = await placedInvoiceFirst(venue, "Caña");
    const voided = await placedInvoiceFirst(venue, "Caña");
    await voidInvoice(venue, voided);
    const open = await parked(venue, "Caña");
    const noBill = await billlessSale(venue);
    const other = await inTx(venue, (tx) =>
      createPrinter(
        tx,
        { locationId: venue.cfg.locationId },
        {
          name: "Inactive",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        },
      ),
    );
    await inTx(venue, (tx) =>
      tx.update(printers).set({ active: false }).where(eq(printers.id, other.id)),
    );
    const before = await counts();
    expect(await post(venue.supervisorDashboard, valid, venue.printerId)).toMatchObject({
      status: 403,
      json: { code: "authorization.not_permitted" },
    });
    expect(await post(venue.staffDashboard, valid, venue.printerId)).toMatchObject({
      status: 403,
      json: { code: "authorization.not_permitted" },
    });
    expect(await post(venue.adminDashboard, valid, randomUUID())).toMatchObject({
      status: 404,
      json: { code: "printer.not_found" },
    });
    expect(await post(venue.adminDashboard, valid)).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "printerId" } },
    });
    expect(await post(venue.adminDashboard, voided, venue.printerId)).toMatchObject({
      status: 409,
      json: { code: "sale.voided" },
    });
    expect(await post(venue.adminDashboard, randomUUID(), venue.printerId)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect(await post(venue.adminDashboard, open, venue.printerId)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect(await post(venue.adminDashboard, noBill, venue.printerId)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect(await post(venue.adminDashboard, valid, other.id)).toMatchObject({
      status: 404,
      json: { code: "printer.not_found" },
    });
    const after = await counts();
    expect(after.jobs).toBe(before.jobs);
    expect(after.reprints).toBe(before.reprints);
  });
});
