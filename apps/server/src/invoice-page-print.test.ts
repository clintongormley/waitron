import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  type A4HoldCode,
  invoiceDeliveries,
  invoiceSeries,
  locations,
  pagePrinters,
  printAgents,
  printJobs,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { createPrinter, enqueuePrintJob } from "@waitron/printing";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import { jobOrigin, locationId as brandLocation, seriesId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import {
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  reserveInvoiceDelivery,
  type InvoiceDeliveryClaim,
} from "./invoice-delivery.js";
import { registerPagePrinter } from "./page-printers.js";
import {
  claimInvoicePagePrint,
  renewInvoicePagePrint,
  reportInvoicePagePrint,
} from "./invoice-page-print.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const T0 = Date.parse("2026-10-12T10:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms);
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

async function venue() {
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  const locationId = await location("Bar");
  const nodeId = await seedNode(suite.db, brandLocation(locationId));
  const agentOne = await agent(locationId, "Back office agent");
  const agentTwo = await agent(locationId, "Re-paired agent");
  return { locationId, nodeId, agentOne, agentTwo };
}

async function location(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(locations)
    .values({ name, invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return row!.id;
}

async function agent(locationId: string, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({ locationId, name, tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  return row!.id;
}

let hostCounter = 20;

async function printer(
  locationId: string,
  agentId: string | null,
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
      supportedFormats: ["application/pdf", "image/urf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 600,
      agentId,
      ...extra,
    })
    .returning({ id: pagePrinters.id });
  return row!.id;
}

/** A synthetic F1 written through the core, as part 1's delivery suites do. */
async function fullInvoice(nodeId: string): Promise<string> {
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: `F${randomUUID().slice(0, 4)}`, purpose: "full" })
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
      counterparty: { taxId: "12345678Z", legalName: "Saved customer", countryCode: "ES" },
      recipientAddress: "Saved address",
    }),
  );
  return sale.saleId;
}

/** Reserves an A4 delivery and dates it `ms` after T0, so the suite's clock decides when it is due. */
async function queueA4(saleId: string, pagePrinterId: string, ms = 0) {
  const delivery = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, saleId, {
      requestKey: randomUUID(),
      personId: "staff-one",
      medium: "a4",
      pagePrinterId,
    }),
  );
  await suite.db
    .update(invoiceDeliveries)
    .set({ createdAt: at(ms).toISOString(), nextAttemptAt: at(ms).toISOString() })
    .where(eq(invoiceDeliveries.id, delivery.id));
  return delivery.id;
}

function pull(
  agentId: string,
  locationId: string,
  ms: number,
  exceptPrinterIds: readonly string[] = [],
) {
  return withTransaction(suite.db, (tx) =>
    claimInvoicePagePrint(tx, agentId, { locationId, exceptPrinterIds }, at(ms)),
  );
}

async function claim(agentId: string, locationId: string, ms: number) {
  return (await pull(agentId, locationId, ms)).job;
}

function renew(held: InvoiceDeliveryClaim, ms: number, hold: A4HoldCode | null = null) {
  return withTransaction(suite.db, (tx) => renewInvoicePagePrint(tx, held, hold, at(ms)));
}

function report(
  held: InvoiceDeliveryClaim,
  outcome: Parameters<typeof reportInvoicePagePrint>[2],
  ms: number,
) {
  return withTransaction(suite.db, (tx) => reportInvoicePagePrint(tx, held, outcome, at(ms)));
}

function expire(ms: number) {
  return withTransaction(suite.db, (tx) => expireInvoiceDeliveryClaims(tx, at(ms)));
}

async function row(id: string) {
  const [found] = await suite.db
    .select()
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.id, id));
  return found!;
}

async function allRows() {
  return suite.db.select().from(invoiceDeliveries).orderBy(invoiceDeliveries.generation);
}

