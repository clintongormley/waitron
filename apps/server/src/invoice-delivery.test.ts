import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  sales,
  nodes,
  pagePrinters,
  invoiceSeries,
  invoiceDeliveries,
  locations,
  printJobs,
  printAgents,
  printers,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  createPrinter,
  enqueuePrintJob,
  claimPrintJobs,
  endDeletedPrinterJobs,
  MAX_DELIVERY_ATTEMPTS,
  PRINTER_DELETED,
} from "@waitron/printing";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import { jobOrigin, locationId, nodeId, seriesId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import {
  claimInvoicePrintJobs,
  endInvoicePrintDeliveries,
  reportInvoicePrintJob,
} from "./invoice-print.js";
import { venueModuleConfig } from "./provision.js";
import { runInvoiceEmailPass, runInvoiceEmailLoop } from "./invoice-email-worker.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE as documentFixture } from "./testing/full-invoice-fixture.js";
import type { InvoiceDeliveryOutcome } from "./invoice-delivery.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import {
  reserveInvoiceDelivery,
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  reportInvoiceDelivery,
  reportInvoiceEmailDelivery,
} from "./invoice-delivery.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const clock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-10-07T12:00:00.000Z"),
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
const consent = {
  statementVersion: "invoice-email-v1",
  language: "es-ES",
  recordedAt: "2026-10-07T14:00:00+02:00",
  personId: "staff-one",
  contactEmail: "venue@example.test",
  contactPhone: "910000000",
};
const email = () => ({
  requestKey: randomUUID(),
  personId: "staff-one",
  medium: "email" as const,
  recipient: "customer@example.test",
  consent,
});

async function issue(full = true) {
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning();
  const nodeId = await seedNode(suite.db, locationId(location!.id));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "F", purpose: full ? "full" : "standard" })
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
  return withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId,
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
            counterparty: { taxId: "12345678Z", legalName: "Saved customer", countryCode: "ES" },
            recipientAddress: "Saved address",
          }
        : {}),
    }),
  );
}

async function rows() {
  return (await suite.db.execute(sql`select * from invoice_deliveries order by generation`)).rows;
}

describe("invoice delivery reservation", () => {
  it("reserves an A4 original with only the page-printer reference and replays it", async () => {
    const sale = await issue();
    const [node] = await suite.db.select().from(nodes);
    const [printer] = await suite.db
      .insert(pagePrinters)
      .values({
        locationId: node!.locationId,
        name: "Office",
        host: "192.0.2.20",
        port: 8631,
        resourcePath: "/ipp/printer",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf", "image/urf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 600,
      })
      .returning();
    const request = {
      requestKey: randomUUID(),
      personId: "staff-one",
      medium: "a4" as const,
      pagePrinterId: printer!.id,
    };
    const first = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, request),
    );
    expect(first).toMatchObject({
      medium: "a4",
      pagePrinterId: printer!.id,
      printJobId: null,
      recipient: null,
      consent: null,
      status: "queued",
      attempts: 0,
      designation: "original",
    });
    await suite.db
      .update(pagePrinters)
      .set({ active: false })
      .where(eq(pagePrinters.id, printer!.id));
    expect(
      await withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, request)),
    ).toEqual(first);
    expect(await rows()).toHaveLength(1);
    expect(await suite.db.select().from(printJobs)).toEqual([]);
  });

  it.each(["disabled", "other-location"])(
    "refuses a %s A4 destination without queuing",
    async (kind) => {
      const sale = await issue();
      const [node] = await suite.db.select().from(nodes);
      const [other] = await suite.db
        .insert(locations)
        .values({ name: "Other", invoiceLocales: ["es-ES"], operationDescription: "Sale" })
        .returning();
      if (kind === "other-location") await seedNode(suite.db, locationId(other!.id));
      const [printer] = await suite.db
        .insert(pagePrinters)
        .values({
          locationId: kind === "other-location" ? other!.id : node!.locationId,
          name: "Office",
          host: "192.0.2.20",
          port: 8631,
          resourcePath: "/ipp/printer",
          documentFormat: "image/urf",
          supportedFormats: ["image/urf"],
          media: "iso_a4_210x297mm",
          resolutionDpi: 600,
          active: kind !== "disabled",
        })
        .returning();
      const request = {
        requestKey: randomUUID(),
        personId: "staff-one",
        medium: "a4" as const,
        pagePrinterId: printer!.id,
      };
      await expect(
        withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, request)),
      ).rejects.toMatchObject({ code: "invoice_delivery.printer_invalid" });
      expect(await rows()).toEqual([]);
    },
  );

  it("refuses a receipt printer as an A4 destination without reserving a delivery", async () => {
    const sale = await issue();
    const [location] = await suite.db.select().from(locations);
    const receipt = await createPrinter(
      suite.db,
      { locationId: location!.id },
      {
        name: "Receipt only",
        transport: "network_tcp",
        host: "192.0.2.10",
      },
    );
    const request = { ...email(), medium: "a4" as const, pagePrinterId: receipt.id };
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, request)),
    ).rejects.toMatchObject({ code: "invoice_delivery.printer_invalid" });
    expect(await rows()).toEqual([]);
  });

  it("stores a queued original and frozen consent metadata without sending or retaining a document", async () => {
    const sale = await issue();
    const input = email();
    const delivery = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, input),
    );
    expect(delivery).toMatchObject({
      saleId: sale.saleId,
      medium: "email",
      designation: "original",
      status: "queued",
      generation: 1,
      attempts: 0,
      recipient: "customer@example.test",
      consent: {
        statementVersion: "invoice-email-v1",
        language: "es-ES",
        recordedAt: "2026-10-07T12:00:00.000Z",
        personId: "staff-one",
        contactEmail: "venue@example.test",
        contactPhone: "910000000",
      },
    });
    consent.contactEmail = "changed@example.test";
    try {
      expect(JSON.parse(String((await rows())[0]!.consent)).contactEmail).toBe(
        "venue@example.test",
      );
    } finally {
      consent.contactEmail = "venue@example.test";
    }
    const columns = (
      await suite.db.execute<{ name: string }>(
        sql`select name from pragma_table_info('invoice_deliveries')`,
      )
    ).rows.map((row) => row.name);
    expect(columns.some((name) => /payload|pdf|raster|document/.test(name))).toBe(false);
  });

  it("replays the same request after completion without allocating another delivery", async () => {
    const sale = await issue();
    const input = email();
    const first = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, input),
    );
    await suite.db.execute(
      sql`update invoice_deliveries set status = 'sent' where id = ${first.id}`,
    );
    const replay = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, input),
    );
    expect(replay).toMatchObject({ id: first.id, status: "sent", designation: "original" });
    expect(await rows()).toHaveLength(1);
  });

  it("serializes competing requests, refuses a different key and keeps another sale eligible", async () => {
    const sale = await issue();
    const other = await issue();
    const results = await Promise.allSettled(
      [email(), email()].map((input) =>
        withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, input)),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "invoice_delivery.active" },
    });
    const allowed = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, other.saleId, email()),
    );
    expect(allowed.designation).toBe("original");
  });

  it.each(["failed", "unknown"])(
    "reserves an original after %s, preserving the earlier address",
    async (status) => {
      const sale = await issue();
      const first = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, email()),
      );
      await suite.db.execute(
        sql`update invoice_deliveries set status = ${status} where id = ${first.id}`,
      );
      const next = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, {
          ...email(),
          recipient: "corrected@example.test",
        }),
      );
      expect(next).toMatchObject({
        designation: "original",
        generation: 2,
        recipient: "corrected@example.test",
      });
      expect((await rows())[0]).toMatchObject({ status, recipient: "customer@example.test" });
    },
  );

  it("marks another delivery after a completed original as duplicate", async () => {
    const sale = await issue();
    const first = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    await suite.db.execute(
      sql`update invoice_deliveries set status = 'sent' where id = ${first.id}`,
    );
    const next = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    expect(next).toMatchObject({ designation: "duplicate", generation: 2 });
  });

  it("rolls back its reservation with the caller's write", async () => {
    const sale = await issue();
    await expect(
      withTransaction(suite.db, async (tx) => {
        await reserveInvoiceDelivery(tx, sale.saleId, email());
        throw new Error("Caller refused");
      }),
    ).rejects.toThrow("Caller refused");
    expect(await rows()).toHaveLength(0);
  });

  it("refuses an absent sale and an F2 with domain codes", async () => {
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, randomUUID(), email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.not_found" });
    const sale = await issue(false);
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.full_invoice_required" });
    expect(await rows()).toHaveLength(0);
  });
});

