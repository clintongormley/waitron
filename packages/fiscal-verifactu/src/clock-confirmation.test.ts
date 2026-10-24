import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { ClockWitness, TrustedClock } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { nextCheckSeq } from "./clock-checks.js";
import { clockStopState, confirmClockStop } from "./clock-confirmation.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
const DAY = 24 * H;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 14.5 * H;
const BOOT = { ms: 5 * M, id: null };

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

async function sale(ms: number, on = { nodeId, seriesId }): Promise<string> {
  try {
    await withTransaction(suite.db, (tx) =>
      recordSale(tx, backend, saleInput({ ...on, clock: clockAt(ms) })),
    );
    return "recorded";
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return error.code;
  }
}

function device(id: string, boxMs: number, differenceMs: number, address: string): ClockWitness {
  return {
    kind: "device",
    id,
    address,
    boxAt: iso(boxMs),
    witnessAt: iso(boxMs + differenceMs),
    uncertaintyMs: 0,
  };
}

function authority(boxMs: number, differenceMs: number, uncertaintyMs: number): ClockWitness {
  return {
    kind: "authority",
    id: "authority",
    boxAt: iso(boxMs),
    witnessAt: iso(boxMs + differenceMs),
    uncertaintyMs,
  };
}

/** Two tills from two addresses agreeing with the box, taken half a minute before the reading `at`. */
function twoDevices(at: number): ClockWitness[] {
  return [
    device("till-1", at - 30 * S, 2 * S, "10.0.0.1"),
    device("till-2", at - 20 * S, -3 * S, "10.0.0.2"),
  ];
}

/** Two tills from two addresses agreeing with each other that the box is two hours behind. */
function twoDevicesAgainst(at: number): ClockWitness[] {
  return [
    device("till-3", at - M, 2 * H, "10.0.0.3"),
    device("till-4", at - M, 2 * H + 10 * S, "10.0.0.4"),
  ];
}

function storedDevices(witnesses: readonly ClockWitness[]) {
  return witnesses.map((witness) => ({
    deviceId: witness.id,
    address: witness.address,
    boxAt: witness.boxAt,
    witnessAt: witness.witnessAt,
  }));
}

function latestId(): string {
  return suite.db.all<{ id: string }>(
    sql`select id from registros_facturacion order by fecha_hora_huso_gen_registro desc, id desc limit 1`,
  )[0]!.id;
}

function headsNow(): Record<string, number> {
  return Object.fromEntries(
    suite.db
      .all<{
        node: string;
        head: number;
      }>(
        sql`select node_id as node, max(secuencia) as head from registros_facturacion group by node_id`,
      )
      .map((row) => [row.node, row.head]),
  );
}

/** A `behind_chain` check opened at `ms`, as the clock watch opens one. */
function openCheck(ms: number): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const [row] = await tx
      .insert(clockChecks)
      .values({
        seq: await nextCheckSeq(tx),
        nodeId,
        openedAt: new Date(ms),
        reason: "behind_chain",
        detail: { clockAt: iso(ms), heads: headsNow() },
      })
      .returning({ id: clockChecks.id });
    return row!.id;
  });
}

function stateAt(ms: number, witnesses: readonly ClockWitness[]) {
  return withTransaction(suite.db, (tx) => clockStopState(tx, reading(ms), witnesses));
}

function confirm(ms: number, witnesses: readonly ClockWitness[]) {
  return withTransaction(suite.db, (tx) =>
    confirmClockStop(tx, { reading: reading(ms), boot: BOOT, witnesses, nodeId }),
  );
}

/** The automatic confirmation at `ms`, after checking it answered nothing and wrote no row. */
async function confirmsNothing(ms: number, witnesses: readonly ClockWitness[]): Promise<void> {
  const before = count("clock_confirmations");
  expect(await confirm(ms, witnesses)).toEqual({ confirmation: null });
  expect(count("clock_confirmations")).toBe(before);
}