describe("claiming an A4 delivery", () => {
  it("hands its own agent the oldest due delivery with the printer's endpoint and records the claim", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne, {
      host: "192.0.2.40",
      port: 8631,
      resourcePath: "/ipp/office",
      documentFormat: "image/urf",
      media: "na_letter_8.5x11in",
      resolutionDpi: 300,
    });
    const later = await queueA4(await fullInvoice(v.nodeId), office, 2_000);
    const oldestSale = await fullInvoice(v.nodeId);
    const oldest = await queueA4(oldestSale, office, 1_000);
    const notDue = await queueA4(await fullInvoice(v.nodeId), office, 10_000);

    const job = await claim(v.agentOne, v.locationId, 5_000);

    expect(job).toEqual({
      claim: { deliveryId: oldest, generation: 1, token: expect.any(String), holder: v.agentOne },
      saleId: oldestSale,
      designation: "original",
      printer: {
        id: office,
        host: "192.0.2.40",
        port: 8631,
        resourcePath: "/ipp/office",
        documentFormat: "image/urf",
        media: "na_letter_8.5x11in",
        resolutionDpi: 300,
      },
    });
    expect(await row(oldest)).toMatchObject({
      status: "sending",
      attempts: 1,
      claimedBy: v.agentOne,
      claimedAgentId: v.agentOne,
      claimedAt: at(5_000).toISOString(),
    });
    expect((await row(later)).status).toBe("queued");
    expect((await row(notDue)).status).toBe("queued");
    expect(await claim(v.agentOne, v.locationId, 5_000)).toBeUndefined();
    await report(job!.claim, { status: "sent" }, 5_000);
    const second = await claim(v.agentOne, v.locationId, 5_000);
    expect(second?.claim.deliveryId).toBe(later);
    await report(second!.claim, { status: "sent" }, 5_000);
    expect(await claim(v.agentOne, v.locationId, 5_000)).toBeUndefined();
    expect((await claim(v.agentOne, v.locationId, 10_000))?.claim.deliveryId).toBe(notDue);
  });

  it("does not claim another location's delivery, and that location's claim takes it", async () => {
    const v = await venue();
    const terrace = await location("Terrace");
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    await suite.db
      .update(pagePrinters)
      .set({ locationId: terrace })
      .where(eq(pagePrinters.id, office));

    expect(await claim(v.agentOne, v.locationId, 1_000)).toBeUndefined();
    expect((await row(id)).status).toBe("queued");
    expect((await claim(v.agentOne, terrace, 1_000))?.claim.deliveryId).toBe(id);
  });

  it("does not claim another agent's printer, nor one with no agent, and its own agent claims it", async () => {
    const v = await venue();
    const theirs = await printer(v.locationId, v.agentTwo);
    const nobodys = await printer(v.locationId, null);
    const id = await queueA4(await fullInvoice(v.nodeId), theirs);
    const unclaimed = await queueA4(await fullInvoice(v.nodeId), nobodys);

    expect(await claim(v.agentOne, v.locationId, 1_000)).toBeUndefined();
    expect((await row(id)).status).toBe("queued");

    const job = await claim(v.agentTwo, v.locationId, 1_000);
    expect(job?.claim).toMatchObject({ deliveryId: id, holder: v.agentTwo });
    expect(await claim(v.agentTwo, v.locationId, 1_000)).toBeUndefined();
    expect(await row(unclaimed)).toMatchObject({ status: "queued", claimTokenHash: null });
  });

  it("fails a due delivery whose printer is disabled without claiming it, and hands out the next", async () => {
    const v = await venue();
    const disabled = await printer(v.locationId, v.agentOne);
    const active = await printer(v.locationId, v.agentOne);
    const terrace = await location("Terrace");
    const elsewhere = await printer(v.locationId, v.agentOne);
    const dead = await queueA4(await fullInvoice(v.nodeId), disabled, 1_000);
    const notDue = await queueA4(await fullInvoice(v.nodeId), disabled, 9_000);
    const live = await queueA4(await fullInvoice(v.nodeId), active, 2_000);
    const otherLocation = await queueA4(await fullInvoice(v.nodeId), elsewhere, 1_000);
    await suite.db.update(pagePrinters).set({ active: false }).where(eq(pagePrinters.id, disabled));
    await suite.db
      .update(pagePrinters)
      .set({ active: false, locationId: terrace })
      .where(eq(pagePrinters.id, elsewhere));
    const before = await row(dead);

    const job = await claim(v.agentOne, v.locationId, 5_000);

    expect(job?.claim.deliveryId).toBe(live);
    expect(await row(dead)).toEqual({
      ...before,
      status: "failed",
      failureCode: "printer_disabled",
    });
    expect((await row(notDue)).status).toBe("queued");
    expect((await row(otherLocation)).status).toBe("queued");
  });

  it("gives a second claim before the lease ends nothing", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    await claim(v.agentOne, v.locationId, 1_000);
    const held = await row(id);

    expect(await claim(v.agentOne, v.locationId, 60_999)).toBeUndefined();
    expect(await claim(v.agentTwo, v.locationId, 60_999)).toBeUndefined();
    expect(await row(id)).toEqual(held);
  });

  it("turns an unrenewed claim unknown when any claim is asked for after its lease", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    await claim(v.agentOne, v.locationId, 1_000);

    expect(await claim(v.agentTwo, v.locationId, 61_000)).toBeUndefined();
    expect(await row(id)).toMatchObject({
      status: "unknown",
      failureCode: "timeout",
      expiredAt: at(61_000).toISOString(),
    });
  });
});

