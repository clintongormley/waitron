import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  type A4HoldCode,
  CORE_MIGRATIONS,
  invoiceDeliveries,
  locations,
  pagePrinters,
  printAgents,
  printJobs,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { createPrinter, enqueuePrintJob, MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { locationId as brandLocation } from "@waitron/shared";
import {
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  INVOICE_DELIVERY_LEASE_MS,
  reportInvoiceDelivery,
  reserveInvoiceDelivery,
  type InvoiceDelivery,
} from "./invoice-delivery.js";
import type { InvoiceDeliveryAttempt } from "./invoice-delivery-status.js";
import { renewInvoicePagePrint } from "./invoice-page-print.js";
import { runInvoiceEmailPass } from "./invoice-email-worker.js";
import { createPageTestPages, type PageTestPages } from "./page-test-pages.js";
import { invoiceDeliveryAlertSource, undeliveredInvoice } from "./alert-sources.js";
import { recordSyntheticInvoice, SYNTHETIC_CUSTOMER } from "./testing/synthetic-invoice.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const START = new Date("2026-10-12T10:00:00.000Z");
const REPORTED = new Date("2026-10-12T10:00:20.000Z");
const EXPIRED = new Date("2026-10-12T10:01:00.000Z");
const LATER = new Date("2026-10-12T11:00:00.000Z");
const CUSTOMER = { ...SYNTHETIC_CUSTOMER, email: "customer@example.test" };

type Medium = "receipt" | "a4" | "email";
type Status = "queued" | "sending" | "sent" | "failed" | "unknown";

async function venue() {
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  const [loc] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  const locationId = loc!.id;
  const nodeId = await seedNode(suite.db, brandLocation(locationId));
  const [agent] = await suite.db
    .insert(printAgents)
    .values({ locationId, name: "Back office agent", tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  const [office] = await suite.db
    .insert(pagePrinters)
    .values({
      locationId,
      name: "Back office",
      host: "192.0.2.20",
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 600,
    })
    .returning({ id: pagePrinters.id });
  return { locationId, nodeId, agentId: agent!.id, officeId: office!.id };
}
type Venue = Awaited<ReturnType<typeof venue>>;

function invoice(v: Venue, full = true): Promise<{ saleId: string; number: string }> {
  return recordSyntheticInvoice(suite.db, v.nodeId, { full });
}

let hostCounter = 0;
async function receiptJob(
  v: Venue,
  saleId: string,
  set: Partial<typeof printJobs.$inferInsert> = {},
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
      { saleId, receiptCopy: false },
    );
    if (Object.keys(set).length > 0) {
      await tx.update(printJobs).set(set).where(eq(printJobs.id, job.jobId));
    }
    return job.jobId;
  });
}

/** Takes one attempt to `status` through the delivery writers. */
async function attempt(
  v: Venue,
  saleId: string,
  medium: Medium,
  status: Status,
  failureCode?: "printer_refused" | "document_unavailable",
  hold?: A4HoldCode,
): Promise<InvoiceDelivery> {
  const requestKey = randomUUID();
  const input =
    medium === "email"
      ? { requestKey, personId: "staff-one", medium, recipient: CUSTOMER.email }
      : medium === "a4"
        ? { requestKey, personId: "staff-one", medium, pagePrinterId: v.officeId }
        : {
            requestKey,
            personId: "staff-one",
            medium,
            printJobId: await receiptJob(v, saleId),
          };
  const reserved = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, saleId, input),
  );
  await suite.db
    .update(invoiceDeliveries)
    .set({ nextAttemptAt: START.toISOString() })
    .where(eq(invoiceDeliveries.id, reserved.id));
  if (status !== "queued") {
    if (medium === "receipt") {
      await suite.db
        .update(printJobs)
        .set({ status: "printing", claimedBy: v.agentId })
        .where(eq(printJobs.id, reserved.printJobId!));
    }
    const held = (await withTransaction(suite.db, (tx) =>
      claimInvoiceDelivery(tx, reserved.id, medium === "email" ? "server-one" : v.agentId, START),
    ))!;
    if (hold !== undefined) {
      await withTransaction(suite.db, (tx) => renewInvoicePagePrint(tx, held, hold, START));
    }
    if (status === "sent" || status === "failed") {
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          status === "sent"
            ? { status: "sent" }
            : {
                status: "failed",
                failureCode:
                  medium === "a4" ? (failureCode ?? "printer_refused") : "transport_failed",
              },
          REPORTED,
        ),
      );
    }
    if (status === "unknown") {
      await withTransaction(suite.db, (tx) => expireInvoiceDeliveryClaims(tx, EXPIRED));
    }
  }
  return (
    await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, reserved.id))
  )[0]!;
}

