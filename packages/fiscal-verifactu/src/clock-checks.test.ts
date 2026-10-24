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
          offsetMinutes: 60,
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

  it("control: opens a check a millisecond past a minute behind the latest record", async () => {
    await sale(T);
    expect(counts()).toEqual({ checks: 0, confirmations: 0 });
    expect(await open(T - M - 1)).not.toBeNull();
    expect(counts()).toEqual({ checks: 1, confirmations: 0 });
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
      return {
        answer,
        inside: {
          checks: (await tx.select().from(clockChecks)).length,
          confirmations: (await tx.select().from(clockConfirmations)).length,
        },
      };
    });
    expect(reopened.inside.checks).toBe(2);
    expect(reopened.inside.confirmations).toBe(1);
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
        offsetMinutes: 60,
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

/** The clock right until 10:00, sales every five minutes, then set 30 minutes back by mistake;
 * the stop ends by itself once the wrong clock reaches the last sale. */
const TEN = Date.parse("2026-10-19T10:00:00.000Z");
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

/** Two tills from two addresses, both `differenceMs` from the box (ten seconds apart). */
function pair(ids: [string, string], boxMs: number, differenceMs: number): ClockWitness[] {
  return [
    witness("device", ids[0], boxMs - 10 * S, differenceMs),
    witness("device", ids[1], boxMs, differenceMs + 10 * S),
  ];
}

/** Sales at 9:40 to 10:00 on the right clock, then a check opened when the clock read 9:30. */
async function caseB(): Promise<string> {
  for (let at = TEN - 20 * M; at <= TEN; at += 5 * M) expect(await sale(at)).toBe("recorded");
  return (await open(TEN - WRONG))!.id;
}

/** The closing on the wrong clock at 10:00, half an hour of boot time after the opening. */
const ENDED = TEN;
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

function storedAuthority(w: ClockWitness) {
  return { boxAt: w.boxAt, witnessAt: w.witnessAt, uncertaintyMs: w.uncertaintyMs };
}

function storedDevices(witnesses: readonly ClockWitness[]) {
  return witnesses.map((w) => ({
    deviceId: w.id,
    address: w.address,
    boxAt: w.boxAt,
    witnessAt: w.witnessAt,
  }));
}

/** The one confirmation a waiting check's closing writes, with its answer. */
async function closedWith(
  answer: Awaited<ReturnType<typeof closeByItself>>,
  checkId: string,
  source: "authority" | "devices" | "elapsed",
  proof: { authority: unknown; devices: unknown[] },
  unconfirmed: boolean,
): Promise<void> {
  const written = await confirmations();
  expect(written).toEqual([
    {
      id: answer.confirmation!.id,
      seq: 1,
      nodeId,
      boxClockAt: new Date(ENDED),
      confirmedAt: new Date(ENDED),
      stepMs: 0,
      source,
      personId: null,
      reason: "behind_chain",
      proof: {
        ...proof,
        admin: null,
        closing: {
          bootMs: ENDED_BOOT.ms,
          bootId: "boot-1",
          correctedStart: iso(ENDED - WRONG),
          partial: false,
          unconfirmed,
        },
      },
      checkId,
      registroId: null,
      recordAt: null,
    },
  ]);
  expect(answer).toEqual({
    confirmation: {
      id: written[0]!.id,
      seq: 1,
      source,
      personId: null,
      confirmedAt: iso(ENDED),
      checkId,
      recordId: null,
    },
  });
  expect(await waiting(ENDED)).toBeNull();
  await expect(withTransaction(suite.db, (tx) => openCheck(tx))).resolves.toBeNull();
}

