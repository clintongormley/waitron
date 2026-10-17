import { placeOrder } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  deviceProfiles,
  invoiceDeliveries,
  invoiceSeries,
  locations,
  pagePrinters,
  printAgents,
  printJobs,
  printers,
  receiptReprints,
  tenants,
} from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { recordSale } from "@waitron/core";
import { seriesId as brandSeriesId, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { inTx, send } from "./testing/bill-venue.js";
import { decodeTicket, opensDrawer } from "./testing/decode-ticket.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import {
  collect,
  parked,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { enqueueOriginalReceipt } from "./receipt-print.js";
import { readSettledTicket } from "./till-sale.js";

import { departmentReceipts, departments } from "@waitron/venue-service";
import { mountOrdersApi } from "./orders-api.js";

// The dashboard's Print invoice (any active printer at the sale's location) and the order detail's
// delivery status, against synthetic full invoices written through the core (public F1 issuance
// stays disabled).
const EMAIL = "cliente@example.test";
let venue: OrderVenue;
let fullSeriesId = "";
let officeId = "";
/** The Orders routes with a mail transport whose check answers `email.transport`. */
const emailOrders = new Hono();
const email: { transport: boolean | Error } = { transport: true };
const logged: unknown[][] = [];
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await inTx(venue, async (tx) => {
      await tx.update(tenants).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      const [series] = await tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(and(eq(invoiceSeries.nodeId, venue.cfg.nodeId), eq(invoiceSeries.purpose, "full")));
      fullSeriesId = series!.id;
      const [agent] = await tx
        .insert(printAgents)
        .values({ locationId: venue.cfg.locationId, name: "Back office agent", tokenHash: "x" })
        .returning({ id: printAgents.id });
      const [office] = await tx
        .insert(pagePrinters)
        .values({
          locationId: venue.cfg.locationId,
          name: "Oficina",
          host: "192.0.2.20",
          port: 631,
          resourcePath: "/ipp/print",
          documentFormat: "application/pdf",
          supportedFormats: ["application/pdf"],
          media: "iso_a4_210x297mm",
          resolutionDpi: 600,
          agentId: agent!.id,
        })
        .returning({ id: pagePrinters.id });
      officeId = office!.id;
      const receipt = { operationDescription: "Restaurante", email: "facturas@example.test" };
      for (const { id } of await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.locationId, venue.cfg.locationId))) {
        await tx
          .insert(departmentReceipts)
          .values({ departmentId: id, receipt })
          .onConflictDoUpdate({ target: departmentReceipts.departmentId, set: { receipt } });
      }
    });
    mountOrdersApi(
      emailOrders,
      {
        db,
        backend: venue.backend,
        cfg: { nodeId: venue.cfg.nodeId },
        till: venue.cfg,
        invoiceEmailAvailable: () =>
          email.transport instanceof Error
            ? Promise.reject(email.transport)
            : Promise.resolve(email.transport),
      },
      (...args: unknown[]) => {
        logged.push(args);
      },
    );
  },
});

/** A full invoice on a new open bill (sent to the kitchen when `placed`), written through the core. */
async function fullInvoice(placed = false): Promise<{ billId: string; saleId: string }> {
  const billId = await parked(venue, "Caña");
  if (placed)
    await placeOrder(
      { db: venue.db, backend: venue.backend, clock: venue.clock },
      venue.cfg,
      billId,
      venue.operatorId,
    );
  const { saleId } = await inTx(venue, (tx) =>
    recordSale(tx, venue.backend, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      seriesId: brandSeriesId(fullSeriesId),
      workingOrderId: brandWorkingOrderId(billId),
      locale: venue.cfg.locale,
      invoiceLocales: venue.cfg.invoiceLocales,
      counterparty: { taxId: "12345678Z", legalName: "Cliente Mayorista SL", countryCode: "ES" },
      recipientAddress: "Calle Cliente 9, Madrid",
      total: "3.00",
      lines: [
        {
          lineNo: 1,
          name: "Caña",
          descriptions: { [venue.cfg.locale]: "Caña de cerveza" },
          quantity: "1",
          unitPrice: "3.00",
          vatRate: "10",
          lineTotal: "3.00",
        },
      ],
      clock: venue.clock,
      settlement: { kind: "deferred" },
      operatorId: venue.operatorId,
    }),
  );
  return { billId, saleId };
}

const printInvoice = (cookie: string, billId: string, body: Record<string, unknown>) =>
  send(venue.orders, cookie, "POST", `/management-api/orders/${billId}/invoice-deliveries`, body);

const printBody = (requestKey: string = randomUUID(), printerId: string = officeId) => ({
  medium: "print",
  printerId,
  requestKey,
});

