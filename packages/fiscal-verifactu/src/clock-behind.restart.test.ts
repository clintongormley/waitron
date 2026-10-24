import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import { openBackupQuery } from "@waitron/store";
import { AppError } from "@waitron/shared";
import type { NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { verifyBackupFiscalChains } from "./backup-verification-chain.js";
import {
  chainHeads,
  clockBehindChain,
  latestRecord,
  refuseWhileClockBehind,
} from "./clock-behind.js";
import { clockBehindSource } from "./clock-behind-alerts.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";
import { FISCAL_STAFF_NOTICES } from "./staff-notices.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 14.5 * H;
const NO_RECORDS_NODE = "99999999-9999-4999-8999-999999999999";

let backend: VerifactuBackend;
let nodeId: NodeId;
let seriesId: SeriesId;
let refusals: AppError[];
let directory: string | undefined;

beforeEach(async () => {
  ({ nodeId, seriesId } = await seedTenantWithSif(suite.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
  refusals = [];
});

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function clockAt(ms: number): TrustedClock {
  return {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(ms), offsetMinutes: 60 }),
  };
}

function count(table: string): number {
  return suite.db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(table)}`)[0]!.n;
}

function written() {
  return {
    registros: count("registros_facturacion"),
    sales: count("sales"),
    envios: count("envios"),
    incidents: count("incidents"),
  };
}

/** "recorded", or the refusal's code after checking it wrote nothing. */
async function attempt(ms: number, on = { nodeId, seriesId }): Promise<string> {
  const before = written();
  try {
    await withTransaction(suite.db, (tx) =>
      recordSale(tx, backend, saleInput({ ...on, clock: clockAt(ms) })),
    );
    return "recorded";
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    expect(written()).toEqual(before);
    refusals.push(error);
    return error.code;
  }
}

async function attemptAll(times: number[], on = { nodeId, seriesId }): Promise<string[]> {
  const answers: string[] = [];
  for (const ms of times) answers.push(await attempt(ms, on));
  return answers;
}

function behind(clockMs: number, lastMs: number) {
  return {
    clockAt: new Date(clockMs).toISOString(),
    offsetMinutes: 60,
    lastRecordAt: new Date(lastMs).toISOString(),
    lastRecordOffsetMinutes: 60,
  };
}

/** Every chain's node and its largest secuencia, read as the restart's writer reads them. */
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

/** Stands in for the other callers that find the latest record (the restart's writer, the Clock
 * row's state): they must pick the record `latestRecord` picks. */
function latestId(): string {
  return suite.db.all<{ id: string }>(
    sql`select id from registros_facturacion order by fecha_hora_huso_gen_registro desc, id desc limit 1`,
  )[0]!.id;
}

function nextSeq(): number {
  return suite.db.all<{ n: number }>(
    sql`select coalesce(max(seq), 0) + 1 as n from clock_confirmations`,
  )[0]!.n;
}

/** A confirmation as the clock watch writes one when devices agree during a stop. */
function restart(
  options: {
    proof?: unknown;
    registroId?: string | null;
    clockMs?: number;
    recordMs?: number;
    node?: string;
  } = {},
) {
  const clockMs = options.clockMs ?? R;
  const registroId = options.registroId === undefined ? latestId() : options.registroId;
  return withTransaction(suite.db, (tx) =>
    tx.insert(clockConfirmations).values({
      seq: nextSeq(),
      nodeId: (options.node ?? nodeId) as NodeId,
      boxClockAt: new Date(clockMs),
      confirmedAt: new Date(clockMs),
      stepMs: 0,
      source: "devices",
      reason: "behind_chain",
      proof: options.proof ?? { heads: headsNow() },
      registroId,
      recordAt: registroId === null ? null : new Date(options.recordMs ?? T),
    }),
  );
}

/** A confirmation written past drizzle's encoding, for stored values a correct writer never
 * stores. */
function insertRawRestart(stored: { proof: string; confirmedAt?: string; recordAt?: string }) {
  const confirmedAt = stored.confirmedAt ?? new Date(R).toISOString();
  const recordAt = stored.recordAt ?? new Date(T).toISOString();
  suite.db.run(sql`insert into clock_confirmations
    (id, seq, node_id, box_clock_at, confirmed_at, step_ms, source, reason, proof, registro_id, record_at)
    values ('44444444-4444-4444-8444-444444444444', ${nextSeq()}, ${nodeId},
      ${new Date(R).toISOString()}, ${confirmedAt}, 0, 'devices', 'behind_chain', ${stored.proof},
      ${latestId()}, ${recordAt})`);
}

function chain() {
  return suite.db.all<{ s: number; at: string; huella: string; anterior: string | null }>(
    sql`select secuencia as s, fecha_hora_huso_gen_registro as at, huella, anterior_huella as anterior
      from registros_facturacion where node_id = ${nodeId} order by secuencia`,
  );
}

function stepWalk(): number[] {
  const times = [R + M, R + 10 * H];
  for (let step = 1; step <= 12; step++) times.push(R + 10 * H - step * 59 * S);
  return times;
}

describe("a restart lifts the stop for one step back", () => {
  it("records the sale after a restart, linked to the record it names", async () => {
    await attempt(T);
    expect(await attempt(R)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(R, T));

    await restart();
    expect(await attempt(R + M)).toBe("recorded");
    const [first, second] = chain();
    expect(second!.anterior).toBe(first!.huella);
    expect(Date.parse(second!.at)).toBe(R + M);
  });

  it("stops again at a second step back of more than a minute", async () => {
    await attempt(T);
    await restart();
    expect(
      await attemptAll([R + M, R + 10 * H, R + 30 * M, R + 10 * H - 59 * S, R + 10 * H - 2 * M]),
    ).toEqual(["recorded", "recorded", "clock.behind_chain", "recorded", "clock.behind_chain"]);
    expect(refusals.map((refusal) => refusal.params)).toEqual([
      behind(R + 30 * M, R + 10 * H),
      behind(R + 10 * H - 2 * M, R + 10 * H),
    ]);
  });

  it("keeps recording while the clock only moves forward", async () => {
    await attempt(T);
    await restart();
    expect(await attemptAll([R + M, R + 10 * H, R + 10 * H + 5 * M])).toEqual([
      "recorded",
      "recorded",
      "recorded",
    ]);
  });

  it("stops a clock walking back 59 s at a time at its second step", async () => {
    await attempt(T);
    await restart();
    expect(await attemptAll(stepWalk())).toEqual([
      "recorded",
      "recorded",
      "recorded",
      ...Array<string>(11).fill("clock.behind_chain"),
    ]);
    expect(refusals.map((refusal) => refusal.params)).toEqual(
      stepWalk()
        .slice(3)
        .map((ms) => behind(ms, R + 10 * H)),
    );
  });

  it("lets the first step go a minute further back than accepted, and no later step", async () => {
    await attempt(T);
    await restart();
    expect(await attemptAll([R - 61 * S, R - 59 * S, R + M, R - 59 * S])).toEqual([
      "clock.behind_chain",
      "recorded",
      "recorded",
      "clock.behind_chain",
    ]);
    expect(refusals.map((refusal) => refusal.params)).toEqual([
      behind(R - 61 * S, T),
      behind(R - 59 * S, R + M),
    ]);
  });

  it("covers a reading a minute further back than the confirmed time, not 61 s", async () => {
    await attempt(T);
    await restart({ clockMs: T - 24 * H });
    expect(await attemptAll([T - 24 * H - 61 * S, T - 24 * H - M])).toEqual([
      "clock.behind_chain",
      "recorded",
    ]);
    expect(refusals[0]!.params).toEqual(behind(T - 24 * H - 61 * S, T));
  });

  it("covers a 400-day gap", async () => {
    await attempt(T);
    await restart({ clockMs: T - 400 * 24 * H });
    expect(await attempt(T - 400 * 24 * H + M)).toBe("recorded");
    const [first, second] = chain();
    expect(second!.anterior).toBe(first!.huella);
  });

  it("answers the same from the stop, the staff notice and the bell", async () => {
    await attempt(T);
    await restart();
    const read = (ms: number) =>
      withTransaction(suite.db, async (tx) => ({
        stop: await clockBehindChain(tx, { instant: new Date(ms), offsetMinutes: 60 }),
        notices: await FISCAL_STAFF_NOTICES[0]!.read({
          tx,
          reading: { instant: new Date(ms), offsetMinutes: 60 },
        }),
        alerts: await clockBehindSource.read({ tx, now: new Date(ms) }),
      }));

    expect(await read(R)).toEqual({ stop: null, notices: [], alerts: [] });
    expect(await read(R - 2 * M)).toEqual({
      stop: behind(R - 2 * M, T),
      notices: [
        {
          key: "clock.behind_chain",
          code: "clock.behind_chain",
          severity: "error",
          params: behind(R - 2 * M, T),
        },
      ],
      alerts: [
        {
          key: "clock.behind_chain",
          code: "clock.behind_chain",
          severity: "error",
          since: null,
          screen: "box-status",
          params: {
            clockAt: new Date(R - 2 * M).toISOString(),
            lastRecordAt: new Date(T).toISOString(),
          },
        },
      ],
    });
  });

  it("lifts only for the one of two same-instant records that latestRecord names", async () => {
    await attempt(T);
    await attempt(T);
    const ids = suite.db
      .all<{ id: string }>(sql`select id from registros_facturacion`)
      .map((row) => row.id);
    const latest = await withTransaction(suite.db, (tx) => latestRecord(tx));
    expect(latest).toEqual({ id: latestId(), at: new Date(T), offsetMinutes: 60 });
    const other = ids.find((id) => id !== latest!.id)!;

    await restart({ registroId: other });
    expect(await attempt(R + M)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(R + M, T));
    await restart({ registroId: latest!.id });
    expect(await attempt(R + M)).toBe("recorded");
  });

  it("does not lift a new stop once real time has passed the record it names", async () => {
    await attempt(T);
    await restart();
    expect(await attemptAll([R + M, T + 2 * M, R + 2 * M])).toEqual([
      "recorded",
      "recorded",
      "clock.behind_chain",
    ]);
    expect(refusals[0]!.params).toEqual(behind(R + 2 * M, T + 2 * M));
  });

  it("still refuses a reading before 28-10-2024 as clock.unusable", async () => {
    await attempt(T);
    await restart();
    const before = written();
    const reading = { instant: new Date("2001-01-01T11:00:00.000Z"), offsetMinutes: 60 };
    await expect(
      withTransaction(suite.db, (tx) => refuseWhileClockBehind(tx, reading)),
    ).rejects.toMatchObject({
      code: "clock.unusable",
      params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
    });
    expect(await attempt(reading.instant.getTime())).toBe("clock.unusable");
    expect(refusals[0]!.params).toEqual({ clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 });
    expect(written()).toEqual(before);
    expect(await attempt(R + M)).toBe("recorded");
  });

  it("covers nothing with a confirmation that names no record", async () => {
    await attempt(T);
    await restart({ registroId: null });
    expect(await attempt(R + M)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(R + M, T));
  });

  it("keeps the stop when the later of two confirmations naming the latest record fails", async () => {
    await attempt(T);
    await restart();
    await restart({ proof: { heads: { [nodeId]: 2 } } });
    expect(await attempt(R + M)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(R + M, T));
  });

  it("lifts a further step back with a fresh confirmation", async () => {
    await attempt(T);
    await restart();
    expect(await attemptAll([R + M, R + 10 * H, R + 30 * M])).toEqual([
      "recorded",
      "recorded",
      "clock.behind_chain",
    ]);
    expect(refusals[0]!.params).toEqual(behind(R + 30 * M, R + 10 * H));
    await restart({ clockMs: R + 30 * M });
    expect(await attempt(R + 31 * M)).toBe("recorded");
    const records = chain();
    expect(records.at(-1)!.anterior).toBe(records.at(-2)!.huella);
  });
});

describe("a restart whose stored heads a correct writer never stores covers nothing", () => {
  const NODE = "NODE";
  const proofs: [string, unknown][] = [
    ["a proof that is a string", "heads"],
    ["a proof that is an array", [{ heads: {} }]],
    ["a proof with no heads", { recordsBefore: 1 }],
    ["heads that are null", { heads: null }],
    ["heads that are an array", { heads: [1] }],
    ["a head that is a string", { heads: { [NODE]: "1" } }],
    ["a negative head", { heads: { [NODE]: -1 } }],
    ["a fractional head", { heads: { [NODE]: 0.5 } }],
    ["a head larger than its chain's", { heads: { [NODE]: 2 } }],
    ["an empty map", { heads: {} }],
    ["a map naming a node with no records", { heads: { [NODE]: 1, [NO_RECORDS_NODE]: 1 } }],
    ["a map naming an inherited property", { heads: { [NODE]: 1, toString: 1 } }],
  ];

  it.each(proofs)("%s", async (_name, proof) => {
    await attempt(T);
    const stored = JSON.parse(JSON.stringify(proof).replaceAll(NODE, nodeId)) as unknown;
    await restart({ proof: stored });
    expect(await attempt(R + M)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(R + M, T));
  });

  it("a proof stored as JSON null", async () => {
    await attempt(T);
    insertRawRestart({ proof: "null" });
    expect(await attempt(R + M)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(R + M, T));
  });

  it("a proof that is not JSON, without throwing from the sale or the staff notice", async () => {
    await attempt(T);
    insertRawRestart({ proof: "not json" });
    expect(await attempt(R + M)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(R + M, T));
    const reading = { instant: new Date(R + M), offsetMinutes: 60 };
    expect(
      await withTransaction(suite.db, (tx) => FISCAL_STAFF_NOTICES[0]!.read({ tx, reading })),
    ).toEqual([
      {
        key: "clock.behind_chain",
        code: "clock.behind_chain",
        severity: "error",
        params: behind(R + M, T),
      },
    ]);
  });

  it.each([
    ["confirmed_at", { confirmedAt: "garbage" }],
    ["record_at", { recordAt: "garbage" }],
  ] as const)("an unreadable %s, a reading 30 days back", async (_column, stored) => {
    await attempt(T);
    insertRawRestart({ proof: JSON.stringify({ heads: headsNow() }), ...stored });
    expect(await attempt(T - 30 * 24 * H)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(T - 30 * 24 * H, T));
  });

  it("control: the same raw row with readable times covers the sale", async () => {
    await attempt(T);
    insertRawRestart({ proof: JSON.stringify({ heads: headsNow() }) });
    expect(await attempt(R + M)).toBe("recorded");
  });

  it("a record_at other than the named record's own time", async () => {
    await attempt(T);
    await restart({ recordMs: T + H });
    expect(await attempt(R - 30 * M)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(R - 30 * M, T));
  });

  it("control: the heads the database holds cover the sale", async () => {
    await attempt(T);
    await restart({ proof: { heads: { [nodeId]: 1 } } });
    expect(await attempt(R + M)).toBe("recorded");
  });
});

describe("a restart over two chains", () => {
  it("counts the older chain's records and the box's as written under it", async () => {
    const older = await seedTenantWithSif(suite.db);
    await attempt(T, older);
    expect(await withTransaction(suite.db, (tx) => chainHeads(tx))).toEqual({ [older.nodeId]: 1 });
    await restart();
    expect(await attemptAll([R + M, R + 10 * H, R + 30 * M, R + 10 * H + M])).toEqual([
      "recorded",
      "recorded",
      "clock.behind_chain",
      "recorded",
    ]);
    expect(refusals[0]!.params).toEqual(behind(R + 30 * M, R + 10 * H));
    expect(await withTransaction(suite.db, (tx) => chainHeads(tx))).toEqual(headsNow());
    expect(headsNow()).toEqual({ [older.nodeId]: 1, [nodeId]: 3 });
  });

  it("holds the box to the latest time written under the restart on any chain", async () => {
    const older = await seedTenantWithSif(suite.db);
    await attempt(T, older);
    await restart();
    expect(await attempt(R + 10 * H)).toBe("recorded");
    expect(await attempt(R + 10 * H, older)).toBe("recorded");
    expect(await attemptAll([R + 30 * M, R + 10 * H - M])).toEqual([
      "clock.behind_chain",
      "recorded",
    ]);
    expect(refusals[0]!.params).toEqual(behind(R + 30 * M, R + 10 * H));
  });

  it("answers the same when the row names the other node", async () => {
    const older = await seedTenantWithSif(suite.db);
    await attempt(T, older);
    await restart({ node: older.nodeId });
    expect(await attemptAll([R + M, R + 10 * H, R + 30 * M, R + 10 * H + M])).toEqual([
      "recorded",
      "recorded",
      "clock.behind_chain",
      "recorded",
    ]);
    expect(refusals[0]!.params).toEqual(behind(R + 30 * M, R + 10 * H));
  });

  it("keeps the stop when heads leave out the older chain", async () => {
    const older = await seedTenantWithSif(suite.db);
    await attempt(T, older);
    await restart({ proof: { heads: {} } });
    expect(await attempt(R + M)).toBe("clock.behind_chain");
    expect(refusals[0]!.params).toEqual(behind(R + M, T));
  });
});

describe("a record a day earlier than the one it links to", () => {
  it("is recorded and a backup copy of the chain verifies", async () => {
    await attempt(T);
    await restart({ clockMs: T - 24 * H });
    expect(await attempt(T - 24 * H)).toBe("recorded");
    const dates = suite.db.all<{ fecha: string; anterior: string | null; huella: string }>(
      sql`select fecha_expedicion_factura as fecha, anterior_huella as anterior, huella
        from registros_facturacion order by secuencia`,
    );
    expect(dates.map((row) => row.fecha)).toEqual(["2026-10-19", "2026-10-18"]);
    expect(dates[1]!.anterior).toBe(dates[0]!.huella);

    directory = await mkdtemp(join(tmpdir(), "waitron-clock-restart-"));
    const [{ file }] = suite.db.all<{ file: string }>(sql`pragma database_list`);
    const source = new DatabaseSync(file!, { readOnly: true });
    try {
      await backup(source, join(directory, "before.db"));
      await backup(source, join(directory, "after.db"));
    } finally {
      source.close();
    }
    const a = await openBackupQuery(join(directory, "before.db"));
    try {
      const b = await openBackupQuery(join(directory, "after.db"));
      try {
        expect(await verifyBackupFiscalChains(a.query, b.query)).toBe(true);
      } finally {
        await b.close();
      }
    } finally {
      await a.close();
    }
  });
});
