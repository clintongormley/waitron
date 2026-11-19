import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, printAgents, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { endMovedPrintJob, enqueuePrintJob, resendPrintJob } from "./outbox.js";
import { endDeletedPrinterJobs } from "./printer-delete-jobs.js";
import { createPrinter } from "./printers.js";
import { claimPrintJobs, endUnpairedPrinterJobs, reportPrintJob } from "./runtime.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const start = Date.parse("2026-11-18T12:00:00.000Z");
const address = "AA:BB:CC:DD:EE:FF";
let agentId: string;
let printerId: string;

beforeEach(async () => {
  await seedVenue(suite.db);
  const [agent] = await suite.db
    .insert(printAgents)
    .values({ name: "Print agent", tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  agentId = agent!.id;
  printerId = await withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(tx, {
      name: "Receipt",
      transport: "bluetooth",
      localKey: address,
    });
    return printer.id;
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
});
afterEach(() => vi.useRealTimers());

const queue = (kind: "document" | "drawer" = "document", target = printerId) =>
  withTransaction(suite.db, async (tx) => {
    const job = await enqueuePrintJob(tx, target, new Uint8Array([1]), kind);
    return job.jobId;
  });

const claim = () =>
  withTransaction(suite.db, async (tx) => {
    const jobs = await claimPrintJobs(tx, agentId, { visibleKeys: [address] });
    return jobs.map((job) => job.id);
  });

const report = (jobId: string, status: "done" | "failed") =>
  withTransaction(suite.db, (tx) =>
    reportPrintJob(tx, {
      agentId,
      jobId,
      outcome: status === "done" ? { status } : { status, error: "offline" },
    }),
  );

const state = (id: string) =>
  suite.db.all(sql`select status, attempts, next_attempt_at from print_jobs where id = ${id}`)[0];

async function failFirstAttempt() {
  const id = await queue();
  expect(await claim()).toEqual([id]);
  expect(await report(id, "failed")).toEqual({ updated: true });
  return id;
}

it("waits 5, 15, 30 and 60 seconds between failed attempts and ends after the fifth", async () => {
  const id = await failFirstAttempt();
  let due = start;
  for (const wait of [5_000, 15_000, 30_000, 60_000]) {
    due += wait;
    vi.setSystemTime(due - 1);
    expect(await claim()).toEqual([]);
    vi.setSystemTime(due);
    expect(await claim()).toEqual([id]);
    expect(await report(id, "failed")).toEqual({ updated: true });
  }
  expect(state(id)).toEqual({ status: "failed", attempts: 5, next_attempt_at: null });
  vi.setSystemTime(due + 60_000);
  expect(await claim()).toEqual([]);
});

it("clears the retry time when the job prints", async () => {
  const id = await failFirstAttempt();
  expect(state(id)).toMatchObject({ next_attempt_at: new Date(start + 5_000).toISOString() });
  vi.setSystemTime(start + 5_000);
  expect(await claim()).toEqual([id]);
  expect(await report(id, "done")).toEqual({ updated: true });
  expect(state(id)).toEqual({ status: "done", attempts: 1, next_attempt_at: null });
});

it("treats a retry stamped more than 60 seconds ahead as due after a backward clock step", async () => {
  const id = await failFirstAttempt();
  vi.setSystemTime(start - 55_000);
  expect(await claim()).toEqual([]);
  vi.setSystemTime(start - 55_001);
  expect(await claim()).toEqual([id]);
});

it("ends a waiting retry when its printer is unpaired", async () => {
  const id = await failFirstAttempt();
  expect(await claim()).toEqual([]);
  expect(
    await withTransaction(suite.db, (tx) => endUnpairedPrinterJobs(tx, agentId, [address])),
  ).toEqual([id]);
  expect(state(id)).toEqual({ status: "failed", attempts: 5, next_attempt_at: null });
  vi.setSystemTime(start + 5_000);
  expect(await claim()).toEqual([]);
});

it("clears a waiting retry when its document is moved to another printer", async () => {
  const id = await failFirstAttempt();
  expect(await withTransaction(suite.db, (tx) => endMovedPrintJob(tx, id))).toBe(true);
  expect(state(id)).toEqual({ status: "failed", attempts: 5, next_attempt_at: null });
});

it("clears a waiting retry when its printer is deleted", async () => {
  const id = await failFirstAttempt();
  expect(await withTransaction(suite.db, (tx) => endDeletedPrinterJobs(tx, printerId))).toEqual([
    id,
  ]);
  expect(state(id)).toEqual({ status: "failed", attempts: 5, next_attempt_at: null });
});

it("holds later documents on the same printer while drawers and other printers continue", async () => {
  const id = await failFirstAttempt();
  const otherPrinter = await withTransaction(suite.db, (tx) =>
    createPrinter(tx, { name: "Kitchen", transport: "network_tcp", host: "192.0.2.12" }),
  );
  const later = await queue();
  const drawer = await queue("drawer");
  const other = await queue("document", otherPrinter.id);
  expect(await claim()).toEqual([other]);
  expect(await report(other, "done")).toEqual({ updated: true });
  expect(await claim()).toEqual([drawer]);
  expect(await report(drawer, "done")).toEqual({ updated: true });
  expect(await claim()).toEqual([]);
  vi.setSystemTime(start + 5_000);
  expect(await claim()).toEqual([id]);
  expect(await report(id, "done")).toEqual({ updated: true });
  expect(await claim()).toEqual([later]);
});

async function failRemainingAttempts(id: string) {
  for (const wait of [5_000, 15_000, 30_000, 60_000]) {
    expect(await claim()).toEqual([]);
    vi.advanceTimersByTime(wait);
    expect(await claim()).toEqual([id]);
    expect(await report(id, "failed")).toEqual({ updated: true });
  }
}

async function freshRound() {
  const givenUp = await failFirstAttempt();
  await failRemainingAttempts(givenUp);
  return async () => {
    vi.advanceTimersByTime(1);
    return withTransaction(suite.db, async (tx) => (await resendPrintJob(tx, givenUp)).jobId);
  };
}

it("prints a kitchen ticket queued before a fresh round's receipt without waiting", async () => {
  const startRound = await freshRound();
  const kitchen = await queue();
  const round = await startRound();
  expect(await claim()).toEqual([kitchen]);
  expect(await report(kitchen, "done")).toEqual({ updated: true });
  expect(await claim()).toEqual([round]);
});

it("holds a kitchen ticket queued during a fresh round only while the round retries", async () => {
  const round = await (await freshRound())();
  expect(await claim()).toEqual([round]);
  expect(await report(round, "failed")).toEqual({ updated: true });
  const kitchen = await queue();
  await failRemainingAttempts(round);
  expect(await claim()).toEqual([kitchen]);
});