let hostCounter = 30;
/** Another A4 printer, at the venue's location unless `locationId` names another. */
async function extraOffice(name: string, locationId: string = venue.cfg.locationId) {
  const [row] = await inTx(venue, (tx) =>
    tx
      .insert(pagePrinters)
      .values({
        locationId,
        name,
        host: `192.0.2.${hostCounter++}`,
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 600,
      })
      .returning({ id: pagePrinters.id }),
  );
  return row!.id;
}

/** Runs `act` with extra A4 printers that are switched off afterwards, for the suites after it. */
async function withExtraOffices(
  act: (extra: { upstairs: string; elsewhere: string; off: string }) => Promise<void>,
) {
  const [terrace] = await inTx(venue, (tx) =>
    tx
      .insert(locations)
      .values({
        name: `Terrace ${hostCounter}`,
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurante",
      })
      .returning({ id: locations.id }),
  );
  const extra = {
    upstairs: await extraOffice("Arriba"),
    elsewhere: await extraOffice("Terraza", terrace!.id),
    off: await extraOffice("Apagada"),
  };
  await inTx(venue, (tx) =>
    tx.update(pagePrinters).set({ active: false }).where(eq(pagePrinters.id, extra.off)),
  );
  try {
    await act(extra);
  } finally {
    await inTx(venue, (tx) =>
      tx.update(pagePrinters).set({ active: false }).where(eq(pagePrinters.id, extra.upstairs)),
    );
  }
}

const deliveriesOf = (saleId: string) =>
  inTx(venue, (tx) =>
    tx.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.saleId, saleId)),
  );

const detailOf = (cookie: string, billId: string) =>
  send(venue.orders, cookie, "GET", `/management-api/orders/${billId}`);

async function deliveryCount(): Promise<number> {
  return venue.db.all<{ n: number }>(sql`select count(*) as n from invoice_deliveries`)[0]!.n;
}