function rows() {
  return suite.db.select().from(clockConfirmations).orderBy(clockConfirmations.seq);
}

describe("no witness", () => {
  it("shows the stop with no proof, and confirms nothing", async () => {
    await sale(T);
    expect(await stateAt(R, [])).toEqual({
      clockAt: iso(R),
      offsetMinutes: 60,
      lastRecordAt: iso(T),
      lastRecordOffsetMinutes: 60,
      recordId: latestId(),
      gapMs: 14.5 * H,
      proof: "none",
      agreeing: { authority: null, devices: [] },
      contrary: { authority: null, devices: [] },
      confirmation: null,
    });
    await confirmsNothing(R, []);
    expect(await sale(R)).toBe("clock.behind_chain");
  });
});

describe("two agreeing devices from two addresses", () => {
  it("are ready, write one confirmation closing the open check, and lift the stop", async () => {
    await sale(T - H);
    await sale(T);
    const checkId = await openCheck(R);
    const witnesses = twoDevices(R);
    expect(await stateAt(R, witnesses)).toEqual({
      clockAt: iso(R),
      offsetMinutes: 60,
      lastRecordAt: iso(T),
      lastRecordOffsetMinutes: 60,
      recordId: latestId(),
      gapMs: 14.5 * H,
      proof: "ready",
      agreeing: { authority: null, devices: witnesses },
      contrary: { authority: null, devices: [] },
      confirmation: null,
    });
    const heads = headsNow();
    expect(heads).toEqual({ [nodeId]: 2 });

    const answer = await confirm(R, witnesses);
    const written = await rows();
    expect(written).toEqual([
      {
        id: answer.confirmation!.id,
        seq: 1,
        nodeId,
        boxClockAt: new Date(R),
        confirmedAt: new Date(R),
        stepMs: 0,
        source: "devices",
        personId: null,
        reason: "behind_chain",
        proof: {
          authority: null,
          devices: storedDevices(witnesses),
          admin: null,
          heads,
          // No boot id, so the stop's start is not known.
          closing: {
            bootMs: BOOT.ms,
            bootId: null,
            correctedStart: iso(R),
            partial: true,
            unconfirmed: false,
          },
        },
        checkId,
        registroId: latestId(),
        recordAt: new Date(T),
      },
    ]);
    expect(answer).toEqual({
      confirmation: {
        id: written[0]!.id,
        seq: 1,
        source: "devices",
        personId: null,
        confirmedAt: iso(R),
        checkId,
        recordId: latestId(),
      },
    });
    expect(await sale(R)).toBe("recorded");
    const after = await stateAt(R, witnesses);
    expect(after!.proof).toBe("confirmed");
    expect(after!.confirmation).toEqual({
      id: written[0]!.id,
      source: "devices",
      personId: null,
      confirmedAt: iso(R),
    });
    await confirmsNothing(R, witnesses);
  });

  it("over a restored database, keep the older chain's record in the heads", async () => {
    const older = await seedTenantWithSif(suite.db);
    await sale(T, older);
    await confirm(R, twoDevices(R));
    const [row] = await rows();
    expect((row!.proof as { heads: object }).heads).toEqual({ [older.nodeId]: 1 });
    expect(await sale(R)).toBe("recorded");
    expect(await sale(R - 30 * M)).toBe("clock.behind_chain");
  });
});