describe("closeClockCheckByItself", () => {
  it("writes nothing while the stop proper still holds, whatever the witnesses", async () => {
    await caseB();
    const at = TEN - 20 * M;
    await closesNothing(at, [aeat(at - 10 * S, 5 * S), ...pair(["till-1", "till-2"], at, 0)]);
    expect(await waiting(at)).toBeNull();
  });

  it("writes nothing under a covering lift, once real time passes the latest record", async () => {
    await sale(T);
    await open(R);
    const lift = await withTransaction(suite.db, (tx) =>
      confirmClockStop(tx, {
        reading: reading(R),
        boot: BOOT,
        witnesses: pair(["till-1", "till-2"], R - 20 * S, 2 * S),
        nodeId,
      }),
    );
    expect(lift.confirmation).not.toBeNull();
    for (const at of [R + 10 * M, T + M]) {
      await closesNothing(at, [aeat(at - 10 * S, 5 * S)]);
      expect(await waiting(at)).toBeNull();
    }
  });

  it("writes nothing on a reading before 28-10-2024", async () => {
    await caseB();
    const at = Date.parse("2024-10-27T12:00:00.000Z");
    await closesNothing(at, [aeat(at - 10 * S, 5 * S)]);
    expect(await waiting(at)).toBeNull();
  });

  it("control: the clock right and AEAT agreeing after the stop ended closes it authority", async () => {
    const checkId = await caseB();
    const agreeing = aeat(ENDED - 10 * S, 5 * S);
    const answer = await closeByItself(ENDED, [agreeing]);
    await closedWith(
      answer,
      checkId,
      "authority",
      { authority: storedAuthority(agreeing), devices: [] },
      false,
    );
  });

  it("with AEAT agreeing and two devices agreeing, attaches the devices", async () => {
    const checkId = await caseB();
    const agreeing = aeat(ENDED - 10 * S, 5 * S);
    const devices = pair(["till-1", "till-2"], ENDED - 5 * S, 2 * S);
    const answer = await closeByItself(ENDED, [agreeing, ...devices]);
    await closedWith(
      answer,
      checkId,
      "authority",
      { authority: storedAuthority(agreeing), devices: storedDevices(devices) },
      false,
    );
  });

  it("with no AEAT witness and two devices from two addresses agreeing, closes it devices", async () => {
    const checkId = await caseB();
    const devices = pair(["till-1", "till-2"], ENDED - 5 * S, 2 * S);
    const answer = await closeByItself(ENDED, devices);
    await closedWith(
      answer,
      checkId,
      "devices",
      { authority: null, devices: storedDevices(devices) },
      false,
    );
  });

  it("control: two devices at one address are one witness, and close nothing", async () => {
    await caseB();
    const devices = pair(["till-1", "till-2"], ENDED - 5 * S, 2 * S).map((w) => ({
      ...w,
      address: "10.0.0.1",
    }));
    await closesNothing(ENDED, devices);
    expect(await waiting(ENDED)).not.toBeNull();
  });

  it("with AEAT agreeing and two devices disagreeing, closes it authority (AEAT first)", async () => {
    const checkId = await caseB();
    const agreeing = aeat(ENDED - 10 * S, 5 * S);
    const answer = await closeByItself(ENDED, [
      agreeing,
      ...pair(["till-3", "till-4"], ENDED - 5 * S, WRONG),
    ]);
    await closedWith(
      answer,
      checkId,
      "authority",
      { authority: storedAuthority(agreeing), devices: [] },
      false,
    );
  });

  it("(i) with AEAT disagreeing after the stop ended, closes it elapsed and unconfirmed", async () => {
    const checkId = await caseB();
    const answer = await closeByItself(ENDED, [aeat(ENDED - 10 * S, WRONG)]);
    await closedWith(answer, checkId, "elapsed", { authority: null, devices: [] }, true);
  });

  it("with AEAT both disagreeing and then agreeing after the stop ended, closes it elapsed", async () => {
    const checkId = await caseB();
    const answer = await closeByItself(ENDED, [
      aeat(ENDED - 20 * S, WRONG),
      aeat(ENDED - 10 * S, 5 * S),
    ]);
    await closedWith(answer, checkId, "elapsed", { authority: null, devices: [] }, true);
  });

  it("counts AEAT's witness taken exactly a minute before the latest record as after the stop", async () => {
    const checkId = await caseB();
    const agreeing = aeat(TEN - M, 5 * S);
    const answer = await closeByItself(ENDED, [agreeing]);
    await closedWith(
      answer,
      checkId,
      "authority",
      { authority: storedAuthority(agreeing), devices: [] },
      false,
    );
  });

  it("control: AEAT's witness a millisecond earlier was taken during the stop, and closes nothing", async () => {
    await caseB();
    await closesNothing(ENDED, [aeat(TEN - M - 1, 5 * S)]);
    expect(await waiting(ENDED)).not.toBeNull();
  });

  it("(ii) with two devices from two addresses disagreeing and no AEAT, closes it elapsed", async () => {
    const checkId = await caseB();
    const answer = await closeByItself(ENDED, pair(["till-3", "till-4"], ENDED - 5 * S, WRONG));
    await closedWith(answer, checkId, "elapsed", { authority: null, devices: [] }, true);
  });

  it("with a disagreeing device group beside an agreeing one and no AEAT, closes it elapsed", async () => {
    const checkId = await caseB();
    const answer = await closeByItself(ENDED, [
      ...pair(["till-1", "till-2"], ENDED - 5 * S, 2 * S),
      ...pair(["till-3", "till-4"], ENDED - 5 * S, WRONG),
    ]);
    await closedWith(answer, checkId, "elapsed", { authority: null, devices: [] }, true);
  });

  it("control: a lone disagreeing device closes nothing", async () => {
    await caseB();
    await closesNothing(ENDED, [witness("device", "till-3", ENDED - 5 * S, WRONG)]);
  });

  it("(iii) with no fresh witness, writes nothing and the check waits", async () => {
    const checkId = await caseB();
    await closesNothing(ENDED, []);
    expect(await waiting(ENDED)).toEqual({ checkId, openedAt: iso(TEN - WRONG) });
  });

  it("(iv) an AEAT disagreement kept from during the stop decides nothing", async () => {
    const checkId = await caseB();
    // Taken while the box read 9:45, more than a minute behind the 10:00 sale.
    const kept = aeat(TEN - 15 * M, WRONG);
    await closesNothing(ENDED, [kept]);
    expect(await waiting(ENDED)).toEqual({ checkId, openedAt: iso(TEN - WRONG) });
  });

  it("(iv) beside an AEAT witness taken after the stop ended that agrees, closes it authority", async () => {
    const checkId = await caseB();
    const agreeing = aeat(ENDED - 10 * S, 5 * S);
    const answer = await closeByItself(ENDED, [aeat(TEN - 15 * M, WRONG), agreeing]);
    await closedWith(
      answer,
      checkId,
      "authority",
      { authority: storedAuthority(agreeing), devices: [] },
      false,
    );
  });

  it("an AEAT reading too uncertain to decide neither closes it nor blocks the devices", async () => {
    const checkId = await caseB();
    const uncertain = aeat(ENDED - 10 * S, 90 * S, 40 * S);
    await closesNothing(ENDED, [uncertain]);
    const devices = pair(["till-1", "till-2"], ENDED - 5 * S, 2 * S);
    const answer = await closeByItself(ENDED, [uncertain, ...devices]);
    await closedWith(
      answer,
      checkId,
      "devices",
      { authority: null, devices: storedDevices(devices) },
      false,
    );
  });
});

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

  it("answers null while the stop proper holds, and the check once the stop has ended", async () => {
    const checkId = await caseB();
    expect(await waiting(TEN - 20 * M)).toBeNull();
    expect(await waiting(TEN - M)).toEqual({ checkId, openedAt: iso(TEN - WRONG) });
  });
});
