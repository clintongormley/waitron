import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { readSettings, VENUE_SETTINGS } from "@waitron/db";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  invoiceDeliveries,
  receiptReprints,
  nodes,
  printJobs,
  printAgents,
  printers,
  isReceiptPrinter,
  receiptRollColumns,
  taxpayer,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedPerson, seedTaxpayer, seedVenue } from "@waitron/db/testing/seed.js";
import {
  createPrinter,
  enqueuePrintJob,
  claimPrintJobs,
  resendPrintJob,
  reportPrintJob,
  runAgentOnce,
  endDeletedPrinterJobs,
  endUnpairedPrinterJobs,
  MAX_DELIVERY_ATTEMPTS,
  PRINTER_DELETED,
} from "@waitron/printing";
import { hashDeviceToken, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { createClient, createAgent, FakeSink, type InvoicePrintClaim } from "@waitron/print-agent";
import { fakeHost } from "@waitron/print-agent/testing/fake-host.js";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import { jobOrigin, nodeId, seriesId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import {
  reserveInvoiceDelivery,
  expireInvoiceDeliveryClaims,
  invoiceDeliveryClaimsDue,
} from "./invoice-delivery.js";
import { clearOldPrintPayloads } from "./housekeeping.js";
import {
  claimInvoicePrintJobs,
  endInvoicePrintDeliveries,
  resendInvoicePrintJob,
} from "./invoice-print.js";
import { mountPrintApi } from "./print-api.js";
import { reprintJobOn } from "./print-job-reprint.js";
import { createPairingMode } from "./pairing-mode.js";
import { deliverDemoPrinterJobs } from "./demo-printer.js";
import { insertCorrective } from "./testing/replacement-fixture.js";
import type { LayOutSaleReceipt } from "./receipt-print.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
/** Stands in for a sale's receipt laid out again: bytes naming the sale, its marking and the roll. */
const layOut: LayOutSaleReceipt = async (_tx, saleId, duplicate, printer) =>
  new TextEncoder().encode(
    `${saleId} ${duplicate ? "copy" : "original"} ${printer.paperWidth} ${printer.resolution}`,
  );

/** What {@link layOut} gives for the sale on printer `printerId`. */
async function laidOut(saleId: string, duplicate: boolean, printerId: string) {
  const [roll] = await suite.db
    .select({ ...receiptRollColumns })
    .from(printers)
    .where(and(isReceiptPrinter(), eq(printers.id, printerId)));
  return withTransaction(suite.db, (tx) => layOut(tx, saleId, duplicate, roll!));
}
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
async function issue(full = true) {
  await seedPerson(suite.db, { id: "staff" });
  await seedTaxpayer(suite.db);
  await suite.db.update(taxpayer).set({ taxpayerDomicile: "Saved domicile" });
  const existing = await readSettings(suite.db, VENUE_SETTINGS);
  if (existing.revision === 0) {
    await seedVenue(suite.db, {
      name: "Bar",
      invoiceLocales: ["es-ES"],
    });
  }
  const nodeId = await seedNode(suite.db);
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
      operationDescription: "Sale on premises",
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

const inventory = { visible: [], scanned: [], pairedBluetooth: [], bluetoothOutcomes: [] };
const MAC = "5A:4A:45:D4:FB:BB";
async function setup(bluetooth = false) {
  const sale = await issue();
  const [node] = await suite.db.select().from(nodes);
  const secret = "synthetic-agent-secret";
  const [agent] = await suite.db
    .insert(printAgents)
    .values({ name: "Agent", tokenHash: hashDeviceToken(secret) })
    .returning();
  const [other] = await suite.db
    .insert(printAgents)
    .values({ name: "Other", tokenHash: hashDeviceToken(secret) })
    .returning();
  const printer = await withTransaction(suite.db, (tx) =>
    createPrinter(
      tx,
      bluetooth
        ? { name: "Receipt", transport: "bluetooth", localKey: MAC }
        : { name: "Receipt", transport: "network_tcp", host: "printer.test" },
    ),
  );
  const job = await withTransaction(suite.db, (tx) =>
    enqueuePrintJob(tx, printer.id, new Uint8Array([27, 64]), "document", {
      saleId: sale.saleId,
      receiptCopy: false,
    }),
  );
  const delivery = await withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, sale.saleId, {
      requestKey: randomUUID(),
      personId: "staff",
      medium: "receipt",
      printJobId: job.jobId,
    }),
  );
  let now = new Date();
  const app = new Hono();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg: {
        nodeId: nodeId(node!.id),
        locale: "es-ES",
        tipsEnabled: false,
        simplifiedInvoiceLimit: null,
      },
      pairingMode: createPairingMode(),
      readMembership: async () => null,
      readInvoiceDocument: () => Promise.reject(new Error("No invoice is read here")),
      layOutSaleReceipt: layOut,
      venueLocale: "es-ES",
      now: () => now,
    },
    () => {},
  );
  const token = `${agent!.id}.${secret}`;
  const fetchImpl: typeof fetch = async (input, init) =>
    app.request(
      typeof input === "string" ? input : input instanceof URL ? input.href : input,
      init,
    );
  const client = createClient({ fetch: fetchImpl });
  const pull = async () => {
    const res = await client.pullJobs("http://box.test", token, inventory);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("Pull refused");
    return res.value.jobs;
  };
  const result = async (body: unknown, jobId = job.jobId, bearer = token) => {
    const response = await app.request(`/print-api/agent/jobs/${jobId}/result`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response;
  };
  const row = async () =>
    (
      await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, delivery.id))
    )[0]!;
  const jobRow = async () =>
    (await suite.db.select().from(printJobs).where(eq(printJobs.id, job.jobId)))[0]!;
  return {
    sale,
    printer,
    job,
    delivery,
    agentId: agent!.id,
    otherId: other!.id,
    otherToken: `${other!.id}.${secret}`,
    token,
    client,
    app,
    fetchImpl,
    pull,
    result,
    row,
    jobRow,
    now: () => now,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
async function held(ctx: Awaited<ReturnType<typeof setup>>) {
  const [job] = await withTransaction(suite.db, (tx) =>
    claimInvoicePrintJobs(tx, ctx.agentId, { visibleKeys: [] }, ctx.now()),
  );
  return job!.invoiceClaim!;
}
describe("invoice receipt API attempt boundary", () => {
  it("round-trips a fresh claim through the real client and commits completion", async () => {
    const ctx = await setup();
    const jobs = await ctx.pull();
    expect(jobs).toHaveLength(1);
    const invoiceClaim = jobs[0]!.invoiceClaim!;
    expect(await ctx.jobRow()).toMatchObject({
      claimedBy: ctx.agentId,
      claimTokenHash: createHash("sha256").update(invoiceClaim.token).digest("hex"),
      claimedAt: ctx.now().toISOString(),
      attempts: 0,
    });
    expect(await ctx.row()).toMatchObject({ status: "sending" });
    expect(invoiceClaim).toEqual({ token: expect.any(String) });
    expect(
      await ctx.client.report("http://box.test", ctx.token, ctx.job.jobId, {
        status: "done",
        invoiceClaim,
      }),
    ).toEqual({ ok: true, value: undefined });
    expect(await ctx.row()).toMatchObject({ status: "sent", reportedOutcome: "sent" });
    expect(await ctx.jobRow()).toMatchObject({ status: "done" });
  });
  it("keeps a future invoice receipt queued and leaves ordinary jobs available", async () => {
    const ctx = await setup();
    await suite.db
      .update(printJobs)
      .set({ createdAt: new Date(ctx.now().getTime() + 60000).toISOString() })
      .where(eq(printJobs.id, ctx.job.jobId));
    const ordinary = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(tx, ctx.printer.id, new Uint8Array([1]), "drawer"),
    );
    expect((await ctx.pull()).map((j) => j.id)).toEqual([ordinary.jobId]);
    expect(await ctx.jobRow()).toMatchObject({ status: "queued", claimedBy: null });
  });
  it("expires a lost claim before pull without silently replaying its receipt", async () => {
    const ctx = await setup();
    await held(ctx);
    ctx.advance(60000);
    expect(await ctx.pull()).toHaveLength(0);
    expect(await ctx.row()).toMatchObject({ status: "unknown", failureCode: "timeout" });
    expect(await ctx.jobRow()).toMatchObject({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS });
  });
  it.each([-60_000, 400 * 86_400_000])(
    "detects and expires a receipt with a job claim %s ms from now",
    async (offset) => {
      const ctx = await setup();
      expect(await ctx.pull()).toHaveLength(1);
      expect(await invoiceDeliveryClaimsDue(suite.db, ctx.now())).toBe(false);
      await suite.db
        .update(printJobs)
        .set({ claimedAt: new Date(ctx.now().getTime() + offset).toISOString() })
        .where(eq(printJobs.id, ctx.job.jobId));
      expect(await invoiceDeliveryClaimsDue(suite.db, ctx.now())).toBe(true);
      expect((await ctx.row()).status).toBe("sending");
      expect(await ctx.pull()).toHaveLength(0);
      expect(await ctx.row()).toMatchObject({ status: "unknown", failureCode: "timeout" });
      expect(await ctx.jobRow()).toMatchObject({
        status: "failed",
        attempts: MAX_DELIVERY_ATTEMPTS,
      });
      expect(await invoiceDeliveryClaimsDue(suite.db, ctx.now())).toBe(false);
    },
  );
  it("records a sanitised current printer failure instead of transport text", async () => {
    const ctx = await setup();
    const invoiceClaim = await held(ctx);
    expect(
      (
        await ctx.result({
          status: "failed",
          error: "customer@example.test password=secret",
          invoiceClaim,
        })
      ).status,
    ).toBe(204);
    expect(await ctx.row()).toMatchObject({
      status: "failed",
      failureCode: "transport_failed",
      reportedOutcome: "failed",
    });
    expect(await ctx.jobRow()).toMatchObject({
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS,
      lastError: "transport_failed",
    });
  });
  it("blocks a generic result from completing a correlated receipt", async () => {
    const ctx = await setup();
    await held(ctx);
    expect((await ctx.result({ status: "done" })).status).toBe(204);
    expect(await ctx.jobRow()).toMatchObject({ status: "printing" });
    expect(await ctx.row()).toMatchObject({ status: "sending", reportedOutcome: null });
  });
  it("blocks the direct generic reporter from completing a correlated receipt", async () => {
    const ctx = await setup();
    await held(ctx);
    expect(
      await withTransaction(suite.db, (tx) =>
        reportPrintJob(tx, {
          agentId: ctx.agentId,
          jobId: ctx.job.jobId,
          outcome: { status: "done" },
        }),
      ),
    ).toEqual({ updated: false });
    expect(await ctx.jobRow()).toMatchObject({ status: "printing" });
  });
  it("leaves correlated invoices outside the local generic runtime", async () => {
    const ctx = await setup();
    const sink = new FakeSink();
    expect(
      await withTransaction(suite.db, (tx) =>
        runAgentOnce({
          tx,
          agentId: ctx.agentId,
          visibleKeys: [],
          transport: sink,
        }),
      ),
    ).toEqual({ claimed: 0, delivered: 0, failed: 0 });
    expect(sink.written).toHaveLength(0);
    expect(await ctx.jobRow()).toMatchObject({ status: "queued" });
  });
  it("the demo printer completes a correlated receipt through the same boundary", async () => {
    const ctx = await setup();
    expect(
      await deliverDemoPrinterJobs(suite.db, {
        agentId: ctx.agentId,
        printerId: ctx.printer.id,
      }),
    ).toBe(1);
    expect(await ctx.row()).toMatchObject({ status: "sent" });
    expect(await ctx.jobRow()).toMatchObject({ status: "done", claimedBy: ctx.agentId });
  });
  it.each([
    null,
    [],
    1,
    {},
    { token: "bad" },
    { token: null },
    { deliveryId: randomUUID(), generation: 1, token: randomUUID() },
  ])("refuses a malformed invoice claim without changing delivery (%j)", async (invoiceClaim) => {
    const ctx = await setup();
    await held(ctx);
    const response = await ctx.result({ status: "done", invoiceClaim });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "invoiceClaim" } },
    });
    expect(await ctx.row()).toMatchObject({ status: "sending", reportedOutcome: null });
    expect(await ctx.jobRow()).toMatchObject({ status: "printing" });
  });
  it.each(["token", "agent", "job"] as const)(
    "ignores another attempt's %s and accepts the authenticated current result",
    async (wrong) => {
      const ctx = await setup();
      const original = await held(ctx);
      const claim = { ...original };
      if (wrong === "token") claim.token = randomUUID();
      const other = await withTransaction(suite.db, (tx) =>
        enqueuePrintJob(tx, ctx.printer.id, new Uint8Array([2])),
      );
      await withTransaction(suite.db, (tx) => claimPrintJobs(tx, ctx.agentId, { visibleKeys: [] }));
      expect(
        (
          await ctx.result(
            { status: "done", invoiceClaim: claim },
            wrong === "job" ? other.jobId : ctx.job.jobId,
            wrong === "agent" ? ctx.otherToken : ctx.token,
          )
        ).status,
      ).toBe(204);
      expect(await ctx.row()).toMatchObject({ status: "sending", reportedOutcome: null });
      expect(await ctx.jobRow()).toMatchObject({ status: "printing" });
      expect(
        (await suite.db.select().from(printJobs).where(eq(printJobs.id, other.jobId)))[0]!.status,
      ).toBe("printing");
      expect((await ctx.result({ status: "done", invoiceClaim: original })).status).toBe(204);
      expect(await ctx.row()).toMatchObject({ status: "sent" });
    },
  );
  it.each(["done", "failed"] as const)(
    "a latest expired %s report updates only the matching original",
    async (status) => {
      const ctx = await setup();
      const invoiceClaim = await held(ctx);
      ctx.advance(60000);
      expect((await ctx.result({ status, error: "unsafe", invoiceClaim })).status).toBe(204);
      expect(await ctx.row()).toMatchObject({
        status: status === "done" ? "sent" : "unknown",
        reportedOutcome: status === "done" ? "sent" : "failed",
        expiredAt: ctx.now().toISOString(),
      });
      expect(await ctx.jobRow()).toMatchObject({ status: status === "done" ? "done" : "failed" });
    },
  );
  it.each([
    ["queued", "done"],
    ["sending", "done"],
    ["failed", "done"],
    ["sent", "done"],
    ["queued", "failed"],
    ["sending", "failed"],
    ["failed", "failed"],
    ["sent", "failed"],
  ] as const)(
    "an old same-agent result leaves the %s retry and both receipt jobs unchanged (%s)",
    async (stage, oldStatus) => {
      const ctx = await setup();
      const old = await held(ctx);
      ctx.advance(60000);
      await withTransaction(suite.db, (tx) => expireInvoiceDeliveryClaims(tx, ctx.now()));
      const retryJob = await withTransaction(suite.db, (tx) => resendPrintJob(tx, ctx.job.jobId));
      const retry = await withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, ctx.sale.saleId, {
          requestKey: randomUUID(),
          personId: "staff",
          medium: "receipt",
          printJobId: retryJob.jobId,
        }),
      );
      let retryClaim: InvoicePrintClaim | undefined;
      if (stage !== "queued") {
        const jobs = await ctx.pull();
        expect(jobs).toHaveLength(1);
        expect(jobs[0]!.id).toBe(retryJob.jobId);
        retryClaim = jobs[0]!.invoiceClaim;
        expect(retryClaim).toEqual({ token: expect.any(String) });
        if (stage === "failed" || stage === "sent")
          expect(
            (
              await ctx.result(
                {
                  status: stage === "sent" ? "done" : "failed",
                  error: "unsafe",
                  invoiceClaim: retryClaim,
                },
                retryJob.jobId,
              )
            ).status,
          ).toBe(204);
      }
      const before = await suite.db.select().from(printJobs);
      const retryBefore = (
        await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, retry.id))
      )[0]!;
      expect(
        (await ctx.result({ status: oldStatus, error: "unsafe", invoiceClaim: old })).status,
      ).toBe(204);
      expect(await suite.db.select().from(printJobs)).toEqual(before);
      expect(
        (
          await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, retry.id))
        )[0],
      ).toEqual(retryBefore);
      expect(await ctx.row()).toMatchObject({
        status: "unknown",
        reportedOutcome: oldStatus === "done" ? "sent" : "failed",
      });
      expect(retryBefore).toMatchObject({ status: stage, designation: "original", generation: 2 });
    },
  );
  it.each([false, true])(
    "the real agent returns the pulled attempt identity on a transport failure=%s",
    async (fails) => {
      const ctx = await setup();
      ctx.app.get("/api/node", (c) =>
        c.json({ nodeId: "box", term: 1, acceptingSales: true, environment: "preproduction" }),
      );
      const sink = new FakeSink();
      const host = fakeHost({
        config: { serverUrl: "http://box.test", name: "Agent" },
        token: ctx.token,
        fetch: ctx.fetchImpl,
        transport: fails
          ? {
              send: async () => {
                throw new Error("private customer transport detail");
              },
            }
          : sink,
      });
      await createAgent({ host }).runOnce();
      expect(await ctx.row()).toMatchObject({
        status: fails ? "failed" : "sent",
        reportedOutcome: fails ? "failed" : "sent",
      });
      if (!fails)
        expect(sink.written).toEqual([
          { printerId: ctx.printer.id, bytes: new Uint8Array([27, 64]) },
        ]);
      else
        expect(JSON.stringify(host.logs) + JSON.stringify(host.statuses)).not.toContain(
          "private customer transport detail",
        );
    },
  );
  it("never puts raw invoice-printer transport text in agent status or logs", async () => {
    const ctx = await setup();
    ctx.app.get("/api/node", (c) =>
      c.json({ nodeId: "box", term: 1, acceptingSales: true, environment: "preproduction" }),
    );
    const host = fakeHost({
      config: { serverUrl: "http://box.test", name: "Agent" },
      token: ctx.token,
      fetch: ctx.fetchImpl,
      transport: {
        send: async () => {
          throw new Error("private customer transport detail");
        },
      },
    });
    await createAgent({ host }).runOnce();
    expect(JSON.stringify(host.logs) + JSON.stringify(host.statuses)).not.toContain(
      "private customer transport detail",
    );
  });
  it("reports an ordinary drawer without an invoice token and does not retry it", async () => {
    const ctx = await setup();
    const ordinary = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(tx, ctx.printer.id, new Uint8Array([1]), "drawer"),
    );
    const first = await ctx.pull();
    expect(first.map((job) => job.id)).toEqual([ctx.job.jobId]);
    const second = await ctx.pull();
    expect(second.map((job) => job.id)).toEqual([ordinary.jobId]);
    const jobs = [...first, ...second];
    expect(jobs.map((job) => job.id)).toEqual([ctx.job.jobId, ordinary.jobId]);
    expect(jobs.find((job) => job.id === ordinary.jobId)).not.toHaveProperty("invoiceClaim");
    expect(
      (await ctx.result({ status: "failed", error: "ordinary connection detail" }, ordinary.jobId))
        .status,
    ).toBe(204);
    expect(
      (await suite.db.select().from(printJobs).where(eq(printJobs.id, ordinary.jobId)))[0],
    ).toMatchObject({ status: "failed", attempts: 1, lastError: "ordinary connection detail" });
    const retried = await ctx.pull();
    expect(retried.map((job) => job.id)).toEqual([]);
    expect((await ctx.result({ status: "done" }, ordinary.jobId)).status).toBe(204);
    expect(
      (await suite.db.select().from(printJobs).where(eq(printJobs.id, ordinary.jobId)))[0],
    ).toMatchObject({ status: "failed", attempts: 1, lastError: "ordinary connection detail" });
    expect(await ctx.row()).toMatchObject({ status: "sending", reportedOutcome: null });
  });
  it("retries and completes an ordinary document without an invoice token", async () => {
    const ctx = await setup();
    const ordinary = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(tx, ctx.printer.id, new Uint8Array([3]), "document"),
    );
    expect((await ctx.pull()).map((job) => job.id)).toEqual([ctx.job.jobId]);
    const pulled = await ctx.pull();
    expect(pulled.map((job) => job.id)).toEqual([ordinary.jobId]);
    expect(pulled[0]).not.toHaveProperty("invoiceClaim");
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    expect(
      (await ctx.result({ status: "failed", error: "printer offline" }, ordinary.jobId)).status,
    ).toBe(204);
    expect(
      (await suite.db.select().from(printJobs).where(eq(printJobs.id, ordinary.jobId)))[0],
    ).toMatchObject({ status: "failed", attempts: 1, lastError: "printer offline" });
    vi.setSystemTime(Date.now() + 5_000);
    const retry = await ctx.pull();
    expect(retry.map((job) => job.id)).toEqual([ordinary.jobId]);
    expect(retry[0]).not.toHaveProperty("invoiceClaim");
    expect((await ctx.result({ status: "done" }, ordinary.jobId)).status).toBe(204);
    expect(
      (await suite.db.select().from(printJobs).where(eq(printJobs.id, ordinary.jobId)))[0],
    ).toMatchObject({ status: "done", attempts: 1, deliveredAt: expect.any(String) });
    expect(await ctx.row()).toMatchObject({ status: "sending", reportedOutcome: null });
  });

  it("rolls back the print claim if its invoice token cannot be attached", async () => {
    const ctx = await setup();
    await suite.db.execute(
      sql`create trigger test_refuse_invoice_claim after update of status on print_jobs when NEW.status = 'printing' begin update print_jobs set claimed_by = null where id = NEW.id; end`,
    );
    const failed = await ctx.app.request("/print-api/agent/jobs", {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.token}`, "content-type": "application/json" },
      body: JSON.stringify(inventory),
    });
    expect(failed.status).toBe(400);
    expect(await failed.json()).toMatchObject({
      error: { code: "invoice_delivery.receipt_invalid" },
    });
    expect(await ctx.jobRow()).toMatchObject({
      status: "queued",
      claimedBy: null,
      claimedAt: null,
      claimTokenHash: null,
    });
    expect(await ctx.row()).toMatchObject({ status: "queued" });
    await suite.db.execute(sql`drop trigger test_refuse_invoice_claim`);
    expect(await ctx.pull()).toHaveLength(1);
    expect(await ctx.jobRow()).toMatchObject({
      status: "printing",
      claimedBy: ctx.agentId,
      claimTokenHash: expect.any(String),
    });
    expect(await ctx.row()).toMatchObject({ status: "sending" });
  });
  it("a repeated invoice result does not rewrite the completion time", async () => {
    const ctx = await setup();
    const invoiceClaim = await held(ctx);
    expect((await ctx.result({ status: "done", invoiceClaim })).status).toBe(204);
    const delivery = await ctx.row(),
      job = await ctx.jobRow();
    ctx.advance(30000);
    expect((await ctx.result({ status: "failed", error: "unsafe", invoiceClaim })).status).toBe(
      204,
    );
    expect(await ctx.row()).toEqual(delivery);
    expect(await ctx.jobRow()).toEqual(job);
  });
});

async function manager(ctx: Awaited<ReturnType<typeof setup>>) {
  const session = await withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Printer manager",
      pinHash: fixturePinHash("1234"),
      role: "manager",
    });
    return startManagementSession(tx, { method: "password", personId: person!.id });
  });
  return async (path: string, body: unknown, method = "POST") =>
    ctx.app.request(path, {
      method,
      headers: {
        cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
}

describe("management invoice receipt resends", () => {
  it("resends a replacement of a full invoice plainly, opening no delivery", async () => {
    const ctx = await setup();
    const replacement = await withTransaction(suite.db, (tx) =>
      insertCorrective(tx, ctx.sale.saleId, { replaces: true }),
    );
    const original = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(tx, ctx.printer.id, new Uint8Array([27, 64]), "document", {
        saleId: replacement,
        receiptCopy: false,
      }),
    );
    await suite.db
      .update(printJobs)
      .set({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS })
      .where(eq(printJobs.id, original.jobId));
    const { jobId } = await withTransaction(suite.db, (tx) =>
      resendInvoicePrintJob(tx, layOut, original.jobId, "staff", ctx.now()),
    );
    expect(jobId).not.toBe(original.jobId);
    expect(
      await suite.db
        .select()
        .from(invoiceDeliveries)
        .where(eq(invoiceDeliveries.saleId, replacement)),
    ).toEqual([]);
  });

  it("retains pending invoice bytes while releasing an audited finished copy", async () => {
    const ctx = await setup();
    const copy = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(tx, ctx.printer.id, new Uint8Array([27, 64]), "document", {
        saleId: ctx.sale.saleId,
        receiptCopy: true,
      }),
    );
    await suite.db
      .insert(receiptReprints)
      .values({ saleId: ctx.sale.saleId, printJobId: copy.jobId, personId: "staff" });
    await suite.db
      .update(printJobs)
      .set({ status: "done", createdAt: "2026-10-01T00:00:00.000Z" })
      .where(inArray(printJobs.id, [ctx.job.jobId, copy.jobId]));
    const audit = await suite.db.select().from(receiptReprints);
    for (const [status, changed] of [
      ["queued", 1],
      ["sending", 0],
      ["unknown", 0],
    ] as const) {
      await suite.db
        .update(invoiceDeliveries)
        .set({ status })
        .where(eq(invoiceDeliveries.id, ctx.delivery.id));
      const delivery = await ctx.row();
      expect(
        await clearOldPrintPayloads(
          suite.db,
          new Date("2026-11-14T04:00:00.000Z"),
          new AbortController().signal,
        ),
      ).toBe(changed);
      expect((await ctx.jobRow()).payload!.byteLength).toBe(2);
      expect(await ctx.row()).toEqual(delivery);
    }
    await suite.db
      .update(invoiceDeliveries)
      .set({ status: "failed" })
      .where(eq(invoiceDeliveries.id, ctx.delivery.id));
    expect(
      await clearOldPrintPayloads(
        suite.db,
        new Date("2026-11-14T04:00:00.000Z"),
        new AbortController().signal,
      ),
    ).toBe(1);
    expect(await suite.db.select().from(receiptReprints)).toEqual(audit);
    expect(await suite.db.select().from(printJobs)).toHaveLength(2);
  });

  it("refuses expired bytes before a supplied replacement can add a job or delivery", async () => {
    const ctx = await setup();
    await suite.db
      .update(printJobs)
      .set({
        payload: new Uint8Array(0),
        status: "failed",
        attempts: 5,
      })
      .where(eq(printJobs.id, ctx.job.jobId));
    const beforeJobs = await suite.db.select().from(printJobs);
    const beforeDeliveries = await suite.db.select().from(invoiceDeliveries);
    await expect(
      withTransaction(suite.db, (tx) =>
        resendInvoicePrintJob(tx, layOut, ctx.job.jobId, "staff", ctx.now(), undefined, {
          printerId: ctx.printer.id,
          payload: new Uint8Array([27, 64]),
        }),
      ),
    ).rejects.toMatchObject({ code: "print_job.sale_payload_expired" });
    expect(await suite.db.select().from(printJobs)).toEqual(beforeJobs);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual(beforeDeliveries);
  });

  it("enrolls an exhausted receipt predating delivery tracking", async () => {
    const ctx = await setup();
    await suite.db.delete(invoiceDeliveries).where(eq(invoiceDeliveries.id, ctx.delivery.id));
    await suite.db
      .update(printJobs)
      .set({ status: "failed", attempts: 5 })
      .where(eq(printJobs.id, ctx.job.jobId));
    const command = await manager(ctx);
    const response = await command(`/management-api/print-jobs/${ctx.job.jobId}/resend`, {});
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    const [delivery] = await suite.db.select().from(invoiceDeliveries);
    expect(delivery).toMatchObject({ printJobId: jobId, designation: "original", generation: 1 });
    const again = await command(`/management-api/print-jobs/${ctx.job.jobId}/resend`, {});
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "print_job.not_resendable" } });
    expect(await suite.db.select().from(printJobs)).toHaveLength(2);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([delivery]);
  });

  it("resends a marked copy laid out again after the original completes", async () => {
    const ctx = await setup();
    const original = await held(ctx);
    await ctx.result({ status: "done", invoiceClaim: original });
    const copy = await withTransaction(suite.db, async (tx) => {
      const job = await enqueuePrintJob(
        tx,
        ctx.printer.id,
        new Uint8Array([68, 85, 80]),
        "document",
        { saleId: ctx.sale.saleId, receiptCopy: true },
      );
      await tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, job.jobId));
      return job;
    });
    const command = await manager(ctx);
    const response = await command(`/management-api/print-jobs/${copy.jobId}/resend`, {});
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    const [delivery] = await suite.db
      .select()
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.printJobId, jobId));
    expect(delivery).toMatchObject({ designation: "duplicate", generation: 2, status: "queued" });
    const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    expect(job).toMatchObject({
      receiptCopy: true,
      resendOf: copy.jobId,
      payload: await laidOut(ctx.sale.saleId, true, ctx.printer.id),
    });
  });

  it("rolls back a receipt resend when its metadata insert is refused", async () => {
    const ctx = await setup();
    const claim = await held(ctx);
    await ctx.result({ status: "failed", error: "unsafe", invoiceClaim: claim });
    await suite.db.execute(
      sql`create trigger refuse_retry_metadata before insert on invoice_deliveries begin select raise(abort, 'synthetic refusal'); end`,
    );
    try {
      const jobs = await suite.db.select().from(printJobs);
      const command = await manager(ctx);
      const response = await command(`/management-api/print-jobs/${ctx.job.jobId}/resend`, {});
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: "server.internal" } });
      expect(await suite.db.select().from(printJobs)).toEqual(jobs);
      expect(await suite.db.select().from(invoiceDeliveries)).toHaveLength(1);
    } finally {
      await suite.db.execute(sql`drop trigger refuse_retry_metadata`);
    }
  });

  it.each(["failed", "unknown"] as const)(
    "enrolls a %s original retry laid out again with a new authenticated claim",
    async (status) => {
      const ctx = await setup();
      const originalClaim = await held(ctx);
      if (status === "failed")
        await ctx.result({ status: "failed", error: "unsafe", invoiceClaim: originalClaim });
      else ctx.advance(60000);
      const command = await manager(ctx);
      const response = await command(`/management-api/print-jobs/${ctx.job.jobId}/resend`, {});
      expect(response.status).toBe(202);
      const { jobId } = (await response.json()) as { jobId: string };
      const [retry] = await suite.db
        .select()
        .from(invoiceDeliveries)
        .where(eq(invoiceDeliveries.printJobId, jobId));
      const [staff] = await suite.db
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.displayName, "Printer manager"));
      expect(retry).toMatchObject({
        saleId: ctx.sale.saleId,
        medium: "receipt",
        designation: "original",
        status: "queued",
        generation: 2,
        personId: staff!.id,
      });
      const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
      expect(job).toMatchObject({
        printerId: ctx.printer.id,
        payload: await laidOut(ctx.sale.saleId, false, ctx.printer.id),
        saleId: ctx.sale.saleId,
        receiptCopy: false,
        resendOf: ctx.job.jobId,
        kind: "document",
      });
      ctx.advance(1000);
      const pulled = await ctx.pull();
      expect(pulled).toHaveLength(1);
      expect(pulled[0]!.id).toBe(jobId);
      const retryClaim = pulled[0]!.invoiceClaim!;
      expect(retryClaim).toEqual({ token: expect.any(String) });
      expect(retryClaim.token).not.toBe(originalClaim.token);
      const before = (
        await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, retry!.id))
      )[0];
      expect(
        (await ctx.result({ status: "done", invoiceClaim: originalClaim }, jobId)).status,
      ).toBe(204);
      await ctx.result({ status: "done", invoiceClaim: originalClaim });
      expect(
        (
          await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, retry!.id))
        )[0],
      ).toEqual(before);
      expect((await ctx.result({ status: "done", invoiceClaim: retryClaim }, jobId)).status).toBe(
        204,
      );
      expect(
        (
          await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, retry!.id))
        )[0],
      ).toMatchObject({ status: "sent" });
    },
  );

  it("reserves a full invoice's delivery for its receipt laid out on another printer", async () => {
    const ctx = await setup();
    await ctx.result({ status: "failed", error: "unsafe", invoiceClaim: await held(ctx) });
    const other = await withTransaction(suite.db, (tx) =>
      createPrinter(tx, { name: "Bar", transport: "network_tcp", host: "bar.test" }),
    );
    const payload = new Uint8Array([27, 64, 66]);
    const { jobId } = await withTransaction(suite.db, (tx) =>
      resendInvoicePrintJob(tx, layOut, ctx.job.jobId, "staff", ctx.now(), undefined, {
        printerId: other.id,
        payload,
      }),
    );
    const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    expect(job).toMatchObject({
      printerId: other.id,
      payload,
      saleId: ctx.sale.saleId,
      receiptCopy: false,
      resendOf: ctx.job.jobId,
    });
    const [delivery] = await suite.db
      .select()
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.printJobId, jobId));
    expect(delivery).toMatchObject({
      saleId: ctx.sale.saleId,
      medium: "receipt",
      designation: "original",
      status: "queued",
      generation: 2,
    });
  });

  it("moves a queued full invoice off an unseen Bluetooth printer only while it is unseen, its delivery with it", async () => {
    const ctx = await setup(true);
    const other = await withTransaction(suite.db, (tx) =>
      createPrinter(tx, { name: "Bar", transport: "network_tcp", host: "bar.test" }),
    );
    const move = (ownPrinterUnseen: boolean) =>
      withTransaction(suite.db, (tx) =>
        reprintJobOn(
          tx,
          async () => new Uint8Array([27, 64, 66]),
          ctx.job.jobId,
          other.id,
          "staff",
          ctx.now(),
          { seen: () => !ownPrinterUnseen },
        ),
      );
    const jobs = await suite.db.select().from(printJobs);
    const deliveries = await suite.db.select().from(invoiceDeliveries);
    await expect(move(false)).rejects.toMatchObject({ code: "print_job.not_resendable" });
    expect(await suite.db.select().from(printJobs)).toEqual(jobs);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual(deliveries);

    const { jobId } = await move(true);
    expect(await ctx.row()).toMatchObject({ status: "failed" });
    const [delivery] = await suite.db
      .select()
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.printJobId, jobId));
    expect(delivery).toMatchObject({ saleId: ctx.sale.saleId, status: "queued" });
  });

  it("reprints a completed thermal invoice as an audited duplicate and keeps its history", async () => {
    const ctx = await setup();
    const invoiceClaim = await held(ctx);
    await ctx.result({ status: "done", invoiceClaim });
    const [original] = await suite.db
      .select()
      .from(printJobs)
      .where(eq(printJobs.id, ctx.job.jobId));
    const [history] = await suite.db
      .select()
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.id, ctx.delivery.id));
    const command = await manager(ctx);

    const response = await command(`/management-api/print-jobs/${ctx.job.jobId}/resend`, {});
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    const [copy] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    expect(copy).toMatchObject({
      printerId: ctx.printer.id,
      kind: "document",
      receiptCopy: true,
      payload: await laidOut(ctx.sale.saleId, true, ctx.printer.id),
    });
    const [delivery] = await suite.db
      .select()
      .from(invoiceDeliveries)
      .where(eq(invoiceDeliveries.printJobId, jobId));
    expect(delivery).toMatchObject({ designation: "duplicate", generation: 2, status: "queued" });
    const [audit] = await suite.db
      .select()
      .from(receiptReprints)
      .where(eq(receiptReprints.printJobId, jobId));
    expect(audit).toMatchObject({ saleId: ctx.sale.saleId, personId: delivery!.personId });
    expect(await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.job.jobId))).toEqual([
      original,
    ]);
    expect(
      await suite.db
        .select()
        .from(invoiceDeliveries)
        .where(eq(invoiceDeliveries.id, ctx.delivery.id)),
    ).toEqual([history]);
  });

  it("rolls back a resend while another medium holds the invoice", async () => {
    const ctx = await setup();
    const invoiceClaim = await held(ctx);
    await ctx.result({ status: "failed", error: "unsafe", invoiceClaim });
    await emailRetry(ctx);
    const jobs = await suite.db.select().from(printJobs);
    const deliveries = await suite.db.select().from(invoiceDeliveries);
    const command = await manager(ctx);
    const response = await command(`/management-api/print-jobs/${ctx.job.jobId}/resend`, {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "print_job.not_resendable" } });
    expect(await suite.db.select().from(printJobs)).toEqual(jobs);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual(deliveries);
  });
});
async function bluetoothPull(
  ctx: Awaited<ReturnType<typeof setup>>,
  extra: Record<string, unknown> = {},
) {
  const response = await ctx.app.request("/print-api/agent/jobs", {
    method: "POST",
    headers: { authorization: `Bearer ${ctx.token}`, "content-type": "application/json" },
    body: JSON.stringify({ pairedBluetooth: [{ localKey: MAC }], ...extra }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { jobs: { id: string; invoiceClaim?: InvoicePrintClaim }[] };
}
async function forget(
  ctx: Awaited<ReturnType<typeof setup>>,
  command: Awaited<ReturnType<typeof manager>>,
) {
  const response = await command(`/management-api/print-agents/${ctx.agentId}/bluetooth/forget`, {
    address: MAC,
  });
  expect(response.status).toBe(202);
  const { command: queued } = (await response.json()) as { command: { id: string } };
  return bluetoothPull(ctx, {
    bluetoothOutcomes: [{ id: queued.id, ok: true }],
    pairedBluetooth: [],
  });
}
async function emailRetry(ctx: Awaited<ReturnType<typeof setup>>) {
  return withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, ctx.sale.saleId, {
      medium: "email",
      requestKey: randomUUID(),
      personId: "staff",
      recipient: "customer@example.test",
    }),
  );
}

describe("invoice receipt terminal Bluetooth endings", () => {
  it("leaves an invoice available when another agent can still print the Bluetooth device", async () => {
    const ctx = await setup(true);
    const response = await ctx.app.request("/print-api/agent/jobs", {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.otherToken}`, "content-type": "application/json" },
      body: JSON.stringify({ visible: [{ transport: "bluetooth", localKey: MAC }] }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { jobs: unknown[] }).jobs).toHaveLength(1);
    expect((await bluetoothPull(ctx)).jobs).toEqual([]);
    expect(await ctx.row()).toMatchObject({
      status: "sending",
      failureCode: null,
      expiredAt: null,
    });
    expect(await ctx.jobRow()).toMatchObject({ status: "printing", lastError: null });
  });

  it("accepts authenticated late success after unpairing before a retry and makes the next delivery a duplicate", async () => {
    const ctx = await setup(true);
    const command = await manager(ctx);
    const pulled = await bluetoothPull(ctx, {
      visible: [{ transport: "bluetooth", localKey: MAC }],
    });
    const claim = pulled.jobs[0]!.invoiceClaim!;
    await forget(ctx, command);
    expect(await ctx.row()).toMatchObject({ status: "unknown" });
    expect(
      (await ctx.result({ status: "done", invoiceClaim: { ...claim, token: randomUUID() } }))
        .status,
    ).toBe(204);
    expect(await ctx.row()).toMatchObject({ status: "unknown", reportedAt: null });
    expect((await ctx.result({ status: "done", invoiceClaim: claim })).status).toBe(204);
    expect(await ctx.row()).toMatchObject({
      status: "sent",
      reportedOutcome: "sent",
      completedAt: ctx.now().toISOString(),
      failureCode: null,
    });
    expect(await ctx.jobRow()).toMatchObject({ status: "done", lastError: null });
    expect(await emailRetry(ctx)).toMatchObject({ designation: "duplicate" });
  });

  it("keeps a completed invoice unchanged when the printer is later unpaired", async () => {
    const ctx = await setup(true);
    const command = await manager(ctx);
    const pulled = await bluetoothPull(ctx, {
      visible: [{ transport: "bluetooth", localKey: MAC }],
    });
    expect(
      (await ctx.result({ status: "done", invoiceClaim: pulled.jobs[0]!.invoiceClaim })).status,
    ).toBe(204);
    const completed = await ctx.row();
    await forget(ctx, command);
    expect(await ctx.row()).toEqual(completed);
    expect(await ctx.jobRow()).toMatchObject({ status: "done" });
    expect(await emailRetry(ctx)).toMatchObject({ designation: "duplicate" });
  });

  it("releases an invoice after a Bluetooth send fails and leaves it ended after recovery", async () => {
    const ctx = await setup(true);
    const otherSale = await issue();
    const unrelated = await withTransaction(suite.db, async (tx) => {
      const usb = await createPrinter(tx, {
        name: "Other invoice printer",
        transport: "usb",
        localKey: "other-usb",
      });
      const job = await enqueuePrintJob(tx, usb.id, new Uint8Array([27, 64]), "document", {
        saleId: otherSale.saleId,
        receiptCopy: false,
      });
      return reserveInvoiceDelivery(tx, otherSale.saleId, {
        requestKey: randomUUID(),
        personId: "staff",
        medium: "receipt",
        printJobId: job.jobId,
      });
    });
    const pulled = await bluetoothPull(ctx, {
      visible: [{ transport: "bluetooth", localKey: MAC }],
    });
    expect(pulled.jobs).toHaveLength(1);
    const acceptedClaim = (await ctx.jobRow()).claimTokenHash;
    expect(acceptedClaim).not.toBeNull();
    expect(
      (
        await ctx.result({
          status: "failed",
          error: "Bluetooth send failed",
          invoiceClaim: pulled.jobs[0]!.invoiceClaim,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await suite.db
          .select()
          .from(invoiceDeliveries)
          .where(eq(invoiceDeliveries.id, unrelated.id))
      )[0],
    ).toEqual(unrelated);
    expect(await ctx.jobRow()).toMatchObject({
      status: "failed",
      lastError: "transport_failed",
      attempts: MAX_DELIVERY_ATTEMPTS,
      claimTokenHash: acceptedClaim,
    });
    expect(await ctx.row()).toMatchObject({
      status: "failed",
      failureCode: "transport_failed",
      completedAt: null,
    });
    const retry = await emailRetry(ctx);
    expect(retry).toMatchObject({ status: "queued", designation: "original", generation: 2 });
    expect(
      (
        await bluetoothPull(ctx, {
          visible: [{ transport: "bluetooth", localKey: MAC }],
        })
      ).jobs,
    ).toEqual([]);
    expect(await ctx.row()).toMatchObject({ status: "failed" });
  });

  it("releases a queued invoice after confirmed unpairing and does not print it on reactivation", async () => {
    const ctx = await setup(true);
    const command = await manager(ctx);
    expect((await bluetoothPull(ctx)).jobs).toEqual([]);
    expect((await forget(ctx, command)).jobs).toEqual([]);
    expect(await ctx.jobRow()).toMatchObject({
      status: "failed",
      lastError: "printer.unpaired",
      attempts: MAX_DELIVERY_ATTEMPTS,
    });
    expect(await ctx.row()).toMatchObject({
      status: "failed",
      failureCode: "transport_failed",
      expiredAt: null,
    });
    expect(
      (
        await command("/management-api/printers", {
          name: "Receipt",
          transport: "bluetooth",
          localKey: MAC,
        })
      ).status,
    ).toBe(201);
    expect(
      (await suite.db.select().from(printers).where(eq(printers.id, ctx.printer.id)))[0],
    ).toMatchObject({ active: true });
    expect(
      (await bluetoothPull(ctx, { visible: [{ transport: "bluetooth", localKey: MAC }] })).jobs,
    ).toEqual([]);
    expect(await emailRetry(ctx)).toMatchObject({ designation: "original" });
  });

  it("keeps a claimed invoice unknown after unpairing and fences its late success behind a newer attempt", async () => {
    const ctx = await setup(true);
    const command = await manager(ctx);
    const pulled = await bluetoothPull(ctx, {
      visible: [{ transport: "bluetooth", localKey: MAC }],
    });
    expect(pulled.jobs).toHaveLength(1);
    const claim = pulled.jobs[0]!.invoiceClaim!;
    expect(claim).toBeDefined();
    const tokenHash = (await ctx.jobRow()).claimTokenHash;
    await forget(ctx, command);
    expect(await ctx.row()).toMatchObject({
      status: "unknown",
      failureCode: "transport_failed",
      expiredAt: ctx.now().toISOString(),
    });
    expect(await ctx.jobRow()).toMatchObject({ claimTokenHash: tokenHash });
    const retry = await emailRetry(ctx);
    expect(retry).toMatchObject({ designation: "original" });
    expect((await ctx.result({ status: "done", invoiceClaim: claim })).status).toBe(204);
    expect(await ctx.row()).toMatchObject({
      status: "unknown",
      reportedOutcome: "sent",
      completedAt: null,
    });
    expect(
      (
        await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, retry.id))
      )[0],
    ).toMatchObject({ status: "queued", designation: "original" });
    expect(await ctx.jobRow()).toMatchObject({ status: "failed", lastError: "printer.unpaired" });
  });

  it("keeps the original agent's late report as history when another agent confirmed unpairing", async () => {
    const ctx = await setup(true);
    const [job] = (
      await bluetoothPull(ctx, {
        visible: [{ transport: "bluetooth", localKey: MAC }],
      })
    ).jobs;
    await suite.db
      .update(printJobs)
      .set({ claimedAt: new Date(ctx.now().getTime() - 61_000).toISOString() })
      .where(eq(printJobs.id, ctx.job.jobId));
    await withTransaction(suite.db, async (tx) => {
      const ended = await endUnpairedPrinterJobs(tx, ctx.otherId, [MAC]);
      expect(ended).toEqual([ctx.job.jobId]);
      await endInvoicePrintDeliveries(tx, ended, ctx.now());
    });
    const retry = await emailRetry(ctx);
    expect((await ctx.result({ status: "done", invoiceClaim: job!.invoiceClaim })).status).toBe(
      204,
    );
    expect(await ctx.row()).toMatchObject({ status: "unknown", reportedOutcome: "sent" });
    expect(await ctx.jobRow()).toMatchObject({ status: "failed", lastError: "printer.unpaired" });
    expect(
      (
        await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, retry.id))
      )[0],
    ).toMatchObject({ status: "queued", designation: "original", generation: 2 });
  });

  it("reconciles a receipt when its agent confirms printing after another agent unpaired it", async () => {
    const ctx = await setup(true);
    const [job] = (
      await bluetoothPull(ctx, {
        visible: [{ transport: "bluetooth", localKey: MAC }],
      })
    ).jobs;
    const claimedAt = new Date(ctx.now().getTime() - 61_000).toISOString();
    await suite.db.update(printJobs).set({ claimedAt }).where(eq(printJobs.id, ctx.job.jobId));
    await withTransaction(suite.db, async (tx) => {
      const ended = await endUnpairedPrinterJobs(tx, ctx.otherId, [MAC]);
      expect(ended).toEqual([ctx.job.jobId]);
      await endInvoicePrintDeliveries(tx, ended, ctx.now());
    });
    expect(await ctx.row()).toMatchObject({ status: "unknown", failureCode: "transport_failed" });
    expect((await ctx.result({ status: "done", invoiceClaim: job!.invoiceClaim })).status).toBe(
      204,
    );
    expect(await ctx.row()).toMatchObject({
      status: "sent",
      reportedOutcome: "sent",
      failureCode: null,
    });
    expect(await ctx.jobRow()).toMatchObject({
      status: "done",
      lastError: null,
      claimedBy: ctx.agentId,
      claimedAt,
    });
    expect(await emailRetry(ctx)).toMatchObject({ designation: "duplicate" });
  });
});