describe("renewing an A4 claim", () => {
  it("keeps a claim alive past 60 s, and the expiry sweep leaves it alone", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);

    expect(await renew(job!.claim, 40_000)).toBe("renewed");
    expect((await row(id)).claimedAt).toBe(at(40_000).toISOString());
    expect(await expire(90_000)).toBe(0);
    expect((await row(id)).status).toBe("sending");
    expect(await renew(job!.claim, 90_000)).toBe("renewed");
    expect(await expire(140_000)).toBe(0);
    expect(await report(job!.claim, { status: "sent" }, 140_000)).toEqual({
      updated: true,
      historical: false,
      repeated: false,
    });
    expect(await row(id)).toMatchObject({ status: "sent", completedAt: at(140_000).toISOString() });
  });

  it("without renewal the claim becomes unknown and renewing it then is lost", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);

    expect(await expire(60_000)).toBe(1);
    expect(await row(id)).toMatchObject({ status: "unknown", failureCode: "timeout" });
    expect(await renew(job!.claim, 60_001)).toBe("lost");
    expect(await row(id)).toMatchObject({ status: "unknown", claimedAt: at(0).toISOString() });
  });

  it("answers lost once the lease has run out, even when no sweep has run", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);

    expect(await renew(job!.claim, 60_000)).toBe("lost");
    expect(await row(id)).toMatchObject({ status: "unknown", claimedAt: at(0).toISOString() });
  });

  it("refuses a renewal with another token, generation or holder, or after the report", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);
    const held = job!.claim;

    expect(await renew({ ...held, token: randomUUID() }, 10_000)).toBe("lost");
    expect(await renew({ ...held, generation: held.generation + 1 }, 10_000)).toBe("lost");
    expect(await renew({ ...held, holder: v.agentTwo }, 10_000)).toBe("lost");
    expect(await renew({ ...held, deliveryId: randomUUID() }, 10_000)).toBe("lost");
    expect((await row(id)).claimedAt).toBe(at(0).toISOString());

    await report(held, { status: "failed", failureCode: "printer_unreachable" }, 20_000);
    expect(await renew(held, 30_000)).toBe("lost");
    expect(await row(id)).toMatchObject({ status: "failed", claimedAt: at(0).toISOString() });
  });

  it("neither renews nor reports an email delivery's claim, nor an unknown delivery", async () => {
    const v = await venue();
    const saleId = await fullInvoice(v.nodeId);
    const emailed = await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, saleId, {
        requestKey: randomUUID(),
        personId: "staff-one",
        medium: "email",
        recipient: "customer@example.test",
      }),
    );
    await suite.db
      .update(invoiceDeliveries)
      .set({ nextAttemptAt: at(0).toISOString() })
      .where(eq(invoiceDeliveries.id, emailed.id));
    const held = await withTransaction(suite.db, (tx) =>
      claimInvoiceDelivery(tx, emailed.id, v.agentOne, at(0)),
    );
    const before = await row(emailed.id);

    expect(await renew(held!, 10_000)).toBe("lost");
    expect(await report(held!, { status: "sent" }, 10_000)).toEqual({
      updated: false,
      historical: false,
      repeated: false,
    });
    expect(await row(emailed.id)).toEqual(before);
    expect(
      await report({ ...held!, deliveryId: randomUUID() }, { status: "sent" }, 10_000),
    ).toEqual({ updated: false, historical: false, repeated: false });
  });
});

