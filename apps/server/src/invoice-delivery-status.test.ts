import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceDeliveries,
  invoiceSeries,
  locations,
  pagePrinters,
  printAgents,
  printJobs,
  printers,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  createPrinter,
  endDeletedPrinterJobs,
  enqueuePrintJob,
  MAX_DELIVERY_ATTEMPTS,
  PRINTER_DELETED,
} from "@waitron/printing";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import { jobOrigin, locationId as brandLocation, seriesId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import {
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  reportInvoiceDelivery,
  reserveInvoiceDelivery,
  type InvoiceDelivery,
  type InvoiceDeliveryClaim,
  type InvoiceDeliveryOutcome,
} from "./invoice-delivery.js";
import {
  readInvoiceDeliveries,
  readInvoiceDeliveriesFor,
  type InvoiceDeliverySale,
  type OfferedPrinter,
} from "./invoice-delivery-status.js";
import { endInvoicePrintDeliveries } from "./invoice-print.js";
import { renewInvoicePagePrint } from "./invoice-page-print.js";
import { readOriginalReceiptPrint } from "./receipt-print.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-10-12T09:00:00.000Z"),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("Unused anchor");
  },
  currentAnchor: () => null,
};
const START = new Date("2026-10-12T10:00:00.000Z");
const REPORTED = new Date("2026-10-12T10:00:20.000Z");
const EXPIRED = new Date("2026-10-12T10:01:00.000Z");
const CUSTOMER = {
  email: "customer@example.test",
  taxId: "12345678Z",
  legalName: "Saved customer",
  address: "Saved address",
};

type Medium = "receipt" | "a4" | "email";
type Status = "queued" | "sending" | "sent" | "failed" | "unknown";

async function venue() {
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  const locationId = await location("Bar");
  const nodeId = await seedNode(suite.db, brandLocation(locationId));
  const [agent] = await suite.db
    .insert(printAgents)
    .values({ locationId, name: "Back office agent", tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  return { locationId, nodeId, agentId: agent!.id };
}
type Venue = Awaited<ReturnType<typeof venue>>;

async function location(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(locations)
    .values({ name, invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return row!.id;
}

let hostCounter = 20;
async function pagePrinter(
  locationId: string,
  extra: Partial<typeof pagePrinters.$inferInsert> = {},
): Promise<string> {
  const [row] = await suite.db
    .insert(pagePrinters)
    .values({
      locationId,
      name: "Back office",
      host: `192.0.2.${hostCounter++}`,
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 600,
      ...extra,
    })
    .returning({ id: pagePrinters.id });
  return row!.id;
}

/** A synthetic invoice written through the core, as part 1's delivery suites do. */
async function invoice(nodeId: string, full = true): Promise<string> {
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({
      nodeId,
      code: `F${randomUUID().slice(0, 4)}`,
      purpose: full ? "full" : "standard",
    })
    .returning();
  const modules = enabledModules(
    ALL_MODULES,
    venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"),
  );
  const backend = fiscalSlot(modules, null).makeBackend({
    db: suite.db,
    clock,
    environment: "preproduction",
  });
  const sale = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId: nodeId as Parameters<typeof recordSale>[2]["nodeId"],
      seriesId: seriesId(series!.id),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { "es-ES": "Café" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "0",
          lineTotal: "1.00",
        },
      ],
      clock,
      settlement: { kind: "deferred" },
      ...(full
        ? {
            counterparty: {
              taxId: CUSTOMER.taxId,
              legalName: CUSTOMER.legalName,
              countryCode: "ES",
            },
            recipientAddress: CUSTOMER.address,
          }
        : {}),
    }),
  );
  return sale.saleId;
}