/** An A4 attempt claimed at `START` whose renewal reports `hold`, with its claim. */
async function heldA4(v: Venue, saleId: string, hold: A4HoldCode, pagePrinterId = v.officeId) {
  const reserved = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, saleId, {
      requestKey: randomUUID(),
      personId: "staff-one",
      medium: "a4",
      pagePrinterId,
    }),
  );
  await suite.db
    .update(invoiceDeliveries)
    .set({ createdAt: START.toISOString(), nextAttemptAt: START.toISOString() })
    .where(eq(invoiceDeliveries.id, reserved.id));
  const claim = (await withTransaction(suite.db, (tx) =>
    claimInvoiceDelivery(tx, reserved.id, v.agentId, START),
  ))!;
  await withTransaction(suite.db, (tx) => renewInvoicePagePrint(tx, claim, hold, START));
  return claim;
}

async function secondPrinter(v: Venue): Promise<string> {
  const [row] = await suite.db
    .insert(pagePrinters)
    .values({
      locationId: v.locationId,
      name: "Upstairs office",
      host: "192.0.2.21",
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 600,
    })
    .returning({ id: pagePrinters.id });
  return row!.id;
}

/** A store whose test page on `pagePrinterId` is printing and held for `hold`. */
function heldTestPage(pagePrinterId: string, hold: A4HoldCode, now: Date): PageTestPages {
  const pages = createPageTestPages(() => now);
  pages.request(pagePrinterId);
  const job = pages.claim("agent", [
    {
      id: pagePrinterId,
      active: true,
      agentId: "agent",
      documentFormat: "application/pdf",
      resolutionDpi: 600,
    },
  ])!;
  pages.renew({ deliveryId: job.id, generation: 1, token: job.token, holder: "agent" }, hold);
  return pages;
}

function alerts(now: Date = LATER, testPages: PageTestPages = createPageTestPages(() => now)) {
  return withTransaction(suite.db, (tx) =>
    invoiceDeliveryAlertSource({ testPages }).read({ tx, now }),
  );
}