const start = new Date("2026-10-07T12:00:00.000Z");
const expired = new Date("2026-10-07T12:01:00.000Z");
async function queued() {
  const sale = await issue();
  const delivery = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, sale.saleId, email()),
  );
  await suite.db.execute(
    sql`update invoice_deliveries set next_attempt_at = ${start.toISOString()} where id = ${delivery.id}`,
  );
  return { sale, delivery };
}
async function claim(id: string, holder = "server-one", now = start) {
  return withTransaction(suite.db, (tx) => claimInvoiceDelivery(tx, id, holder, now));
}
async function expire(restart = false) {
  return withTransaction(suite.db, (tx) =>
    expireInvoiceDeliveryClaims(tx, restart ? start : expired, restart),
  );
}

describe("invoice delivery claims", () => {
  it("claims once, hashes its fresh token and excludes another worker before expiry", async () => {
    const { delivery } = await queued();
    const held = await claim(delivery.id);
    expect(held).toMatchObject({ deliveryId: delivery.id, generation: 1, holder: "server-one" });
    expect(held!.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await claim(delivery.id, "server-two")).toBeUndefined();
    expect(await rows()).toMatchObject([
      { status: "sending", attempts: 1, claimed_at: start.toISOString() },
    ]);
    expect((await rows())[0]!.claim_token_hash).not.toBe(held!.token);
  });

  it("keeps a scheduled queue entry reserved without claiming it early", async () => {
    const { sale, delivery } = await queued();
    await suite.db.execute(
      sql`update invoice_deliveries set next_attempt_at = ${expired.toISOString()} where id = ${delivery.id}`,
    );
    expect(await claim(delivery.id)).toBeUndefined();
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.active" });
    expect(await claim(delivery.id, "server-one", expired)).toBeDefined();
  });

  it.each([false, true])(
    "expires a claim on timeout/restart=%s without silently replaying it",
    async (restart) => {
      const { delivery } = await queued();
      await claim(delivery.id);
      if (!restart) {
        await withTransaction(suite.db, (tx) =>
          expireInvoiceDeliveryClaims(tx, new Date(start.getTime() + 59_999)),
        );
        expect((await rows())[0]!.status).toBe("sending");
      }
      expect(await expire(restart)).toBe(1);
      expect(await claim(delivery.id, "server-two", expired)).toBeUndefined();
      expect(await rows()).toMatchObject([
        { status: "unknown", attempts: 1, failure_code: restart ? "restart" : "timeout" },
      ]);
    },
  );

  it.each(["deliveryId", "generation", "token", "holder"] as const)(
    "ignores a report with the wrong %s",
    async (field) => {
      const { delivery } = await queued();
      const held = (await claim(delivery.id))!;
      const bad = { ...held, [field]: field === "generation" ? 2 : "wrong" };
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, bad, { status: "sent" }, expired),
        ),
      ).toEqual({ updated: false, historical: false });
      expect((await rows())[0]!.status).toBe("sending");
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, held, { status: "sent" }, start),
        ),
      ).toEqual({ updated: true, historical: false });
      expect((await rows())[0]!.status).toBe("sent");
    },
  );

  it("applies the first authenticated result once and ignores a contradictory duplicate", async () => {
    const { delivery } = await queued();
    const held = (await claim(delivery.id))!;
    await withTransaction(suite.db, (tx) =>
      reportInvoiceDelivery(tx, held, { status: "sent" }, start),
    );
    expect(
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          { status: "failed", failureCode: "transport_failed" },
          expired,
        ),
      ),
    ).toEqual({ updated: false, historical: false });
    expect(await rows()).toMatchObject([
      { status: "sent", completed_at: start.toISOString(), attempts: 1, failure_code: null },
    ]);
  });

  it.each(["sent", "failed"] as const)(
    "resolves late %s before retry without treating failure as certainty",
    async (status) => {
      const { sale, delivery } = await queued();
      const held = (await claim(delivery.id))!;
      await expire();
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          status === "sent" ? { status } : { status, failureCode: "transport_failed" },
          expired,
        ),
      );
      expect((await rows())[0]!.status).toBe(status === "sent" ? "sent" : "unknown");
      const next = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, email()),
      );
      expect(next.designation).toBe(status === "sent" ? "duplicate" : "original");
    },
  );

  it.each([
    ["sent", "queued"],
    ["failed", "queued"],
    ["sent", "sending"],
    ["failed", "sending"],
    ["sent", "sent"],
    ["failed", "sent"],
    ["sent", "failed"],
    ["failed", "failed"],
  ] as const)(
    "records late %s only as history while the retry is %s",
    async (status, retryState) => {
      const { sale, delivery } = await queued();
      const held = (await claim(delivery.id))!;
      await expire();
      const next = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, email()),
      );
      await suite.db.execute(
        sql`update invoice_deliveries set next_attempt_at = ${expired.toISOString()} where id = ${next.id}`,
      );
      const retry =
        retryState === "queued" ? undefined : (await claim(next.id, "server-one", expired))!;
      if (retry !== undefined) {
        expect(retry).toMatchObject({ generation: 2, holder: "server-one" });
        expect(retry.token).not.toBe(held.token);
        if (retryState === "sent" || retryState === "failed") {
          await withTransaction(suite.db, (tx) =>
            reportInvoiceDelivery(
              tx,
              retry,
              retryState === "sent"
                ? { status: "sent" }
                : { status: "failed", failureCode: "transport_failed" },
              expired,
            ),
          );
        }
      }
      expect((await rows())[1]!.status).toBe(retryState);
      const before = (await rows())[1];
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(
            tx,
            held,
            status === "sent" ? { status } : { status, failureCode: "transport_failed" },
            expired,
          ),
        ),
      ).toEqual({ updated: false, historical: true });
      expect((await rows())[1]).toEqual(before);
      expect((await rows())[0]).toMatchObject({
        status: "unknown",
        reported_outcome: status,
        reported_failure_code: status === "failed" ? "transport_failed" : null,
      });
      if (retryState === "sending") {
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, retry!, { status: "sent" }, expired),
        );
        expect((await rows())[1]).toMatchObject({
          status: "sent",
          designation: "original",
          attempts: 1,
        });
      }
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, held, { status: "sent" }, expired),
        ),
      ).toEqual({ updated: false, historical: false });
    },
  );
});

describe("existing F1 receipt delivery", () => {
  async function receipt(
    saleId: string,
    status: "queued" | "printing" | "done" | "failed",
    attempts = 0,
    receiptCopy = false,
    kind: "document" | "drawer" = "document",
  ) {
    const [location] = await suite.db.select().from(locations);
    return withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(
        tx,
        { locationId: location!.id },
        { name: "Receipt", transport: "network_tcp", host: "printer.test" },
      );
      const job = await enqueuePrintJob(
        tx,
        { locationId: location!.id },
        printer.id,
        new Uint8Array([27, 64]),
        kind,
        { saleId, receiptCopy },
      );
      await tx.update(printJobs).set({ status, attempts }).where(eq(printJobs.id, job.jobId));
      return job;
    });
  }
  it("makes email after a completed A231 receipt original a duplicate", async () => {
    const sale = await issue();
    await receipt(sale.saleId, "done");
    const next = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    expect(next.designation).toBe("duplicate");
  });
  it.each([
    ["queued", 0],
    ["printing", 0],
    ["failed", 4],
  ] as const)("refuses email beside an eligible existing %s receipt", async (status, attempts) => {
    const sale = await issue();
    await receipt(sale.saleId, status, attempts);
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.active" });
    expect(await rows()).toHaveLength(0);
  });
  it("permits an original after an exhausted receipt and ignores copies and drawers", async () => {
    const sale = await issue();
    await receipt(sale.saleId, "failed", 5);
    await receipt(sale.saleId, "done", 0, true);
    await receipt(sale.saleId, "done", 0, false, "drawer");
    const next = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    expect(next.designation).toBe("original");
  });
});

