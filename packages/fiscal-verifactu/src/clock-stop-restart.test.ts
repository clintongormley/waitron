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
import { clockStopState, restartAfterClockStop } from "./clock-stop-restart.js";
import { clockStopRestarts } from "./schema/clock-stop-restarts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 14.5 * H;
const FIRST = "33333333-3333-4333-8333-333333333333";
const SECOND = "55555555-5555-4555-8555-555555555555";

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

function device(id: string, boxMs: number, differenceMs = 2 * S): ClockWitness {
  return {
    kind: "device",
    id,
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

/** Two tills agreeing with the box, taken half a minute before the reading `at`. */
function twoDevices(at: number): ClockWitness[] {
  return [device("till-1", at - 30 * S), device("till-2", at - 20 * S, -3 * S)];
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

function stateAt(ms: number, witnesses: readonly ClockWitness[]) {
  return withTransaction(suite.db, (tx) => clockStopState(tx, reading(ms), witnesses));
}

function press(
  ms: number,
  witnesses: readonly ClockWitness[],
  options: { personId?: string; recordId?: string; node?: NodeId } = {},
) {
  return withTransaction(suite.db, (tx) =>
    restartAfterClockStop(tx, {
      reading: reading(ms),
      witnesses,
      personId: options.personId ?? FIRST,
      personName: "Ana",
      nodeId: options.node ?? nodeId,
      recordId: options.recordId ?? latestId(),
    }),
  );
}

/** The refusal's code and params, after checking the press wrote no row. */
async function refusal(
  pressing: () => Promise<unknown>,
): Promise<{ code: string; params: unknown }> {
  const before = count("clock_stop_restarts");
  try {
    await pressing();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    expect(count("clock_stop_restarts")).toBe(before);
    return { code: error.code, params: error.params };
  }
  throw new Error("the press was not refused");
}

function refused(reason: string) {
  return { code: "clock.restart_refused", params: { reason } };
}

describe("a restart with two agreeing devices", () => {
  it("is offered, writes one row and lifts the stop", async () => {
    await sale(T - H);
    await sale(T);
    const witnesses = twoDevices(R);
    const state = await stateAt(R, witnesses);
    expect(state).toEqual({
      clockAt: iso(R),
      offsetMinutes: 60,
      lastRecordAt: iso(T),
      lastRecordOffsetMinutes: 60,
      recordId: latestId(),
      gapMs: 14.5 * H,
      restart: null,
      offer: "offered",
      proof: { authority: null, devices: witnesses },
      contrary: { authority: null, devices: [] },
    });
    const heads = headsNow();
    expect(heads).toEqual({ [nodeId]: 2 });

    const answer = await press(R, witnesses);
    expect(answer.replayed).toBe(false);
    const rows = await suite.db.select().from(clockStopRestarts);
    expect(rows).toEqual([
      {
        id: answer.restart.id,
        nodeId,
        personId: FIRST,
        restartedAt: new Date(R),
        clockAt: new Date(R),
        registroId: latestId(),
        recordAt: new Date(T),
        proof: {
          authority: null,
          devices: witnesses.map((witness) => ({
            deviceId: witness.id,
            boxAt: witness.boxAt,
            witnessAt: witness.witnessAt,
          })),
          heads,
        },
      },
    ]);
    expect(answer.restart).toEqual({
      id: rows[0]!.id,
      personId: FIRST,
      restartedAt: iso(R),
      clockAt: iso(R),
      lastRecordAt: iso(T),
      proofKind: "devices",
    });
    expect((await stateAt(R, witnesses))!.offer).toBe("restarted");
    expect(await sale(R)).toBe("recorded");
  });

  it("over a restored database, counts the older chain's record in the heads it keeps", async () => {
    const older = await seedTenantWithSif(suite.db);
    await sale(T, older);
    const answer = await press(R, twoDevices(R));
    expect(answer.replayed).toBe(false);
    const [row] = await suite.db.select().from(clockStopRestarts);
    expect(row!.proof).toMatchObject({ heads: { [older.nodeId]: 1 } });
    expect(Object.keys((row!.proof as { heads: object }).heads)).toEqual([older.nodeId]);
    expect(await sale(R)).toBe("recorded");
    expect(await sale(R - 30 * M)).toBe("clock.behind_chain");
  });

  it("keeps AEAT's agreeing reading as the proof, and names both kinds", async () => {
    await sale(T);
    const aeat = authority(R - M, 10 * S, 500);
    const witnesses = [aeat, ...twoDevices(R)];
    expect((await stateAt(R, witnesses))!.proof).toEqual({
      authority: aeat,
      devices: twoDevices(R),
    });
    const answer = await press(R, witnesses);
    expect(answer.restart.proofKind).toBe("authority_and_devices");
    const [row] = await suite.db.select().from(clockStopRestarts);
    expect((row!.proof as { authority: unknown }).authority).toEqual({
      boxAt: aeat.boxAt,
      witnessAt: aeat.witnessAt,
      uncertaintyMs: 500,
    });
  });

  it("takes AEAT alone as proof, without a lone device", async () => {
    await sale(T);
    const aeat = authority(R - M, 10 * S, 500);
    const witnesses = [aeat, device("till-1", R - 30 * S)];
    expect((await stateAt(R, witnesses))!.proof).toEqual({ authority: aeat, devices: [] });
    const answer = await press(R, witnesses);
    expect(answer.restart.proofKind).toBe("authority");
    const [row] = await suite.db.select().from(clockStopRestarts);
    expect((row!.proof as { devices: unknown }).devices).toEqual([]);
  });
});

describe("no proof", () => {
  it.each([
    ["no witnesses", []],
    ["one device", [device("till-1", R - 30 * S)]],
    ["an AEAT reading that says nothing", [authority(R - M, 70 * S, 20 * S)]],
    ["the same device twice", [device("till-1", R - 30 * S), device("till-1", R - 20 * S)]],
  ] as const)("%s → not offered and refused", async (_name, witnesses) => {
    await sale(T);
    expect((await stateAt(R, witnesses))!.offer).toBe("no_proof");
    expect(await refusal(() => press(R, witnesses))).toEqual(refused("no_proof"));
    expect(await sale(R)).toBe("clock.behind_chain");
  });
});

describe("contrary proof", () => {
  it.each([
    ["an AEAT reading that disagrees", [authority(R - M, 2 * H, 500)]],
    ["an AEAT disagreement ten minutes old", [authority(R - 10 * M, 2 * H, 500)]],
    [
      "two devices agreeing at +2 h",
      [device("till-3", R - M, 2 * H), device("till-4", R - M, 2 * H + 10 * S)],
    ],
  ] as const)("two agreeing devices plus %s → refused", async (_name, against) => {
    await sale(T);
    const witnesses = [...twoDevices(R), ...against];
    const state = await stateAt(R, witnesses);
    expect(state!.offer).toBe("contrary_proof");
    expect(state!.contrary).toEqual(
      against[0]!.kind === "authority"
        ? { authority: against[0], devices: [] }
        : { authority: null, devices: [...against] },
    );
    expect(await refusal(() => press(R, witnesses))).toEqual(refused("contrary_proof"));
  });

  it("control: a lone device at +2 h is no contrary proof", async () => {
    await sale(T);
    const witnesses = [...twoDevices(R), device("till-3", R - M, 2 * H)];
    expect((await stateAt(R, witnesses))!.offer).toBe("offered");
    expect((await press(R, witnesses)).replayed).toBe(false);
  });
});

describe("how far back", () => {
  it("refuses a 25-hour gap", async () => {
    await sale(T);
    const at = T - 25 * H;
    expect((await stateAt(at, twoDevices(at)))!.offer).toBe("too_far");
    expect(await refusal(() => press(at, twoDevices(at)))).toEqual(refused("too_far"));
  });

  it("refuses 24 hours and one second", async () => {
    await sale(T);
    const at = T - 24 * H - S;
    expect((await stateAt(at, twoDevices(at)))!.offer).toBe("too_far");
    expect(await refusal(() => press(at, twoDevices(at)))).toEqual(refused("too_far"));
  });

  it("offers and writes exactly 24 hours", async () => {
    await sale(T);
    const at = T - 24 * H;
    expect((await stateAt(at, twoDevices(at)))!.offer).toBe("offered");
    expect((await press(at, twoDevices(at))).replayed).toBe(false);
    expect(await sale(at)).toBe("recorded");
  });

  it("judges the gap before the proof", async () => {
    await sale(T);
    const at = T - 25 * H;
    expect((await stateAt(at, []))!.offer).toBe("too_far");
    expect(await refusal(() => press(at, []))).toEqual(refused("too_far"));
  });
});

describe("witnesses taken before the stop", () => {
  it("do not count when taken within a minute of the latest record", async () => {
    await sale(T);
    const witnesses = [device("till-1", T - 30 * S), device("till-2", T - M)];
    expect((await stateAt(R, witnesses))!.offer).toBe("no_proof");
    expect(await refusal(() => press(R, witnesses))).toEqual(refused("no_proof"));
  });

  it("count from just over a minute before the latest record", async () => {
    await sale(T);
    const witnesses = [device("till-1", T - M - 1), device("till-2", T - M - 1)];
    expect((await stateAt(T - M - 1, witnesses))!.offer).toBe("offered");
  });

  it("an AEAT disagreement taken before the stop is no contrary proof", async () => {
    await sale(T);
    const witnesses = [...twoDevices(R), authority(T - 30 * S, 2 * H, 500)];
    expect((await stateAt(R, witnesses))!.offer).toBe("offered");
  });

  it("an unreadable boxAt counts neither way", async () => {
    await sale(T);
    const witnesses = [...twoDevices(R), { ...authority(R - M, 2 * H, 500), boxAt: "garbage" }];
    expect((await stateAt(R, witnesses))!.offer).toBe("offered");
  });
});

describe("the checks' order, where two reasons hold at once", () => {
  it("a gap over 24 hours is refused as too far, whatever the witnesses say", async () => {
    await sale(T);
    const at = T - 25 * H;
    const witnesses = [...twoDevices(at), authority(at - M, 2 * H, 500)];
    expect((await stateAt(at, witnesses))!.offer).toBe("too_far");
    expect(await refusal(() => press(at, witnesses))).toEqual(refused("too_far"));
  });

  it("contrary proof with no proof is refused as contrary proof", async () => {
    await sale(T);
    const witnesses = [authority(R - M, 2 * H, 500)];
    expect((await stateAt(R, witnesses))!.offer).toBe("contrary_proof");
    expect(await refusal(() => press(R, witnesses))).toEqual(refused("contrary_proof"));
  });

  it("an older record is refused as changed even when a restart covers the latest", async () => {
    await sale(T - H);
    const older = latestId();
    await sale(T);
    await press(R, twoDevices(R));
    expect(await refusal(() => press(R, twoDevices(R), { recordId: older }))).toEqual(
      refused("record_changed"),
    );
  });
});

describe("witnesses taken after the reading", () => {
  it("are no proof: the box's clock may have stepped back since", async () => {
    await sale(T);
    const witnesses = [device("till-1", R + 30 * S), device("till-2", R + S)];
    expect((await stateAt(R, witnesses))!.offer).toBe("no_proof");
    expect(await refusal(() => press(R, witnesses))).toEqual(refused("no_proof"));
    expect(await refusal(() => press(R, [authority(R + S, 0, 500)]))).toEqual(refused("no_proof"));
  });

  it("control: taken at the reading itself, they are proof", async () => {
    await sale(T);
    const witnesses = [device("till-1", R), device("till-2", R), authority(R, 0, 500)];
    expect((await stateAt(R, witnesses))!.proof).toEqual({
      authority: witnesses[2],
      devices: witnesses.slice(0, 2),
    });
    expect((await press(R, witnesses)).restart.proofKind).toBe("authority_and_devices");
  });
});

describe("the stop and the record", () => {
  it("refuses a record that is no longer the latest", async () => {
    await sale(T - H);
    const older = latestId();
    await sale(T);
    expect(await refusal(() => press(R, twoDevices(R), { recordId: older }))).toEqual(
      refused("record_changed"),
    );
  });

  it.each([
    ["the latest record's time", T],
    ["a minute behind it", T - M],
  ])("at %s, no stop: no state and the press refused", async (_name, at) => {
    await sale(T);
    expect(await stateAt(at, twoDevices(at))).toBeNull();
    expect(await refusal(() => press(at, twoDevices(at)))).toEqual(refused("not_stopped"));
  });

  it("control: a minute and a millisecond behind is a stop", async () => {
    await sale(T);
    expect((await stateAt(T - M - 1, []))!.offer).toBe("no_proof");
  });

  it("with no records there is no stop", async () => {
    expect(await stateAt(R, twoDevices(R))).toBeNull();
    expect(
      await refusal(() =>
        withTransaction(suite.db, (tx) =>
          restartAfterClockStop(tx, {
            reading: reading(R),
            witnesses: twoDevices(R),
            personId: FIRST,
            personName: "Ana",
            nodeId,
            recordId: FIRST,
          }),
        ),
      ),
    ).toEqual(refused("not_stopped"));
  });

  it("a 2001 clock answers clock.unusable and shows no state", async () => {
    await sale(T);
    const at = Date.parse("2001-01-01T10:00:00.000Z");
    expect(await stateAt(at, twoDevices(at))).toBeNull();
    expect(await refusal(() => press(at, twoDevices(at)))).toEqual({
      code: "clock.unusable",
      params: { clockAt: iso(at), offsetMinutes: 60 },
    });
  });
});

describe("two records at one instant", () => {
  it("names the record the stop compares against, and a restart of it lifts the stop", async () => {
    await sale(T);
    await sale(T);
    expect(count("registros_facturacion")).toBe(2);
    expect((await stateAt(R, twoDevices(R)))!.recordId).toBe(latestId());
    expect((await press(R, twoDevices(R), { recordId: latestId() })).replayed).toBe(false);
    expect(await sale(R)).toBe("recorded");
  });
});

describe("a second press", () => {
  it("answers the first restart to a second manager, writing nothing", async () => {
    await sale(T);
    const first = await press(R, twoDevices(R));
    const second = await press(R + 5 * S, twoDevices(R + 5 * S), { personId: SECOND });
    expect(second).toEqual({ restart: first.restart, replayed: true });
    expect(count("clock_stop_restarts")).toBe(1);
    expect((await stateAt(R + 5 * S, []))!.restart).toEqual({
      personId: FIRST,
      restartedAt: iso(R),
      clockAt: iso(R),
    });
  });

  it("refuses with the first's person once a later step back stops payments again", async () => {
    await sale(T);
    await press(R, twoDevices(R));
    expect(await sale(R + 10 * H)).toBe("recorded");
    const at = R + 10 * H - 2 * M;
    const state = await stateAt(at, twoDevices(at));
    expect(state!.offer).toBe("stepped_back");
    expect(state!.restart).toEqual({ personId: FIRST, restartedAt: iso(R), clockAt: iso(R) });
    expect(await refusal(() => press(at, twoDevices(at), { personId: SECOND }))).toEqual({
      code: "clock.restart_refused",
      params: { reason: "stepped_back", personId: FIRST, restartedAt: iso(R) },
    });
    expect(count("clock_stop_restarts")).toBe(1);
  });

  it("control: a minute behind the record under it is still covered", async () => {
    await sale(T);
    await press(R, twoDevices(R));
    expect(await sale(R + 10 * H)).toBe("recorded");
    const at = R + 10 * H - M;
    expect((await stateAt(at, []))!.offer).toBe("restarted");
    expect((await press(at, [])).replayed).toBe(true);
  });
});

describe("a restart row a correct writer never stores", () => {
  it.each([
    ["no authority, no devices", {}, "devices"],
    ["an authority and no devices", { authority: {} }, "authority"],
    ["an authority and devices", { authority: {}, devices: [{}] }, "authority_and_devices"],
  ] as const)("%s: a replay names the kind it holds", async (_name, proof, kind) => {
    await sale(T);
    await withTransaction(suite.db, (tx) =>
      tx.insert(clockStopRestarts).values({
        nodeId,
        personId: FIRST,
        restartedAt: new Date(R),
        clockAt: new Date(R),
        registroId: latestId(),
        recordAt: new Date(T),
        proof: { ...proof, heads: headsNow() },
      }),
    );
    const answer = await press(R, []);
    expect(answer.replayed).toBe(true);
    expect(answer.restart.proofKind).toBe(kind);
  });

  it("unreadable stored times show as stored and never throw", async () => {
    await sale(T);
    suite.db.run(sql`insert into clock_stop_restarts
      (id, node_id, person_id, restarted_at, clock_at, registro_id, record_at, proof)
      values ('44444444-4444-4444-8444-444444444444', ${nodeId}, ${FIRST},
        'garbage', 'garbage', ${latestId()}, ${iso(T)}, 'not json')`);
    const state = await stateAt(R, []);
    expect(state!.offer).toBe("stepped_back");
    expect(state!.restart).toEqual({
      personId: FIRST,
      restartedAt: "garbage",
      clockAt: "garbage",
    });
    expect(await refusal(() => press(R, []))).toEqual({
      code: "clock.restart_refused",
      params: { reason: "stepped_back", personId: FIRST, restartedAt: "garbage" },
    });
  });
});
