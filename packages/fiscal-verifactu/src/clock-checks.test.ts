import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BootReading, ClockWitness, TrustedClock } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import {
  closeClockCheckByItself,
  correctedStart,
  nextCheckSeq,
  nextConfirmationSeq,
  openCheck,
  openClockCheck,
  waitingClockCheck,
} from "./clock-checks.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 14.5 * H;
const BOOT: BootReading = { ms: 1_000_000, id: "boot-1" };

let backend: VerifactuBackend;
let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  ({ nodeId, seriesId } = await seedTenantWithSif(suite.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function reading(ms: number) {
  return { instant: new Date(ms), offsetMinutes: 60 };
}

function clockAt(ms: number): TrustedClock {
  return {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(ms), offsetMinutes: 60 }),
  };
}

function count(table: string): number {
  return suite.db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(table)}`)[0]!.n;
}

async function sale(ms: number): Promise<string> {
  try {
    await withTransaction(suite.db, (tx) =>
      recordSale(tx, backend, saleInput({ nodeId, seriesId, clock: clockAt(ms) })),
    );
    return "recorded";
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return error.code;
  }
}

function open(ms: number, boot: BootReading = BOOT) {
  return withTransaction(suite.db, (tx) =>
    openClockCheck(tx, { reading: reading(ms), boot, nodeId }),
  );
}

function counts() {
  return { checks: count("clock_checks"), confirmations: count("clock_confirmations") };
}

describe("openClockCheck", () => {
  it("writes nothing while the clock is not behind the latest record", async () => {
    await sale(T);
    const before = counts();
    expect(await open(T - M)).toBeNull();
    expect(counts()).toEqual(before);
  });

  it("writes nothing with no record at all", async () => {
    expect(await open(R)).toBeNull();
    expect(counts()).toEqual({ checks: 0, confirmations: 0 });
  });

  it("writes nothing on a reading before 28-10-2024", async () => {
    await sale(T);
    expect(await open(Date.parse("2024-10-27T12:00:00.000Z"))).toBeNull();
    expect(counts()).toEqual({ checks: 0, confirmations: 0 });
  });
});

describe("openCheck", () => {
  it("finds nothing open when a newer closed check sits above an older open one", async () => {
    await sale(T);
    await withTransaction(suite.db, async (tx) => {
      for (const ms of [R, R + M]) {
        await tx.insert(clockChecks).values({
          seq: await nextCheckSeq(tx),
          nodeId,
          openedAt: new Date(ms),
          reason: "behind_chain",
          detail: { clockAt: iso(ms), heads: {} },
        });
      }
      const [newer] = await tx
        .select()
        .from(clockChecks)
        .where(sql`seq = 2`);
      await tx.insert(clockConfirmations).values({
        seq: await nextConfirmationSeq(tx),
        nodeId,
        boxClockAt: new Date(R + 2 * M),
        confirmedAt: new Date(R + 2 * M),
        stepMs: 0,
        source: "elapsed",
        reason: "behind_chain",
        proof: {},
        checkId: newer!.id,
      });
    });
    await expect(withTransaction(suite.db, (tx) => openCheck(tx))).resolves.toBeNull();
  });
});

describe("correctedStart", () => {
  const ELEVEN_THIRTY = Date.parse("2026-10-19T11:30:00.000Z");
  const opened = { detail: { bootMs: 1_000_000, bootId: "boot-1" } };

  it("takes the boot-time clock's elapsed time off the closing's time on the same boot", () => {
    expect(
      correctedStart(opened, {
        confirmedAt: new Date(ELEVEN_THIRTY),
        bootMs: 6_400_000,
        bootId: "boot-1",
      }),
    ).toEqual({ correctedStart: "2026-10-19T10:00:00.000Z", partial: false });
  });

  it.each([
    ["a different boot", { bootMs: 6_400_000, bootId: "boot-2" }, opened],
    ["no boot id at the closing", { bootMs: 6_400_000, bootId: null }, opened],
    [
      "no boot id at either end",
      { bootMs: 6_400_000, bootId: null },
      { detail: { bootMs: 1_000_000, bootId: null } },
    ],
    ["a boot clock that went backwards", { bootMs: 999_999, bootId: "boot-1" }, opened],
    ["an unreadable closing boot reading", { bootMs: Number.NaN, bootId: "boot-1" }, opened],
    [
      "an unreadable opening boot reading",
      { bootMs: 6_400_000, bootId: "boot-1" },
      { detail: { bootMs: "x", bootId: "boot-1" } },
    ],
    ["an opening with no detail", { bootMs: 6_400_000, bootId: "boot-1" }, { detail: null }],
  ])("falls back to the closing's time, partial, for %s", (_name, closing, check) => {
    expect(correctedStart(check, { confirmedAt: new Date(ELEVEN_THIRTY), ...closing })).toEqual({
      correctedStart: iso(ELEVEN_THIRTY),
      partial: true,
    });
  });
});
const WRONG = 30 * M;

function witness(
  kind: "authority" | "device",
  id: string,
  boxMs: number,
  differenceMs: number,
  uncertaintyMs = 0,
): ClockWitness {
  return {
    kind,
    id,
    ...(kind === "device" ? { address: `10.0.0.${id.slice(-1)}` } : {}),
    boxAt: iso(boxMs),
    witnessAt: iso(boxMs + differenceMs),
    uncertaintyMs,
  };
}

function aeat(boxMs: number, differenceMs: number, uncertaintyMs = 500): ClockWitness {
  return witness("authority", "authority", boxMs, differenceMs, uncertaintyMs);
}
const ENDED_BOOT: BootReading = { ms: BOOT.ms + WRONG, id: "boot-1" };

function closeByItself(ms: number, witnesses: readonly ClockWitness[], boot = ENDED_BOOT) {
  return withTransaction(suite.db, (tx) =>
    closeClockCheckByItself(tx, { reading: reading(ms), boot, witnesses, nodeId }),
  );
}

function waiting(ms: number) {
  return withTransaction(suite.db, (tx) => waitingClockCheck(tx, reading(ms)));
}

async function closesNothing(ms: number, witnesses: readonly ClockWitness[]): Promise<void> {
  const before = counts();
  expect(await closeByItself(ms, witnesses)).toEqual({ confirmation: null });
  expect(counts()).toEqual(before);
}

describe("waitingClockCheck", () => {
  it("answers null when no check is open", async () => {
    await sale(T);
    expect(await waiting(T)).toBeNull();
  });

  it("answers null for an open check with no record at all, and nothing closes it", async () => {
    await withTransaction(suite.db, async (tx) =>
      tx.insert(clockChecks).values({
        seq: await nextCheckSeq(tx),
        nodeId,
        openedAt: new Date(R),
        reason: "behind_chain",
        detail: { clockAt: iso(R), heads: {} },
      }),
    );
    expect(await waiting(T)).toBeNull();
    await closesNothing(T, [aeat(T - 10 * S, 5 * S)]);
  });
});