describe("reporting an A4 delivery", () => {
  it("records a failure with its code and queues no retry", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);

    expect(
      await report(job!.claim, { status: "failed", failureCode: "printer_refused" }, 5_000),
    ).toEqual({ updated: true, historical: false, repeated: false });
    expect(await allRows()).toEqual([
      expect.objectContaining({
        id,
        status: "failed",
        failureCode: "printer_refused",
        reportedOutcome: "failed",
        reportedFailureCode: "printer_refused",
        completedAt: null,
      }),
    ]);
    expect(await claim(v.agentOne, v.locationId, 600_000)).toBeUndefined();
  });

  it("answers a repeat of an accepted report as repeated, agreeing or not, and changes nothing", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);

    expect(await report(job!.claim, { status: "sent" }, 5_000)).toEqual({
      updated: true,
      historical: false,
      repeated: false,
    });
    const done = await row(id);
    const repeated = { updated: false, historical: false, repeated: true };
    expect(await report(job!.claim, { status: "sent" }, 6_000)).toEqual(repeated);
    expect(
      await report(job!.claim, { status: "unknown", failureCode: "printer_aborted" }, 7_000),
    ).toEqual(repeated);
    expect(await row(id)).toEqual(done);
    expect(done).toMatchObject({ status: "sent", reportedAt: at(5_000).toISOString() });
  });

  it("keeps a claim that matches no row lost after an accepted report", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);
    await report(job!.claim, { status: "sent" }, 5_000);
    const other = await queueA4(await fullInvoice(v.nodeId), office, 9_000);
    const done = await row(id);
    const waiting = await row(other);
    const lost = { updated: false, historical: false, repeated: false };

    expect(await report({ ...job!.claim, token: randomUUID() }, { status: "sent" }, 6_000)).toEqual(
      lost,
    );
    expect(await report({ ...job!.claim, holder: v.agentTwo }, { status: "sent" }, 6_000)).toEqual(
      lost,
    );
    expect(await report({ ...job!.claim, generation: 2 }, { status: "sent" }, 6_000)).toEqual(lost);
    expect(await report({ ...job!.claim, deliveryId: other }, { status: "sent" }, 6_000)).toEqual(
      lost,
    );
    expect(await row(other)).toEqual(waiting);
    expect(await row(id)).toEqual(done);
  });

  it("answers lost, not repeated, for a claim whose row was ended without a report", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);
    // Guards against a future writer that ends a claimed A4 row without recording a report.
    await suite.db
      .update(invoiceDeliveries)
      .set({ status: "failed", failureCode: "printer_disabled" })
      .where(eq(invoiceDeliveries.id, id));
    const ended = await row(id);

    expect(await report(job!.claim, { status: "sent" }, 5_000)).toEqual({
      updated: false,
      historical: false,
      repeated: false,
    });
    expect(await row(id)).toEqual(ended);
    expect(ended.reportedAt).toBeNull();
  });

  it("keeps unknown for a failure reported after the lease ran out, even when no sweep has run", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);

    await report(job!.claim, { status: "failed", failureCode: "printer_unreachable" }, 61_000);
    expect(await row(id)).toMatchObject({
      status: "unknown",
      failureCode: "timeout",
      reportedFailureCode: "printer_unreachable",
    });
  });

  it("turns unknown into sent on a late success before any retry", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);
    await expire(60_000);

    expect(await report(job!.claim, { status: "sent" }, 70_000)).toEqual({
      updated: true,
      historical: false,
      repeated: false,
    });
    expect(await row(id)).toMatchObject({
      status: "sent",
      failureCode: null,
      completedAt: at(70_000).toISOString(),
    });
  });

  it("keeps unknown on a late failure", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);
    await expire(60_000);

    await report(job!.claim, { status: "failed", failureCode: "printer_refused" }, 70_000);
    expect(await row(id)).toMatchObject({
      status: "unknown",
      failureCode: "timeout",
      reportedOutcome: "failed",
      reportedFailureCode: "printer_refused",
      completedAt: null,
    });
  });

  it("keeps the same agent's old token as history only after a reclaim", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const saleId = await fullInvoice(v.nodeId);
    const first = await queueA4(saleId, office);
    const old = await claim(v.agentOne, v.locationId, 0);
    await expire(60_000);
    const retry = await queueA4(saleId, office, 61_000);
    const fresh = await claim(v.agentOne, v.locationId, 62_000);
    expect(fresh?.claim).toMatchObject({ deliveryId: retry, generation: 2 });

    expect(await renew(old!.claim, 63_000)).toBe("lost");
    expect(await report(old!.claim, { status: "sent" }, 63_000)).toEqual({
      updated: false,
      historical: true,
      repeated: false,
    });
    expect(await row(first)).toMatchObject({ status: "unknown", reportedOutcome: "sent" });
    expect(await report(old!.claim, { status: "sent" }, 63_500)).toEqual({
      updated: false,
      historical: false,
      repeated: true,
    });
    expect(await row(retry)).toMatchObject({ status: "sending", reportedOutcome: null });
    expect(await renew(fresh!.claim, 64_000)).toBe("renewed");
  });

  it("changes nothing current on an old success after a retry was queued, claimed and failed", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const saleId = await fullInvoice(v.nodeId);
    const first = await queueA4(saleId, office);
    const old = await claim(v.agentOne, v.locationId, 0);
    await expire(60_000);
    const retry = await queueA4(saleId, office, 61_000);
    const fresh = await claim(v.agentOne, v.locationId, 62_000);
    await report(fresh!.claim, { status: "failed", failureCode: "printer_unreachable" }, 63_000);
    const current = await row(retry);

    expect(await report(old!.claim, { status: "sent" }, 64_000)).toEqual({
      updated: false,
      historical: true,
      repeated: false,
    });
    expect(await row(retry)).toEqual(current);
    expect(await row(first)).toMatchObject({ status: "unknown", completedAt: null });
    const next = await queueA4(saleId, office, 65_000);
    expect(await row(next)).toMatchObject({ designation: "original", generation: 3 });
  });

  it.each(["a4", "email", "receipt"] as const)(
    "makes the next %s after a completed A4 original a duplicate",
    async (medium) => {
      const v = await venue();
      const office = await printer(v.locationId, v.agentOne);
      const saleId = await fullInvoice(v.nodeId);
      await queueA4(saleId, office);
      const job = await claim(v.agentOne, v.locationId, 0);
      await report(job!.claim, { status: "sent" }, 5_000);

      const next = await withTransaction(suite.db, async (tx) => {
        const request = { requestKey: randomUUID(), personId: "staff-one" };
        if (medium === "a4") {
          return reserveInvoiceDelivery(tx, saleId, { ...request, medium, pagePrinterId: office });
        }
        if (medium === "email") {
          return reserveInvoiceDelivery(tx, saleId, {
            ...request,
            medium,
            recipient: "customer@example.test",
          });
        }
        const receiptPrinter = await createPrinter(
          tx,
          { locationId: v.locationId },
          { name: "Receipt", transport: "network_tcp", host: "printer.test" },
        );
        const receipt = await enqueuePrintJob(
          tx,
          { locationId: v.locationId },
          receiptPrinter.id,
          new Uint8Array([27, 64]),
          "document",
          { saleId, receiptCopy: true },
        );
        return reserveInvoiceDelivery(tx, saleId, {
          ...request,
          medium,
          printJobId: receipt.jobId,
        });
      });
      expect(next).toMatchObject({ medium, designation: "duplicate", generation: 2 });
      if (medium === "receipt") expect(await suite.db.select().from(printJobs)).toHaveLength(1);
    },
  );

  it("lets the old agent finish its claim after a re-point, and hands the next one to the new agent", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne, {
      host: "192.0.2.40",
      port: 631,
      resourcePath: "/ipp/print",
    });
    const handedOut = await queueA4(await fullInvoice(v.nodeId), office);
    const waiting = await queueA4(await fullInvoice(v.nodeId), office, 1_000);
    const job = await claim(v.agentOne, v.locationId, 2_000);
    expect(job?.claim.deliveryId).toBe(handedOut);

    const repointed = await withTransaction(suite.db, (tx) =>
      registerPagePrinter(
        tx,
        v.locationId,
        {
          name: "Back office",
          entry: {
            agentId: v.agentTwo,
            host: "192.0.2.40",
            lastSeenAt: T0,
            office: {
              port: 631,
              resourcePath: "/ipp/print",
              printable: true,
              documentFormat: "application/pdf",
              media: "iso_a4_210x297mm",
              resolutionDpi: 600,
              supportedFormats: ["application/pdf"],
            },
          },
        },
        { now: T0 + 1_000, discoveryUntil: 0 },
      ),
    );
    expect(repointed).toEqual({ id: office, outcome: "repointed" });

    expect(await renew(job!.claim, 30_000)).toBe("renewed");
    expect(await report(job!.claim, { status: "sent" }, 40_000)).toEqual({
      updated: true,
      historical: false,
      repeated: false,
    });
    expect((await row(handedOut)).status).toBe("sent");
    expect(await claim(v.agentOne, v.locationId, 41_000)).toBeUndefined();
    const next = await claim(v.agentTwo, v.locationId, 41_000);
    expect(next?.claim).toMatchObject({ deliveryId: waiting, holder: v.agentTwo });
    expect(await row(waiting)).toMatchObject({ claimedAgentId: v.agentTwo });
  });
});