describe("dashboard Print invoice", () => {
  it("queues an A4 original on the chosen printer for a staff dashboard session", async () => {
    const { billId, saleId } = await fullInvoice();
    const answer = await printInvoice(venue.staffDashboard, billId, printBody());
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      medium: "a4",
      designation: "original",
      status: "queued",
      personId: venue.operatorId,
      printerHold: null,
    });
    const rows = await deliveriesOf(saleId);
    expect(rows).toEqual([
      expect.objectContaining({
        id: (answer.json as { id: string }).id,
        medium: "a4",
        pagePrinterId: officeId,
        personId: venue.operatorId,
      }),
    ]);
  });

  it("answers a replayed request key with the same attempt and no second row", async () => {
    const { billId, saleId } = await fullInvoice();
    const key = randomUUID();
    const first = await printInvoice(venue.adminDashboard, billId, printBody(key));
    expect(first.status).toBe(200);
    const again = await printInvoice(venue.adminDashboard, billId, printBody(key));
    expect(again).toEqual(first);
    expect(await deliveriesOf(saleId)).toHaveLength(1);
  });

  it("refuses a request key reused for another printer, A4 or receipt, writing nothing", async () => {
    const { billId, saleId } = await fullInvoice();
    await withExtraOffices(async ({ upstairs }) => {
      const key = randomUUID();
      expect((await printInvoice(venue.adminDashboard, billId, printBody(key))).status).toBe(200);
      const before = await deliveriesOf(saleId);
      for (const printerId of [upstairs, venue.printerId]) {
        expect(
          await printInvoice(venue.adminDashboard, billId, printBody(key, printerId)),
        ).toMatchObject({
          status: 409,
          json: { code: "submission.id_reused", params: { submissionId: key } },
        });
      }
      expect(await deliveriesOf(saleId)).toEqual(before);
      expect(before).toEqual([expect.objectContaining({ medium: "a4", pagePrinterId: officeId })]);
    });
  });

  it("refuses a receipt printer's request key reused for an A4 printer, writing nothing", async () => {
    const { billId, saleId } = await fullInvoice();
    const key = randomUUID();
    expect(
      (await printInvoice(venue.adminDashboard, billId, printBody(key, venue.printerId))).status,
    ).toBe(200);
    const rows = await deliveriesOf(saleId);
    const jobs = await jobsOfSale(saleId);
    expect(await printInvoice(venue.adminDashboard, billId, printBody(key))).toMatchObject({
      status: 409,
      json: { code: "submission.id_reused", params: { submissionId: key } },
    });
    expect(await deliveriesOf(saleId)).toEqual(rows);
    expect(await jobsOfSale(saleId)).toEqual(jobs);
  });

  it("refuses a second attempt while one is active, writing nothing", async () => {
    const { billId, saleId } = await fullInvoice();
    expect((await printInvoice(venue.adminDashboard, billId, printBody())).status).toBe(200);
    const before = await deliveriesOf(saleId);
    expect(await printInvoice(venue.adminDashboard, billId, printBody())).toMatchObject({
      status: 409,
      json: { code: "invoice_delivery.active" },
    });
    expect(await deliveriesOf(saleId)).toEqual(before);
  });

  it("refuses a request key that already asked for an email, changing nothing", async () => {
    const { billId, saleId } = await fullInvoice();
    const key = randomUUID();
    await inTx(venue, (tx) =>
      reserveInvoiceDelivery(tx, saleId, {
        requestKey: key,
        personId: venue.operatorId,
        medium: "email",
        recipient: EMAIL,
      }),
    );
    const before = await deliveriesOf(saleId);
    expect(await printInvoice(venue.adminDashboard, billId, printBody(key))).toMatchObject({
      status: 409,
      json: { code: "submission.id_reused", params: { submissionId: key } },
    });
    expect(await deliveriesOf(saleId)).toEqual(before);
  });

  it("refuses a simplified invoice, writing nothing", async () => {
    const billId = await placedIssuedBill(venue, "Caña");
    const before = await deliveryCount();
    expect(await printInvoice(venue.adminDashboard, billId, printBody())).toMatchObject({
      status: 409,
      json: { code: "invoice_delivery.full_invoice_required" },
    });
    expect(await deliveryCount()).toBe(before);
  });

  it("prints on any active A4 printer at the sale's location, and refuses any other", async () => {
    const { billId, saleId } = await fullInvoice();
    await withExtraOffices(async ({ upstairs, elsewhere, off }) => {
      for (const printerId of [elsewhere, off, randomUUID()]) {
        expect(
          await printInvoice(venue.adminDashboard, billId, printBody(randomUUID(), printerId)),
        ).toMatchObject({ status: 409, json: { code: "invoice_delivery.printer_invalid" } });
      }
      expect(await deliveriesOf(saleId)).toEqual([]);
      expect(
        (await printInvoice(venue.adminDashboard, billId, printBody(randomUUID(), upstairs)))
          .status,
      ).toBe(200);
      expect(await deliveriesOf(saleId)).toEqual([
        expect.objectContaining({ medium: "a4", pagePrinterId: upstairs }),
      ]);
    });
  });

  it("refuses a bound dashboard device without print-receipt, writing nothing", async () => {
    const { billId, saleId } = await fullInvoice();
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
    });
    const cookie = `${venue.staffDashboard}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
    expect(await printInvoice(cookie, billId, printBody())).toMatchObject({
      status: 403,
      json: { code: "device.forbidden_action", params: { action: "invoice_delivery" } },
    });
    expect(await deliveriesOf(saleId)).toEqual([]);
  });

  it("does not let staff print an older finished invoice hidden from their Orders detail", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    let old: { billId: string; saleId: string };
    try {
      old = await fullInvoice(true);
      expect((await collect(venue, old.billId, "3.00")).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    expect(await printInvoice(venue.staffDashboard, old.billId, printBody())).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found" },
    });
    expect(await deliveriesOf(old.saleId)).toEqual([]);
    expect((await printInvoice(venue.supervisorDashboard, old.billId, printBody())).status).toBe(
      200,
    );
  });

  it("refuses a missing session, a bad body and a bill with no invoice", async () => {
    const { billId } = await fullInvoice();
    const open = await parked(venue, "Caña");
    const before = await deliveryCount();
    expect(await printInvoice("", billId, printBody())).toMatchObject({
      status: 401,
      json: { code: "management_session.required" },
    });
    for (const body of [
      { requestKey: randomUUID() },
      { medium: "fax", requestKey: randomUUID() },
      { medium: "a4", requestKey: randomUUID() },
    ])
      expect(await printInvoice(venue.adminDashboard, billId, body)).toMatchObject({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "medium" } },
      });
    for (const requestKey of [undefined, "not-an-id"])
      expect(
        await printInvoice(venue.adminDashboard, billId, {
          medium: "print",
          printerId: officeId,
          requestKey,
        }),
      ).toMatchObject({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "requestKey" } },
      });
    for (const printerId of [undefined, "not-an-id"])
      expect(
        await printInvoice(venue.adminDashboard, billId, {
          medium: "print",
          printerId,
          requestKey: randomUUID(),
        }),
      ).toMatchObject({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "printerId" } },
      });
    for (const id of [open, randomUUID(), "not-a-bill"])
      expect(await printInvoice(venue.adminDashboard, id, printBody())).toMatchObject({
        status: 404,
        json: { code: "working_order.not_found" },
      });
    expect(await deliveryCount()).toBe(before);
  });
});

describe("the order detail's delivery status", () => {
  it("carries the status, the history with names and the downloads, and no recipient address", async () => {
    const { billId, saleId } = await fullInvoice();
    const email = await inTx(venue, (tx) =>
      reserveInvoiceDelivery(tx, saleId, {
        requestKey: randomUUID(),
        personId: venue.adminId,
        medium: "email",
        recipient: EMAIL,
      }),
    );
    await inTx(venue, (tx) =>
      tx
        .update(invoiceDeliveries)
        .set({ status: "sent", completedAt: new Date().toISOString() })
        .where(eq(invoiceDeliveries.id, email.id)),
    );
    const printed = await printInvoice(venue.staffDashboard, billId, printBody());
    expect(printed.status).toBe(200);
    expect(
      (
        await venue.orders.request(`/management-api/orders/${billId}/invoice-pdf`, {
          method: "POST",
          headers: { cookie: venue.adminDashboard },
        })
      ).status,
    ).toBe(200);

    const detail = await detailOf(venue.supervisorDashboard, billId);
    expect(detail.status).toBe(200);
    expect(detail.json).toMatchObject({
      deliveries: {
        current: {
          id: (printed.json as { id: string }).id,
          medium: "a4",
          designation: "duplicate",
          status: "queued",
          personId: venue.operatorId,
          personName: "Ana",
          printerHold: null,
        },
        originalCompleted: true,
        actions: { retryOriginal: null, print: null, receiptInstead: null },
        history: [
          { medium: "a4", designation: "duplicate", personName: "Ana" },
          {
            id: email.id,
            medium: "email",
            designation: "original",
            status: "sent",
            personId: venue.adminId,
            personName: "Administradora",
          },
        ],
      },
      invoicePdfDownloads: [{ personId: venue.adminId, personName: "Administradora" }],
    });
    const body = detail.json as {
      deliveries: { history: unknown[] };
      invoicePdfDownloads: { requestedAt: string }[];
    };
    expect(body.deliveries.history).toHaveLength(2);
    expect(body.invoicePdfDownloads).toHaveLength(1);
    expect(Date.parse(body.invoicePdfDownloads[0]!.requestedAt)).not.toBeNaN();
    // The stored email row does hold the address, so its absence from the answer is meaningful.
    const [stored] = await inTx(venue, (tx) =>
      tx.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, email.id)),
    );
    expect(stored!.recipient).toBe(EMAIL);
    expect(JSON.stringify(detail.json)).not.toContain(EMAIL);
  });

  it("names nobody for a receipt original no one asked for", async () => {
    const { billId, saleId } = await fullInvoice();
    await inTx(venue, async (tx) =>
      enqueueOriginalReceipt(
        tx,
        venue.cfg,
        await readSettledTicket(venue.backend, tx, venue.cfg, billId),
        saleId,
      ),
    );
    expect((await detailOf(venue.adminDashboard, billId)).json).toMatchObject({
      deliveries: {
        current: { id: null, medium: "receipt", personId: null, personName: null },
        history: [{ id: null, medium: "receipt", personId: null, personName: null }],
      },
    });
  });

  it("offers the location's active receipt and A4 printers when nothing is active", async () => {
    const { billId } = await fullInvoice();
    expect((await detailOf(venue.adminDashboard, billId)).json).toMatchObject({
      deliveries: {
        current: null,
        originalCompleted: false,
        originalPrinterId: null,
        actions: {
          print: {
            printers: [
              { id: venue.printerId, name: "Recibos", kind: "receipt" },
              { id: officeId, name: "Oficina", kind: "a4" },
            ],
            designation: "original",
          },
        },
        history: [],
      },
      invoicePdfDownloads: [],
    });
  });

  it("offers every active printer at the sale's location, receipt printers first, by name, with the original's printer", async () => {
    const { billId, saleId } = await fullInvoice();
    await withExtraOffices(async ({ upstairs }) => {
      expect(
        (await printInvoice(venue.adminDashboard, billId, printBody(randomUUID(), upstairs)))
          .status,
      ).toBe(200);
      const detail = (await detailOf(venue.adminDashboard, billId)).json as {
        deliveries: { originalPrinterId: string | null };
      };
      expect(detail.deliveries.originalPrinterId).toBe(upstairs);
      await inTx(venue, (tx) =>
        tx
          .update(invoiceDeliveries)
          .set({ status: "failed", failureCode: "printer_refused" })
          .where(eq(invoiceDeliveries.saleId, saleId)),
      );
      expect((await detailOf(venue.adminDashboard, billId)).json).toMatchObject({
        deliveries: {
          originalPrinterId: upstairs,
          actions: {
            print: {
              printers: [
                { id: venue.printerId, name: "Recibos", kind: "receipt" },
                { id: upstairs, name: "Arriba", kind: "a4" },
                { id: officeId, name: "Oficina", kind: "a4" },
              ],
              designation: "original",
            },
          },
        },
      });
    });
  });

  it("reads the sale's location once while mail can be sent", async () => {
    email.transport = true;
    const { billId } = await fullInvoice();
    const session = (
      venue.db as unknown as { session: { prepareQuery: (...args: unknown[]) => unknown } }
    ).session;
    const prepare = session.prepareQuery.bind(session);
    const statements: string[] = [];
    const spy = vi.spyOn(session, "prepareQuery").mockImplementation((...args) => {
      statements.push((args[0] as { sql: string }).sql);
      return prepare(...args);
    });
    try {
      const detail = await send(
        emailOrders,
        venue.adminDashboard,
        "GET",
        `/management-api/orders/${billId}`,
      );
      expect(detail.json).toMatchObject({
        deliveries: { actions: { email: { designation: "original" } } },
      });
    } finally {
      spy.mockRestore();
    }
    const saleLocationReads = statements.filter((statement) =>
      statement.includes('from "sales" inner join "nodes"'),
    );
    expect(saleLocationReads).toHaveLength(1);
  });

  it("shows what the office printer is holding the A4 for", async () => {
    const { billId, saleId } = await fullInvoice();
    const printed = await printInvoice(venue.adminDashboard, billId, printBody());
    await inTx(venue, (tx) =>
      tx
        .update(invoiceDeliveries)
        .set({ status: "sending", claimedAt: new Date().toISOString(), printerHold: "paper_out" })
        .where(eq(invoiceDeliveries.saleId, saleId)),
    );
    expect((await detailOf(venue.adminDashboard, billId)).json).toMatchObject({
      deliveries: {
        current: {
          id: (printed.json as { id: string }).id,
          status: "sending",
          printerHold: "paper_out",
        },
      },
    });
  });

  it("ends a lapsed A4 claim before reading", async () => {
    const { billId, saleId } = await fullInvoice();
    expect((await printInvoice(venue.adminDashboard, billId, printBody())).status).toBe(200);
    await inTx(venue, (tx) =>
      tx
        .update(invoiceDeliveries)
        .set({ status: "sending", claimedAt: new Date(Date.now() - 120_000).toISOString() })
        .where(eq(invoiceDeliveries.saleId, saleId)),
    );
    expect((await detailOf(venue.adminDashboard, billId)).json).toMatchObject({
      deliveries: { current: { status: "unknown", failureCode: "timeout" } },
    });
  });

  it("has no delivery status and no downloads for a simplified invoice or an open bill", async () => {
    const simplified = await placedIssuedBill(venue, "Caña");
    const open = await parked(venue, "Caña");
    for (const billId of [simplified, open])
      expect((await detailOf(venue.adminDashboard, billId)).json).toMatchObject({
        deliveries: null,
        invoicePdfDownloads: [],
      });
  });
});

const CUSTOMER_EMAIL = "cliente.privado@example.test";

const emailIt = (cookie: string, billId: string, body: Record<string, unknown> = {}) =>
  send(emailOrders, cookie, "POST", `/management-api/orders/${billId}/invoice-deliveries`, {
    medium: "email",
    recipient: CUSTOMER_EMAIL,
    requestKey: randomUUID(),
    ...body,
  });

const retry = (
  cookie: string,
  billId: string,
  deliveryId: string,
  requestKey: string = randomUUID(),
) =>
  send(
    emailOrders,
    cookie,
    "POST",
    `/management-api/orders/${billId}/invoice-deliveries/${deliveryId}/retry`,
    { requestKey },
  );

/** An email original to the customer that the mail server refused. */
async function failedEmail(billId: string, saleId: string): Promise<string> {
  const queued = await emailIt(venue.adminDashboard, billId);
  expect(queued.status).toBe(200);
  const id = (queued.json as { id: string }).id;
  await inTx(venue, (tx) =>
    tx
      .update(invoiceDeliveries)
      .set({
        status: "failed",
        failureCode: "transport_failed",
        reportedAt: new Date().toISOString(),
      })
      .where(eq(invoiceDeliveries.id, id)),
  );
  expect(await deliveriesOf(saleId)).toHaveLength(1);
  return id;
}

describe("dashboard email", () => {
  it("emails a full invoice for a person holding report.export, answering no address", async () => {
    email.transport = true;
    const { billId, saleId } = await fullInvoice();
    const answer = await emailIt(venue.adminDashboard, billId, { recipient: ` ${CUSTOMER_EMAIL}` });
    expect(answer.status).toBe(200);
    const rows = await deliveriesOf(saleId);
    expect(rows).toEqual([
      expect.objectContaining({
        id: (answer.json as { id: string }).id,
        medium: "email",
        designation: "original",
        status: "queued",
        recipient: CUSTOMER_EMAIL,
        personId: venue.adminId,
      }),
    ]);
    expect(answer.json).toMatchObject({ medium: "email", personId: venue.adminId });
    expect(JSON.stringify(answer.json)).not.toContain("cliente.privado");
  });

  it("refuses a person without report.export, writing nothing", async () => {
    email.transport = true;
    const { billId, saleId } = await fullInvoice();
    const failed = await failedEmail(billId, saleId);
    for (const cookie of [venue.supervisorDashboard, venue.staffDashboard]) {
      expect(await emailIt(cookie, billId)).toMatchObject({
        status: 403,
        json: { code: "authorization.not_permitted" },
      });
      expect(await retry(cookie, billId, failed)).toMatchObject({
        status: 403,
        json: { code: "authorization.not_permitted" },
      });
    }
    expect(await deliveriesOf(saleId)).toHaveLength(1);
  });

  it("refuses a missing or malformed address, and mail that cannot be sent, writing nothing", async () => {
    email.transport = true;
    const { billId, saleId } = await fullInvoice();
    for (const recipient of [undefined, "", "cliente@", 7])
      expect(await emailIt(venue.adminDashboard, billId, { recipient })).toMatchObject({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "recipient" } },
      });
    email.transport = false;
    expect(await emailIt(venue.adminDashboard, billId)).toMatchObject({
      status: 409,
      json: { code: "invoice_delivery.email_unavailable" },
    });
    email.transport = true;
    expect(await deliveriesOf(saleId)).toEqual([]);
  });

  it("answers a replayed key with the same attempt, and gives one attempt to two requests racing", async () => {
    email.transport = true;
    const { billId, saleId } = await fullInvoice();
    const key = randomUUID();
    const answers = await Promise.all([
      emailIt(venue.adminDashboard, billId, { requestKey: key }),
      emailIt(venue.adminDashboard, billId),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)).toMatchObject({
      json: { code: "invoice_delivery.active" },
    });
    const rows = await deliveriesOf(saleId);
    expect(rows).toHaveLength(1);
    const again = await emailIt(venue.adminDashboard, billId, { requestKey: rows[0]!.requestKey });
    expect(again).toEqual(answers.find((answer) => answer.status === 200));
    expect(await deliveriesOf(saleId)).toEqual(rows);
  });

  it("refuses a bill with no invoice, a malformed id and a bad request key, writing nothing", async () => {
    email.transport = true;
    const open = await parked(venue, "Caña");
    const before = await deliveryCount();
    for (const id of [open, randomUUID(), "not-a-bill"]) {
      expect(await emailIt(venue.adminDashboard, id)).toMatchObject({
        status: 404,
        json: { code: "working_order.not_found" },
      });
      expect(await retry(venue.adminDashboard, id, randomUUID())).toMatchObject({
        status: 404,
        json: { code: "working_order.not_found" },
      });
    }
    const { billId } = await fullInvoice();
    expect(await retry(venue.adminDashboard, billId, randomUUID(), "again")).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field: "requestKey" } },
    });
    expect(await deliveryCount()).toBe(before);
  });

  it("emails a duplicate once the original was sent", async () => {
    email.transport = true;
    const { billId, saleId } = await fullInvoice();
    const first = (await emailIt(venue.adminDashboard, billId)).json as { id: string };
    await inTx(venue, (tx) =>
      tx
        .update(invoiceDeliveries)
        .set({ status: "sent", completedAt: new Date().toISOString() })
        .where(eq(invoiceDeliveries.id, first.id)),
    );
    expect((await emailIt(venue.adminDashboard, billId)).json).toMatchObject({
      designation: "duplicate",
      status: "queued",
    });
    expect(await deliveriesOf(saleId)).toHaveLength(2);
  });

  it("emails the same address again as the original after a failure, once per key", async () => {
    email.transport = true;
    const { billId, saleId } = await fullInvoice();
    const failed = await failedEmail(billId, saleId);
    const key = randomUUID();
    const answer = await retry(venue.adminDashboard, billId, failed, key);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      medium: "email",
      designation: "original",
      status: "queued",
    });
    expect(await retry(venue.adminDashboard, billId, failed, key)).toEqual(answer);
    const rows = await deliveriesOf(saleId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id !== failed)).toMatchObject({
      recipient: CUSTOMER_EMAIL,
      requestKey: key,
      personId: venue.adminId,
      generation: 2,
    });
    expect(await retry(venue.adminDashboard, billId, failed)).toMatchObject({
      status: 409,
      json: { code: "invoice_delivery.active" },
    });
    expect(await retry(venue.adminDashboard, billId, randomUUID())).toMatchObject({
      status: 404,
      json: { code: "invoice_delivery.not_found" },
    });
    expect(await deliveriesOf(saleId)).toHaveLength(2);
  });

  it("refuses a key used by an email request as a retry, and the reverse, changing nothing", async () => {
    email.transport = true;
    const { billId, saleId } = await fullInvoice();
    const failed = await failedEmail(billId, saleId);
    const emailKey = randomUUID();
    expect((await emailIt(venue.adminDashboard, billId, { requestKey: emailKey })).status).toBe(
      200,
    );
    expect(await retry(venue.adminDashboard, billId, failed, emailKey)).toMatchObject({
      status: 409,
      json: { code: "submission.id_reused", params: { submissionId: emailKey } },
    });
    const other = await fullInvoice();
    const otherFailed = await failedEmail(other.billId, other.saleId);
    const retryKey = randomUUID();
    expect((await retry(venue.adminDashboard, other.billId, otherFailed, retryKey)).status).toBe(
      200,
    );
    expect(
      await emailIt(venue.adminDashboard, other.billId, { requestKey: retryKey }),
    ).toMatchObject({
      status: 409,
      json: { code: "submission.id_reused", params: { submissionId: retryKey } },
    });
    expect(await deliveriesOf(saleId)).toHaveLength(2);
    expect(await deliveriesOf(other.saleId)).toHaveLength(2);
  });

  it("offers email in the detail only while mail can be sent", async () => {
    email.transport = true;
    const { billId } = await fullInvoice();
    const read = async () =>
      (await send(emailOrders, venue.adminDashboard, "GET", `/management-api/orders/${billId}`))
        .json;
    expect(await read()).toMatchObject({
      deliveries: { actions: { email: { designation: "original" } } },
    });
    email.transport = false;
    expect(await read()).toMatchObject({ deliveries: { actions: { email: null } } });
    email.transport = new Error("credentials unreadable");
    expect(await read()).toMatchObject({ deliveries: { actions: { email: null } } });
    email.transport = true;
  });

  it("puts the customer's address in no response and no log line", async () => {
    email.transport = true;
    logged.length = 0;
    const { billId, saleId } = await fullInvoice();
    const key = randomUUID();
    const answers = [
      await emailIt(venue.adminDashboard, billId, { requestKey: key }),
      await emailIt(venue.adminDashboard, billId, {
        requestKey: key,
        recipient: "otra@example.test",
      }),
      await emailIt(venue.adminDashboard, billId),
    ];
    const id = (answers[0]!.json as { id: string }).id;
    await inTx(venue, (tx) =>
      tx
        .update(invoiceDeliveries)
        .set({ status: "failed", failureCode: "transport_failed" })
        .where(eq(invoiceDeliveries.id, id)),
    );
    email.transport = new Error("credentials unreadable");
    answers.push(
      await send(emailOrders, venue.adminDashboard, "GET", `/management-api/orders/${billId}`),
    );
    email.transport = true;
    answers.push(await retry(venue.adminDashboard, billId, id));
    answers.push(
      await send(emailOrders, venue.adminDashboard, "GET", `/management-api/orders/${billId}`),
    );
    expect(answers.map((answer) => answer.status)).toEqual([200, 409, 409, 200, 200, 200]);
    const responses = JSON.stringify(answers);
    const logs = JSON.stringify(logged);
    // Controls: each haystack holds what it should, and the address is in the stored rows.
    expect(responses).toContain(id);
    expect(logs).toContain("invoice_delivery.email_check_failed");
    expect(JSON.stringify(await deliveriesOf(saleId))).toContain(CUSTOMER_EMAIL);
    for (const haystack of [responses, logs]) {
      expect(haystack).not.toContain("cliente.privado");
      expect(haystack).not.toContain("otra@");
    }
  });
});

const jobsOfSale = (saleId: string) =>
  inTx(venue, (tx) =>
    tx
      .select()
      .from(printJobs)
      .where(eq(printJobs.saleId, saleId))
      .orderBy(sql`${printJobs}.rowid`),
  );

const reprintsOf = (saleId: string) =>
  inTx(venue, (tx) => tx.select().from(receiptReprints).where(eq(receiptReprints.saleId, saleId)));

/** The venue's receipt printer's original for `saleId` has printed, through the print endpoint. */
async function receiptPrinted(saleId: string) {
  await inTx(venue, async (tx) => {
    await tx
      .update(printJobs)
      .set({ status: "done", attempts: 1 })
      .where(eq(printJobs.saleId, saleId));
    await tx
      .update(invoiceDeliveries)
      .set({ status: "sent", completedAt: new Date().toISOString() })
      .where(eq(invoiceDeliveries.saleId, saleId));
  });
}

describe("dashboard print on a receipt printer", () => {
  it("lists the location's receipt printers before its A4 printers, and queues an original document job on the chosen one", async () => {
    const { billId, saleId } = await fullInvoice();
    expect((await detailOf(venue.adminDashboard, billId)).json).toMatchObject({
      deliveries: {
        actions: {
          print: {
            printers: [
              { id: venue.printerId, name: "Recibos", kind: "receipt" },
              { id: officeId, name: "Oficina", kind: "a4" },
            ],
          },
        },
      },
    });
    const answer = await printInvoice(
      venue.adminDashboard,
      billId,
      printBody(randomUUID(), venue.printerId),
    );
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ medium: "receipt", designation: "original" });
    const [job, ...more] = await jobsOfSale(saleId);
    expect(more).toEqual([]);
    expect(job).toMatchObject({ printerId: venue.printerId, kind: "document", receiptCopy: false });
    expect(await deliveriesOf(saleId)).toEqual([
      expect.objectContaining({ medium: "receipt", printJobId: job!.id, personId: venue.adminId }),
    ]);
    const printed = decodeTicket(job!.payload).replace(/\s+/g, " ");
    const { invoiceNumber } = await inTx(venue, (tx) =>
      readSettledTicket(venue.backend, tx, venue.cfg, billId),
    );
    expect(printed).toContain(`FACTURA ${invoiceNumber}`);
    expect(printed).toContain("Cliente Mayorista SL");
    expect(printed).toContain("NIF: 12345678Z");
    expect(printed).toContain("Calle Cliente 9, Madrid");
    expect(opensDrawer(job!.payload)).toBe(false);
    expect(await reprintsOf(saleId)).toEqual([]);
  });

  it("records a receipt copy for a duplicate, once per request key, and the original's printer stays the original's", async () => {
    const { billId, saleId } = await fullInvoice();
    await printInvoice(venue.adminDashboard, billId, printBody(randomUUID(), venue.printerId));
    await receiptPrinted(saleId);
    const key = randomUUID();
    const copy = await printInvoice(venue.adminDashboard, billId, printBody(key, venue.printerId));
    expect(copy.json).toMatchObject({ medium: "receipt", designation: "duplicate" });
    expect(
      await printInvoice(venue.adminDashboard, billId, printBody(key, venue.printerId)),
    ).toEqual(copy);
    const [, copyJob, ...more] = await jobsOfSale(saleId);
    expect(more).toEqual([]);
    expect(copyJob).toMatchObject({ printerId: venue.printerId, receiptCopy: true });
    expect(opensDrawer(copyJob!.payload)).toBe(false);
    expect(await reprintsOf(saleId)).toEqual([
      expect.objectContaining({ printJobId: copyJob!.id, personId: venue.adminId }),
    ]);
    await receiptPrinted(saleId);
    expect((await printInvoice(venue.adminDashboard, billId, printBody())).json).toMatchObject({
      medium: "a4",
      designation: "duplicate",
    });
    expect((await detailOf(venue.adminDashboard, billId)).json).toMatchObject({
      deliveries: { originalPrinterId: venue.printerId },
    });
    expect(await reprintsOf(saleId)).toHaveLength(1);
  });

  it("refuses a receipt printer switched off, deleted or at another location, writing nothing", async () => {
    const { billId, saleId } = await fullInvoice();
    const [terrace] = await inTx(venue, (tx) =>
      tx
        .insert(locations)
        .values({
          name: `Terrace ${randomUUID()}`,
          invoiceLocales: ["es-ES"],
          operationDescription: "Restaurante",
        })
        .returning({ id: locations.id }),
    );
    const make = (name: string, locationId: string = venue.cfg.locationId) =>
      inTx(venue, (tx) =>
        createPrinter(
          tx,
          { locationId },
          { name, transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
        ),
      );
    const off = (await make("Apagada")).id;
    const deleted = (await make("Borrada")).id;
    const elsewhere = (await make("Terraza", terrace!.id)).id;
    await inTx(venue, async (tx) => {
      await tx.update(printers).set({ active: false }).where(eq(printers.id, off));
      await tx
        .update(printers)
        .set({ active: false, deletedAt: new Date().toISOString() })
        .where(eq(printers.id, deleted));
    });
    for (const printerId of [off, deleted, elsewhere]) {
      expect(
        await printInvoice(venue.adminDashboard, billId, printBody(randomUUID(), printerId)),
      ).toMatchObject({ status: 409, json: { code: "invoice_delivery.printer_invalid" } });
    }
    expect(await deliveriesOf(saleId)).toEqual([]);
    expect(await jobsOfSale(saleId)).toEqual([]);
  });

  it("still offers email and the PDF with no printer anywhere", async () => {
    email.transport = true;
    const { billId } = await fullInvoice();
    const activePrinters = await inTx(venue, (tx) =>
      tx.select({ id: printers.id }).from(printers).where(eq(printers.active, true)),
    );
    const activeOffices = await inTx(venue, (tx) =>
      tx.select({ id: pagePrinters.id }).from(pagePrinters).where(eq(pagePrinters.active, true)),
    );
    await inTx(venue, async (tx) => {
      await tx.update(printers).set({ active: false });
      await tx.update(pagePrinters).set({ active: false });
    });
    try {
      expect(
        (await send(emailOrders, venue.adminDashboard, "GET", `/management-api/orders/${billId}`))
          .json,
      ).toMatchObject({
        deliveries: { actions: { print: null, email: { designation: "original" } } },
      });
      expect(
        (
          await venue.orders.request(`/management-api/orders/${billId}/invoice-pdf`, {
            method: "POST",
            headers: { cookie: venue.adminDashboard },
          })
        ).status,
      ).toBe(200);
    } finally {
      await inTx(venue, async (tx) => {
        await tx
          .update(printers)
          .set({ active: true })
          .where(
            inArray(
              printers.id,
              activePrinters.map((row) => row.id),
            ),
          );
        await tx
          .update(pagePrinters)
          .set({ active: true })
          .where(
            inArray(
              pagePrinters.id,
              activeOffices.map((row) => row.id),
            ),
          );
      });
    }
  });
});