describe("invoiceDeliveryAlertSource", () => {
  it.each([
    ["a4", "failed", REPORTED],
    ["receipt", "failed", REPORTED],
    ["email", "failed", REPORTED],
  ] as const)("raises one alert for an F1 whose %s original %s", async (medium, status, since) => {
    const v = await venue();
    const sale = await invoice(v);
    await attempt(v, sale.saleId, medium, status);

    expect(await alerts()).toEqual([
      {
        key: `invoice_delivery.undelivered:${sale.saleId}`,
        code: "invoice_delivery.failed",
        params: { invoice: sale.number },
        severity: "error",
        since: since.toISOString(),
        screen: "orders",
      },
    ]);
  });

  it("raises the failed alert for an A4 the agent could not get the pages of", async () => {
    const v = await venue();
    const sale = await invoice(v);
    await attempt(v, sale.saleId, "a4", "failed", "document_unavailable");

    expect(await alerts()).toEqual([
      expect.objectContaining({
        key: `invoice_delivery.undelivered:${sale.saleId}`,
        code: "invoice_delivery.failed",
      }),
    ]);
  });

  it.each(["a4", "receipt", "email"] as const)(
    "raises the uncertain alert for an F1 whose %s original is unknown",
    async (medium) => {
      const v = await venue();
      const sale = await invoice(v);
      await attempt(v, sale.saleId, medium, "unknown");

      expect(await alerts()).toEqual([
        {
          key: `invoice_delivery.undelivered:${sale.saleId}`,
          code: "invoice_delivery.uncertain",
          params: { invoice: sale.number },
          severity: "error",
          since: EXPIRED.toISOString(),
          screen: "orders",
        },
      ]);
    },
  );

  it("raises the unclaimed alert for an A4 still queued two minutes after it was due", async () => {
    const v = await venue();
    const sale = await invoice(v);
    await attempt(v, sale.saleId, "a4", "queued");

    expect(await alerts(new Date(START.getTime() + 119_999))).toEqual([]);
    expect(await alerts(new Date(START.getTime() + 120_000))).toEqual([
      {
        key: `invoice_delivery.undelivered:${sale.saleId}`,
        code: "invoice_delivery.office_printer_unclaimed",
        params: { invoice: sale.number, printer: "Back office" },
        severity: "error",
        since: START.toISOString(),
        screen: "orders",
      },
    ]);
  });

  it("raises nothing while an attempt is being sent, or for a queued receipt or email", async () => {
    const v = await venue();
    await attempt(v, (await invoice(v)).saleId, "a4", "sending");
    await attempt(v, (await invoice(v)).saleId, "receipt", "queued");
    await attempt(v, (await invoice(v)).saleId, "email", "queued");

    expect(await alerts()).toEqual([]);
  });

  it("clears once a later attempt is sent", async () => {
    const v = await venue();
    const sale = await invoice(v);
    await attempt(v, sale.saleId, "a4", "failed");
    expect(await alerts()).toHaveLength(1);

    await attempt(v, sale.saleId, "receipt", "sent");

    expect(await alerts()).toEqual([]);
  });

  it("raises nothing for a failed duplicate once the original was delivered", async () => {
    const v = await venue();
    const sale = await invoice(v);
    await attempt(v, sale.saleId, "receipt", "sent");
    const duplicate = await attempt(v, sale.saleId, "a4", "failed");
    expect(duplicate.designation).toBe("duplicate");

    expect(await alerts()).toEqual([]);
  });

  it("raises for an F1 whose receipt original no delivery row tracks ran out of attempts", async () => {
    const v = await venue();
    const sale = await invoice(v);
    await receiptJob(v, sale.saleId, { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });

    expect(await alerts()).toEqual([
      expect.objectContaining({
        key: `invoice_delivery.undelivered:${sale.saleId}`,
        code: "invoice_delivery.failed",
      }),
    ]);
  });

  it("raises nothing for a simplified invoice whose receipt failed", async () => {
    const v = await venue();
    const sale = await invoice(v, false);
    await receiptJob(v, sale.saleId, { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });

    expect(await alerts()).toEqual([]);
  });

  it("raises one alert per sale, and none of them carries the customer's details", async () => {
    const v = await venue();
    const first = await invoice(v);
    const second = await invoice(v);
    await attempt(v, first.saleId, "email", "failed");
    await attempt(v, first.saleId, "email", "unknown");
    await attempt(v, second.saleId, "a4", "failed");

    const raised = await alerts();

    expect(raised.map((a) => a.key).sort()).toEqual(
      [
        `invoice_delivery.undelivered:${first.saleId}`,
        `invoice_delivery.undelivered:${second.saleId}`,
      ].sort(),
    );
    const text = JSON.stringify(raised);
    for (const detail of Object.values(CUSTOMER)) expect(text).not.toContain(detail);
  });

  it("follows the delivery status on whether an original is still owed", async () => {
    const failed: InvoiceDeliveryAttempt = {
      id: "delivery-one",
      medium: "email",
      designation: "original",
      status: "failed",
      failureCode: "transport_failed",
      requestedAt: START.toISOString(),
      at: REPORTED.toISOString(),
      personId: "staff-one",
      printerHold: null,
      lateSuccess: false,
    };
    const actions = { retryOriginal: null, print: null, receiptInstead: null, email: null };
    const read = (status: Parameters<typeof undeliveredInvoice>[0]) =>
      undeliveredInvoice(status, LATER, {
        officePrinters: new Map(),
        sendingHolds: new Map(),
        sendingPrinters: new Set(),
        testPages: createPageTestPages(() => LATER),
      });

    expect(
      read({
        current: failed,
        originalCompleted: true,
        originalPrinterId: null,
        actions,
        history: [failed],
      }),
    ).toBeNull();
    expect(
      read({
        current: null,
        originalCompleted: false,
        originalPrinterId: null,
        actions,
        history: [],
      }),
    ).toBeNull();
    expect(
      read({
        current: failed,
        originalCompleted: false,
        originalPrinterId: null,
        actions,
        history: [failed],
      }),
    ).toEqual({ kind: "failed", since: REPORTED.toISOString() });
  });
});