describe("one A4 job per printer", () => {
  it("hands out another printer's younger invoice while one is sending, and names the busy printer", async () => {
    const v = await venue();
    const x = await printer(v.locationId, v.agentOne);
    const y = await printer(v.locationId, v.agentOne);
    const first = await queueA4(await fullInvoice(v.nodeId), x, 0);
    const olderOnX = await queueA4(await fullInvoice(v.nodeId), x, 1_000);
    const youngerOnY = await queueA4(await fullInvoice(v.nodeId), y, 2_000);

    expect((await pull(v.agentOne, v.locationId, 5_000)).job?.claim.deliveryId).toBe(first);
    const second = await pull(v.agentOne, v.locationId, 5_000);
    expect(second.job?.claim.deliveryId).toBe(youngerOnY);
    expect(second.busyPrinterIds).toEqual([x]);
    const third = await pull(v.agentOne, v.locationId, 5_000);
    expect(third.job).toBeUndefined();
    expect([...third.busyPrinterIds].sort()).toEqual([x, y].sort());
    expect((await row(olderOnX)).status).toBe("queued");
  });

  it("counts another agent's claim on a printer as busy, and lists only this location's printers", async () => {
    const v = await venue();
    const terrace = await location("Terrace");
    const x = await printer(v.locationId, v.agentTwo);
    const elsewhere = await printer(v.locationId, v.agentOne);
    await queueA4(await fullInvoice(v.nodeId), x, 0);
    await queueA4(await fullInvoice(v.nodeId), elsewhere, 0);
    await suite.db
      .update(pagePrinters)
      .set({ locationId: terrace })
      .where(eq(pagePrinters.id, elsewhere));
    expect((await pull(v.agentTwo, v.locationId, 1_000)).job).toBeDefined();
    expect((await pull(v.agentOne, terrace, 1_000)).job).toBeDefined();
    const later = await queueA4(await fullInvoice(v.nodeId), x, 1_000);
    await suite.db.update(pagePrinters).set({ agentId: v.agentOne }).where(eq(pagePrinters.id, x));

    expect(await pull(v.agentOne, v.locationId, 2_000)).toEqual({
      job: undefined,
      busyPrinterIds: [x],
    });
    expect((await row(later)).status).toBe("queued");
  });

  it("skips a printer it is told to, and hands out another printer's invoice", async () => {
    const v = await venue();
    const x = await printer(v.locationId, v.agentOne);
    const y = await printer(v.locationId, v.agentOne);
    const onX = await queueA4(await fullInvoice(v.nodeId), x, 0);
    const onY = await queueA4(await fullInvoice(v.nodeId), y, 1_000);

    expect((await pull(v.agentOne, v.locationId, 5_000, [x])).job?.claim.deliveryId).toBe(onY);
    expect(await pull(v.agentOne, v.locationId, 5_000, [x])).toEqual({
      job: undefined,
      busyPrinterIds: [y],
    });
    expect((await row(onX)).status).toBe("queued");
    expect((await pull(v.agentOne, v.locationId, 5_000)).job?.claim.deliveryId).toBe(onX);
  });

  it("hands out the printer's next invoice once the one out is reported", async () => {
    const v = await venue();
    const x = await printer(v.locationId, v.agentOne);
    await queueA4(await fullInvoice(v.nodeId), x, 0);
    const next = await queueA4(await fullInvoice(v.nodeId), x, 1_000);
    const job = await claim(v.agentOne, v.locationId, 5_000);
    expect(await claim(v.agentOne, v.locationId, 6_000)).toBeUndefined();

    await report(job!.claim, { status: "failed", failureCode: "printer_refused" }, 7_000);

    expect(await pull(v.agentOne, v.locationId, 8_000)).toMatchObject({
      job: { claim: { deliveryId: next } },
      busyPrinterIds: [],
    });
  });

  it("frees a printer whose claim has lapsed on the same call, and hands out its next invoice", async () => {
    const v = await venue();
    const x = await printer(v.locationId, v.agentOne);
    const lapsed = await queueA4(await fullInvoice(v.nodeId), x, 0);
    const next = await queueA4(await fullInvoice(v.nodeId), x, 1_000);
    await claim(v.agentOne, v.locationId, 1_000);
    expect(await claim(v.agentOne, v.locationId, 60_999)).toBeUndefined();

    expect(await pull(v.agentOne, v.locationId, 61_000)).toMatchObject({
      job: { claim: { deliveryId: next } },
      busyPrinterIds: [],
    });
    expect(await row(lapsed)).toMatchObject({ status: "unknown", failureCode: "timeout" });
  });
});

