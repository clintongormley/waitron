import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  printAgents,
  printJobs,
  printers,
  withTransaction,
  venueLocationId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { FakeSink } from "@waitron/print-agent";
import { claimPrintJobs, reportPrintJob } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function fixture(kind: "document" | "drawer", separatePrinter = false) {
  await seedVenue(suite.db, {
    name: "Bar",
    invoiceLocales: ["es-ES"],
    operationDescription: "Sale on premises",
  });
  const locationId = await venueLocationId(suite.db);
  const agents = await suite.db
    .insert(printAgents)
    .values([
      { locationId, name: "A", tokenHash: "scrypt$fixture-a" },
      { locationId, name: "B", tokenHash: "scrypt$fixture-b" },
    ])
    .returning({ id: printAgents.id });
  const ids = await withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(tx, {
      name: "Kitchen",
      transport: "network_tcp",
      host: "10.0.0.9",
    });
    const first = await enqueuePrintJob(tx, printer.id, new Uint8Array([1]));
    const tailPrinter = separatePrinter
      ? await createPrinter(tx, { name: "Other", transport: "network_tcp", host: "10.0.0.10" })
      : printer;
    const tail = await enqueuePrintJob(tx, tailPrinter.id, new Uint8Array([2]), kind);
    await tx
      .update(printJobs)
      .set({ createdAt: new Date(Date.now() - 2_000).toISOString() })
      .where(eq(printJobs.id, first.jobId));
    await tx
      .update(printJobs)
      .set({ createdAt: new Date(Date.now() - 1_000).toISOString() })
      .where(eq(printJobs.id, tail.jobId));
    return { first: first.jobId, tail: tail.jobId };
  });
  return { locationId, a: agents[0]!.id, b: agents[1]!.id, ...ids };
}

describe("aged print batches", () => {
  it.each(["document", "drawer"] as const)(
    "does not give two agents the unsent %s tail",
    async (kind) => {
      const ctx = await fixture(kind);
      const pull = (agentId: string) =>
        withTransaction(suite.db, (tx) => claimPrintJobs(tx, agentId, { visibleKeys: [] }));
      const firstBatch = await pull(ctx.a);
      const sent = new FakeSink();
      const send = async (agentId: string, job: (typeof firstBatch)[number]) => {
        await sent.send(
          {
            id: job.printer_id,
            transport: job.transport,
            host: job.host,
            port: job.port,
            devicePath: job.local_key,
          },
          new Uint8Array(job.payload),
        );
        await withTransaction(suite.db, (tx) =>
          reportPrintJob(tx, {
            agentId,
            jobId: job.id,
            outcome: { status: "done" },
          }),
        );
      };
      await send(ctx.a, firstBatch[0]!);
      await withTransaction(suite.db, (tx) =>
        tx
          .update(printJobs)
          .set({ claimedAt: "2026-01-01T00:00:00.000Z" })
          .where(eq(printJobs.id, ctx.tail)),
      );
      const secondBatch = await pull(ctx.b);
      for (const job of secondBatch) await send(ctx.b, job);
      for (const job of firstBatch.slice(1)) await send(ctx.a, job);
      expect(sent.written.map((entry) => [...entry.bytes])).toEqual([[1], [2]]);
      const [tail] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.tail));
      expect(tail!.status).toBe("done");
    },
  );

  it("does not replay a drawer whose done report was lost", async () => {
    const ctx = await fixture("drawer");
    await withTransaction(suite.db, (tx) =>
      tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, ctx.first)),
    );
    const pulled = await withTransaction(suite.db, (tx) =>
      claimPrintJobs(tx, ctx.a, {
        visibleKeys: [],
      }),
    );
    expect(pulled.map((job) => job.id)).toEqual([ctx.tail]);
    const sent = new FakeSink();
    const job = pulled[0]!;
    await sent.send(
      {
        id: job.printer_id,
        transport: job.transport,
        host: job.host,
        port: job.port,
        devicePath: job.local_key,
      },
      new Uint8Array(job.payload),
    );
    await withTransaction(suite.db, (tx) =>
      tx
        .update(printJobs)
        .set({ claimedAt: "2026-01-01T00:00:00.000Z" })
        .where(eq(printJobs.id, ctx.tail)),
    );
    const reclaimed = await withTransaction(suite.db, (tx) =>
      claimPrintJobs(tx, ctx.b, {
        visibleKeys: [],
      }),
    );
    for (const replay of reclaimed)
      await sent.send(
        {
          id: replay.printer_id,
          transport: replay.transport,
          host: replay.host,
          port: replay.port,
          devicePath: replay.local_key,
        },
        new Uint8Array(replay.payload),
      );
    expect(sent.written.map((entry) => [...entry.bytes])).toEqual([[2]]);
  });
  it("does not retry a drawer after a send wrote the pulse and then rejected", async () => {
    const ctx = await fixture("drawer");
    await withTransaction(suite.db, (tx) =>
      tx.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, ctx.first)),
    );
    const sent = new FakeSink();
    for (const agentId of [ctx.a, ctx.b]) {
      const pulled = await withTransaction(suite.db, (tx) =>
        claimPrintJobs(tx, agentId, {
          visibleKeys: [],
        }),
      );
      for (const job of pulled) {
        await sent.send(
          {
            id: job.printer_id,
            transport: job.transport,
            host: job.host,
            port: job.port,
            devicePath: job.local_key,
          },
          new Uint8Array(job.payload),
        );
        await withTransaction(suite.db, (tx) =>
          reportPrintJob(tx, {
            agentId,
            jobId: job.id,
            outcome: { status: "failed", error: "connection reset after write" },
          }),
        );
      }
    }
    expect(sent.written.map((entry) => [...entry.bytes])).toEqual([[2]]);
    const [row] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.tail));
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(1);
    expect(row!.lastError).toBe("connection reset after write");
  });

  it("lets another printer pass a failed document on the next pull", async () => {
    const ctx = await fixture("document", true);
    const pull = () =>
      withTransaction(suite.db, (tx) =>
        claimPrintJobs(tx, ctx.a, {
          visibleKeys: [],
        }),
      );
    expect((await pull()).map((job) => job.id)).toEqual([ctx.first]);
    await withTransaction(suite.db, (tx) =>
      reportPrintJob(tx, {
        agentId: ctx.a,
        jobId: ctx.first,
        outcome: { status: "failed", error: "offline" },
      }),
    );
    expect((await pull()).map((job) => job.id)).toEqual([ctx.tail]);
  });
  it.each([false, true])(
    "keeps the older failed ticket ahead on the same printer (same timestamp: %s)",
    async (sameTime) => {
      const ctx = await fixture("document");
      if (sameTime) {
        const [first] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.first));
        await suite.db
          .update(printJobs)
          .set({ createdAt: first!.createdAt })
          .where(eq(printJobs.id, ctx.tail));
      }
      const pull = () =>
        withTransaction(suite.db, (tx) =>
          claimPrintJobs(tx, ctx.a, {
            visibleKeys: [],
          }),
        );
      expect((await pull()).map((job) => job.id)).toEqual([ctx.first]);
      await withTransaction(suite.db, (tx) =>
        reportPrintJob(tx, {
          agentId: ctx.a,
          jobId: ctx.first,
          outcome: { status: "failed", error: "paper out" },
        }),
      );
      expect((await pull()).map((job) => job.id)).toEqual([ctx.first]);
      await withTransaction(suite.db, (tx) =>
        reportPrintJob(tx, {
          agentId: ctx.a,
          jobId: ctx.first,
          outcome: { status: "done" },
        }),
      );
      expect((await pull()).map((job) => job.id)).toEqual([ctx.tail]);
    },
  );
});