/** The printer delete's job and receipt endings and its tombstone write, in one transaction. */
async function deletePrinterNow(
  ctx: Awaited<ReturnType<typeof setup>>,
  printerId = ctx.printer.id,
) {
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
      ctx.now(),
    );
    await tx
      .update(printers)
      .set({ active: false, deletedAt: ctx.now().toISOString() })
      .where(eq(printers.id, printerId));
  });
}

const DELETED_JOB = {
  status: "failed",
  attempts: MAX_DELIVERY_ATTEMPTS,
  lastError: PRINTER_DELETED,
};

describe("invoice receipt printer deletion", () => {
  it.each([
    ["done", false],
    ["failed", false],
    ["done", true],
    ["failed", true],
  ] as const)(
    "keeps a pulled receipt unknown and its job ended after a late %s result (newer attempt first: %s)",
    async (status, newerFirst) => {
      const ctx = await setup();
      const claim = (await ctx.pull())[0]!.invoiceClaim!;
      const tokenHash = (await ctx.jobRow()).claimTokenHash;
      await deletePrinterNow(ctx);
      const endedJob = await ctx.jobRow();
      expect(endedJob).toMatchObject({
        ...DELETED_JOB,
        claimedBy: ctx.agentId,
        claimTokenHash: tokenHash,
      });
      const ended = await ctx.row();
      expect(ended).toMatchObject({
        status: "unknown",
        failureCode: "transport_failed",
        expiredAt: ctx.now().toISOString(),
        completedAt: null,
        reportedAt: null,
      });
      const retry = newerFirst ? await emailRetry(ctx) : undefined;
      ctx.advance(1000);
      const body =
        status === "done"
          ? { status, invoiceClaim: claim }
          : { status, error: "paper", invoiceClaim: claim };

      for (const [bad, jobId, bearer] of [
        [{ ...body, invoiceClaim: { ...claim, token: randomUUID() } }, undefined, undefined],
        [body, randomUUID(), undefined],
        [{ ...body, invoiceClaim: undefined }, undefined, undefined],
        [body, undefined, ctx.otherToken],
      ] as const) {
        expect((await ctx.result(bad, jobId, bearer)).status).toBe(204);
        expect(await ctx.row()).toEqual(ended);
        expect(await ctx.jobRow()).toEqual(endedJob);
      }

      expect((await ctx.result(body)).status).toBe(204);
      const reported = {
        ...ended,
        reportedOutcome: status === "done" ? "sent" : "failed",
        reportedAt: ctx.now().toISOString(),
        reportedFailureCode: status === "done" ? null : "transport_failed",
      };
      expect(await ctx.row()).toEqual(reported);
      expect(await ctx.jobRow()).toEqual(endedJob);

      ctx.advance(1000);
      expect((await ctx.result(body)).status).toBe(204);
      expect(await ctx.row()).toEqual(reported);
      expect(await ctx.jobRow()).toEqual(endedJob);

      expect(await ctx.pull()).toEqual([]);
      if (retry !== undefined) {
        expect(
          (
            await suite.db
              .select()
              .from(invoiceDeliveries)
              .where(eq(invoiceDeliveries.id, retry.id))
          )[0],
        ).toEqual(retry);
      } else {
        expect(await emailRetry(ctx)).toMatchObject({ designation: "original", generation: 2 });
      }
    },
  );

  it("fails a queued receipt with its job, and nothing claims it", async () => {
    const ctx = await setup();
    await deletePrinterNow(ctx);
    expect(await ctx.row()).toMatchObject({
      status: "failed",
      failureCode: "transport_failed",
      expiredAt: null,
    });
    expect(await ctx.jobRow()).toMatchObject({
      ...DELETED_JOB,
      claimedBy: null,
      claimTokenHash: null,
    });
    ctx.advance(1000);
    expect(await ctx.pull()).toEqual([]);
    expect(await ctx.row()).toMatchObject({ status: "failed" });
    expect(await emailRetry(ctx)).toMatchObject({ designation: "original", status: "queued" });
  });

  it("leaves a printed receipt and its job as they were", async () => {
    const ctx = await setup();
    const claim = (await ctx.pull())[0]!.invoiceClaim!;
    expect((await ctx.result({ status: "done", invoiceClaim: claim })).status).toBe(204);
    const sent = await ctx.row();
    const job = await ctx.jobRow();
    await deletePrinterNow(ctx);
    expect(await ctx.row()).toEqual(sent);
    expect(await ctx.jobRow()).toEqual(job);
    expect(await emailRetry(ctx)).toMatchObject({ designation: "duplicate" });
  });

  it.each(["printed", "ended"] as const)(
    "answers printer.not_found to a resend of a deleted printer's %s receipt and adds nothing",
    async (state) => {
      const ctx = await setup();
      if (state === "printed") {
        const claim = (await ctx.pull())[0]!.invoiceClaim!;
        await ctx.result({ status: "done", invoiceClaim: claim });
      }
      await deletePrinterNow(ctx);
      const jobs = await suite.db.select().from(printJobs);
      const deliveries = await suite.db.select().from(invoiceDeliveries);
      const command = await manager(ctx);

      const response = await command(`/management-api/print-jobs/${ctx.job.jobId}/resend`, {});

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "printer.not_found", params: { id: ctx.printer.id } },
      });
      expect(await suite.db.select().from(printJobs)).toEqual(jobs);
      expect(await suite.db.select().from(invoiceDeliveries)).toEqual(deliveries);
    },
  );

  it("rolls back the claim expiry a refused resend of a deleted printer's receipt ran first", async () => {
    const ctx = await setup();
    await deletePrinterNow(ctx);
    // A receipt sent long enough ago that the resend's expiry pass would end it.
    const stale = new Date(ctx.now().getTime() - 120_000).toISOString();
    await suite.db
      .update(printJobs)
      .set({ claimedAt: stale })
      .where(eq(printJobs.id, ctx.job.jobId));
    await suite.db
      .update(invoiceDeliveries)
      .set({ status: "sending", expiredAt: null, failureCode: null })
      .where(eq(invoiceDeliveries.id, ctx.delivery.id));
    const before = await suite.db.select().from(invoiceDeliveries);
    const jobs = await suite.db.select().from(printJobs);
    const command = await manager(ctx);

    const response = await command(`/management-api/print-jobs/${ctx.job.jobId}/resend`, {});

    expect(response.status).toBe(404);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual(before);
    expect(await suite.db.select().from(printJobs)).toEqual(jobs);
    // The control: the same expiry, committed on its own, does end it.
    await withTransaction(suite.db, (tx) => expireInvoiceDeliveryClaims(tx, ctx.now()));
    expect(await ctx.row()).toMatchObject({ status: "unknown", failureCode: "timeout" });
  });

  it("switches off only the live printer when a deleted printer's Bluetooth address is unpaired", async () => {
    const ctx = await setup(true);
    const command = await manager(ctx);
    await deletePrinterNow(ctx);
    expect((await bluetoothPull(ctx)).jobs).toEqual([]);
    const [tombstone] = await suite.db
      .select()
      .from(printers)
      .where(eq(printers.id, ctx.printer.id));
    const [replacement] = await suite.db
      .insert(printers)
      .values({
        ...tombstone!,
        id: randomUUID(),
        name: "Receipt again",
        active: true,
        deletedAt: null,
      })
      .returning({ id: printers.id });
    // Fails the pull on any write to the deleted row, so a same-value write shows too.
    await suite.db.execute(sql`create trigger test_tombstone_written before update on printers
      when old.deleted_at is not null begin select raise(abort, 'tombstone_written'); end`);
    try {
      await forget(ctx, command);
    } finally {
      await suite.db.execute(sql`drop trigger test_tombstone_written`);
    }
    expect(
      (await suite.db.select().from(printers).where(eq(printers.id, ctx.printer.id)))[0],
    ).toEqual(tombstone);
    expect(
      (await suite.db.select().from(printers).where(eq(printers.id, replacement!.id)))[0],
    ).toMatchObject({ active: false, deletedAt: null });
  });
});

