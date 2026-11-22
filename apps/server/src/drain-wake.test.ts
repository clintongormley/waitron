import { expect, it, onTestFinished, vi } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { DEFAULT_SKIP_RETRY_MS, VerifactuBackend, drain } from "@waitron/fiscal-verifactu";
import { seedTaxpayerWithSif } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { drainJob } from "./fiscal-jobs.js";
import { createHealthState } from "./health.js";
import { createJobRunner } from "./job-runner.js";
import { fakeTimerDelay } from "./testing/fake-timer-delay.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const START = new Date("2026-07-21T12:00:00.000Z");

async function filingBox() {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  const db = suite.db;
  const { nodeId, seriesId } = await seedTaxpayerWithSif(db);
  const clock = {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date() }),
  };
  const backend = new VerifactuBackend({ deploymentEnvironment: "production", clock, db });
  const aeat = createFakeAeat({ serverNow: START, tiempoEsperaInicial: 60 }).client();
  const submitted: { at: number; records: number }[] = [];
  const client = {
    ...aeat,
    async submit(...args: Parameters<typeof aeat.submit>) {
      submitted.push({ at: Date.now() - START.getTime(), records: args[1].length });
      return aeat.submit(...args);
    },
  };
  const log = () => {};
  const runner = createJobRunner({
    now: () => new Date(),
    monotonicMs: Date.now,
    delay: fakeTimerDelay,
    log,
  });
  onTestFinished(async () => {
    await runner.stopJobs();
    vi.useRealTimers();
  });
  runner.add(
    drainJob({
      getRole: () => "primary",
      drain: (now, signal) =>
        drain(
          {
            db,
            environment: "production",
            skipRetryMs: DEFAULT_SKIP_RETRY_MS,
            resolveClient: async () => client,
            signal,
          },
          now,
        ),
      timings: { minTickMs: 5_000, maxTickMs: 3_600_000 },
      health: createHealthState(START),
      awaitingCert: { current: false },
      log,
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  return {
    submitted,
    sell: () =>
      withTransaction(db, (tx) => recordSale(tx, backend, saleInput({ nodeId, seriesId, clock }))),
  };
}

it("200 sales in a minute send at most once while the fiscal service's wait runs", async () => {
  const box = await filingBox();
  for (let sale = 0; sale < 200; sale++) {
    await box.sell();
    await vi.advanceTimersByTimeAsync(300);
  }
  expect(box.submitted).toEqual([{ at: 5_000, records: 17 }]);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(box.submitted).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(box.submitted).toEqual([
    { at: 5_000, records: 17 },
    { at: 65_000, records: 183 },
  ]);
});

it("a sale after the fiscal service's wait has passed wakes a sleeping drain immediately", async () => {
  const box = await filingBox();
  await box.sell();
  await vi.advanceTimersByTimeAsync(70_000);
  expect(box.submitted).toEqual([{ at: 5_000, records: 1 }]);
  await box.sell();
  await vi.advanceTimersByTimeAsync(0);
  expect(box.submitted).toEqual([
    { at: 5_000, records: 1 },
    { at: 70_000, records: 1 },
  ]);
});
