import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, printAgents, printJobs, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { FakeSink } from "@waitron/print-agent";
import { claimPrintJobs, reportPrintJob } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function fixture(kind: "document" | "drawer", separatePrinter = false) {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Bar",
      invoiceLocales: ["es-ES"],
      operationDescription: "Sale on premises",
    })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const agents = await suite.db
    .insert(printAgents)
    .values([
      { locationId, name: "A", tokenHash: "scrypt$fixture-a" },
      { locationId, name: "B", tokenHash: "scrypt$fixture-b" },
    ])
    .returning({ id: printAgents.id });
  const ids = await withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(
      tx,
      { locationId },
      {
        name: "Kitchen",
        transport: "network_tcp",
        host: "10.0.0.9",
      },
    );
    const first = await enqueuePrintJob(tx, { locationId }, printer.id, new Uint8Array([1]));
    const tailPrinter = separatePrinter
      ? await createPrinter(
          tx,
          { locationId },
          { name: "Other", transport: "network_tcp", host: "10.0.0.10" },
        )
      : printer;
    const tail = await enqueuePrintJob(
      tx,
      { locationId },
      tailPrinter.id,
      new Uint8Array([2]),
      kind,
    );
    await tx
      .update(printJobs)
      .set({ createdAt: "2026-10-11T00:00:00.000Z" })
      .where(eq(printJobs.id, first.jobId));
    await tx
      .update(printJobs)
      .set({ createdAt: "2026-10-11T00:00:01.000Z" })
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
        withTransaction(suite.db, (tx) =>
          claimPrintJobs(tx, agentId, { locationId: ctx.locationId, visibleKeys: [] }),
        );
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
        locationId: ctx.locationId,
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
        locationId: ctx.locationId,
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
          locationId: ctx.locationId,
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
          locationId: ctx.locationId,
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
      if (sameTime)
        await suite.db
          .update(printJobs)
          .set({ createdAt: "2026-10-11T00:00:00.000Z" })
          .where(eq(printJobs.id, ctx.tail));
      const pull = () =>
        withTransaction(suite.db, (tx) =>
          claimPrintJobs(tx, ctx.a, {
            locationId: ctx.locationId,
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