describe("agreeing devices must also agree with each other", () => {
  it("one a minute behind the box and one a minute ahead are no proof, and write nothing", async () => {
    await sale(T);
    const witnesses = [
      device("till-1", R - 30 * S, -M, "10.0.0.1"),
      device("till-2", R - 20 * S, M, "10.0.0.2"),
    ];
    const state = await stateAt(R, witnesses);
    expect(state!.proof).toBe("none");
    expect(state!.agreeing).toEqual({ authority: null, devices: [] });
    await confirmsNothing(R, witnesses);
    expect(await sale(R)).toBe("clock.behind_chain");
  });

  it("control: half a minute behind and half a minute ahead are proof", async () => {
    await sale(T);
    const witnesses = [
      device("till-1", R - 30 * S, -30 * S, "10.0.0.1"),
      device("till-2", R - 20 * S, 30 * S, "10.0.0.2"),
    ];
    expect((await stateAt(R, witnesses))!.proof).toBe("ready");
    expect((await confirm(R, witnesses)).confirmation!.source).toBe("devices");
    expect(await sale(R)).toBe("recorded");
  });

  it("of three at a minute behind, level and a minute ahead, two that agree are the proof", async () => {
    await sale(T);
    const behind = device("till-1", R - 40 * S, -M, "10.0.0.1");
    const level = device("till-2", R - 30 * S, 0, "10.0.0.2");
    const ahead = device("till-3", R - 20 * S, M, "10.0.0.3");
    const witnesses = [behind, level, ahead];
    const state = await stateAt(R, witnesses);
    expect(state!.proof).toBe("ready");
    expect(state!.agreeing.devices).toEqual([level, ahead]);
    await confirm(R, witnesses);
    const [row] = await rows();
    expect((row!.proof as { devices: unknown }).devices).toEqual(storedDevices([level, ahead]));
  });
});

describe("devices at one address", () => {
  it("the same two device ids from one address are not proof", async () => {
    await sale(T);
    const witnesses = [
      device("till-1", R - 30 * S, 2 * S, "10.0.0.1"),
      device("till-2", R - 20 * S, -3 * S, "10.0.0.1"),
    ];
    expect((await stateAt(R, witnesses))!.proof).toBe("none");
    await confirmsNothing(R, witnesses);
    expect(await sale(R)).toBe("clock.behind_chain");
  });
});

describe("AEAT's time", () => {
  it("agreeing, beside two devices that disagree, confirms with source authority", async () => {
    await sale(T);
    const aeat = authority(R - M, 10 * S, 500);
    const against = twoDevicesAgainst(R);
    const state = await stateAt(R, [aeat, ...against]);
    expect(state!.proof).toBe("ready");
    expect(state!.agreeing).toEqual({ authority: aeat, devices: [] });
    expect(state!.contrary).toEqual({ authority: null, devices: against });
    const answer = await confirm(R, [aeat, ...against]);
    expect(answer.confirmation!.source).toBe("authority");
    const [row] = await rows();
    expect(row!.source).toBe("authority");
    expect(row!.proof).toMatchObject({
      authority: { boxAt: aeat.boxAt, witnessAt: aeat.witnessAt, uncertaintyMs: 500 },
      devices: [],
    });
    expect(await sale(R)).toBe("recorded");
  });

  it("agreeing, with two agreeing devices, keeps the devices beside it", async () => {
    await sale(T);
    const aeat = authority(R - M, 10 * S, 500);
    const witnesses = [aeat, ...twoDevices(R)];
    expect((await stateAt(R, witnesses))!.agreeing).toEqual({
      authority: aeat,
      devices: twoDevices(R),
    });
    await confirm(R, witnesses);
    const [row] = await rows();
    expect(row!.source).toBe("authority");
    expect((row!.proof as { devices: unknown }).devices).toEqual(storedDevices(twoDevices(R)));
  });

  it("disagreeing ten minutes ago, beside two agreeing devices, is contrary and writes nothing", async () => {
    await sale(T);
    const aeat = authority(R - 10 * M, 2 * H, 500);
    const witnesses = [...twoDevices(R), aeat];
    const state = await stateAt(R, witnesses);
    expect(state!.proof).toBe("contrary");
    expect(state!.contrary).toEqual({ authority: aeat, devices: [] });
    await confirmsNothing(R, witnesses);
    expect(await sale(R)).toBe("clock.behind_chain");
  });

  it("too uncertain to agree or disagree, is no witness: two agreeing devices still confirm", async () => {
    await sale(T);
    const vague = authority(R - M, 90 * S, 40 * S);
    const witnesses = [vague, ...twoDevices(R)];
    const state = await stateAt(R, witnesses);
    expect(state!.proof).toBe("ready");
    expect(state!.agreeing).toEqual({ authority: null, devices: twoDevices(R) });
    expect(state!.contrary).toEqual({ authority: null, devices: [] });
    expect((await confirm(R, witnesses)).confirmation!.source).toBe("devices");
    expect(await sale(R)).toBe("recorded");
  });

  it("an unreadable boxAt on a disagreement counts neither way", async () => {
    await sale(T);
    const witnesses = [...twoDevices(R), { ...authority(R - M, 2 * H, 500), boxAt: "garbage" }];
    expect((await stateAt(R, witnesses))!.proof).toBe("ready");
  });
});