async function receiptJob(
  v: Venue,
  saleId: string,
  set: Partial<typeof printJobs.$inferInsert> = {},
  receiptCopy = false,
): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(
      tx,
      { locationId: v.locationId },
      { name: "Receipt", transport: "network_tcp", host: `receipt-${hostCounter++}.test` },
    );
    const job = await enqueuePrintJob(
      tx,
      { locationId: v.locationId },
      printer.id,
      new Uint8Array([27, 64]),
      "document",
      { saleId, receiptCopy },
    );
    if (Object.keys(set).length > 0) {
      await tx.update(printJobs).set(set).where(eq(printJobs.id, job.jobId));
    }
    return job.jobId;
  });
}

async function reserve(
  v: Venue,
  saleId: string,
  medium: Medium,
  pagePrinterId?: string,
): Promise<InvoiceDelivery> {
  const requestKey = randomUUID();
  const input =
    medium === "email"
      ? { requestKey, personId: "staff-one", medium, recipient: CUSTOMER.email }
      : medium === "a4"
        ? { requestKey, personId: "staff-one", medium, pagePrinterId: pagePrinterId! }
        : {
            requestKey,
            personId: "staff-one",
            medium,
            printJobId: await receiptJob(v, saleId),
          };
  const delivery = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, saleId, input),
  );
  await suite.db
    .update(invoiceDeliveries)
    .set({ nextAttemptAt: START.toISOString() })
    .where(eq(invoiceDeliveries.id, delivery.id));
  return (
    await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, delivery.id))
  )[0]!;
}

async function claim(v: Venue, delivery: InvoiceDelivery): Promise<InvoiceDeliveryClaim> {
  const holder = delivery.medium === "email" ? "server-one" : v.agentId;
  if (delivery.medium === "receipt") {
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedBy: v.agentId })
      .where(eq(printJobs.id, delivery.printJobId!));
  }
  return (await withTransaction(suite.db, (tx) =>
    claimInvoiceDelivery(tx, delivery.id, holder, START),
  ))!;
}

function report(held: InvoiceDeliveryClaim, outcome: InvoiceDeliveryOutcome, now = REPORTED) {
  return withTransaction(suite.db, (tx) => reportInvoiceDelivery(tx, held, outcome, now));
}

function expire() {
  return withTransaction(suite.db, (tx) => expireInvoiceDeliveryClaims(tx, EXPIRED));
}

/** Takes one attempt to `status` through the delivery writers. */
async function attempt(
  v: Venue,
  saleId: string,
  medium: Medium,
  status: Status,
  pagePrinterId?: string,
): Promise<InvoiceDelivery> {
  const delivery = await reserve(v, saleId, medium, pagePrinterId);
  if (status !== "queued") {
    const held = await claim(v, delivery);
    if (status === "sent") await report(held, { status: "sent" });
    if (status === "failed") {
      await report(held, {
        status: "failed",
        failureCode: medium === "a4" ? "printer_refused" : "transport_failed",
      });
    }
    if (status === "unknown") await expire();
  }
  return (
    await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, delivery.id))
  )[0]!;
}

type Offer = (sale: InvoiceDeliverySale) => Promise<OfferedPrinter[]>;

const a4 = (id: string, name = "Back office"): OfferedPrinter => ({ id, name, kind: "a4" });

/** Offers every active page printer at the sale's location, by name, as the Orders detail does. */
const locationOffices: Offer = async (sale) =>
  (
    await suite.db
      .select({ id: pagePrinters.id, name: pagePrinters.name })
      .from(pagePrinters)
      .where(and(eq(pagePrinters.locationId, sale.locationId), eq(pagePrinters.active, true)))
      .orderBy(pagePrinters.name)
  ).map((row) => a4(row.id, row.name));

function read(saleId: string, emailAvailable = true, printers: Offer = locationOffices) {
  return withTransaction(suite.db, (tx) =>
    readInvoiceDeliveries(tx, saleId, { emailAvailable, printers }),
  );
}

async function jobPrinter(jobId: string): Promise<string> {
  const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
  return job!.printerId;
}