describe("drawer delivery time limits", () => {
  afterEach(() => vi.useRealTimers());

  async function drawer(transport: "usb" | "bluetooth" = "usb") {
    const ctx = await fixture("drawer");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T12:00:00.000Z"));
    await suite.db.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, ctx.first));
    const [row] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.tail));
    await suite.db
      .update(printers)
      .set({ transport, localKey: "DRAWER" })
      .where(eq(printers.id, row!.printerId));
    await suite.db
      .update(printJobs)
      .set({ createdAt: new Date().toISOString() })
      .where(eq(printJobs.id, ctx.tail));
    return { ...ctx, printerId: row!.printerId };
  }

  const pull = (agentId: string, visibleKeys = ["DRAWER"]) =>
    withTransaction(suite.db, (tx) => claimPrintJobs(tx, agentId, { visibleKeys }));

  it.each(["usb", "bluetooth"] as const)(
    "expires an unseen %s drawer before reconnection",
    async (transport) => {
      const ctx = await drawer(transport);
      expect(await pull(ctx.a, [])).toEqual([]);
      vi.setSystemTime(new Date("2026-11-08T12:00:30.000Z"));
      const claimed = await pull(ctx.b);
      const sent = new FakeSink();
      for (const job of claimed)
        await sent.send(
          {
            id: job.printer_id,
            transport: job.transport,
            host: job.host,
            port: job.port,
            devicePath: job.local_key,
          },
          new Uint8Array(job.payload),
        );
      expect(sent.written).toEqual([]);
      const [row] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.tail));
      expect(row).toMatchObject({
        status: "failed",
        lastError: "print_job.drawer_expired",
        attempts: 0,
        claimedAt: null,
        claimedBy: null,
      });
    },
  );

  it("still hands out a drawer just before thirty seconds", async () => {
    const ctx = await drawer();
    vi.setSystemTime(new Date("2026-11-08T12:00:29.999Z"));
    expect((await pull(ctx.a)).map((job) => job.id)).toEqual([ctx.tail]);
  });

  it("ends a disabled printer's drawer before it is enabled again without ending its document", async () => {
    const ctx = await drawer();
    const document = await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(tx, ctx.printerId, new Uint8Array([3])),
    );
    await suite.db.update(printers).set({ active: false }).where(eq(printers.id, ctx.printerId));
    vi.setSystemTime(new Date("2026-11-08T12:00:30.000Z"));
    expect(await pull(ctx.a, [])).toEqual([]);
    const [ended] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.tail));
    expect(ended).toMatchObject({
      status: "failed",
      attempts: 0,
      lastError: "print_job.drawer_expired",
    });
    const [waitingDocument] = await suite.db
      .select()
      .from(printJobs)
      .where(eq(printJobs.id, document.jobId));
    expect(waitingDocument).toMatchObject({
      status: "queued",
      attempts: 0,
      lastError: null,
      claimedAt: null,
      claimedBy: null,
    });
    await suite.db.update(printers).set({ active: true }).where(eq(printers.id, ctx.printerId));
    expect((await pull(ctx.b)).map((job) => job.id)).toEqual([document.jobId]);
  });

  it.each([
    { age: 59_999, status: "printing", error: null },
    { age: 60_000, status: "failed", error: "print_job.drawer_outcome_unknown" },
    { age: -60_001, status: "failed", error: "print_job.drawer_outcome_unknown" },
  ])(
    "makes an unreported drawer explicit at claim age $age without repeating it",
    async ({ age, status, error }) => {
      const ctx = await drawer();
      expect((await pull(ctx.a)).map((job) => job.id)).toEqual([ctx.tail]);
      vi.setSystemTime(new Date(Date.parse("2026-11-08T12:00:00.000Z") + age));
      expect(await pull(ctx.b)).toEqual([]);
      const [row] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.tail));
      expect(row).toMatchObject({
        status,
        lastError: error,
        attempts: 0,
        claimedBy: ctx.a,
        claimedAt: "2026-11-08T12:00:00.000Z",
      });
      if (status === "failed")
        for (const agentId of [ctx.a, ctx.b])
          for (const outcome of [{ status: "done" }, { status: "failed", error: "late" }] as const)
            expect(
              await withTransaction(suite.db, (tx) =>
                reportPrintJob(tx, { agentId, jobId: ctx.tail, outcome }),
              ),
            ).toEqual({ updated: false });
    },
  );

  it("counts time waiting behind earlier documents toward the drawer limit", async () => {
    const ctx = await drawer();
    const documents: string[] = [];
    for (let index = 0; index < 3; index++) {
      const job = await withTransaction(suite.db, (tx) =>
        enqueuePrintJob(tx, ctx.printerId, new Uint8Array([index])),
      );
      documents.push(job.jobId);
      await suite.db
        .update(printJobs)
        .set({ createdAt: "2026-11-08T11:59:59.000Z" })
        .where(eq(printJobs.id, job.jobId));
    }
    for (const [index, id] of documents.entries()) {
      vi.setSystemTime(new Date(Date.parse("2026-11-08T12:00:00.000Z") + index * 11_000));
      expect((await pull(ctx.a)).map((job) => job.id)).toEqual([id]);
      await withTransaction(suite.db, (tx) =>
        reportPrintJob(tx, { agentId: ctx.a, jobId: id, outcome: { status: "done" } }),
      );
    }
    vi.setSystemTime(new Date("2026-11-08T12:00:33.000Z"));
    expect(await pull(ctx.a)).toEqual([]);
    const [row] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.tail));
    expect(row).toMatchObject({
      status: "failed",
      lastError: "print_job.drawer_expired",
      attempts: 0,
    });
  });

  it("ends a drawer with a missing claim stamp without another delivery", async () => {
    const ctx = await drawer();
    await suite.db
      .update(printJobs)
      .set({ status: "printing", claimedAt: null, claimedBy: ctx.a })
      .where(eq(printJobs.id, ctx.tail));
    expect(await pull(ctx.b)).toEqual([]);
    const [row] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.tail));
    expect(row).toMatchObject({
      status: "failed",
      lastError: "print_job.drawer_outcome_unknown",
      attempts: 0,
      claimedBy: ctx.a,
    });
  });

  it("expires a queued drawer stamped beyond its wait after a clock step back", async () => {
    const ctx = await drawer();
    vi.setSystemTime(new Date("2026-11-08T11:59:29.999Z"));
    expect(await pull(ctx.b)).toEqual([]);
    const [row] = await suite.db.select().from(printJobs).where(eq(printJobs.id, ctx.tail));
    expect(row).toMatchObject({
      status: "failed",
      lastError: "print_job.drawer_expired",
      attempts: 0,
    });
  });
});