describe("devices that disagree", () => {
  it("a group from two addresses, with no AEAT reading, is contrary and writes nothing", async () => {
    await sale(T);
    const against = twoDevicesAgainst(R);
    const witnesses = [...twoDevices(R), ...against];
    const state = await stateAt(R, witnesses);
    expect(state!.proof).toBe("contrary");
    expect(state!.contrary).toEqual({ authority: null, devices: against });
    await confirmsNothing(R, witnesses);
  });

  it("control: a lone device that disagrees is no contrary proof", async () => {
    await sale(T);
    const witnesses = [...twoDevices(R), device("till-3", R - M, 2 * H, "10.0.0.3")];
    expect((await stateAt(R, witnesses))!.proof).toBe("ready");
    expect((await confirm(R, witnesses)).confirmation!.source).toBe("devices");
  });
});

describe("how far back", () => {
  it("a 400-day gap with proof is confirmed: there is no cap", async () => {
    await sale(T);
    const at = T - 400 * DAY;
    expect((await stateAt(at, twoDevices(at)))!.proof).toBe("ready");
    expect((await confirm(at, twoDevices(at))).confirmation!.source).toBe("devices");
    expect(await sale(at)).toBe("recorded");
  });
});

describe("witnesses taken before the stop", () => {
  it("do not count when taken within a minute of the latest record", async () => {
    await sale(T);
    const witnesses = [
      device("till-1", T - 30 * S, 2 * S, "10.0.0.1"),
      device("till-2", T - M, 2 * S, "10.0.0.2"),
    ];
    expect((await stateAt(R, witnesses))!.proof).toBe("none");
    await confirmsNothing(R, witnesses);
  });

  it("count from just over a minute before the latest record", async () => {
    await sale(T);
    const at = T - M - 1;
    const witnesses = [
      device("till-1", at, 2 * S, "10.0.0.1"),
      device("till-2", at, 2 * S, "10.0.0.2"),
    ];
    expect((await stateAt(at, witnesses))!.proof).toBe("ready");
  });

  it("an AEAT disagreement taken before the stop is no contrary proof", async () => {
    await sale(T);
    const witnesses = [...twoDevices(R), authority(T - 30 * S, 2 * H, 500)];
    expect((await stateAt(R, witnesses))!.proof).toBe("ready");
  });

  it("two disagreeing devices taken before the stop are no contrary proof", async () => {
    await sale(T);
    const before = [
      device("till-3", T - 30 * S, 2 * H, "10.0.0.3"),
      device("till-4", T - 30 * S, 2 * H, "10.0.0.4"),
    ];
    const state = await stateAt(R, [...twoDevices(R), ...before]);
    expect(state!.proof).toBe("ready");
    expect(state!.contrary).toEqual({ authority: null, devices: [] });
  });
});