describe("active invoice outcome", () => {
  it.each(["failed", "unknown"] as const)(
    "records a current %s result and its safe failure code",
    async (status) => {
      const { delivery } = await queued();
      const held = (await claim(delivery.id))!;
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          { status, failureCode: "transport_failed" },
          new Date("2026-10-07T14:00:30+02:00"),
        ),
      );
      expect((await rows())[0]).toMatchObject({
        status,
        failure_code: "transport_failed",
        reported_failure_code: "transport_failed",
        reported_at: "2026-10-07T12:00:30.000Z",
        reported_outcome: status,
        completed_at: null,
        attempts: 1,
      });
    },
  );
});

describe("receipt delivery reservation", () => {
  async function receiptJob(
    saleId: string,
    receiptCopy: boolean | null = false,
    kind: "document" | "drawer" = "document",
  ) {
    const [location] = await suite.db.select().from(locations);
    return withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(
        tx,
        { locationId: location!.id },
        { name: "Receipt", transport: "network_tcp", host: "printer.test" },
      );
      return enqueuePrintJob(
        tx,
        { locationId: location!.id },
        printer.id,
        new Uint8Array([27, 64]),
        kind,
        { saleId, receiptCopy },
      );
    });
  }
  const request = (printJobId: string) => ({
    requestKey: randomUUID(),
    personId: "staff-one",
    medium: "receipt" as const,
    printJobId,
  });

  it("tracks an unattributed paper original without fabricating an operator", async () => {
    const sale = await issue();
    const job = await receiptJob(sale.saleId);
    const input = { ...request(job.jobId), personId: null };
    const delivery = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, input),
    );
    expect(delivery).toMatchObject({
      saleId: sale.saleId,
      printJobId: job.jobId,
      personId: null,
      medium: "receipt",
      designation: "original",
      status: "queued",
    });
    expect(
      await withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, input)),
    ).toEqual(delivery);
    expect(await rows()).toHaveLength(1);
    expect(await suite.db.select().from(printJobs)).toHaveLength(1);
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.active" });
    const [location] = await suite.db.select().from(locations);
    const [agent] = await suite.db
      .insert(printAgents)
      .values({
        locationId: location!.id,
        name: "Receipt agent",
        tokenHash: "scrypt$fixture",
      })
      .returning();
    const now = new Date();
    const [claimed] = await withTransaction(suite.db, (tx) =>
      claimInvoicePrintJobs(tx, agent!.id, { locationId: location!.id, visibleKeys: [] }, now),
    );
    expect(claimed!.invoiceClaim).toMatchObject({ deliveryId: delivery.id, generation: 1 });
    await withTransaction(suite.db, (tx) =>
      reportInvoicePrintJob(
        tx,
        {
          agentId: agent!.id,
          jobId: job.jobId,
          outcome: { status: "done" },
        },
        now,
      ),
    );
    expect((await rows())[0]).toMatchObject({ status: "sending", person_id: null });
    await withTransaction(suite.db, (tx) =>
      reportInvoicePrintJob(
        tx,
        {
          agentId: agent!.id,
          jobId: job.jobId,
          invoiceClaim: claimed!.invoiceClaim,
          outcome: { status: "done" },
        },
        now,
      ),
    );
    expect((await rows())[0]).toMatchObject({ status: "sent", person_id: null });
    expect((await suite.db.select().from(printJobs))[0]).toMatchObject({
      status: "done",
      receiptCopy: false,
      receiptHandover: null,
    });
  });

  it("correlates the existing queued original without another job or handover snapshot", async () => {
    const sale = await issue();
    const job = await receiptJob(sale.saleId);
    const handover = { personId: "staff-two", confirmedAt: "2026-10-07T12:00:00.000Z" };
    await suite.db
      .update(printJobs)
      .set({ receiptHandover: handover })
      .where(eq(printJobs.id, job.jobId));
    const input = request(job.jobId);
    const delivery = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, input),
    );
    expect(delivery).toMatchObject({
      medium: "receipt",
      printJobId: job.jobId,
      designation: "original",
      generation: 1,
      status: "queued",
      recipient: null,
      consent: null,
    });
    const replay = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, input),
    );
    expect(replay.id).toBe(delivery.id);
    expect(await rows()).toHaveLength(1);
    expect(await suite.db.select().from(printJobs)).toMatchObject([
      { id: job.jobId, status: "queued", receiptHandover: handover, receiptCopy: false },
    ]);
    await expect(
      withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email())),
    ).rejects.toMatchObject({ code: "invoice_delivery.active" });
  });

  it.each(["missing", "other-sale", "drawer", "not-receipt", "done", "failed", "printing"])(
    "refuses a %s job without reserving delivery metadata",
    async (scenario) => {
      const sale = await issue();
      const other = scenario === "other-sale" ? await issue() : sale;
      const job = await receiptJob(
        other.saleId,
        scenario === "not-receipt" ? null : false,
        scenario === "drawer" ? "drawer" : "document",
      );
      if (scenario === "done" || scenario === "failed" || scenario === "printing") {
        await suite.db
          .update(printJobs)
          .set({ status: scenario })
          .where(eq(printJobs.id, job.jobId));
      }
      await expect(
        withTransaction(suite.db, (tx) =>
          reserveInvoiceDelivery(
            tx,
            sale.saleId,
            request(scenario === "missing" ? randomUUID() : job.jobId),
          ),
        ),
      ).rejects.toMatchObject({ code: "invoice_delivery.receipt_invalid" });
      expect(await rows()).toHaveLength(0);
    },
  );

  it("refuses another queued original while allowing only the selected job to be correlated", async () => {
    const sale = await issue();
    const selected = await receiptJob(sale.saleId);
    await receiptJob(sale.saleId);
    await expect(
      withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, request(selected.jobId)),
      ),
    ).rejects.toMatchObject({ code: "invoice_delivery.active" });
    expect(await rows()).toHaveLength(0);
  });

  it("reserves a receipt copy after email completes and refuses original bytes", async () => {
    const sale = await issue();
    const delivery = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    const held = (await claim(delivery.id, "server-one", new Date("2026-12-01T00:00:00.000Z")))!;
    await withTransaction(suite.db, (tx) => reportInvoiceDelivery(tx, held, { status: "sent" }));
    const copy = await receiptJob(sale.saleId, true);
    const next = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, request(copy.jobId)),
    );
    expect(next).toMatchObject({
      medium: "receipt",
      designation: "duplicate",
      generation: 2,
      printJobId: copy.jobId,
    });
    await suite.db
      .update(invoiceDeliveries)
      .set({ status: "failed" })
      .where(eq(invoiceDeliveries.id, next.id));
    const original = await receiptJob(sale.saleId);
    await expect(
      withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, request(original.jobId)),
      ),
    ).rejects.toMatchObject({ code: "invoice_delivery.receipt_invalid" });
  });

  it("refuses copy bytes before an original has completed", async () => {
    const sale = await issue();
    const copy = await receiptJob(sale.saleId, true);
    await expect(
      withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, request(copy.jobId)),
      ),
    ).rejects.toMatchObject({ code: "invoice_delivery.receipt_invalid" });
    expect(await rows()).toHaveLength(0);
  });

  it("rolls back the job and its receipt reservation together", async () => {
    const sale = await issue();
    await expect(
      withTransaction(suite.db, async (tx) => {
        const [location] = await tx.select().from(locations);
        const printer = await createPrinter(
          tx,
          { locationId: location!.id },
          { name: "Receipt", transport: "network_tcp", host: "printer.test" },
        );
        const job = await enqueuePrintJob(
          tx,
          { locationId: location!.id },
          printer.id,
          new Uint8Array([27, 64]),
          "document",
          { saleId: sale.saleId, receiptCopy: false },
        );
        await reserveInvoiceDelivery(tx, sale.saleId, request(job.jobId));
        throw new Error("Caller refused");
      }),
    ).rejects.toThrow("Caller refused");
    expect(await rows()).toHaveLength(0);
    expect(await suite.db.select().from(printJobs)).toHaveLength(0);
  });

  it("cannot reuse a correlated receipt job for a new request even after delivery ends", async () => {
    const sale = await issue();
    const job = await receiptJob(sale.saleId);
    const first = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, request(job.jobId)),
    );
    await suite.db
      .update(invoiceDeliveries)
      .set({ status: "failed" })
      .where(eq(invoiceDeliveries.id, first.id));
    await expect(
      withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, request(job.jobId)),
      ),
    ).rejects.toMatchObject({ code: "invoice_delivery.receipt_invalid" });
    expect(await rows()).toHaveLength(1);
  });

  async function receiptClaimSetup() {
    const sale = await issue();
    const job = await receiptJob(sale.saleId);
    const [location] = await suite.db.select().from(locations);
    const [agent] = await suite.db
      .insert(printAgents)
      .values({
        locationId: location!.id,
        name: "Receipt agent",
        tokenHash: "scrypt$fixture",
      })
      .returning();
    const delivery = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, request(job.jobId)),
    );
    await suite.db
      .update(invoiceDeliveries)
      .set({ nextAttemptAt: start.toISOString() })
      .where(eq(invoiceDeliveries.id, delivery.id));
    return { sale, job, delivery, agentId: agent!.id, locationId: location!.id };
  }
  async function pulled(ctx: Awaited<ReturnType<typeof receiptClaimSetup>>) {
    return withTransaction(suite.db, (tx) =>
      claimPrintJobs(tx, ctx.agentId, {
        locationId: ctx.locationId,
        visibleKeys: [],
        invoiceReceiptsAt: start.toISOString(),
      }),
    );
  }

  it("leaves an absent invoice delivery unclaimed", async () => {
    expect(await claim(randomUUID())).toBeUndefined();
    expect(await rows()).toHaveLength(0);
  });

  it.each(["queued", "done", "failed"] as const)(
    "does not attach an invoice claim to a %s print job retaining the holder",
    async (status) => {
      const ctx = await receiptClaimSetup();
      await suite.db
        .update(printJobs)
        .set({ status, claimedBy: ctx.agentId })
        .where(eq(printJobs.id, ctx.job.jobId));
      expect(await claim(ctx.delivery.id, ctx.agentId)).toBeUndefined();
      await suite.db
        .update(printJobs)
        .set({ status: "printing" })
        .where(eq(printJobs.id, ctx.job.jobId));
      expect(await claim(ctx.delivery.id, ctx.agentId)).toBeDefined();
    },
  );

  it("does not attach another job's print claim to this invoice attempt", async () => {
    const ctx = await receiptClaimSetup();
    const other = await receiptJob(ctx.sale.saleId, true);
    const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, other.jobId));
    await withTransaction(suite.db, (tx) =>
      claimPrintJobs(tx, ctx.agentId, {
        locationId: ctx.locationId,
        visibleKeys: [],
        invoiceReceiptsAt: start.toISOString(),
        printerId: job!.printerId,
      }),
    );
    expect(await claim(ctx.delivery.id, ctx.agentId)).toBeUndefined();
    await pulled(ctx);
    expect(await claim(ctx.delivery.id, ctx.agentId)).toBeDefined();
  });

  it("requires the same agent's current print claim before assigning an invoice token", async () => {
    const ctx = await receiptClaimSetup();
    expect(await claim(ctx.delivery.id, ctx.agentId)).toBeUndefined();
    expect(await pulled(ctx)).toHaveLength(1);
    const [otherAgent] = await suite.db
      .insert(printAgents)
      .values({
        locationId: ctx.locationId,
        name: "Another receipt agent",
        tokenHash: "scrypt$other-fixture",
      })
      .returning();
    expect(await claim(ctx.delivery.id, otherAgent!.id)).toBeUndefined();
    const held = await claim(ctx.delivery.id, ctx.agentId);
    expect(held).toMatchObject({ deliveryId: ctx.delivery.id, generation: 1, holder: ctx.agentId });
    expect((await rows())[0]).toMatchObject({ claimed_agent_id: ctx.agentId, status: "sending" });
  });

  it.each(["sent", "failed"] as const)(
    "projects current receipt %s without another handover or retry",
    async (status) => {
      const ctx = await receiptClaimSetup();
      await pulled(ctx);
      const held = (await claim(ctx.delivery.id, ctx.agentId))!;
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          status === "sent" ? { status } : { status, failureCode: "transport_failed" },
          start,
        ),
      );
      const [job] = await suite.db.select().from(printJobs);
      expect(job).toMatchObject({
        status: status === "sent" ? "done" : "failed",
        receiptHandover: null,
        attempts: status === "sent" ? 0 : 5,
        deliveredAt: status === "sent" ? start.toISOString() : null,
        lastError: status === "sent" ? null : "transport_failed",
      });
      expect(await pulled(ctx)).toHaveLength(0);
      const before = { ...job };
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(tx, held, { status: "sent" }, expired),
      );
      expect((await suite.db.select().from(printJobs))[0]).toEqual(before);
    },
  );

  it.each([false, true])(
    "expires receipt lease on restart=%s and ends old print eligibility before email retry",
    async (restart) => {
      const ctx = await receiptClaimSetup();
      await pulled(ctx);
      const held = (await claim(ctx.delivery.id, ctx.agentId))!;
      if (!restart) {
        expect(
          await withTransaction(suite.db, (tx) =>
            expireInvoiceDeliveryClaims(tx, new Date(start.getTime() + 59999)),
          ),
        ).toBe(0);
        expect((await suite.db.select().from(printJobs))[0]!.status).toBe("printing");
      }
      expect(await expire(restart)).toBe(1);
      expect((await suite.db.select().from(printJobs))[0]).toMatchObject({
        status: "failed",
        attempts: 5,
      });
      expect(await pulled(ctx)).toHaveLength(0);
      const next = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, ctx.sale.saleId, email()),
      );
      expect(next).toMatchObject({ medium: "email", designation: "original", generation: 2 });
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, held, { status: "sent" }, expired),
        ),
      ).toEqual({ updated: false, historical: true });
      expect((await suite.db.select().from(printJobs))[0]).toMatchObject({
        status: "failed",
        attempts: 5,
        deliveredAt: null,
      });
      expect((await rows())[1]).toMatchObject({
        status: "queued",
        designation: "original",
        attempts: 0,
      });
    },
  );

  it.each(["sent", "failed"] as const)(
    "projects latest late receipt %s before retry",
    async (status) => {
      const ctx = await receiptClaimSetup();
      await pulled(ctx);
      const held = (await claim(ctx.delivery.id, ctx.agentId))!;
      await expire();
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          status === "sent" ? { status } : { status, failureCode: "transport_failed" },
          expired,
        ),
      );
      expect((await suite.db.select().from(printJobs))[0]).toMatchObject({
        status: status === "sent" ? "done" : "failed",
        deliveredAt: status === "sent" ? expired.toISOString() : null,
        attempts: 5,
      });
      expect((await rows())[0]!.status).toBe(status === "sent" ? "sent" : "unknown");
      const next = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, ctx.sale.saleId, email()),
      );
      expect(next.designation).toBe(status === "sent" ? "duplicate" : "original");
    },
  );

  it("keeps the receipt job unchanged for an unauthenticated token or generation", async () => {
    const ctx = await receiptClaimSetup();
    await pulled(ctx);
    const held = (await claim(ctx.delivery.id, ctx.agentId))!;
    const before = (await suite.db.select().from(printJobs))[0];
    for (const bad of [
      { ...held, token: "wrong" },
      { ...held, generation: 2 },
    ]) {
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, bad, { status: "sent" }, start),
        ),
      ).toEqual({ updated: false, historical: false });
      expect((await suite.db.select().from(printJobs))[0]).toEqual(before);
    }
    expect(
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(tx, held, { status: "sent" }, start),
      ),
    ).toEqual({ updated: true, historical: false });
    expect((await suite.db.select().from(printJobs))[0]!.status).toBe("done");
  });

  /** The printer delete's job and receipt endings and its tombstone write, in one transaction. */
  async function deleteReceiptPrinter(jobId: string, now = start) {
    const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    const printerId = job!.printerId;
    await withTransaction(suite.db, async (tx) => {
      const live = await tx.execute<{ print_job_id: string }>(sql`
        select d.print_job_id from invoice_deliveries d
        join print_jobs j on j.id = d.print_job_id
        where j.printer_id = ${printerId} and d.medium = 'receipt'
          and d.status in ('queued', 'sending')`);
      await endDeletedPrinterJobs(tx, printerId);
      await endInvoicePrintDeliveries(
        tx,
        live.rows.map((row) => row.print_job_id),
        now,
      );
      await tx
        .update(printers)
        .set({ active: false, deletedAt: now.toISOString() })
        .where(eq(printers.id, printerId));
    });
    return printerId;
  }
  async function jobById(jobId: string) {
    return (await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId)))[0]!;
  }

  it("answers printer.not_found to a receipt reservation naming a deleted printer's job, before replaying its request key", async () => {
    const sale = await issue();
    const job = await receiptJob(sale.saleId);
    const first = request(job.jobId);
    await withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, first));
    const printerId = await deleteReceiptPrinter(job.jobId);
    // Not a state the delete leaves; it shows a waiting job does not reopen the deleted printer.
    const [seeded] = await suite.db
      .insert(printJobs)
      .values({
        locationId: (await jobById(job.jobId)).locationId,
        printerId,
        payload: new Uint8Array([27, 64]),
        saleId: sale.saleId,
        receiptCopy: false,
      })
      .returning();
    const before = await rows();
    const jobsBefore = await suite.db.select().from(printJobs);

    for (const input of [first, request(seeded!.id)]) {
      await expect(
        withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, input)),
      ).rejects.toMatchObject({ code: "printer.not_found", params: { id: printerId } });
    }
    await expect(
      withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, request(randomUUID())),
      ),
    ).rejects.toMatchObject({ code: "invoice_delivery.receipt_invalid" });
    expect(await rows()).toEqual(before);
    expect(await suite.db.select().from(printJobs)).toEqual(jobsBefore);
  });

  it("gives no invoice token for a deleted printer's receipt, even with its job seeded back to printing", async () => {
    const ctx = await receiptClaimSetup();
    await pulled(ctx);
    await deleteReceiptPrinter(ctx.job.jobId);
    // Neither state is one the delete leaves; together they isolate the deleted-printer check.
    await suite.db
      .update(invoiceDeliveries)
      .set({ status: "queued" })
      .where(eq(invoiceDeliveries.id, ctx.delivery.id));
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedBy: ctx.agentId, claimedAt: start.toISOString() })
      .where(eq(printJobs.id, ctx.job.jobId));
    const before = await rows();
    const job = await jobById(ctx.job.jobId);

    expect(await claim(ctx.delivery.id, ctx.agentId)).toBeUndefined();

    expect(await rows()).toEqual(before);
    expect(await jobById(ctx.job.jobId)).toEqual(job);
  });

  it.each(["sent", "failed"] as const)(
    "keeps a deleted printer's ended receipt and job, recording only a late %s report's metadata",
    async (status) => {
      const ctx = await receiptClaimSetup();
      const [pulledJob] = await withTransaction(suite.db, (tx) =>
        claimInvoicePrintJobs(
          tx,
          ctx.agentId,
          { locationId: ctx.locationId, visibleKeys: [] },
          start,
        ),
      );
      const held = { ...pulledJob!.invoiceClaim!, holder: ctx.agentId };
      await deleteReceiptPrinter(ctx.job.jobId);
      const ended = await jobById(ctx.job.jobId);
      expect(ended).toMatchObject({
        status: "failed",
        attempts: MAX_DELIVERY_ATTEMPTS,
        lastError: PRINTER_DELETED,
        claimedBy: ctx.agentId,
      });
      const [unknown] = await suite.db
        .select()
        .from(invoiceDeliveries)
        .where(eq(invoiceDeliveries.id, ctx.delivery.id));
      expect(unknown).toMatchObject({
        status: "unknown",
        failureCode: "transport_failed",
        expiredAt: start.toISOString(),
        completedAt: null,
      });
      const outcome: InvoiceDeliveryOutcome =
        status === "sent" ? { status } : { status, failureCode: "transport_failed" };

      expect(
        await withTransaction(suite.db, (tx) => reportInvoiceDelivery(tx, held, outcome, expired)),
      ).toEqual({ updated: false, historical: false });

      const [reported] = await suite.db
        .select()
        .from(invoiceDeliveries)
        .where(eq(invoiceDeliveries.id, ctx.delivery.id));
      expect(reported).toEqual({
        ...unknown,
        reportedOutcome: status,
        reportedAt: expired.toISOString(),
        reportedFailureCode: status === "sent" ? null : "transport_failed",
      });
      expect(await jobById(ctx.job.jobId)).toEqual(ended);
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceDelivery(tx, held, { status: "sent" }, expired),
        ),
      ).toEqual({ updated: false, historical: false });
      expect(
        (
          await suite.db
            .select()
            .from(invoiceDeliveries)
            .where(eq(invoiceDeliveries.id, ctx.delivery.id))
        )[0],
      ).toEqual(reported);
      expect(await jobById(ctx.job.jobId)).toEqual(ended);
    },
  );

  it("ends a live receipt whose job had already printed, leaves that job as it was, and refuses its late report", async () => {
    const ctx = await receiptClaimSetup();
    const [pulledJob] = await withTransaction(suite.db, (tx) =>
      claimInvoicePrintJobs(
        tx,
        ctx.agentId,
        { locationId: ctx.locationId, visibleKeys: [] },
        start,
      ),
    );
    const held = { ...pulledJob!.invoiceClaim!, holder: ctx.agentId };
    // A job finished while its receipt still says sending: not a state the routes leave, which is
    // why only the retained printer, not the job, can fence its late report.
    await suite.db
      .update(printJobs)
      .set({ status: "done", deliveredAt: start.toISOString() })
      .where(eq(printJobs.id, ctx.job.jobId));
    const printed = await jobById(ctx.job.jobId);

    await deleteReceiptPrinter(ctx.job.jobId);

    expect(await jobById(ctx.job.jobId)).toEqual(printed);
    expect((await rows())[0]).toMatchObject({
      status: "unknown",
      failure_code: "transport_failed",
    });
    expect(
      await withTransaction(suite.db, (tx) =>
        reportInvoiceDelivery(
          tx,
          held,
          { status: "failed", failureCode: "transport_failed" },
          expired,
        ),
      ),
    ).toEqual({ updated: false, historical: false });
    expect(await jobById(ctx.job.jobId)).toEqual(printed);
    expect((await rows())[0]).toMatchObject({
      status: "unknown",
      reported_outcome: "failed",
      completed_at: null,
    });
  });

  it.each(["deleted printer", "deletion reason"] as const)(
    "expiry leaves the job of a %s as it was",
    async (fence) => {
      const ctx = await receiptClaimSetup();
      await pulled(ctx);
      await claim(ctx.delivery.id, ctx.agentId);
      if (fence === "deleted printer") {
        await deleteReceiptPrinter(ctx.job.jobId);
        // Neither state is one the delete leaves; together they isolate expiry's printer check.
        await suite.db
          .update(invoiceDeliveries)
          .set({ status: "sending" })
          .where(eq(invoiceDeliveries.id, ctx.delivery.id));
        await suite.db
          .update(printJobs)
          .set({ status: "done", deliveredAt: start.toISOString() })
          .where(eq(printJobs.id, ctx.job.jobId));
      } else {
        await suite.db
          .update(printJobs)
          .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastError: PRINTER_DELETED })
          .where(eq(printJobs.id, ctx.job.jobId));
      }
      const job = await jobById(ctx.job.jobId);

      expect(await expire()).toBe(1);

      expect(await jobById(ctx.job.jobId)).toEqual(job);
      expect((await rows())[0]).toMatchObject({ status: "unknown", failure_code: "timeout" });
    },
  );
});

