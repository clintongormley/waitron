import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceDeliveries,
  invoiceSeries,
  locations,
  printAgents,
  printJobs,
  sales,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId } from "@waitron/shared";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import { claimPrintJobs, reportPrintJob } from "./runtime.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const now = "2026-12-01T00:00:00.000Z";
async function setup() {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["en-GB"], operationDescription: "Sale on premises" })
    .returning();
  const nodeId = await seedNode(suite.db, locationId(location!.id));
  const [agent] = await suite.db
    .insert(printAgents)
    .values({ locationId: location!.id, name: "Agent", tokenHash: "fixture" })
    .returning();
  return withTransaction(suite.db, async (tx) => {
    const [series] = await tx
      .insert(invoiceSeries)
      .values({ nodeId, code: "F", purpose: "full" })
      .returning();
    const [sale] = await tx
      .insert(sales)
      .values({
        source: "operator_script",
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: "2026-10-07T12:00:00.000Z",
        issuedOffsetMinutes: 0,
        total: 100,
        vatBreakdown: [],
        locale: "en-GB",
        invoiceLocales: ["en-GB"],
        fiscalBackend: "fixture",
        fiscalState: "not_applicable",
        counterpartyTaxId: "synthetic-customer",
      })
      .returning();
    const cfg = { locationId: location!.id };
    const printer = await createPrinter(tx, cfg, {
      name: "Receipt",
      transport: "network_tcp",
      host: "printer.test",
    });
    const managed = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([1]), "document", {
      saleId: sale!.id,
      receiptCopy: false,
    });
    const ordinary = await enqueuePrintJob(tx, cfg, printer.id, new Uint8Array([2]), "drawer");
    const [delivery] = await tx
      .insert(invoiceDeliveries)
      .values({
        saleId: sale!.id,
        printJobId: managed.jobId,
        requestKey: randomUUID(),
        personId: "staff",
        medium: "receipt",
        designation: "original",
        generation: 1,
        nextAttemptAt: now,
      })
      .returning();
    return {
      managed: managed.jobId,
      ordinary: ordinary.jobId,
      deliveryId: delivery!.id,
      agentId: agent!.id,
      locationId: location!.id,
    };
  });
}
describe("generic print runtime's invoice boundary", () => {
  it("leaves a correlated invoice for the token-aware adapter and reports an ordinary drawer", async () => {
    const ctx = await setup();
    await withTransaction(suite.db, async (tx) => {
      const jobs = await claimPrintJobs(tx, ctx.agentId, {
        locationId: ctx.locationId,
        visibleKeys: [],
      });
      expect(jobs.map((job) => job.id)).toEqual([ctx.ordinary]);
      expect(
        await reportPrintJob(tx, {
          agentId: ctx.agentId,
          jobId: ctx.ordinary,
          outcome: { status: "done" },
        }),
      ).toEqual({ updated: true });
      const [managed] = await tx.select().from(printJobs).where(eq(printJobs.id, ctx.managed));
      expect(managed).toMatchObject({ status: "queued", claimedBy: null });
    });
  });
  it("lets the invoice adapter claim a due correlated receipt alongside ordinary work", async () => {
    const ctx = await setup();
    await withTransaction(suite.db, async (tx) => {
      const jobs = await claimPrintJobs(tx, ctx.agentId, {
        locationId: ctx.locationId,
        visibleKeys: [],
        invoiceReceiptsAt: now,
      });
      expect(jobs.map((job) => job.id)).toEqual([ctx.managed, ctx.ordinary]);
      expect(
        await reportPrintJob(tx, {
          agentId: ctx.agentId,
          jobId: ctx.managed,
          outcome: { status: "done" },
        }),
      ).toEqual({ updated: false });
      expect(
        (await tx.select().from(printJobs).where(eq(printJobs.id, ctx.managed)))[0],
      ).toMatchObject({ status: "printing", deliveredAt: null });
    });
  });
  it.each(["sending", "sent", "failed", "unknown"] as const)(
    "does not give the adapter a %s receipt even when the generic job is queued",
    async (status) => {
      const ctx = await setup();
      await suite.db
        .update(invoiceDeliveries)
        .set({ status })
        .where(eq(invoiceDeliveries.id, ctx.deliveryId));
      const jobs = await withTransaction(suite.db, (tx) =>
        claimPrintJobs(tx, ctx.agentId, {
          locationId: ctx.locationId,
          visibleKeys: [],
          invoiceReceiptsAt: now,
        }),
      );
      expect(jobs.map((job) => job.id)).toEqual([ctx.ordinary]);
      expect(
        (await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.managed)))[0],
      ).toMatchObject({ status: "queued", claimedBy: null });
    },
  );
  it("does not consume a future invoice claim before its due time", async () => {
    const ctx = await setup();
    const jobs = await withTransaction(suite.db, (tx) =>
      claimPrintJobs(tx, ctx.agentId, {
        locationId: ctx.locationId,
        visibleKeys: [],
        invoiceReceiptsAt: "2026-11-30T23:59:59.999Z",
      }),
    );
    expect(jobs.map((job) => job.id)).toEqual([ctx.ordinary]);
    expect(
      (await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.managed)))[0],
    ).toMatchObject({ status: "queued", claimedBy: null });
  });
});