describe("witnesses taken after the reading", () => {
  it("are no proof: the box's clock may have stepped back since", async () => {
    await sale(T);
    const witnesses = [
      device("till-1", R + 30 * S, 2 * S, "10.0.0.1"),
      device("till-2", R + S, 2 * S, "10.0.0.2"),
    ];
    expect((await stateAt(R, witnesses))!.proof).toBe("none");
    await confirmsNothing(R, witnesses);
    await confirmsNothing(R, [authority(R + S, 0, 500)]);
  });

  it("control: taken at the reading itself, they are proof", async () => {
    await sale(T);
    const witnesses = [
      device("till-1", R, 0, "10.0.0.1"),
      device("till-2", R, 0, "10.0.0.2"),
      authority(R, 0, 500),
    ];
    expect((await stateAt(R, witnesses))!.agreeing).toEqual({
      authority: witnesses[2],
      devices: witnesses.slice(0, 2),
    });
  });
});

describe("a stop that comes back after a lift", () => {
  it("is unconfirmed again, and a fresh confirmation closes the new check", async () => {
    await sale(T);
    const firstCheck = await openCheck(R);
    const first = await confirm(R, twoDevices(R));
    expect(await sale(R + 10 * H)).toBe("recorded");
    const at = R + 10 * H - 2 * M;
    const state = await stateAt(at, []);
    expect(state!.proof).toBe("none");
    expect(state!.confirmation).toBeNull();
    await confirmsNothing(at, []);

    const secondCheck = await openCheck(at);
    const second = await confirm(at, twoDevices(at));
    const written = await rows();
    expect(written.map((row) => [row.id, row.seq, row.checkId, row.registroId])).toEqual([
      [first.confirmation!.id, 1, firstCheck, latestId()],
      [second.confirmation!.id, 2, secondCheck, latestId()],
    ]);
    expect(await sale(at)).toBe("recorded");
    expect((await stateAt(at, []))!.confirmation!.id).toBe(second.confirmation!.id);
  });

  it("control: a minute behind the record written under the lift is still confirmed", async () => {
    await sale(T);
    await confirm(R, twoDevices(R));
    expect(await sale(R + 10 * H)).toBe("recorded");
    const at = R + 10 * H - M;
    expect((await stateAt(at, []))!.proof).toBe("confirmed");
    await confirmsNothing(at, twoDevices(at));
  });
});

describe("the stop and the record", () => {
  it.each([
    ["the latest record's time", T],
    ["a minute behind it", T - M],
  ])("at %s, no stop: no state and nothing confirmed", async (_name, at) => {
    await sale(T);
    expect(await stateAt(at, twoDevices(at))).toBeNull();
    await confirmsNothing(at, twoDevices(at));
  });

  it("control: a minute and a millisecond behind is a stop", async () => {
    await sale(T);
    expect((await stateAt(T - M - 1, []))!.proof).toBe("none");
  });

  it("with no records there is no stop", async () => {
    expect(await stateAt(R, twoDevices(R))).toBeNull();
    await confirmsNothing(R, twoDevices(R));
  });

  it("a clock before 28-10-2024 shows no state and confirms nothing", async () => {
    await sale(T);
    const at = Date.parse("2001-01-01T10:00:00.000Z");
    expect(await stateAt(at, twoDevices(at))).toBeNull();
    await confirmsNothing(at, twoDevices(at));
  });

  it("of two records at one instant, names the one the stop compares against", async () => {
    await sale(T);
    await sale(T);
    expect(count("registros_facturacion")).toBe(2);
    expect((await stateAt(R, twoDevices(R)))!.recordId).toBe(latestId());
    expect((await confirm(R, twoDevices(R))).confirmation!.recordId).toBe(latestId());
    expect(await sale(R)).toBe("recorded");
  });
});

const PERSON = "person-1";

/** An administrator's device reading at `boxMs` on the box's clock, `differenceMs` away from it. */
function adminReading(boxMs: number, differenceMs: number, uncertaintyMs: number) {
  return {
    personId: PERSON,
    personName: "Alex Admin",
    reading: { boxAt: iso(boxMs), witnessAt: iso(boxMs + differenceMs), uncertaintyMs },
  };
}

type AdminInput = ReturnType<typeof adminReading>;

