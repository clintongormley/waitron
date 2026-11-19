import { dateA4Job, readDeliveryAndClaim } from "./testing/a4-print-job.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  type A4HoldCode,
  CORE_CHANGE_SOURCES,
  CORE_MIGRATIONS,
  installChangeFeed,
  invoiceDeliveries,
  printAgents,
  printJobs,
  taxpayer,
  withTransaction,
} from "@waitron/db";
import { insertA4Printer } from "@waitron/db/testing/printers.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedPerson, seedTaxpayer, seedVenue } from "@waitron/db/testing/seed.js";
import { createPrinter, enqueuePrintJob, MAX_DELIVERY_ATTEMPTS } from "@waitron/printing";
import { claimInvoiceReceipt } from "./invoice-print.js";
import {
  claimInvoiceDelivery,
  abandonInvoiceEmail,
  settleInvoiceEmail,
  startInvoiceEmail,
  expireInvoiceDeliveryClaims,
  INVOICE_DELIVERY_LEASE_MS,
  reportInvoiceDelivery,
  reserveInvoiceDelivery,
  type InvoiceDelivery,
} from "./invoice-delivery.js";
import type { InvoiceDeliveryAttempt } from "./invoice-delivery-status.js";
import { renewInvoicePagePrint } from "./invoice-page-print.js";
import { invoiceMail } from "./invoice-mail.js";
import { createJobRunner } from "./job-runner.js";
import { realSleep } from "./loop.js";
import { mailSendJob, runMailPass } from "./mail-sender.js";
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
  await seedPerson(suite.db, { id: "staff-one" });
  await seedTaxpayer(suite.db);
  await suite.db.update(taxpayer).set({ taxpayerDomicile: "Saved domicile" });
  await seedVenue(suite.db, {
    name: "Bar",
    invoiceLocales: ["es-ES"],
  });
  const nodeId = await seedNode(suite.db);
  const [agent] = await suite.db
    .insert(printAgents)
    .values({ name: "Back office agent", tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  const officeId = await insertA4Printer(suite.db, {
    name: "Back office",
    host: "192.0.2.20",
    resolutionDpi: 600,
  });
  return { nodeId, agentId: agent!.id, officeId: officeId };
}
type Venue = Awaited<ReturnType<typeof venue>>;

function invoice(v: Venue, full = true): Promise<{ saleId: string; number: string }> {
  return recordSyntheticInvoice(suite.db, v.nodeId, { full, operationDescription: "Restaurant" });
}

let hostCounter = 0;
async function receiptJob(
  saleId: string,
  set: Partial<typeof printJobs.$inferInsert> = {},
): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(tx, {
      name: "Receipt",
      transport: "network_tcp",
      host: `receipt-${hostCounter++}.test`,
    });
    const job = await enqueuePrintJob(tx, printer.id, new Uint8Array([27, 64]), "document", {
      saleId,
      receiptCopy: false,
    });
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
            printJobId: await receiptJob(saleId),
          };
  const reserved = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, saleId, input),
  );
  await suite.db
    .update(invoiceDeliveries)
    .set({ createdAt: START.toISOString() })
    .where(eq(invoiceDeliveries.id, reserved.id));
  if (medium === "a4") await dateA4Job(suite.db, reserved.printJobId!, START);
  if (medium === "email" && status !== "queued") {
    await withTransaction(suite.db, async (tx) => {
      await startInvoiceEmail(tx, reserved.id);
      if (status === "unknown") {
        await abandonInvoiceEmail(tx, reserved.id, EXPIRED);
      } else if (status !== "sending") {
        await settleInvoiceEmail(
          tx,
          reserved,
          5,
          status === "sent" ? { status } : { status, failureCode: "transport_failed" },
          REPORTED,
        );
      }
    });
  } else if (status !== "queued") {
    const held = await withTransaction(suite.db, async (tx) => {
      const holder = v.agentId;
      if (medium !== "receipt") {
        const claim = (await claimInvoiceDelivery(tx, reserved.id, holder, START))!;
        if (hold !== undefined) await renewInvoicePagePrint(tx, claim, hold, START);
        return claim;
      }
      const printJobId = reserved.printJobId!;
      await tx
        .update(printJobs)
        .set({ status: "printing", claimedBy: holder, createdAt: START.toISOString() })
        .where(eq(printJobs.id, printJobId));
      const claim = await claimInvoiceReceipt(tx, printJobId, holder, START);
      return { ...claim!, holder, printJobId };
    });
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
  await dateA4Job(suite.db, reserved.printJobId!, START);
  const claim = (await withTransaction(suite.db, (tx) =>
    claimInvoiceDelivery(tx, reserved.id, v.agentId, START),
  ))!;
  await withTransaction(suite.db, (tx) => renewInvoicePagePrint(tx, claim, hold, START));
  return claim;
}