describe("completed receipt original management actions", () => {
  it.each(["failed", "queued", "printing", "retrying"] as const)(
    "hides resend for an original while its delivery is %s",
    async (status) => {
      const ctx = await setup();
      const command = await manager(ctx);
      const sale = await issue(false);
      const original = await withTransaction(suite.db, async (tx) => {
        const job = await enqueuePrintJob(
          tx,
          ctx.printer.id,
          new Uint8Array([27, 64]),
          "document",
          { saleId: sale.saleId, receiptCopy: false },
        );
        await tx
          .update(printJobs)
          .set({ status: "failed", attempts: 5 })
          .where(eq(printJobs.id, job.jobId));
        const retry = await resendPrintJob(tx, job.jobId);
        await tx
          .update(printJobs)
          .set({
            status: status === "failed" ? "done" : status === "retrying" ? "failed" : status,
            attempts: status === "retrying" ? 1 : 0,
          })
          .where(eq(printJobs.id, retry.jobId));
        return job;
      });
      const listing = await command("/management-api/print-jobs", undefined, "GET");
      expect(listing.status).toBe(200);
      const jobs = (await listing.json()) as { id: string; canResend: boolean }[];
      expect(jobs.find((job) => job.id === original.jobId)).toMatchObject({ canResend: false });
      const before = await suite.db.select().from(printJobs);
      const response = await command(`/management-api/print-jobs/${original.jobId}/resend`, {});
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "print_job.not_resendable" } });
      expect(await suite.db.select().from(printJobs)).toEqual(before);
    },
  );
});