describe("invoice delivery staff attribution", () => {
  it.each(["email", "a4"] as const)("refuses unattributed %s delivery rows", async (medium) => {
    const sale = await issue();
    await expect(
      withTransaction(suite.db, (tx) =>
        tx.insert(invoiceDeliveries).values({
          saleId: sale.saleId,
          requestKey: randomUUID(),
          medium,
          designation: "original",
          generation: 1,
          personId: null,
          ...(medium === "email" ? { recipient: "customer@example.test", consent } : {}),
        }),
      ),
    ).rejects.toThrow("CHECK constraint failed: invoice_deliveries_person_ck");
    expect(await rows()).toEqual([]);
  });
});

describe("receipt delivery correlation key", () => {
  it("refuses an absent job through the declared foreign key", async () => {
    const sale = await issue();
    await expect(
      withTransaction(suite.db, (tx) =>
        tx.insert(invoiceDeliveries).values({
          saleId: sale.saleId,
          requestKey: randomUUID(),
          medium: "receipt",
          designation: "original",
          generation: 1,
          personId: "staff-one",
          printJobId: randomUUID(),
        }),
      ),
    ).rejects.toThrow("FOREIGN KEY constraint failed");
    expect(await rows()).toHaveLength(0);
  });
});

describe("receipt agent correlation key", () => {
  it("refuses an absent agent through the declared foreign key", async () => {
    const sale = await issue();
    await expect(
      withTransaction(suite.db, (tx) =>
        tx.insert(invoiceDeliveries).values({
          saleId: sale.saleId,
          requestKey: randomUUID(),
          medium: "email",
          designation: "original",
          generation: 1,
          personId: "staff-one",
          recipient: "customer@example.test",
          consent,
          claimedAgentId: randomUUID(),
        }),
      ),
    ).rejects.toThrow("FOREIGN KEY constraint failed");
    expect(await rows()).toHaveLength(0);
  });
});

