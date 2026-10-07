import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  invoiceDeliveries,
  locations,
  nodes,
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
  resendPrintJob,
  reportPrintJob,
  runAgentOnce,
  MAX_DELIVERY_ATTEMPTS,
} from "@waitron/printing";
import {
  hashSecret,
  hashPin,
  persons,
  startManagementSession,
  IDENTITY_MIGRATIONS,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { createClient, createAgent, FakeSink } from "@waitron/print-agent";
import { fakeHost } from "@waitron/print-agent/testing/fake-host.js";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import { jobOrigin, locationId, nodeId, seriesId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import {
  reserveInvoiceDelivery,
  claimInvoiceDelivery,
  expireInvoiceDeliveryClaims,
} from "./invoice-delivery.js";
import { mountPrintApi } from "./print-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { deliverDemoPrinterJobs } from "./demo-printer.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
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

type ClaimWire = { deliveryId: string; generation: number; token: string };
const inventory = { visible: [], scanned: [], pairedBluetooth: [], bluetoothOutcomes: [] };
const MAC = "5A:4A:45:D4:FB:BB";
async function setup(bluetooth = false) {
  const sale = await issue();
  const [location] = await suite.db.select().from(locations);
  const [node] = await suite.db.select().from(nodes);
  const [series] = await suite.db.select().from(invoiceSeries);
  const secret = "synthetic-agent-secret";
  const [agent] = await suite.db
    .insert(printAgents)
    .values({ locationId: location!.id, name: "Agent", tokenHash: hashSecret(secret) })
    .returning();
  const [other] = await suite.db
    .insert(printAgents)
    .values({ locationId: location!.id, name: "Other", tokenHash: hashSecret(secret) })
    .returning();
  const printer = await withTransaction(suite.db, (tx) =>
    createPrinter(
      tx,
      { locationId: location!.id },
      bluetooth
        ? { name: "Receipt", transport: "bluetooth", localKey: MAC }
        : { name: "Receipt", transport: "network_tcp", host: "printer.test" },
    ),
  );
  const job = await withTransaction(suite.db, (tx) =>
    enqueuePrintJob(
      tx,
      { locationId: location!.id },
      printer.id,
      new Uint8Array([27, 64]),
      "document",
      { saleId: sale.saleId, receiptCopy: false },
    ),
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
  await suite.db
    .update(invoiceDeliveries)
    .set({ nextAttemptAt: now.toISOString() })
    .where(eq(invoiceDeliveries.id, delivery.id));
  const app = new Hono();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg: {
        locationId: locationId(location!.id),
        nodeId: nodeId(node!.id),
        seriesId: seriesId(series!.id),
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        tipsEnabled: false,
        simplifiedInvoiceLimit: null,
      },
      pairingMode: createPairingMode(),
      readMembership: async () => null,
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
    otherToken: `${other!.id}.${secret}`,
    locationId: location!.id,
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
  await withTransaction(suite.db, (tx) =>
    claimPrintJobs(tx, ctx.agentId, {
      locationId: ctx.locationId,
      visibleKeys: [],
      invoiceReceiptsAt: ctx.now().toISOString(),
    }),
  );
  return (await withTransaction(suite.db, (tx) =>
    claimInvoiceDelivery(tx, ctx.delivery.id, ctx.agentId, ctx.now()),
  ))!;
}
describe("invoice receipt API attempt boundary", () => {
  it("round-trips a fresh claim through the real client and commits completion", async () => {
    const ctx = await setup();
    const jobs = await ctx.pull();
    expect(jobs).toHaveLength(1);
    const invoiceClaim = (jobs[0] as unknown as { invoiceClaim?: ClaimWire }).invoiceClaim;
    expect(invoiceClaim).toMatchObject({
      deliveryId: ctx.delivery.id,
      generation: 1,
      token: expect.any(String),
    });
    expect(await ctx.row()).toMatchObject({ status: "sending", claimedAgentId: ctx.agentId });
    expect((await ctx.row()).claimTokenHash).not.toBe(invoiceClaim!.token);
    expect(
      await ctx.client.report("http://box.test", ctx.token, ctx.job.jobId, {
        status: "done",
        invoiceClaim,
      } as never),
    ).toEqual({ ok: true, value: undefined });
    expect(await ctx.row()).toMatchObject({ status: "sent", reportedOutcome: "sent" });
    expect(await ctx.jobRow()).toMatchObject({ status: "done" });
  });
  it("keeps a future invoice receipt queued and leaves ordinary jobs available", async () => {
    const ctx = await setup();
    await suite.db
      .update(invoiceDeliveries)
      .set({ nextAttemptAt: new Date(ctx.now().getTime() + 60000).toISOString() })
      .where(eq(invoiceDeliveries.id, ctx.delivery.id));
    const ordinary = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(
        tx,
        { locationId: ctx.locationId },
        ctx.printer.id,
        new Uint8Array([1]),
        "drawer",
      ),
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
          locationId: ctx.locationId,
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
      await deliverDemoPrinterJobs(suite.db, ctx.locationId, {
        agentId: ctx.agentId,
        printerId: ctx.printer.id,
      }),
    ).toBe(1);
    expect(await ctx.row()).toMatchObject({ status: "sent", claimedAgentId: ctx.agentId });
    expect(await ctx.jobRow()).toMatchObject({ status: "done" });
  });
  it.each([
    null,
    [],
    1,
    {},
    { deliveryId: "bad", generation: 1, token: randomUUID() },
    { deliveryId: randomUUID(), generation: 0, token: randomUUID() },
    { deliveryId: randomUUID(), generation: 1.5, token: randomUUID() },
    { deliveryId: randomUUID(), generation: "1", token: randomUUID() },
    { deliveryId: randomUUID(), generation: Number.MAX_SAFE_INTEGER + 1, token: randomUUID() },
    { deliveryId: randomUUID(), generation: 1, token: "bad" },
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
  it.each(["token", "generation", "delivery", "agent", "job"] as const)(
    "ignores another attempt's %s and accepts the authenticated current result",
    async (wrong) => {
      const ctx = await setup();
      const original = await held(ctx);
      const claim = { ...original };
      if (wrong === "token") claim.token = randomUUID();
      if (wrong === "generation") claim.generation++;
      if (wrong === "delivery") claim.deliveryId = randomUUID();
      const other = await withTransaction(suite.db, (tx) =>
        enqueuePrintJob(tx, { locationId: ctx.locationId }, ctx.printer.id, new Uint8Array([2])),
      );
      await withTransaction(suite.db, (tx) =>
        claimPrintJobs(tx, ctx.agentId, { locationId: ctx.locationId, visibleKeys: [] }),
      );
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
      await suite.db
        .update(invoiceDeliveries)
        .set({ nextAttemptAt: ctx.now().toISOString() })
        .where(eq(invoiceDeliveries.id, retry.id));
      let retryClaim: ClaimWire | undefined;
      if (stage !== "queued") {
        const jobs = await ctx.pull();
        expect(jobs).toHaveLength(1);
        retryClaim = (jobs[0] as unknown as { invoiceClaim: ClaimWire }).invoiceClaim;
        expect(retryClaim).toMatchObject({ deliveryId: retry.id, generation: 2 });
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
  it("keeps ordinary jobs claimable and reportable without an invoice token", async () => {
    const ctx = await setup();
    const ordinary = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(
        tx,
        { locationId: ctx.locationId },
        ctx.printer.id,
        new Uint8Array([1]),
        "drawer",
      ),
    );
    const jobs = await ctx.pull();
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
    expect(retried.map((job) => job.id)).toEqual([ordinary.jobId]);
    expect((await ctx.result({ status: "done" }, ordinary.jobId)).status).toBe(204);
    expect(
      (await suite.db.select().from(printJobs).where(eq(printJobs.id, ordinary.jobId)))[0],
    ).toMatchObject({ status: "done", attempts: 1 });
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
    });
    expect(await ctx.row()).toMatchObject({ status: "queued", claimTokenHash: null });
    await suite.db.execute(sql`drop trigger test_refuse_invoice_claim`);
    expect(await ctx.pull()).toHaveLength(1);
    expect(await ctx.jobRow()).toMatchObject({ status: "printing", claimedBy: ctx.agentId });
    expect(await ctx.row()).toMatchObject({
      status: "sending",
      claimTokenHash: expect.any(String),
    });
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
    const [person] = await tx
      .insert(persons)
      .values({
        displayName: "Printer manager",
        pinHash: hashPin("1234"),
        role: "manager",
      })
      .returning();
    return startManagementSession(tx, { personId: person!.id });
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

  it("resends marked copy bytes after the original completes", async () => {
    const ctx = await setup();
    const original = await held(ctx);
    await ctx.result({ status: "done", invoiceClaim: original });
    const copy = await withTransaction(suite.db, async (tx) => {
      const job = await enqueuePrintJob(
        tx,
        { locationId: ctx.locationId },
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
      payload: new Uint8Array([68, 85, 80]),
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
    "enrolls a %s original retry with the same bytes and a new authenticated claim",
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
      const [staff] = await suite.db.select().from(persons);
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
        payload: (await ctx.jobRow()).payload,
        saleId: ctx.sale.saleId,
        receiptCopy: false,
        resendOf: ctx.job.jobId,
        kind: "document",
      });
      ctx.advance(1000);
      const pulled = await ctx.pull();
      expect(pulled).toHaveLength(1);
      const retryClaim = (pulled[0] as unknown as { invoiceClaim: ClaimWire }).invoiceClaim;
      expect(retryClaim).toMatchObject({ deliveryId: retry!.id, generation: 2 });
      expect(retryClaim.token).not.toBe(originalClaim.token);
      const before = (
        await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, retry!.id))
      )[0];
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

  it("refuses resending completed original bytes and leaves its history unchanged", async () => {
    const ctx = await setup();
    const invoiceClaim = await held(ctx);
    await ctx.result({ status: "done", invoiceClaim });
    const jobs = await suite.db.select().from(printJobs);
    const deliveries = await suite.db.select().from(invoiceDeliveries);
    const command = await manager(ctx);
    const response = await command(`/management-api/print-jobs/${ctx.job.jobId}/resend`, {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "print_job.not_resendable" } });
    expect(await suite.db.select().from(printJobs)).toEqual(jobs);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual(deliveries);
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
  return (await response.json()) as { jobs: { id: string; invoiceClaim?: ClaimWire }[] };
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
      consent: {
        statementVersion: "1",
        language: "es-ES",
        recordedAt: ctx.now().toISOString(),
        personId: "staff",
        contactEmail: "venue@example.test",
      },
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
    expect((await bluetoothPull(ctx, { bluetoothPrinting: false })).jobs).toEqual([]);
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

  it("releases a queued invoice when Bluetooth printing is unavailable and leaves it ended after recovery", async () => {
    const ctx = await setup(true);
    const otherSale = await issue();
    const unrelated = await withTransaction(suite.db, async (tx) => {
      const usb = await createPrinter(
        tx,
        { locationId: ctx.locationId },
        {
          name: "Other invoice printer",
          transport: "usb",
          localKey: "other-usb",
        },
      );
      const job = await enqueuePrintJob(
        tx,
        { locationId: ctx.locationId },
        usb.id,
        new Uint8Array([27, 64]),
        "document",
        { saleId: otherSale.saleId, receiptCopy: false },
      );
      return reserveInvoiceDelivery(tx, otherSale.saleId, {
        requestKey: randomUUID(),
        personId: "staff",
        medium: "receipt",
        printJobId: job.jobId,
      });
    });
    expect((await bluetoothPull(ctx, { bluetoothPrinting: false })).jobs).toEqual([]);
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
      lastError: "printer.bluetooth_printing_unavailable",
      attempts: MAX_DELIVERY_ATTEMPTS,
    });
    expect(await ctx.row()).toMatchObject({
      status: "failed",
      failureCode: "transport_failed",
      completedAt: null,
      claimTokenHash: null,
    });
    const retry = await emailRetry(ctx);
    expect(retry).toMatchObject({ status: "queued", designation: "original", generation: 2 });
    expect(
      (
        await bluetoothPull(ctx, {
          bluetoothPrinting: true,
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
      (await command(`/management-api/printers/${ctx.printer.id}`, { active: true }, "PATCH"))
        .status,
    ).toBe(204);
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
    const tokenHash = (await ctx.row()).claimTokenHash;
    await forget(ctx, command);
    expect(await ctx.row()).toMatchObject({
      status: "unknown",
      failureCode: "transport_failed",
      expiredAt: ctx.now().toISOString(),
      claimTokenHash: tokenHash,
    });
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
});

describe("invoice receipt printer deactivation", () => {
  it.each([
    ["queued", "POST"],
    ["sending", "POST"],
    ["queued", "PATCH"],
    ["sending", "PATCH"],
  ] as const)(
    "ends a %s invoice attempt through %s without resuming it or ending ordinary jobs on reactivation",
    async (status, method) => {
      const ctx = await setup();
      if (status === "sending") await ctx.pull();
      const ordinary = await withTransaction(suite.db, (tx) =>
        enqueuePrintJob(
          tx,
          { locationId: ctx.locationId },
          ctx.printer.id,
          new Uint8Array([1]),
          "document",
        ),
      );
      const command = await manager(ctx);
      expect(
        (
          await command(
            `/management-api/printers/${ctx.printer.id}${method === "POST" ? "/deactivate" : ""}`,
            method === "POST" ? {} : { active: false },
            method,
          )
        ).status,
      ).toBe(204);
      expect(await ctx.row()).toMatchObject({
        status: status === "sending" ? "unknown" : "failed",
        failureCode: "transport_failed",
      });
      expect(await ctx.jobRow()).toMatchObject({
        status: "failed",
        attempts: MAX_DELIVERY_ATTEMPTS,
      });
      expect(
        (await suite.db.select().from(printJobs).where(eq(printJobs.id, ordinary.jobId)))[0],
      ).toMatchObject({ status: "queued", attempts: 0 });
      const retry = await emailRetry(ctx);
      expect(retry).toMatchObject({ designation: "original", status: "queued" });
      expect(
        (await command(`/management-api/printers/${ctx.printer.id}`, { active: true }, "PATCH"))
          .status,
      ).toBe(204);
      expect((await ctx.pull()).map((job) => job.id)).toEqual([ordinary.jobId]);
      expect(await ctx.row()).toMatchObject({
        status: status === "sending" ? "unknown" : "failed",
      });
    },
  );

  it("accepts the disabled printer's authenticated late completion before retry", async () => {
    const ctx = await setup();
    const claim = (await ctx.pull())[0]!.invoiceClaim!;
    const command = await manager(ctx);
    expect(
      (await command(`/management-api/printers/${ctx.printer.id}/deactivate`, {})).status,
    ).toBe(204);
    expect(await ctx.row()).toMatchObject({
      status: "unknown",
      expiredAt: ctx.now().toISOString(),
    });
    expect((await ctx.result({ status: "done", invoiceClaim: claim })).status).toBe(204);
    expect(await ctx.row()).toMatchObject({ status: "sent", reportedOutcome: "sent" });
    expect(await emailRetry(ctx)).toMatchObject({ designation: "duplicate" });
  });

  it("leaves a completed invoice unchanged when its printer is deactivated", async () => {
    const ctx = await setup();
    const claim = (await ctx.pull())[0]!.invoiceClaim!;
    expect((await ctx.result({ status: "done", invoiceClaim: claim })).status).toBe(204);
    const completed = await ctx.row();
    const job = await ctx.jobRow();
    const command = await manager(ctx);
    expect(
      (await command(`/management-api/printers/${ctx.printer.id}/deactivate`, {})).status,
    ).toBe(204);
    expect(await ctx.row()).toEqual(completed);
    expect(await ctx.jobRow()).toEqual(job);
    expect(await emailRetry(ctx)).toMatchObject({ designation: "duplicate" });
  });
});