function confirmAsAdmin(ms: number, witnesses: readonly ClockWitness[], admin: AdminInput) {
  return withTransaction(suite.db, (tx) =>
    confirmClockStop(tx, { reading: reading(ms), boot: BOOT, witnesses, nodeId, admin }),
  );
}

/** The administrator's confirmation at `ms`, after checking it threw `code` with `params` and
 * wrote no row. */
async function adminRefused(
  ms: number,
  witnesses: readonly ClockWitness[],
  admin: AdminInput,
  code: string,
  params: object,
): Promise<void> {
  const before = count("clock_confirmations");
  const failure = await confirmAsAdmin(ms, witnesses, admin).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(AppError);
  expect((failure as AppError).code).toBe(code);
  expect((failure as AppError).params).toEqual(params);
  expect(count("clock_confirmations")).toBe(before);
}

describe("an administrator's device", () => {
  it("agreeing at exactly a minute, counting its uncertainty, confirms with source admin", async () => {
    await sale(T - H);
    await sale(T);
    const checkId = await openCheck(R);
    const heads = headsNow();
    const admin = adminReading(R - 2 * S, 59 * S, S);
    const answer = await confirmAsAdmin(R, [], admin);
    const written = await rows();
    expect(written).toEqual([
      {
        id: answer.confirmation!.id,
        seq: 1,
        nodeId,
        boxClockAt: new Date(R),
        confirmedAt: new Date(R),
        stepMs: 0,
        source: "admin",
        personId: PERSON,
        reason: "behind_chain",
        proof: {
          authority: null,
          devices: [],
          admin: {
            boxAt: admin.reading.boxAt,
            witnessAt: admin.reading.witnessAt,
            uncertaintyMs: S,
          },
          heads,
          closing: {
            bootMs: BOOT.ms,
            bootId: null,
            correctedStart: iso(R),
            partial: true,
            unconfirmed: false,
          },
        },
        checkId,
        registroId: latestId(),
        recordAt: new Date(T),
      },
    ]);
    expect(answer).toEqual({
      confirmation: {
        id: written[0]!.id,
        seq: 1,
        source: "admin",
        personId: PERSON,
        confirmedAt: iso(R),
        checkId,
        recordId: latestId(),
      },
    });
    expect(await sale(R)).toBe("recorded");
    expect((await stateAt(R, []))!.confirmation).toEqual({
      id: written[0]!.id,
      source: "admin",
      personId: PERSON,
      confirmedAt: iso(R),
    });
  });

  it("a millisecond over a minute, on either side of the box, differs and writes nothing", async () => {
    await sale(T);
    await adminRefused(R, [], adminReading(R, -59 * S - 1, S), "clock.confirm_refused", {
      reason: "differs",
    });
    await adminRefused(R, [], adminReading(R, 59 * S, S + 1), "clock.confirm_refused", {
      reason: "differs",
    });
    expect(await sale(R)).toBe("clock.behind_chain");
  });

  it("a negative uncertainty differs and writes nothing", async () => {
    await sale(T);
    await adminRefused(R, [], adminReading(R, 60 * S + 500, -S), "clock.confirm_refused", {
      reason: "differs",
    });
    const answer = await confirmAsAdmin(R, [], adminReading(R, 59 * S, 0));
    expect(answer.confirmation!.source).toBe("admin");
  });

  it("an unreadable time differs and writes nothing", async () => {
    await sale(T);
    const admin = adminReading(R, 0, 0);
    await adminRefused(
      R,
      [],
      { ...admin, reading: { ...admin.reading, witnessAt: "garbage" } },
      "clock.confirm_refused",
      { reason: "differs" },
    );
  });

  it("keeps agreeing witnesses beside it in the proof", async () => {
    await sale(T);
    const aeat = authority(R - M, 10 * S, 500);
    await confirmAsAdmin(R, [aeat, ...twoDevices(R)], adminReading(R, 0, 0));
    const [row] = await rows();
    expect(row!.source).toBe("admin");
    expect(row!.proof).toMatchObject({
      authority: { boxAt: aeat.boxAt, witnessAt: aeat.witnessAt, uncertaintyMs: 500 },
      devices: storedDevices(twoDevices(R)),
    });
  });

  it("with AEAT disagreeing during the stop, is refused as contrary proof", async () => {
    await sale(T);
    await adminRefused(
      R,
      [authority(R - 10 * M, 2 * H, 500)],
      adminReading(R, 0, 0),
      "clock.confirm_refused",
      { reason: "contrary_proof" },
    );
    expect(await sale(R)).toBe("clock.behind_chain");
  });

  it("control: AEAT disagreeing before the stop does not refuse it", async () => {
    await sale(T);
    const answer = await confirmAsAdmin(
      R,
      [authority(T - 30 * S, 2 * H, 500)],
      adminReading(R, 0, 0),
    );
    expect(answer.confirmation!.source).toBe("admin");
  });

  it("with two devices from two addresses disagreeing, is refused as contrary proof", async () => {
    await sale(T);
    await adminRefused(R, twoDevicesAgainst(R), adminReading(R, 0, 0), "clock.confirm_refused", {
      reason: "contrary_proof",
    });
  });

  it("with two devices disagreeing beside AEAT agreeing, is still refused as contrary proof", async () => {
    await sale(T);
    await adminRefused(
      R,
      [authority(R - M, 10 * S, 500), ...twoDevicesAgainst(R)],
      adminReading(R, 0, 0),
      "clock.confirm_refused",
      { reason: "contrary_proof" },
    );
  });

  it("control: a lone device disagreeing does not refuse it", async () => {
    await sale(T);
    const answer = await confirmAsAdmin(
      R,
      [device("till-3", R - M, 2 * H, "10.0.0.3")],
      adminReading(R, 0, 0),
    );
    expect(answer.confirmation!.source).toBe("admin");
  });

  it("an AEAT reading too uncertain to decide does not refuse it", async () => {
    await sale(T);
    const answer = await confirmAsAdmin(
      R,
      [authority(R - M, 90 * S, 40 * S)],
      adminReading(R, 0, 0),
    );
    expect(answer.confirmation!.source).toBe("admin");
    const [row] = await rows();
    expect((row!.proof as { authority: unknown }).authority).toBeNull();
  });

  it.each([
    ["at the latest record's time", T],
    ["a minute behind it", T - M],
  ])("with no stop %s, is refused as not stopped", async (_name, at) => {
    await sale(T);
    await adminRefused(at, [], adminReading(at, 0, 0), "clock.confirm_refused", {
      reason: "not_stopped",
    });
  });

  it("with no records, is refused as not stopped", async () => {
    await adminRefused(R, [], adminReading(R, 0, 0), "clock.confirm_refused", {
      reason: "not_stopped",
    });
  });

  it("once a confirmation covers the reading, is refused as not stopped", async () => {
    await sale(T);
    await confirmAsAdmin(R, [], adminReading(R, 0, 0));
    await adminRefused(R, [], adminReading(R, 0, 0), "clock.confirm_refused", {
      reason: "not_stopped",
    });
  });

  it("on a clock before 28-10-2024, throws clock.unusable and writes nothing", async () => {
    await sale(T);
    const at = Date.parse("2001-01-01T10:00:00.000Z");
    await adminRefused(at, [], adminReading(at, 0, 0), "clock.unusable", {
      clockAt: iso(at),
      offsetMinutes: 60,
    });
  });
});