describe("invoice email automatic retries", () => {
  it("does not automatically retry a definite receipt refusal", async () => {
    const sale = await issue();
    const [location] = await suite.db.select().from(locations);
    const [agent] = await suite.db
      .insert(printAgents)
      .values({
        locationId: location!.id,
        name: "Receipt agent",
        tokenHash: "scrypt$retry-fixture",
      })
      .returning();
    const delivery = await withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(
        tx,
        { locationId: location!.id },
        { name: "Receipt", transport: "network_tcp", host: "printer.test" },
      );
      const job = await enqueuePrintJob(
        tx,
        { locationId: location!.id },
        printer.id,
        new Uint8Array([27, 64]),
        "document",
        { saleId: sale.saleId, receiptCopy: false },
      );
      return reserveInvoiceDelivery(tx, sale.saleId, {
        requestKey: randomUUID(),
        personId: "staff-one",
        medium: "receipt",
        printJobId: job.jobId,
      });
    });
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedBy: agent!.id })
      .where(eq(printJobs.id, delivery.printJobId!));
    const held = (await claim(delivery.id, agent!.id, new Date("2026-12-01T00:00:00.000Z")))!;
    await withTransaction(suite.db, (tx) =>
      reportInvoiceEmailDelivery(
        tx,
        held,
        { status: "failed", failureCode: "transport_failed" },
        new Date("2026-12-01T00:00:01.000Z"),
      ),
    );
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "failed", medium: "receipt", attempts: 1 });
    expect((await suite.db.select().from(printJobs))[0]).toMatchObject({
      status: "failed",
      attempts: 5,
    });
  });

  it("records an expired attempt's refusal as history without altering its explicit retry", async () => {
    const { sale, delivery } = await queued();
    const held = (await claim(delivery.id))!;
    await expire();
    await withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email()));
    const before = (await rows())[1];
    expect(
      await withTransaction(suite.db, (tx) =>
        reportInvoiceEmailDelivery(
          tx,
          held,
          { status: "failed", failureCode: "transport_failed" },
          expired,
        ),
      ),
    ).toEqual({ updated: false, historical: true });
    expect(await rows()).toHaveLength(2);
    expect((await rows())[1]).toEqual(before);
    expect((await rows())[0]).toMatchObject({ status: "unknown", reported_outcome: "failed" });
  });
  it("persists four due retries, retains each refusal and stops after five claims", async () => {
    const { sale, delivery } = await queued();
    let currentId = delivery.id;
    const claims = [];
    const times = [
      "2026-10-07T12:00:00.000Z",
      "2026-10-07T12:00:05.000Z",
      "2026-10-07T12:00:35.000Z",
      "2026-10-07T12:02:35.000Z",
      "2026-10-07T12:12:35.000Z",
    ];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const now = new Date(times[attempt - 1]!);
      const held = (await claim(currentId, "server-one", now))!;
      expect(held).toMatchObject({ deliveryId: currentId, generation: attempt });
      claims.push(held);
      expect((await rows())[attempt - 1]).toMatchObject({ attempts: attempt, status: "sending" });
      await withTransaction(suite.db, (tx) =>
        reportInvoiceEmailDelivery(
          tx,
          held,
          { status: "failed", failureCode: "transport_failed" },
          now,
        ),
      );
      const history = await rows();
      expect(history).toHaveLength(attempt === 5 ? 5 : attempt + 1);
      expect(history[attempt - 1]).toMatchObject({
        status: "failed",
        attempts: attempt,
        reported_outcome: "failed",
        reported_failure_code: "transport_failed",
        reported_at: now.toISOString(),
      });
      if (attempt < 5) {
        const next = history[attempt]!;
        currentId = String(next.id);
        expect(next).toMatchObject({
          sale_id: sale.saleId,
          status: "queued",
          designation: "original",
          generation: attempt + 1,
          attempts: attempt,
          recipient: "customer@example.test",
          person_id: "staff-one",
          consent: history[0]!.consent,
          next_attempt_at: times[attempt],
          claim_token_hash: null,
          claimed_by: null,
          claimed_at: null,
          reported_at: null,
        });
        expect(
          await claim(currentId, "server-two", new Date(new Date(times[attempt]!).getTime() - 1)),
        ).toBeUndefined();
        await expect(
          withTransaction(suite.db, (tx) => reserveInvoiceDelivery(tx, sale.saleId, email())),
        ).rejects.toMatchObject({ code: "invoice_delivery.active" });
        const before = await rows();
        expect(
          await withTransaction(suite.db, (tx) =>
            reportInvoiceEmailDelivery(tx, held, { status: "sent" }, now),
          ),
        ).toEqual({ updated: false, historical: false });
        expect(await rows()).toEqual(before);
        expect(
          await withTransaction(suite.db, (tx) =>
            reportInvoiceEmailDelivery(
              tx,
              held,
              { status: "failed", failureCode: "transport_failed" },
              now,
            ),
          ),
        ).toEqual({ updated: false, historical: false });
        expect(await rows()).toEqual(before);
      }
    }
    expect(new Set(claims.map((held) => held.token)).size).toBe(5);
    expect(
      await claim(currentId, "server-two", new Date("2026-12-01T00:00:00.000Z")),
    ).toBeUndefined();
    const explicit = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    expect(explicit).toMatchObject({
      designation: "original",
      generation: 6,
      status: "queued",
      attempts: 0,
    });
    expect(
      await claim(explicit.id, "server-one", new Date("2026-12-01T00:00:00.000Z")),
    ).toBeDefined();
    expect((await rows())[5]!.attempts).toBe(1);
  });

  it.each(["sent", "unknown"] as const)("never automatically retries %s", async (status) => {
    const { delivery } = await queued();
    const held = (await claim(delivery.id))!;
    await withTransaction(suite.db, (tx) =>
      reportInvoiceEmailDelivery(
        tx,
        held,
        status === "sent" ? { status } : { status, failureCode: "timeout" },
        start,
      ),
    );
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status, attempts: 1 });
    expect(await claim(delivery.id, "server-two", expired)).toBeUndefined();
  });

  it("leaves an expired refusal uncertain without reserving a retry", async () => {
    const { delivery } = await queued();
    const held = (await claim(delivery.id))!;
    await expire();
    await withTransaction(suite.db, (tx) =>
      reportInvoiceEmailDelivery(
        tx,
        held,
        { status: "failed", failureCode: "transport_failed" },
        expired,
      ),
    );
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({
      status: "unknown",
      failure_code: "timeout",
      reported_outcome: "failed",
    });
  });

  it.each(["token", "generation", "holder"] as const)(
    "cannot schedule from a forged %s",
    async (field) => {
      const { delivery } = await queued();
      const held = (await claim(delivery.id))!;
      const bad = { ...held, [field]: field === "generation" ? 2 : "wrong" };
      expect(
        await withTransaction(suite.db, (tx) =>
          reportInvoiceEmailDelivery(
            tx,
            bad,
            { status: "failed", failureCode: "transport_failed" },
            start,
          ),
        ),
      ).toEqual({ updated: false, historical: false });
      expect(await rows()).toHaveLength(1);
      expect((await rows())[0]!.status).toBe("sending");
      await withTransaction(suite.db, (tx) =>
        reportInvoiceEmailDelivery(
          tx,
          held,
          { status: "failed", failureCode: "transport_failed" },
          start,
        ),
      );
      expect(await rows()).toHaveLength(2);
    },
  );

  it("keeps a duplicate's designation through a refusal and later acceptance", async () => {
    const { sale, delivery } = await queued();
    const original = (await claim(delivery.id))!;
    await withTransaction(suite.db, (tx) =>
      reportInvoiceEmailDelivery(tx, original, { status: "sent" }, start),
    );
    const copy = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    const now = new Date("2026-12-01T00:00:00.000Z");
    const held = (await claim(copy.id, "server-one", now))!;
    await withTransaction(suite.db, (tx) =>
      reportInvoiceEmailDelivery(
        tx,
        held,
        { status: "failed", failureCode: "transport_failed" },
        now,
      ),
    );
    const retry = (await rows())[2]!;
    expect(retry).toMatchObject({
      status: "queued",
      designation: "duplicate",
      attempts: 1,
      generation: 3,
    });
    const next = (await claim(
      String(retry.id),
      "server-one",
      new Date("2026-12-01T00:00:05.000Z"),
    ))!;
    await withTransaction(suite.db, (tx) =>
      reportInvoiceEmailDelivery(
        tx,
        next,
        { status: "sent" },
        new Date("2026-12-01T00:00:06.000Z"),
      ),
    );
    expect((await rows())[2]).toMatchObject({
      status: "sent",
      designation: "duplicate",
      attempts: 2,
    });
    expect(await rows()).toHaveLength(3);
  });

  it("rolls back the refusal and scheduled retry with their caller", async () => {
    const { delivery } = await queued();
    const held = (await claim(delivery.id))!;
    const before = await rows();
    await expect(
      withTransaction(suite.db, async (tx) => {
        await reportInvoiceEmailDelivery(
          tx,
          held,
          { status: "failed", failureCode: "transport_failed" },
          start,
        );
        throw new Error("Caller refused");
      }),
    ).rejects.toThrow("Caller refused");
    expect(await rows()).toEqual(before);
  });
});