describe("invoiceDeliveryAlertSource's database reads", () => {
  /** Reads the alerts through a transaction that counts the queries the source builds. */
  async function countedAlerts(): Promise<{ queries: number; raised: number }> {
    let queries = 0;
    const raised = await withTransaction(suite.db, (tx) => {
      const counted = new Proxy(tx, {
        get(target, property) {
          const value = Reflect.get(target, property, target) as unknown;
          if (typeof value !== "function") return value;
          if (property === "select" || property === "selectDistinct") {
            return (...args: unknown[]) => {
              queries += 1;
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return (value as (...a: unknown[]) => unknown).bind(target);
        },
      });
      return invoiceDeliveryAlertSource({ testPages: createPageTestPages(() => LATER) }).read({
        tx: counted,
        now: LATER,
      });
    });
    return { queries, raised: raised.length };
  }

  it("reads as many queries for five owed invoices as for one", async () => {
    const v = await venue();
    await attempt(v, (await invoice(v)).saleId, "a4", "failed");
    const one = await countedAlerts();
    expect(one.raised).toBe(1);

    await attempt(v, (await invoice(v)).saleId, "receipt", "failed");
    await attempt(v, (await invoice(v)).saleId, "email", "unknown");
    await heldA4(v, (await invoice(v)).saleId, "paper_out");
    await attempt(v, (await invoice(v)).saleId, "a4", "queued");
    const five = await countedAlerts();

    expect(five.raised).toBe(5);
    expect(five.queries).toBe(one.queries);
  });
});

describe("invoiceDeliveryAlertSource, while an office printer holds a job", () => {
  const DUE_PLUS_TWO = new Date(START.getTime() + 120_000);

  it.each(["paper_out", "paper_jam"] as const)(
    "raises the held alert for an A4 being sent that the printer holds for %s",
    async (hold) => {
      const v = await venue();
      const sale = await invoice(v);
      await heldA4(v, sale.saleId, hold);

      expect(await alerts()).toEqual([
        {
          key: `invoice_delivery.undelivered:${sale.saleId}`,
          code: "invoice_delivery.held",
          params: { invoice: sale.number, printer: "Back office", hold },
          severity: "error",
          since: START.toISOString(),
          screen: "orders",
        },
      ]);
    },
  );

  it("clears the held alert when a renewal clears the hold", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await heldA4(v, sale.saleId, "paper_out");
    expect(await alerts(REPORTED)).toHaveLength(1);

    await withTransaction(suite.db, (tx) => renewInvoicePagePrint(tx, claim, null, REPORTED));

    expect(await alerts(REPORTED)).toEqual([]);
  });

  it("clears the held alert when the attempt is sent", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await heldA4(v, sale.saleId, "paper_out");

    await withTransaction(suite.db, (tx) =>
      reportInvoiceDelivery(tx, claim, { status: "sent" }, REPORTED),
    );

    expect(await alerts()).toEqual([]);
  });

  it("says an A4 that ended unknown while held may still print", async () => {
    const v = await venue();
    const sale = await invoice(v);
    await attempt(v, sale.saleId, "a4", "unknown", undefined, "paper_out");

    expect(await alerts()).toEqual([
      {
        key: `invoice_delivery.undelivered:${sale.saleId}`,
        code: "invoice_delivery.uncertain_held",
        params: { invoice: sale.number, printer: "Back office" },
        severity: "error",
        since: EXPIRED.toISOString(),
        screen: "orders",
      },
    ]);
  });

  it("names the hold of the invoice being sent ahead of a queued A4 on the same printer", async () => {
    const v = await venue();
    await heldA4(v, (await invoice(v)).saleId, "paper_out");
    const queued = await invoice(v);
    await attempt(v, queued.saleId, "a4", "queued");

    const behind = (now: Date) =>
      alerts(now).then((raised) =>
        raised.filter((a) => a.key === `invoice_delivery.undelivered:${queued.saleId}`),
      );
    expect(await behind(new Date(DUE_PLUS_TWO.getTime() - 1))).toEqual([]);
    expect(await behind(DUE_PLUS_TWO)).toEqual([
      {
        key: `invoice_delivery.undelivered:${queued.saleId}`,
        code: "invoice_delivery.queued_behind_hold",
        params: { invoice: queued.number, printer: "Back office", hold: "paper_out" },
        severity: "error",
        since: START.toISOString(),
        screen: "orders",
      },
    ]);
  });

  it("names the hold of a test page the same printer is holding ahead of a queued A4", async () => {
    const v = await venue();
    const queued = await invoice(v);
    await attempt(v, queued.saleId, "a4", "queued");

    expect(
      await alerts(DUE_PLUS_TWO, heldTestPage(v.officeId, "cover_open", DUE_PLUS_TWO)),
    ).toEqual([
      {
        key: `invoice_delivery.undelivered:${queued.saleId}`,
        code: "invoice_delivery.queued_behind_hold",
        params: { invoice: queued.number, printer: "Back office", hold: "cover_open" },
        severity: "error",
        since: START.toISOString(),
        screen: "orders",
      },
    ]);
  });

  it("keeps the unclaimed wording for a queued A4 on a printer other than the held one", async () => {
    const v = await venue();
    const upstairs = await secondPrinter(v);
    await heldA4(v, (await invoice(v)).saleId, "paper_out", upstairs);
    const queued = await invoice(v);
    await attempt(v, queued.saleId, "a4", "queued");

    const raised = await alerts(DUE_PLUS_TWO, heldTestPage(upstairs, "paper_jam", DUE_PLUS_TWO));

    expect(raised.filter((a) => a.key === `invoice_delivery.undelivered:${queued.saleId}`)).toEqual(
      [
        {
          key: `invoice_delivery.undelivered:${queued.saleId}`,
          code: "invoice_delivery.office_printer_unclaimed",
          params: { invoice: queued.number, printer: "Back office" },
          severity: "error",
          since: START.toISOString(),
          screen: "orders",
        },
      ],
    );
  });

  it("raises nothing for a queued A4 while the same printer is sending another invoice unheld", async () => {
    const v = await venue();
    await attempt(v, (await invoice(v)).saleId, "a4", "sending");
    const queued = await invoice(v);
    await attempt(v, queued.saleId, "a4", "queued");

    expect(await alerts(DUE_PLUS_TWO)).toEqual([]);
  });

  it("raises the unclaimed alert once the invoice ahead is sent and the queued A4 is still not taken", async () => {
    const v = await venue();
    const ahead = await heldA4(v, (await invoice(v)).saleId, "paper_out");
    await withTransaction(suite.db, (tx) => renewInvoicePagePrint(tx, ahead, null, START));
    const queued = await invoice(v);
    await attempt(v, queued.saleId, "a4", "queued");
    expect(await alerts(DUE_PLUS_TWO)).toEqual([]);

    await withTransaction(suite.db, (tx) =>
      reportInvoiceDelivery(tx, ahead, { status: "sent" }, REPORTED),
    );

    expect(await alerts(DUE_PLUS_TWO)).toEqual([
      {
        key: `invoice_delivery.undelivered:${queued.saleId}`,
        code: "invoice_delivery.office_printer_unclaimed",
        params: { invoice: queued.number, printer: "Back office" },
        severity: "error",
        since: START.toISOString(),
        screen: "orders",
      },
    ]);
  });

  it("turns a held A4 whose agent stopped renewing uncertain on the server's email pass, keeping its hold", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await heldA4(v, sale.saleId, "paper_out");
    const pass = (now: Date) =>
      runInvoiceEmailPass({
        db: suite.db,
        holder: "server-one",
        now: () => now,
        readDocument: () => Promise.reject(new Error("No email is due")),
        send: () => Promise.reject(new Error("No email is due")),
      });
    const row = async () =>
      (
        await suite.db
          .select()
          .from(invoiceDeliveries)
          .where(eq(invoiceDeliveries.id, claim.deliveryId))
      )[0]!;
    const justBefore = new Date(START.getTime() + INVOICE_DELIVERY_LEASE_MS - 1);
    const lapsed = new Date(START.getTime() + INVOICE_DELIVERY_LEASE_MS);

    expect(await pass(justBefore)).toEqual({ processed: false });
    expect(await alerts(justBefore)).toEqual([
      expect.objectContaining({ code: "invoice_delivery.held" }),
    ]);

    expect(await pass(lapsed)).toEqual({ processed: false });
    expect(await row()).toMatchObject({
      status: "unknown",
      failureCode: "timeout",
      printerHold: "paper_out",
    });
    expect(await alerts(lapsed)).toEqual([
      {
        key: `invoice_delivery.undelivered:${sale.saleId}`,
        code: "invoice_delivery.uncertain_held",
        params: { invoice: sale.number, printer: "Back office" },
        severity: "error",
        since: lapsed.toISOString(),
        screen: "orders",
      },
    ]);
  });
});