describe("an administrator's device while a check waits", () => {
  /** A sale at T and a check opened at R; the stop has ended once the clock reads T. */
  async function waitingCheck(): Promise<string> {
    await sale(T);
    return openCheck(R);
  }

  it("agreeing, closes the waiting check with source admin, naming no record", async () => {
    const checkId = await waitingCheck();
    const admin = adminReading(T - 2 * S, 10 * S, S);
    const devices = twoDevices(T);
    const answer = await confirmAsAdmin(T, devices, admin);
    const written = await rows();
    expect(written).toEqual([
      {
        id: answer.confirmation!.id,
        seq: 1,
        nodeId,
        boxClockAt: new Date(T),
        confirmedAt: new Date(T),
        stepMs: 0,
        source: "admin",
        personId: PERSON,
        reason: "behind_chain",
        proof: {
          authority: null,
          devices: storedDevices(devices),
          admin: {
            boxAt: admin.reading.boxAt,
            witnessAt: admin.reading.witnessAt,
            uncertaintyMs: S,
          },
          // The opening stored no boot reading, so no elapsed time is known.
          closing: {
            bootMs: BOOT.ms,
            bootId: null,
            correctedStart: iso(T),
            partial: true,
            unconfirmed: false,
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
        source: "admin",
        personId: PERSON,
        confirmedAt: iso(T),
        checkId,
        recordId: null,
      },
    });
    await adminRefused(T, [], adminReading(T, 0, 0), "clock.confirm_refused", {
      reason: "not_stopped",
    });
  });

  it("an AEAT disagreement kept from during the stop does not refuse it", async () => {
    const checkId = await waitingCheck();
    const answer = await confirmAsAdmin(
      T,
      [authority(R - 10 * M, 2 * H, 500)],
      adminReading(T, 0, 0),
    );
    expect(answer.confirmation).toMatchObject({ source: "admin", checkId, recordId: null });
  });

  it("an AEAT disagreement taken after the stop ended refuses it as contrary proof", async () => {
    await waitingCheck();
    await adminRefused(
      T,
      [authority(T - 20 * S, 2 * H, 500)],
      adminReading(T, 0, 0),
      "clock.confirm_refused",
      { reason: "contrary_proof" },
    );
  });

  it("two devices disagreeing after the stop ended refuse it as contrary proof", async () => {
    await waitingCheck();
    await adminRefused(T, twoDevicesAgainst(T), adminReading(T, 0, 0), "clock.confirm_refused", {
      reason: "contrary_proof",
    });
  });

  it("AEAT agreeing after the stop ended, beside two devices disagreeing, refuses it as contrary proof", async () => {
    await waitingCheck();
    await adminRefused(
      T,
      [authority(T - 20 * S, 10 * S, 500), ...twoDevicesAgainst(T)],
      adminReading(T, 0, 0),
      "clock.confirm_refused",
      { reason: "contrary_proof" },
    );
  });

  it("AEAT disagreeing after the stop ended, beside two agreeing devices, refuses it as contrary proof", async () => {
    await waitingCheck();
    await adminRefused(
      T,
      [authority(T - 20 * S, 2 * H, 500), ...twoDevices(T)],
      adminReading(T, 0, 0),
      "clock.confirm_refused",
      { reason: "contrary_proof" },
    );
  });

  it("control: a lone device disagreeing after the stop ended does not refuse it", async () => {
    const checkId = await waitingCheck();
    const answer = await confirmAsAdmin(
      T,
      [device("till-3", T - 20 * S, 2 * H, "10.0.0.3")],
      adminReading(T, 0, 0),
    );
    expect(answer.confirmation).toMatchObject({ source: "admin", checkId, recordId: null });
  });

  it("a device that differs is refused, and writes nothing", async () => {
    await waitingCheck();
    await adminRefused(T, [], adminReading(T, 2 * M, 0), "clock.confirm_refused", {
      reason: "differs",
    });
  });

  it("with no stop and no waiting check, is refused as not stopped", async () => {
    await sale(T);
    await adminRefused(T, [], adminReading(T, 0, 0), "clock.confirm_refused", {
      reason: "not_stopped",
    });
  });

  it("the automatic path does not close a waiting check", async () => {
    await waitingCheck();
    await confirmsNothing(T, [authority(T - 10 * S, 5 * S, 500), ...twoDevices(T)]);
  });
});