describe("invoice email worker pass", () => {
  it("stops the default idle wait when shutdown arrives", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let iterations = 0;
    const work = runInvoiceEmailLoop({
      db: suite.db,
      holder: "server-one",
      now: () => start,
      readDocument: documentFor,
      send: async () => {
        throw new Error("Secondary cannot send");
      },
      signal: controller.signal,
      isPrimary: () => {
        iterations++;
        entered();
        return false;
      },
      onError: () => {
        throw new Error("Unexpected loop failure");
      },
    });
    try {
      await within(started);
      controller.abort();
      await within(work);
      expect(iterations).toBe(1);
    } finally {
      controller.abort();
      await within(work);
    }
  });

  it("does not claim or send when already stopped", async () => {
    await queued();
    const controller = new AbortController();
    controller.abort();
    await runInvoiceEmailLoop({
      db: suite.db,
      holder: "server-one",
      now: () => start,
      readDocument: documentFor,
      send: async () => {
        throw new Error("Stopped worker cannot send");
      },
      signal: controller.signal,
      isPrimary: () => true,
      onError: () => {
        throw new Error("Unexpected loop failure");
      },
    });
    expect((await rows())[0]).toMatchObject({ status: "queued", attempts: 0 });
  });
  it("checks primary status on every iteration before claiming invoice email", async () => {
    await queued();
    const controller = new AbortController();
    let primary = false;
    let sleeps = 0;
    let sent = 0;
    await runInvoiceEmailLoop({
      db: suite.db,
      holder: "server-one",
      now: () => start,
      readDocument: documentFor,
      send: async () => {
        sent++;
        return { status: "sent" };
      },
      signal: controller.signal,
      isPrimary: () => primary,
      onError: () => {
        throw new Error("Unexpected loop failure");
      },
      sleep: async () => {
        if (sleeps++ === 0) {
          expect(sent).toBe(0);
          expect((await rows())[0]).toMatchObject({ status: "queued", attempts: 0 });
          primary = true;
        } else controller.abort();
      },
    });
    expect(sent).toBe(1);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("finishes and records an in-flight send before shutdown without another iteration", async () => {
    await queued();
    const controller = new AbortController();
    let answer!: (outcome: InvoiceDeliveryOutcome) => void;
    const pending = new Promise<InvoiceDeliveryOutcome>((resolve) => {
      answer = resolve;
    });
    let started!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finished = false;
    let slept = false;
    const work = runInvoiceEmailLoop({
      db: suite.db,
      holder: "server-one",
      now: () => start,
      readDocument: documentFor,
      send: async () => {
        started();
        return pending;
      },
      signal: controller.signal,
      isPrimary: () => true,
      onError: () => {
        throw new Error("Unexpected loop failure");
      },
      sleep: async () => {
        slept = true;
      },
    }).then(() => {
      finished = true;
    });
    try {
      await within(
        Promise.race([
          sending,
          work.then(() => {
            throw new Error("Worker ended before send");
          }),
        ]),
      );
      controller.abort();
      await Promise.resolve();
      expect(finished).toBe(false);
      expect((await rows())[0]).toMatchObject({ status: "sending" });
    } finally {
      controller.abort();
      answer({ status: "sent" });
      await within(work);
    }
    expect(slept).toBe(false);
    expect((await rows())[0]).toMatchObject({ status: "sent", reported_outcome: "sent" });
  });

  it("contains a pass failure and retries the still-queued delivery on the next iteration", async () => {
    await queued();
    const controller = new AbortController();
    const failure = new Error("Unexpected clock failure");
    let broken = true;
    const errors: unknown[] = [];
    await runInvoiceEmailLoop({
      db: suite.db,
      holder: "server-one",
      now: () => {
        if (broken) throw failure;
        return start;
      },
      readDocument: documentFor,
      send: async () => {
        controller.abort();
        return { status: "sent" };
      },
      signal: controller.signal,
      isPrimary: () => true,
      onError: (error) => {
        errors.push(error);
      },
      sleep: async () => {
        broken = false;
      },
    });
    expect(errors).toEqual([failure]);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 1 });
  });
  it("expires abandoned claims before selecting new work without replaying them", async () => {
    const { delivery } = await queued();
    await claim(delivery.id);
    const options = {
      db: suite.db,
      holder: "server-two",
      readDocument: documentFor,
      send: async (): Promise<InvoiceDeliveryOutcome> => {
        throw new Error("Uncertain replay");
      },
    };
    expect(
      await runInvoiceEmailPass({ ...options, now: () => new Date(start.getTime() + 59_999) }),
    ).toEqual({ processed: false });
    expect((await rows())[0]!.status).toBe("sending");
    expect(await runInvoiceEmailPass({ ...options, now: () => expired })).toEqual({
      processed: false,
    });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({
      status: "unknown",
      failure_code: "timeout",
      attempts: 1,
    });
  });

  it("marks the submitted document as a duplicate from delivery history", async () => {
    const { sale, delivery } = await queued();
    const original = (await claim(delivery.id))!;
    await withTransaction(suite.db, (tx) =>
      reportInvoiceDelivery(tx, original, { status: "sent" }, start),
    );
    const copy = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, sale.saleId, email()),
    );
    let duplicate: boolean | undefined;
    await runInvoiceEmailPass({
      db: suite.db,
      holder: "server-one",
      now: () => new Date("2026-12-01T00:00:00.000Z"),
      readDocument: documentFor,
      send: async (message) => {
        duplicate = message.document.duplicate;
        return { status: "sent" };
      },
    });
    expect(duplicate).toBe(true);
    expect((await rows())[1]).toMatchObject({
      id: copy.id,
      status: "sent",
      designation: "duplicate",
    });
  });

  it("sanitises a projection failure without a send or an automatic replay", async () => {
    await queued();
    let transported = false;
    await runInvoiceEmailPass({
      db: suite.db,
      holder: "server-one",
      now: () => start,
      readDocument: async () => {
        throw new Error("Saved customer private data");
      },
      send: async () => {
        transported = true;
        return { status: "sent" };
      },
    });
    expect(transported).toBe(false);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({
      status: "unknown",
      failure_code: "transport_failed",
      reported_outcome: "unknown",
    });
    expect(JSON.stringify(await rows())).not.toContain("private data");
  });
  async function within<T>(promise: Promise<T>): Promise<T> {
    let timer!: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Worker operation exceeded 5 seconds")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const documentFor = async (
    tx: import("@waitron/db").Transaction,
    delivery: { saleId: string; designation: string },
  ) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, delivery.saleId));
    return {
      ...documentFixture,
      duplicate: false,
      result: {
        ...documentFixture.result,
        issuedAt: sale!.issuedAt,
      },
    };
  };

  it("commits the claim before transport and serves another sale while the send waits", async () => {
    const { sale, delivery } = await queued();
    let answer!: (outcome: InvoiceDeliveryOutcome) => void;
    const waiting = new Promise<InvoiceDeliveryOutcome>((resolve) => {
      answer = resolve;
    });
    let started!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    let submitted: { recipient: string; document: ReceiptDocumentInput } | undefined;
    const work = runInvoiceEmailPass({
      db: suite.db,
      holder: "server-one",
      now: () => start,
      readDocument: documentFor,
      send: async (message) => {
        submitted = message;
        started();
        return waiting;
      },
    });
    try {
      await within(
        Promise.race([
          sending,
          work.then(() => {
            throw new Error("Worker ended before transport");
          }),
        ]),
      );
      expect((await rows())[0]).toMatchObject({
        status: "sending",
        attempts: 1,
        claimed_by: "server-one",
      });
      expect(submitted).toMatchObject({
        recipient: "customer@example.test",
        document: { duplicate: false },
      });
      expect(submitted!.document.result.issuedAt).toBe("2026-10-07T12:00:00.000Z");
      const [series] = await suite.db.select().from(invoiceSeries);
      const modules = enabledModules(
        ALL_MODULES,
        venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"),
      );
      const backend = fiscalSlot(modules, null).makeBackend({
        db: suite.db,
        clock,
        environment: "preproduction",
      });
      const another = await within(
        withTransaction(suite.db, (tx) =>
          recordSale(tx, backend, {
            origin: jobOrigin("operator_script"),
            nodeId: nodeId(series!.nodeId),
            seriesId: seriesId(series!.id),
            locale: "es-ES",
            invoiceLocales: ["es-ES"],
            total: "1.00",
            lines: [
              {
                lineNo: 1,
                name: "Tea",
                descriptions: { "es-ES": "Té" },
                quantity: "1",
                unitPrice: "1.00",
                vatRate: "0",
                lineTotal: "1.00",
              },
            ],
            clock,
            settlement: { kind: "deferred" },
            counterparty: { taxId: "12345678Z", legalName: "Another customer", countryCode: "ES" },
            recipientAddress: "Saved address",
          }),
        ),
      );
      expect(another.saleId).not.toBe(sale.saleId);
      expect(await suite.db.select().from(sales)).toHaveLength(2);
      expect(
        await runInvoiceEmailPass({
          db: suite.db,
          holder: "server-two",
          now: () => start,
          readDocument: documentFor,
          send: async () => {
            throw new Error("Duplicate transport");
          },
        }),
      ).toEqual({ processed: false });
    } finally {
      answer({ status: "sent" });
      await work;
    }
    expect((await rows())[0]).toMatchObject({
      id: delivery.id,
      status: "sent",
      attempts: 1,
      reported_outcome: "sent",
    });
  });

  it("does not claim another medium or an email before its due time", async () => {
    const { delivery } = await queued();
    const options = {
      db: suite.db,
      holder: "server-one",
      now: () => new Date(start.getTime() - 1),
      readDocument: documentFor,
      send: async (): Promise<InvoiceDeliveryOutcome> => {
        throw new Error("Early transport");
      },
    };
    expect(await runInvoiceEmailPass(options)).toEqual({ processed: false });
    expect((await rows())[0]).toMatchObject({ id: delivery.id, status: "queued", attempts: 0 });
    await suite.db
      .update(invoiceDeliveries)
      .set({ medium: "a4", recipient: null, consent: null })
      .where(eq(invoiceDeliveries.id, delivery.id));
    expect(await runInvoiceEmailPass({ ...options, now: () => start })).toEqual({
      processed: false,
    });
    expect((await rows())[0]).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("records a certain refusal and claims its scheduled retry only when due", async () => {
    const { delivery } = await queued();
    const first = await runInvoiceEmailPass({
      db: suite.db,
      holder: "server-one",
      now: () => start,
      readDocument: documentFor,
      send: async () => ({ status: "failed", failureCode: "transport_failed" }),
    });
    expect(first).toEqual({ processed: true, deliveryId: delivery.id });
    expect(await rows()).toMatchObject([
      { status: "failed", attempts: 1 },
      { status: "queued", attempts: 1, next_attempt_at: "2026-10-07T12:00:05.000Z" },
    ]);
    const options = {
      db: suite.db,
      holder: "server-two",
      readDocument: documentFor,
      send: async (): Promise<InvoiceDeliveryOutcome> => ({ status: "sent" }),
    };
    expect(
      await runInvoiceEmailPass({ ...options, now: () => new Date("2026-10-07T12:00:04.999Z") }),
    ).toEqual({ processed: false });
    expect(
      await runInvoiceEmailPass({ ...options, now: () => new Date("2026-10-07T12:00:05.000Z") }),
    ).toEqual({ processed: true, deliveryId: (await rows())[1]!.id });
    expect((await rows())[1]).toMatchObject({
      status: "sent",
      attempts: 2,
      designation: "original",
      completed_at: "2026-10-07T12:00:05.000Z",
    });
  });

  it("turns an unexpected transport throw into sanitised uncertainty without replay", async () => {
    await queued();
    await runInvoiceEmailPass({
      db: suite.db,
      holder: "server-one",
      now: () => start,
      readDocument: documentFor,
      send: async () => {
        throw new Error("smtp://private:secret@host customer@example.test");
      },
    });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({
      status: "unknown",
      failure_code: "transport_failed",
      reported_failure_code: "transport_failed",
    });
    expect(JSON.stringify(await rows())).not.toContain("private:secret");
  });

  it("keeps an expired worker result historical once a new attempt is reserved", async () => {
    const { sale } = await queued();
    let answer!: (outcome: InvoiceDeliveryOutcome) => void;
    let started!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<InvoiceDeliveryOutcome>((resolve) => {
      answer = resolve;
    });
    const work = runInvoiceEmailPass({
      db: suite.db,
      holder: "server-one",
      now: () => start,
      readDocument: documentFor,
      send: async () => {
        started();
        return waiting;
      },
    });
    let nextId!: string;
    try {
      await within(
        Promise.race([
          sending,
          work.then(() => {
            throw new Error("Worker ended before transport");
          }),
        ]),
      );
      await within(expire());
      const next = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, sale.saleId, email()),
      );
      nextId = next.id;
    } finally {
      answer({ status: "sent" });
      await work;
    }
    expect(await rows()).toMatchObject([
      { status: "unknown", reported_outcome: "sent" },
      { id: nextId, status: "queued", attempts: 0, reported_at: null },
    ]);
  });
});

it("does not join the write queue while invoice email has no due work", async () => {
  await issue();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = withTransaction(suite.db, async (tx) => {
    await tx.update(tenants).set({ legalName: "Writing beside idle email" });
    entered();
    await gate;
  });
  await started;
  const pass = runInvoiceEmailPass({
    db: suite.db,
    holder: "server-idle",
    now: () => start,
    readDocument: async () => {
      throw new Error("Idle cannot read a document");
    },
    send: async () => {
      throw new Error("Idle cannot send");
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(
      await Promise.race([
        pass,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 500);
        }),
      ]),
    ).toEqual({ processed: false });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    release();
    await writer;
    await pass;
  }
});