describe("the hold a renewal reports", () => {
  it("stores the hold beside the renewal, and a renewal without one clears it", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);
    expect((await row(id)).printerHold).toBeNull();

    expect(await renew(job!.claim, 20_000, "paper_out")).toBe("renewed");
    expect(await row(id)).toMatchObject({
      status: "sending",
      claimedAt: at(20_000).toISOString(),
      printerHold: "paper_out",
    });
    expect(await renew(job!.claim, 40_000, "cover_open")).toBe("renewed");
    expect((await row(id)).printerHold).toBe("cover_open");
    expect(await renew(job!.claim, 60_000, null)).toBe("renewed");
    expect(await row(id)).toMatchObject({
      claimedAt: at(60_000).toISOString(),
      printerHold: null,
    });
  });

  it("writes no hold through a lost claim", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);
    const held = job!.claim;
    expect(await renew(held, 10_000, "paper_out")).toBe("renewed");

    expect(await renew({ ...held, token: randomUUID() }, 20_000, "paper_jam")).toBe("lost");
    expect(await renew({ ...held, holder: v.agentTwo }, 20_000, null)).toBe("lost");
    expect(await row(id)).toMatchObject({
      claimedAt: at(10_000).toISOString(),
      printerHold: "paper_out",
    });
    expect(await renew(held, 70_000, null)).toBe("lost");
    expect(await row(id)).toMatchObject({ status: "unknown", printerHold: "paper_out" });
  });

  it("keeps a held claim sending while it is renewed every 20 s for 30 minutes", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const id = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);

    for (let ms = 20_000; ms <= 30 * 60_000; ms += 20_000) {
      expect(await renew(job!.claim, ms, "paper_out")).toBe("renewed");
      expect(await expire(ms + 19_999)).toBe(0);
    }
    expect(await row(id)).toMatchObject({
      status: "sending",
      claimedAt: at(30 * 60_000).toISOString(),
      printerHold: "paper_out",
    });
  });

  it("keeps the last hold through a report and through a lapse", async () => {
    const v = await venue();
    const office = await printer(v.locationId, v.agentOne);
    const reported = await queueA4(await fullInvoice(v.nodeId), office);
    const job = await claim(v.agentOne, v.locationId, 0);
    await renew(job!.claim, 20_000, "paper_out");
    await report(job!.claim, { status: "sent" }, 30_000);
    expect(await row(reported)).toMatchObject({ status: "sent", printerHold: "paper_out" });

    const lapsed = await queueA4(await fullInvoice(v.nodeId), office, 30_000);
    const next = await claim(v.agentOne, v.locationId, 30_000);
    expect(next!.claim.deliveryId).toBe(lapsed);
    await renew(next!.claim, 40_000, "paper_jam");
    expect(await expire(100_000)).toBe(1);
    expect(await row(lapsed)).toMatchObject({
      status: "unknown",
      failureCode: "timeout",
      printerHold: "paper_jam",
    });
  });
});
