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
  correctedStart,
  nextCheckSeq,
  nextConfirmationSeq,
  openCheck,
  openClockCheck,
} from "./clock-checks.js";
import { confirmClockStop } from "./clock-confirmation.js";
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

function latest(): { id: string } {
  return suite.db.all<{ id: string }>(
    sql`select id from registros_facturacion order by fecha_hora_huso_gen_registro desc, id desc limit 1`,
  )[0]!;
}

function open(ms: number, boot: BootReading = BOOT) {
  return withTransaction(suite.db, (tx) =>
    openClockCheck(tx, { reading: reading(ms), boot, nodeId }),
  );
}

function checks() {
  return suite.db.select().from(clockChecks).orderBy(clockChecks.seq);
}

function confirmations() {
  return suite.db.select().from(clockConfirmations).orderBy(clockConfirmations.seq);
}

function counts() {
  return { checks: count("clock_checks"), confirmations: count("clock_confirmations") };
}

describe("openClockCheck", () => {
  it("opens a behind_chain check holding the reading, the boot, the latest record and the heads", async () => {
    await sale(T - H);
    await sale(T);
    const answer = await open(R);
    const written = await checks();
    expect(written).toEqual([
      {
        id: answer!.id,
        seq: 1,
        nodeId,
        openedAt: new Date(R),
        reason: "behind_chain",
        detail: {
          clockAt: iso(R),
          bootMs: 1_000_000,
          bootId: "boot-1",
          lastRecordAt: iso(T),
          lastRecordId: latest().id,
          heads: { [nodeId]: 2 },
        },
      },
    ]);
    expect(count("clock_confirmations")).toBe(0);
  });

  it("answers the open check again while the heads have not moved, writing nothing", async () => {
    await sale(T);
    const first = await open(R);
    const before = counts();
    const again = await open(R + 15 * S, { ms: 1_015_000, id: "boot-1" });
    expect(again).toEqual(first);
    expect(counts()).toEqual(before);
    expect(before).toEqual({ checks: 1, confirmations: 0 });
  });

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

  it("writes nothing under a covering lift, though the raw comparison is still behind", async () => {
    await sale(T);
    await open(R);
    const witnesses: ClockWitness[] = [
      {
        kind: "device",
        id: "till-1",
        address: "10.0.0.1",
        boxAt: iso(R - 30 * S),
        witnessAt: iso(R - 28 * S),
        uncertaintyMs: 0,
      },
      {
        kind: "device",
        id: "till-2",
        address: "10.0.0.2",
        boxAt: iso(R - 20 * S),
        witnessAt: iso(R - 23 * S),
        uncertaintyMs: 0,
      },
    ];
    const lift = await withTransaction(suite.db, (tx) =>
      confirmClockStop(tx, { reading: reading(R), boot: BOOT, witnesses, nodeId }),
    );
    expect(lift.confirmation).not.toBeNull();
    const before = counts();
    expect(before).toEqual({ checks: 1, confirmations: 1 });
    // Still more than a minute behind T, but covered by the lift.
    expect(await open(R + 10 * M)).toBeNull();
    expect(counts()).toEqual(before);
  });

  it("closes a check whose stop came back after a sale, and opens a new one, in one transaction", async () => {
    await sale(T);
    const old = await open(R);
    // The clock read right again for a while, and a sale went through.
    expect(await sale(T + 2 * M)).toBe("recorded");
    const saleId = latest().id;
    // Then it stepped back again: the stop proper holds, with the heads past the old check's.
    const reopened = await withTransaction(suite.db, async (tx) => {
      const answer = await openClockCheck(tx, {
        reading: reading(R + H),
        boot: { ms: 6_400_000, id: "boot-1" },
        nodeId,
      });
      return { answer, inside: { checks: (await tx.select().from(clockChecks)).length } };
    });
    expect(reopened.inside.checks).toBe(2);
    expect(reopened.answer!.id).not.toBe(old!.id);
    const written = await checks();
    expect(written).toHaveLength(2);
    expect(written[1]).toEqual({
      id: reopened.answer!.id,
      seq: 2,
      nodeId,
      openedAt: new Date(R + H),
      reason: "behind_chain",
      detail: {
        clockAt: iso(R + H),
        bootMs: 6_400_000,
        bootId: "boot-1",
        lastRecordAt: iso(T + 2 * M),
        lastRecordId: saleId,
        heads: { [nodeId]: 2 },
      },
    });
    const closed = await confirmations();
    expect(closed).toEqual([
      {
        id: closed[0]!.id,
        seq: 1,
        nodeId,
        boxClockAt: new Date(R + H),
        confirmedAt: new Date(R + H),
        stepMs: 0,
        source: "elapsed",
        personId: null,
        reason: "behind_chain",
        proof: {
          authority: null,
          devices: [],
          admin: null,
          closing: {
            bootMs: 6_400_000,
            bootId: "boot-1",
            correctedStart: iso(R + H - 5_400_000),
            partial: false,
            unconfirmed: true,
          },
        },
        checkId: old!.id,
        registroId: null,
        recordAt: null,
      },
    ]);
    await expect(withTransaction(suite.db, (tx) => openCheck(tx))).resolves.toMatchObject({
      id: reopened.answer!.id,
    });
  });

  it.each([
    ["cannot be read", "not heads"],
    ["leave out a node that now has records", {}],
  ])(
    "treats a check whose stored heads %s as one the chain has moved past",
    async (_name, heads) => {
      await sale(T);
      await withTransaction(suite.db, async (tx) =>
        tx.insert(clockChecks).values({
          seq: await nextCheckSeq(tx),
          nodeId,
          openedAt: new Date(R),
          reason: "behind_chain",
          detail: { clockAt: iso(R), heads },
        }),
      );
      const answer = await open(R + M);
      expect(counts()).toEqual({ checks: 2, confirmations: 1 });
      const [closing] = await confirmations();
      // No boot reading stored at the opening, so no elapsed time is known.
      expect(closing!.proof).toMatchObject({
        closing: { correctedStart: iso(R + M), partial: true },
      });
      expect((await checks())[1]!.id).toBe(answer!.id);
    },
  );
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
