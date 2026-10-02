import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { deviceProfiles, printJobs, printers, receiptReprints, sales, tenants } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import type { FiscalBackend } from "@waitron/fiscal";
import { inTx, send } from "./testing/bill-venue.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { DEV_DEVICE_HEADER, DEVICE_COOKIE } from "./device-session.js";
import { mountOrdersApi } from "./orders-api.js";
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
  it("does not queue a job or audit row when a copy cannot be built", async () => {
    const billId = await placedInvoiceFirst(venue, "Caña");
    const before = await counts();
    const [taxpayer] = await inTx(venue, (tx) => tx.select().from(tenants));
    await inTx(venue, (tx) => tx.delete(tenants));
    try {
      expect(await post(venue.adminDashboard, billId, venue.printerId)).toMatchObject({
        status: 500,
        json: { code: "server.internal" },
      });
      expect(await counts()).toEqual(before);
    } finally {
      await inTx(venue, (tx) => tx.insert(tenants).values(taxpayer!));
    }
  });

  it("logs an Orders failure when receipt reconstruction throws, without queuing a copy", async () => {
    const billId = await placedInvoiceFirst(venue, "Caña");
    const backend = Object.create(venue.backend) as FiscalBackend;
    vi.spyOn(backend, "filedReceiptFor").mockRejectedValue(new Error("reconstruction probe"));
    const events: string[] = [];
    const app = new Hono();
    mountOrdersApi(
      app,
      { db: venue.db, backend, cfg: { nodeId: venue.cfg.nodeId }, till: venue.cfg },
      (_level, event) => events.push(event),
    );
    const before = await counts();
    expect(
      await send(app, venue.adminDashboard, "POST", `/management-api/orders/${billId}/reprint`, {
        printerId: venue.printerId,
      }),
    ).toMatchObject({ status: 500, json: { code: "server.internal" } });
    expect(events).toContain("orders.failed");
    expect(await counts()).toEqual(before);
  });

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

  it("lets a staff dashboard session copy a receipt and a voided invoice", async () => {
    const paid = await placedInvoiceFirst(venue, "Caña");
    const voided = await placedInvoiceFirst(venue, "Caña");
    await voidInvoice(venue, voided);
    const first = await post(venue.staffDashboard, paid, venue.printerId);
    const second = await post(venue.staffDashboard, voided, venue.printerId);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const ids = [first, second].map((answer) => (answer.json as { jobId: string }).jobId);
    for (const jobId of ids) {
      const [job] = await inTx(venue, (tx) =>
        tx.select().from(printJobs).where(eq(printJobs.id, jobId)),
      );
      expect(job?.kind).toBe("document");
      expect(decodeTicket(job!.payload)).toContain("DUPLICADO");
    }
    const audits = await inTx(venue, (tx) =>
      tx.select().from(receiptReprints).where(eq(receiptReprints.personId, venue.operatorId)),
    );
    expect(audits.map((audit) => audit.printJobId)).toEqual(expect.arrayContaining(ids));
  });

  it("applies the till copy's print-receipt capability to a bound dashboard device", async () => {
    const billId = await placedInvoiceFirst(venue, "Caña");
    const [profile] = await inTx(venue, (tx) =>
      tx
        .insert(deviceProfiles)
        .values({
          name: `No receipt ${randomUUID()}`,
          formFactor: "phone-portrait",
          capabilities: [],
        })
        .returning({ id: deviceProfiles.id }),
    );
    const device = await enrolDeviceForTest(venue.db, venue.cfg, {
      name: "No receipt",
      profileId: profile!.id,
      registerId: venue.cfg.tillId,
    });
    const cookie = `${venue.staffDashboard}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
    expect(await post(cookie, billId, venue.printerId)).toMatchObject({
      status: 403,
      json: { code: "device.forbidden_action", params: { action: "reprint" } },
    });
  });

  it("checks a development device header through the same print-receipt gate", async () => {
    const billId = await placedInvoiceFirst(venue, "Caña");
    const [profile] = await inTx(venue, (tx) =>
      tx
        .insert(deviceProfiles)
        .values({ name: `No copy ${randomUUID()}`, formFactor: "phone-portrait", capabilities: [] })
        .returning({ id: deviceProfiles.id }),
    );
    const device = await enrolDeviceForTest(venue.db, venue.cfg, {
      name: "No copy",
      profileId: profile!.id,
      registerId: venue.cfg.tillId,
    });
    const app = new Hono();
    mountOrdersApi(
      app,
      {
        db: venue.db,
        backend: venue.backend,
        cfg: { nodeId: venue.cfg.nodeId },
        till: venue.cfg,
        devMode: true,
      },
      () => {},
    );
    const response = await app.request(`/management-api/orders/${billId}/reprint`, {
      method: "POST",
      headers: {
        cookie: venue.staffDashboard,
        [DEV_DEVICE_HEADER]: device.deviceId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ printerId: venue.printerId }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "device.forbidden_action", params: { action: "reprint" } },
    });
  });

  it("does not let staff copy an older finished bill hidden from their Orders detail", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    let oldPaid: string;
    try {
      oldPaid = await placedInvoiceFirst(venue, "Caña");
      expect((await collect(venue, oldPaid, "3.00")).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    const before = await counts();
    expect(await post(venue.staffDashboard, oldPaid, venue.printerId)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect(await counts()).toEqual(before);
    expect((await post(venue.adminDashboard, oldPaid, venue.printerId)).status).toBe(202);
  });

  it("refuses an uninvoiced bill and an inactive printer without writing", async () => {
    const valid = await placedInvoiceFirst(venue, "Caña");
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
    expect(await post(venue.adminDashboard, valid, randomUUID())).toMatchObject({
      status: 404,
      json: { code: "printer.not_found" },
    });
    expect(await post(venue.adminDashboard, valid)).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "printerId" } },
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
