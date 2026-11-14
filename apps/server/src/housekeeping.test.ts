import { setImmediate as turn } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, printJobs, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createPrinter } from "@waitron/printing";
import { clearOldPrintPayloads, housekeepingJob } from "./housekeeping.js";
import { createJobRunner } from "./job-runner.js";
import { fakeTimerDelay } from "./testing/fake-timer-delay.js";
import { printJobInTrouble } from "./print-job-trouble.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const now = new Date("2026-11-14T04:00:00.000Z");
const old = "2026-11-01T04:00:00.000Z";
async function printer() {
  return withTransaction(suite.db, (tx) =>
    createPrinter(tx, {
      name: "Kitchen",
      transport: "network_tcp",
      host: "printer.test",
    }),
  );
}
async function job(printerId: string, patch: Partial<typeof printJobs.$inferInsert> = {}) {
  return (
    await suite.db
      .insert(printJobs)
      .values({
        printerId,
        payload: new Uint8Array([27, 64, 1]),
        status: "done",
        createdAt: old,
        ...patch,
      })
      .returning()
  )[0]!;
}
const lengths = () =>
  suite.db.all<{ size: number; storage: string }>(
    sql`select length(payload) size, typeof(payload) storage from print_jobs order by rowid`,
  );

describe("print payload housekeeping", () => {
  it("empties only old terminal jobs and stores an empty blob without changing their history", async () => {
    const p = await printer();
    const cases = [
      [{ status: "done" }, 0],
      [{ status: "done", createdAt: "2026-11-07T04:00:00.000Z" }, 3],
      [{ status: "done", createdAt: "2026-11-07T03:59:59.999Z" }, 0],
      [{ status: "done", createdAt: "2026-11-13T04:00:00.000Z" }, 3],
      [{ status: "queued" }, 3],
      [{ status: "printing" }, 3],
      [{ status: "failed", attempts: 4 }, 3],
      [{ status: "failed", attempts: 5 }, 3],
      [{ status: "failed", attempts: 5, lastError: "print_job.moved" }, 3],
      [{ status: "failed", attempts: 5, lastError: "printer.unpaired" }, 3],
      [{ status: "failed", attempts: 5, lastError: "printer.deleted" }, 0],
      [{ status: "failed", kind: "drawer", attempts: 1 }, 0],
    ] as const;
    for (const [patch] of cases) await job(p.id, patch);
    const before = await suite.db.select().from(printJobs);
    expect(await clearOldPrintPayloads(suite.db, now, new AbortController().signal)).toBe(4);
    expect(lengths()).toEqual(cases.map(([, want]) => ({ size: want, storage: "blob" })));
    const after = await suite.db.select().from(printJobs);
    expect(after.map((row) => ({ ...row, payload: null }))).toEqual(
      before.map((row) => ({ ...row, payload: null })),
    );
    expect(await clearOldPrintPayloads(suite.db, now, new AbortController().signal)).toBe(0);
  });

  it("keeps a retryable original even when its replacement has printed, and retains resend links", async () => {
    const p = await printer();
    const ended = await job(p.id, { status: "failed", attempts: 5 });
    const retryable = await job(p.id, { status: "failed", attempts: 1 });
    await job(p.id, { resendOf: ended.id });
    await job(p.id, { resendOf: retryable.id });
    const trouble = () =>
      suite.db.all(sql`select id from print_jobs where ${printJobInTrouble(now)}`);
    const before = trouble();
    expect(await clearOldPrintPayloads(suite.db, now, new AbortController().signal)).toBe(3);
    expect(lengths().map((row) => row.size)).toEqual([0, 3, 0, 0]);
    expect(trouble()).toEqual(before);
    expect((await suite.db.select().from(printJobs)).map((row) => row.resendOf)).toEqual([
      null,
      null,
      ended.id,
      retryable.id,
    ]);
  });

  it("advances beyond ineligible windows and lets a stop run before the next batch", async () => {
    const p = await printer();
    for (const status of ["queued", "queued", "done", "queued", "done"] as const)
      await job(p.id, { status });
    expect(await clearOldPrintPayloads(suite.db, now, new AbortController().signal, 2)).toBe(2);
    expect(lengths().map((row) => row.size)).toEqual([3, 3, 0, 3, 0]);
    await suite.db.delete(printJobs);
    for (let i = 0; i < 4; i++) await job(p.id);
    const controller = new AbortController();
    const stop = turn().then(() => controller.abort());
    expect(await clearOldPrintPayloads(suite.db, now, controller.signal, 2)).toBe(2);
    await stop;
    expect(lengths().map((row) => row.size)).toEqual([0, 0, 3, 3]);
  });

  it("clears old payloads when the box restarts after 04:00 on seven successive days", async () => {
    const p = await printer();
    const sizes: number[] = [];
    for (let day = 0; day < 7; day++) {
      const at = new Date(now.getTime() + day * 86400000 + 3 * 3600000);
      const row = await job(p.id, {
        createdAt: new Date(at.getTime() - 8 * 86400000).toISOString(),
      });
      const duty = housekeepingJob({
        db: suite.db,
        isPrimary: () => true,
        readClock: async () => ({
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
          cutoverChanges: [],
        }),
        jitterSeed: "node",
        now: () => at,
        log: () => {},
        maxWaitMs: 3600000,
      });
      vi.useFakeTimers();
      const runner = createJobRunner({ now: () => at, delay: fakeTimerDelay, log: () => {} });
      try {
        runner.add(duty);
        await vi.advanceTimersByTimeAsync(999);
        expect(
          (await suite.db.select().from(printJobs).where(eq(printJobs.id, row.id)))[0]!.payload
            .byteLength,
        ).toBe(3);
        await vi.advanceTimersByTimeAsync(1);
        sizes.push(
          (await suite.db.select().from(printJobs).where(eq(printJobs.id, row.id)))[0]!.payload
            .byteLength,
        );
      } finally {
        await runner.stopJobs();
        vi.useRealTimers();
      }
    }
    expect(sizes).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("runs catch-up once, then follows 04:00 venue time and the next local day", async () => {
    const p = await printer();
    const row = await job(p.id);
    let at = new Date("2026-11-14T02:00:00.000Z");
    let primary = true;
    const duty = housekeepingJob({
      db: suite.db,
      isPrimary: () => primary,
      readClock: async () => ({
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        cutoverChanges: [],
      }),
      jitterSeed: "node",
      now: () => at,
      log: () => {},
      maxWaitMs: 3600000,
    });
    expect(duty.name).toBe("housekeeping");
    expect(duty.applies()).toBe(true);
    expect((await duty.pass({ now: at, signal: new AbortController().signal })).nextDueAt).toEqual(
      new Date("2026-11-14T03:00:00.000Z"),
    );
    expect(lengths()[0]!.size).toBe(0);
    await suite.db
      .update(printJobs)
      .set({ payload: new Uint8Array([1, 2, 3]) })
      .where(eq(printJobs.id, row.id));
    await duty.pass({ now: at, signal: new AbortController().signal });
    expect(lengths()[0]!.size).toBe(3);
    at = new Date("2026-11-14T03:00:00.000Z");
    expect((await duty.pass({ now: at, signal: new AbortController().signal })).nextDueAt).toEqual(
      new Date("2026-11-15T03:00:00.000Z"),
    );
    expect(lengths()[0]!.size).toBe(0);
    await suite.db
      .update(printJobs)
      .set({ payload: new Uint8Array([1]) })
      .where(eq(printJobs.id, row.id));
    await duty.pass({ now: at, signal: new AbortController().signal });
    expect(lengths()[0]!.size).toBe(1);
    primary = false;
    expect(duty.applies()).toBe(false);
  });
});