const statusTime: Record<Status, string> = {
  queued: START.toISOString(),
  sending: START.toISOString(),
  sent: REPORTED.toISOString(),
  failed: REPORTED.toISOString(),
  unknown: EXPIRED.toISOString(),
};

describe("readInvoiceDeliveries", () => {
  const media: Medium[] = ["receipt", "a4", "email"];
  const statuses: Status[] = ["queued", "sending", "sent", "failed", "unknown"];
  const cases = media.flatMap((medium) => statuses.map((status) => [medium, status] as const));

  it.each(cases)("reads a %s original that is %s", async (medium, status) => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);
    const delivery = await attempt(v, saleId, medium, status, office);

    const result = await read(saleId);

    const failureCode =
      status === "failed"
        ? medium === "a4"
          ? "printer_refused"
          : "transport_failed"
        : status === "unknown"
          ? "timeout"
          : null;
    const current = {
      id: delivery.id,
      medium,
      designation: "original",
      status,
      failureCode,
      requestedAt: delivery.createdAt,
      at: statusTime[status],
      personId: "staff-one",
      printerHold: null,
      lateSuccess: false,
    };
    const printers = [a4(office)];
    const ended = status === "failed" || status === "unknown";
    expect(result).toEqual({
      current,
      originalCompleted: status === "sent",
      originalPrinterId:
        medium === "a4"
          ? office
          : medium === "receipt"
            ? await jobPrinter(delivery.printJobId!)
            : null,
      actions: {
        retryOriginal: ended ? { medium } : null,
        print:
          status === "sent"
            ? { printers, designation: "duplicate" }
            : ended
              ? { printers, designation: "original" }
              : null,
        receiptInstead:
          medium !== "receipt" && status === "queued" ? { deliveryId: delivery.id } : null,
        email:
          status === "sent"
            ? { designation: "duplicate" }
            : ended
              ? { designation: "original" }
              : null,
      },
      history: [current],
    });
  });

  describe("what the printer holds an A4 for", () => {
    /** An A4 original whose agent renewed its claim reporting `paper_out`, then taken to `status`. */
    async function heldA4(v: Venue, saleId: string, status: Status, office: string) {
      const delivery = await reserve(v, saleId, "a4", office);
      const held = await claim(v, delivery);
      expect(
        await withTransaction(suite.db, (tx) =>
          renewInvoicePagePrint(tx, held, "paper_out", START),
        ),
      ).toBe("renewed");
      if (status === "sent") await report(held, { status: "sent" });
      if (status === "failed") {
        await report(held, { status: "failed", failureCode: "printer_refused" });
      }
      if (status === "unknown") await expire();
      const [row] = await suite.db
        .select()
        .from(invoiceDeliveries)
        .where(eq(invoiceDeliveries.id, delivery.id));
      // The column keeps the last hold once the attempt ends; the reader decides what it shows.
      expect(row).toMatchObject({ status, printerHold: "paper_out" });
      return row!;
    }

    it.each([
      ["sending", "paper_out"],
      ["unknown", "paper_out"],
      ["sent", null],
      ["failed", null],
    ] as const)("shows an A4 that is %s with a stored hold as held by %s", async (status, hold) => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      const delivery = await heldA4(v, saleId, status, office);

      const result = await read(saleId);

      expect(result!.current).toMatchObject({ id: delivery.id, status, printerHold: hold });
    });

    it.each([
      ["email", "sending"],
      ["email", "unknown"],
      ["receipt", "sending"],
      ["receipt", "unknown"],
    ] as const)("shows no hold on a %s attempt that is %s", async (medium, status) => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const delivery = await attempt(v, saleId, medium, status);
      // No writer stores a hold on these media; one forced in shows the reader ignores it.
      await suite.db
        .update(invoiceDeliveries)
        .set({ printerHold: "paper_out" })
        .where(eq(invoiceDeliveries.id, delivery.id));

      const result = await read(saleId);

      expect(result!.current).toMatchObject({ id: delivery.id, status, printerHold: null });
    });

    it("offers no retry, no A4 and no paper for a held A4, which may still print", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      await receiptJob(v, saleId, { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });
      await heldA4(v, saleId, "sending", office);

      const result = await read(saleId);

      expect(result!.current).toMatchObject({ status: "sending", printerHold: "paper_out" });
      expect(result!.actions).toEqual({
        retryOriginal: null,
        print: null,
        receiptInstead: null,
        email: null,
      });
    });
  });

  it("dates an attempt the agent itself reported uncertain by its report", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);
    const delivery = await reserve(v, saleId, "a4", office);
    await report(await claim(v, delivery), { status: "unknown", failureCode: "printer_aborted" });

    const result = await read(saleId);

    expect(result!.current).toMatchObject({
      status: "unknown",
      failureCode: "printer_aborted",
      at: REPORTED.toISOString(),
    });
    expect(result!.actions.retryOriginal).toEqual({ medium: "a4" });
  });

  it("keeps an expired attempt dated by its expiry after a late failure report", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);
    const delivery = await reserve(v, saleId, "a4", office);
    const held = await claim(v, delivery);
    await expire();
    await report(
      held,
      { status: "failed", failureCode: "printer_refused" },
      new Date("2026-10-12T10:02:00.000Z"),
    );

    expect((await read(saleId))!.current).toMatchObject({
      status: "unknown",
      failureCode: "timeout",
      at: EXPIRED.toISOString(),
      lateSuccess: false,
    });
  });

  it("offers A4 as the original when the invoice has no attempt yet", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);

    expect(await read(saleId)).toEqual({
      current: null,
      originalCompleted: false,
      originalPrinterId: null,
      actions: {
        retryOriginal: null,
        print: { printers: [a4(office)], designation: "original" },
        receiptInstead: null,
        email: { designation: "original" },
      },
      history: [],
    });
  });

  it("offers exactly the printers its caller offers, in their order", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    await pagePrinter(v.locationId, { name: "Not offered" });
    const offered: OfferedPrinter[] = [
      { id: randomUUID(), name: "Bar receipts", kind: "receipt" },
      a4(randomUUID(), "Upstairs office"),
    ];

    expect((await read(saleId, true, async () => offered))!.actions.print).toEqual({
      printers: offered,
      designation: "original",
    });
  });

  it("offers no print, and no A4 retry, when its caller offers no printer", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const used = await pagePrinter(v.locationId, { name: "Old office" });
    await attempt(v, saleId, "a4", "failed", used);

    const result = await read(saleId, true, async () => []);

    expect(result!.current).toMatchObject({ medium: "a4", status: "failed" });
    expect(result!.actions).toEqual({
      retryOriginal: null,
      print: null,
      receiptInstead: null,
      email: { designation: "original" },
    });
  });

  it("offers an A4 retry only when an A4 printer is among the offered printers", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);
    await attempt(v, saleId, "a4", "failed", office);
    const receipts: OfferedPrinter = { id: randomUUID(), name: "Bar receipts", kind: "receipt" };

    expect((await read(saleId, true, async () => [receipts]))!.actions).toMatchObject({
      retryOriginal: null,
      print: { printers: [receipts], designation: "original" },
    });
    expect((await read(saleId, true, async () => [receipts, a4(office)]))!.actions).toMatchObject({
      retryOriginal: { medium: "a4" },
    });
  });

  it("offers nothing to print while an attempt is active, whatever is offered", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);
    await attempt(v, saleId, "a4", "queued", office);

    expect((await read(saleId, true, async () => [a4(office)]))!.actions.print).toBeNull();
  });

  describe("the original's printer", () => {
    it("is the printer of the original that was sent, not of a newer duplicate on another printer", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      const upstairs = await pagePrinter(v.locationId, {
        name: "Upstairs",
      });
      await attempt(v, saleId, "a4", "sent", office);
      const duplicate = await attempt(v, saleId, "a4", "sent", upstairs);

      const result = await read(saleId);

      expect(duplicate.designation).toBe("duplicate");
      expect(result!.current).toMatchObject({ id: duplicate.id });
      expect(result!.originalPrinterId).toBe(office);
    });

    it("is the printer of a printed receipt original no row tracks, over a newer failed A4 original", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      await attempt(v, saleId, "a4", "failed", office);
      const jobId = await receiptJob(v, saleId, { status: "done" });

      expect((await read(saleId))!.originalPrinterId).toBe(await jobPrinter(jobId));
    });

    it("is the newest original attempt's printer while none was sent", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      const upstairs = await pagePrinter(v.locationId, {
        name: "Upstairs",
      });
      await attempt(v, saleId, "a4", "failed", office);
      await attempt(v, saleId, "a4", "unknown", upstairs);

      expect((await read(saleId))!.originalPrinterId).toBe(upstairs);
    });

    it("is null when the newest original attempt was an email, and the receipt job's printer for paper", async () => {
      const v = await venue();
      const emailed = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      await attempt(v, emailed, "a4", "failed", office);
      await attempt(v, emailed, "email", "failed");
      const printed = await invoice(v.nodeId);
      const receipt = await attempt(v, printed, "receipt", "failed");

      expect((await read(emailed))!.originalPrinterId).toBeNull();
      expect((await read(printed))!.originalPrinterId).toBe(await jobPrinter(receipt.printJobId!));
    });
  });

  it("offers duplicates only once an original has completed, even after a failed duplicate", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);
    await attempt(v, saleId, "email", "sent");
    const duplicate = await attempt(v, saleId, "a4", "failed", office);

    const result = await read(saleId);

    expect(duplicate.designation).toBe("duplicate");
    expect(result!.current).toMatchObject({
      id: duplicate.id,
      designation: "duplicate",
      status: "failed",
    });
    expect(result!.originalCompleted).toBe(true);
    expect(result!.actions).toEqual({
      retryOriginal: null,
      print: { printers: [a4(office)], designation: "duplicate" },
      receiptInstead: null,
      email: { designation: "duplicate" },
    });
  });

  it("does not offer the receipt switch for a queued A4 duplicate", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);
    await attempt(v, saleId, "receipt", "sent");
    const duplicate = await attempt(v, saleId, "a4", "queued", office);

    const result = await read(saleId);

    expect(result!.current).toMatchObject({ id: duplicate.id, status: "queued" });
    expect(result!.actions).toEqual({
      retryOriginal: null,
      print: null,
      receiptInstead: null,
      email: null,
    });
  });

  it("lists every attempt newest first, with its staff member and a late success", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);
    const first = await reserve(v, saleId, "a4", office);
    const held = await claim(v, first);
    await expire();
    const second = await attempt(v, saleId, "a4", "failed", office);
    await report(held, { status: "sent" }, new Date("2026-10-12T10:05:00.000Z"));

    const result = await read(saleId);

    expect(result!.history.map((entry) => [entry.id, entry.status, entry.lateSuccess])).toEqual([
      [second.id, "failed", false],
      [first.id, "unknown", true],
    ]);
    expect(result!.history.every((entry) => entry.personId === "staff-one")).toBe(true);
    // A late success on a superseded attempt is history only: the next one is still original.
    expect(result!.originalCompleted).toBe(false);
    expect(result!.actions.retryOriginal).toEqual({ medium: "a4" });
    expect(result!.actions.print).toMatchObject({ designation: "original" });
  });

  describe("email", () => {
    it("offers no email and no email retry when email cannot be sent", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      await attempt(v, saleId, "email", "failed");

      expect((await read(saleId, true))!.actions).toMatchObject({
        retryOriginal: { medium: "email" },
        email: { designation: "original" },
      });
      expect((await read(saleId, false))!.actions).toMatchObject({
        retryOriginal: null,
        email: null,
      });
    });

    it("offers a receipt retry instead when the failed email cannot be sent again", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      await attempt(v, saleId, "receipt", "failed");
      await attempt(v, saleId, "email", "unknown");

      expect((await read(saleId, false))!.actions).toMatchObject({
        retryOriginal: { medium: "receipt" },
        email: null,
      });
    });

    it("does not offer the switch to paper for a queued email duplicate", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      await attempt(v, saleId, "receipt", "sent");
      const duplicate = await attempt(v, saleId, "email", "queued");

      const result = await read(saleId);

      expect(result!.current).toMatchObject({ id: duplicate.id, designation: "duplicate" });
      expect(result!.actions.receiptInstead).toBeNull();
    });

    it("offers no switch to paper for an email original being sent, though its receipt can be resent", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      await attempt(v, saleId, "receipt", "failed");
      const email = await attempt(v, saleId, "email", "queued");
      expect((await read(saleId))!.actions.receiptInstead).toEqual({ deliveryId: email.id });
      await claim(v, email);

      expect((await read(saleId))!.actions.receiptInstead).toBeNull();
    });
  });

  it("offers paper instead of a waiting original only on A4 or email, never a receipt", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const receipt = await attempt(v, saleId, "receipt", "queued");
    // Forced: the job ended for good while its row still waits, so only the medium keeps it out.
    await suite.db
      .update(printJobs)
      .set({ status: "failed", attempts: 5 })
      .where(eq(printJobs.id, receipt.printJobId!));
    expect(
      await withTransaction(suite.db, (tx) => readOriginalReceiptPrint(tx, saleId)),
    ).toMatchObject({ status: "failed", canRetry: true });

    const result = await read(saleId);

    expect(result!.current).toMatchObject({ id: receipt.id, status: "queued" });
    expect(result!.actions.receiptInstead).toBeNull();
  });

  it("carries no customer detail", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    await attempt(v, saleId, "email", "failed");

    const text = JSON.stringify(await read(saleId));

    for (const detail of Object.values(CUSTOMER)) expect(text).not.toContain(detail);
    expect(text).toContain("staff-one");
  });

  describe("a receipt original no delivery row tracks", () => {
    it("counts a printed one as the completed original", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      const delivered = "2026-10-12T10:00:30.000Z";
      const jobId = await receiptJob(v, saleId, { status: "done", deliveredAt: delivered });
      const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));

      const result = await read(saleId);

      const current = {
        id: null,
        medium: "receipt",
        designation: "original",
        status: "sent",
        failureCode: null,
        requestedAt: job!.createdAt,
        at: delivered,
        personId: null,
        printerHold: null,
        lateSuccess: false,
      };
      expect(result).toEqual({
        current,
        originalCompleted: true,
        originalPrinterId: job!.printerId,
        actions: {
          retryOriginal: null,
          print: { printers: [a4(office)], designation: "duplicate" },
          receiptInstead: null,
          email: { designation: "duplicate" },
        },
        history: [current],
      });
    });

    it("lists it after the delivery rows that came later", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      await receiptJob(v, saleId, { status: "done" });
      const duplicate = await attempt(v, saleId, "a4", "sent", office);

      const result = await read(saleId);

      expect(result!.history.map((entry) => [entry.id, entry.medium, entry.designation])).toEqual([
        [duplicate.id, "a4", "duplicate"],
        [null, "receipt", "original"],
      ]);
    });

    it.each([
      ["queued", { status: "queued" }, "queued"],
      ["printing", { status: "printing" }, "sending"],
      ["failed with automatic attempts left", { status: "failed", attempts: 1 }, "queued"],
    ] as const)("reads a %s one as in flight and offers nothing", async (_, set, status) => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      await pagePrinter(v.locationId);
      await receiptJob(v, saleId, set);

      const result = await read(saleId);

      expect(result!.current).toMatchObject({ id: null, status, at: null });
      expect(result!.actions).toEqual({
        retryOriginal: null,
        print: null,
        receiptInstead: null,
        email: null,
      });
    });

    it("offers a receipt retry for an exhausted one", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      await receiptJob(v, saleId, { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });

      const result = await read(saleId);

      expect(result!.current).toMatchObject({ id: null, status: "failed", failureCode: null });
      expect(result!.actions).toEqual({
        retryOriginal: { medium: "receipt" },
        print: null,
        receiptInstead: null,
        email: { designation: "original" },
      });
    });

    it("blocks new attempts while one is in flight beside a delivery row", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      await attempt(v, saleId, "a4", "failed", office);
      await receiptJob(v, saleId);

      const result = await read(saleId);

      expect(result!.current).toMatchObject({ medium: "a4", status: "failed" });
      expect(result!.actions).toEqual({
        retryOriginal: null,
        print: null,
        receiptInstead: null,
        email: null,
      });
    });

    it("ignores paper copies", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      await receiptJob(v, saleId, { status: "done" }, true);
      await receiptJob(v, saleId, {}, true);

      const result = await read(saleId);

      expect(result).toMatchObject({ current: null, originalCompleted: false, history: [] });
    });
  });

  it("offers no receipt retry when the original's printer was deleted", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const office = await pagePrinter(v.locationId);
    const delivery = await attempt(v, saleId, "receipt", "failed");
    const [job] = await suite.db
      .select()
      .from(printJobs)
      .where(eq(printJobs.id, delivery.printJobId!));
    await withTransaction(suite.db, async (tx) => {
      await endDeletedPrinterJobs(tx, job!.printerId);
      await tx
        .update(printers)
        .set({ active: false, deletedAt: START.toISOString() })
        .where(eq(printers.id, job!.printerId));
    });

    const result = await read(saleId);

    expect(result!.current).toMatchObject({ id: delivery.id, status: "failed" });
    expect(result!.actions).toEqual({
      retryOriginal: null,
      print: { printers: [a4(office)], designation: "original" },
      receiptInstead: null,
      email: { designation: "original" },
    });
  });

  it("reports a deleted printer's exhausted untracked original with the printer-deleted code", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const jobId = await receiptJob(v, saleId, {
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS,
    });
    const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    await suite.db
      .update(printers)
      .set({ active: false, deletedAt: START.toISOString() })
      .where(eq(printers.id, job!.printerId));

    const result = await read(saleId);

    expect(result!.current).toMatchObject({ status: "failed", failureCode: PRINTER_DELETED });
    expect(result!.actions.retryOriginal).toBeNull();
  });

  /** Deletes a receipt printer as the printer delete does: its jobs and receipt rows end first. */
  async function deleteReceiptPrinter(jobId: string) {
    const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    await withTransaction(suite.db, async (tx) => {
      await endDeletedPrinterJobs(tx, job!.printerId);
      await endInvoicePrintDeliveries(tx, [jobId], START);
      await tx
        .update(printers)
        .set({ active: false, deletedAt: START.toISOString() })
        .where(eq(printers.id, job!.printerId));
    });
  }

  describe("beside an earlier failed receipt original", () => {
    it("offers the switch to paper for a queued A4 original while that receipt can be resent", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      await attempt(v, saleId, "receipt", "failed");
      const a4 = await attempt(v, saleId, "a4", "queued", office);

      const result = await read(saleId);

      // The switch resends that receipt's job: the original path adds none once one exists.
      const receipt = await withTransaction(suite.db, (tx) => readOriginalReceiptPrint(tx, saleId));
      expect(receipt).toMatchObject({ status: "failed", canRetry: true });
      expect(result!.actions.receiptInstead).toEqual({ deliveryId: a4.id });
    });

    it("offers no switch to paper once that receipt's printer was deleted", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const office = await pagePrinter(v.locationId);
      const receipt = await attempt(v, saleId, "receipt", "failed");
      await deleteReceiptPrinter(receipt.printJobId!);
      const a4 = await attempt(v, saleId, "a4", "queued", office);

      const result = await read(saleId);

      expect(result!.current).toMatchObject({ id: a4.id, status: "queued" });
      expect(result!.actions).toEqual({
        retryOriginal: null,
        print: null,
        receiptInstead: null,
        email: null,
      });
    });

    it("offers a receipt retry when the failed A4 original cannot be retried on A4", async () => {
      const v = await venue();
      const saleId = await invoice(v.nodeId);
      const old = await pagePrinter(v.locationId, { name: "Old office" });
      await attempt(v, saleId, "receipt", "failed");
      await attempt(v, saleId, "a4", "failed", old);

      const result = await read(saleId, true, async () => []);

      expect(result!.current).toMatchObject({ medium: "a4", status: "failed" });
      expect(result!.actions).toEqual({
        retryOriginal: { medium: "receipt" },
        print: null,
        receiptInstead: null,
        email: { designation: "original" },
      });
    });
  });

  it("marks a success reported after the receipt's printer was deleted, keeping the status", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const delivery = await reserve(v, saleId, "receipt");
    const held = await claim(v, delivery);
    await deleteReceiptPrinter(delivery.printJobId!);
    await report(held, { status: "sent" });

    const result = await read(saleId);

    expect(result!.history).toEqual([
      expect.objectContaining({ id: delivery.id, status: "unknown", lateSuccess: true }),
    ]);
    expect(result!.originalCompleted).toBe(false);
  });

  it("answers null for a simplified invoice, whatever it printed", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId, false);
    await pagePrinter(v.locationId);
    await receiptJob(v, saleId, { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });

    expect(await read(saleId)).toBeNull();
  });

  it("refuses an unknown sale", async () => {
    await venue();
    await expect(read(randomUUID())).rejects.toMatchObject({
      code: "invoice_delivery.not_found",
    });
  });

  it("asks its caller for the printers of each full invoice, with the sale's own location", async () => {
    const v = await venue();
    const saleId = await invoice(v.nodeId);
    const terrace = await location("Terrace");
    const terraceNode = await seedNode(suite.db, brandLocation(terrace));
    const other = await invoice(terraceNode);
    const simplified = await invoice(v.nodeId, false);
    const asked: InvoiceDeliverySale[] = [];
    const offer: Offer = async (sale) => {
      asked.push(sale);
      return [];
    };

    for (const id of [saleId, other, simplified]) await read(id, true, offer);

    expect(asked).toEqual([
      { id: saleId, locationId: v.locationId },
      { id: other, locationId: terrace },
    ]);
  });

  it("reads several sales at once exactly as it reads each one", async () => {
    const v = await venue();
    const office = await pagePrinter(v.locationId);
    const terrace = await location("Terrace");
    const terraceNode = await seedNode(suite.db, brandLocation(terrace));
    const failedA4 = await invoice(v.nodeId);
    await attempt(v, failedA4, "a4", "failed", office);
    const printed = await invoice(v.nodeId);
    await attempt(v, printed, "receipt", "sent");
    await attempt(v, printed, "email", "unknown");
    const untracked = await invoice(terraceNode);
    await receiptJob(v, untracked, { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });
    const fresh = await invoice(terraceNode);
    const simplified = await invoice(v.nodeId, false);
    const queuedReceipt = await invoice(v.nodeId);
    await receiptJob(v, queuedReceipt);
    const missing = randomUUID();
    const ids = [failedA4, printed, untracked, fresh, simplified, queuedReceipt];

    const batch = await withTransaction(suite.db, (tx) =>
      readInvoiceDeliveriesFor(tx, [...ids, missing], { emailAvailable: true }),
    );

    expect([...batch.keys()].sort()).toEqual([...ids].sort());
    for (const id of ids) expect(batch.get(id), id).toEqual(await read(id, true, async () => []));
    expect(batch.get(simplified)).toBeNull();
    expect(batch.get(fresh)!.actions.print).toBeNull();
  });
});