async function secondPrinter(): Promise<string> {
  const printerId = await insertA4Printer(suite.db, {
    name: "Upstairs office",
    host: "192.0.2.21",
    resolutionDpi: 600,
  });
  return printerId;
}

/** A store whose test page on `pagePrinterId` is printing and held for `hold`. */
function heldTestPage(pagePrinterId: string, hold: A4HoldCode, now: Date): PageTestPages {
  const pages = createPageTestPages(() => now.getTime());
  pages.request(pagePrinterId, "es-ES");
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

function alerts(
  now: Date = LATER,
  testPages: PageTestPages = createPageTestPages(() => now.getTime()),
) {
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

  it("raises the unclaimed alert at once, dated now, for an A4 queued further ahead than the longest retry wait", async () => {
    const v = await venue();
    const sale = await invoice(v);
    await attempt(v, sale.saleId, "a4", "queued");

    // Ten minutes is the longest retry wait; a due time further ahead was stamped before a step back.
    expect(await alerts(new Date(START.getTime() - 600_000))).toEqual([]);
    for (const now of [
      new Date(START.getTime() - 600_001),
      new Date(START.getTime() - 400 * 86_400_000),
    ])
      expect(await alerts(now)).toEqual([
        {
          key: `invoice_delivery.undelivered:${sale.saleId}`,
          code: "invoice_delivery.office_printer_unclaimed",
          params: { invoice: sale.number, printer: "Back office" },
          severity: "error",
          since: now.toISOString(),
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
    await receiptJob(sale.saleId, { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });

    expect(await alerts()).toEqual([
      expect.objectContaining({
        key: `invoice_delivery.undelivered:${sale.saleId}`,
        code: "invoice_delivery.failed",
      }),
    ]);
  });

  it("does not report an old receipt attempt on an office printer", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const office = await withTransaction(suite.db, insertA4Printer);
    await receiptJob(sale.saleId, {
      printerId: office,
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS,
    });
    expect(await alerts()).toEqual([]);
  });

  it("raises nothing for a simplified invoice whose receipt failed", async () => {
    const v = await venue();
    const sale = await invoice(v, false);
    await receiptJob(sale.saleId, { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });

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
        testPages: createPageTestPages(() => LATER.getTime()),
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

describe("invoiceDeliveryAlertSource, after a success reported too late to count", () => {
  const LATE = new Date("2026-10-12T10:30:00.000Z");

  /** An A4 attempt whose claim has lapsed, with the claim its agent still holds. */
  async function lapsedA4(v: Venue, saleId: string) {
    const reserved = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, saleId, {
        requestKey: randomUUID(),
        personId: "staff-one",
        medium: "a4",
        pagePrinterId: v.officeId,
      }),
    );
    await dateA4Job(suite.db, reserved.printJobId!, START);
    const claim = (await withTransaction(suite.db, (tx) =>
      claimInvoiceDelivery(tx, reserved.id, v.agentId, START),
    ))!;
    await withTransaction(suite.db, (tx) => expireInvoiceDeliveryClaims(tx, EXPIRED));
    return claim;
  }

  const reportLate = (
    claim: Awaited<ReturnType<typeof lapsedA4>>,
    outcome: Parameters<typeof reportInvoiceDelivery>[2],
  ) => withTransaction(suite.db, (tx) => reportInvoiceDelivery(tx, claim, outcome, LATE));

  const sent = { status: "sent" } as const;

  const alertFor = (saleId: string, number: string, code: string, since: Date) => ({
    key: `invoice_delivery.undelivered:${saleId}`,
    code,
    params: { invoice: number },
    severity: "error",
    since: since.toISOString(),
    screen: "orders",
  });

  it.each(["email", "a4", "receipt"] as const)(
    "asks for a check when a newer %s attempt failed",
    async (medium) => {
      const v = await venue();
      const sale = await invoice(v);
      const claim = await lapsedA4(v, sale.saleId);
      await attempt(v, sale.saleId, medium, "failed");
      await reportLate(claim, sent);

      expect(await alerts()).toEqual([
        alertFor(sale.saleId, sale.number, "invoice_delivery.uncertain", REPORTED),
      ]);
    },
  );

  it("replaces a raised failed alert when the late success arrives", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await lapsedA4(v, sale.saleId);
    await attempt(v, sale.saleId, "email", "failed");
    expect(await alerts()).toEqual([
      alertFor(sale.saleId, sale.number, "invoice_delivery.failed", REPORTED),
    ]);

    await reportLate(claim, sent);

    expect(await alerts()).toEqual([
      alertFor(sale.saleId, sale.number, "invoice_delivery.uncertain", REPORTED),
    ]);
  });

  it("still asks for a check when a further retry fails after the late success", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await lapsedA4(v, sale.saleId);
    await attempt(v, sale.saleId, "email", "failed");
    await reportLate(claim, sent);

    await attempt(v, sale.saleId, "a4", "failed");

    expect(await alerts()).toEqual([
      alertFor(sale.saleId, sale.number, "invoice_delivery.uncertain", REPORTED),
    ]);
  });

  it("clears when a retry after the late success is delivered", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await lapsedA4(v, sale.saleId);
    await attempt(v, sale.saleId, "email", "failed");
    await reportLate(claim, sent);
    expect(await alerts()).toHaveLength(1);

    await attempt(v, sale.saleId, "email", "sent");

    expect(await alerts()).toEqual([]);
  });

  it("raises nothing when no retry was reserved, because the late success delivers the original", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await lapsedA4(v, sale.saleId);
    expect(await alerts()).toEqual([
      alertFor(sale.saleId, sale.number, "invoice_delivery.uncertain", EXPIRED),
    ]);

    await reportLate(claim, sent);

    expect(await alerts()).toEqual([]);
  });

  it("raises nothing for a failed copy after the original was delivered", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await lapsedA4(v, sale.saleId);
    await attempt(v, sale.saleId, "email", "failed");
    await reportLate(claim, sent);
    await attempt(v, sale.saleId, "email", "sent");
    const copy = await attempt(v, sale.saleId, "email", "failed");
    expect(copy.designation).toBe("duplicate");

    expect(await alerts()).toEqual([]);
  });

  it.each(["email", "a4", "receipt"] as const)(
    "raises nothing once a late email success counts as the original, though a newer %s attempt failed",
    async (medium) => {
      const v = await venue();
      const sale = await invoice(v);
      const first = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, {
          requestKey: randomUUID(),
          personId: "staff-one",
          medium: "email",
          recipient: CUSTOMER.email,
        }),
      );
      await withTransaction(suite.db, async (tx) => {
        await startInvoiceEmail(tx, first.id);
        await abandonInvoiceEmail(tx, first.id, EXPIRED);
      });
      await attempt(v, sale.saleId, medium, "failed");
      expect(await alerts()).toEqual([
        alertFor(sale.saleId, sale.number, "invoice_delivery.failed", REPORTED),
      ]);

      await withTransaction(suite.db, (tx) =>
        settleInvoiceEmail(tx, first, 1, { status: "sent" }, LATE),
      );

      expect(await alerts()).toEqual([]);
    },
  );

  it("keeps the failed alert when the old attempt's late report was a failure", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await lapsedA4(v, sale.saleId);
    await attempt(v, sale.saleId, "email", "failed");

    await reportLate(claim, { status: "failed", failureCode: "transport_failed" });

    expect(await alerts()).toEqual([
      alertFor(sale.saleId, sale.number, "invoice_delivery.failed", REPORTED),
    ]);
  });

  it("keeps the alert a held newer attempt raises", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await lapsedA4(v, sale.saleId);
    await attempt(v, sale.saleId, "a4", "unknown", undefined, "paper_out");
    await reportLate(claim, sent);

    expect(await alerts()).toEqual([
      expect.objectContaining({
        code: "invoice_delivery.uncertain_held",
        params: { invoice: sale.number, printer: "Back office" },
      }),
    ]);
  });

  it("keeps the alert for a newer A4 no agent has taken", async () => {
    const v = await venue();
    const sale = await invoice(v);
    const claim = await lapsedA4(v, sale.saleId);
    await attempt(v, sale.saleId, "a4", "queued");
    await reportLate(claim, sent);

    expect(await alerts()).toEqual([
      expect.objectContaining({ code: "invoice_delivery.office_printer_unclaimed" }),
    ]);
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
      return invoiceDeliveryAlertSource({
        testPages: createPageTestPages(() => LATER.getTime()),
      }).read({
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
    const upstairs = await secondPrinter();
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
      runMailPass({
        db: suite.db,
        owners: [
          invoiceMail({
            db: suite.db,
            readDocument: () => Promise.reject(new Error("No email is due")),
          }),
        ],
        now: () => now,
        signal: new AbortController().signal,
        isPrimary: () => true,
        resolveDelivery: async () => ({ mode: "unconfigured" }),
        log: () => {},
      });
    const row = () => readDeliveryAndClaim(suite.db, eq(invoiceDeliveries.id, claim.deliveryId));
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

  it("wakes for a new print claim and expires it with SMTP unconfigured", async () => {
    const v = await venue();
    const paper = await invoice(v);
    const email = await invoice(v);
    await attempt(v, email.saleId, "email", "queued");
    await installChangeFeed(
      suite.db,
      CORE_CHANGE_SOURCES.filter(({ table }) => table === "invoice_deliveries"),
    );
    const clockBase = performance.now();
    const now = () => new Date(START.getTime() + 58_000 + performance.now() - clockBase);
    let waiting!: () => void;
    const asleep = new Promise<void>((resolve) => (waiting = resolve));
    const log = () => {};
    const runner = createJobRunner({
      now,
      log,
      delay: (ms, signal) => {
        waiting();
        return realSleep(ms, signal);
      },
    });
    runner.add(
      mailSendJob({
        db: suite.db,
        owners: [
          invoiceMail({
            db: suite.db,
            readDocument: () => Promise.reject(new Error("SMTP is missing")),
          }),
        ],
        now,
        isPrimary: () => true,
        resolveDelivery: async () => ({ mode: "unconfigured" }),
        log,
        maxSleepMs: 60_000,
      }),
    );
    try {
      await asleep;
      const claim = await heldA4(v, paper.saleId, "paper_out");
      await vi.waitFor(
        async () => {
          const [row] = await suite.db
            .select()
            .from(invoiceDeliveries)
            .where(eq(invoiceDeliveries.id, claim.deliveryId));
          expect(row).toMatchObject({ status: "unknown", failureCode: "timeout" });
        },
        { timeout: 4_000 },
      );
    } finally {
      await runner.stopJobs();
    }
  });
});
