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
import { refuseWhileClockBehind } from "./clock-behind.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const M = 60_000;
const H = 3_600_000;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 14.5 * H;

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

/** Every chain's node and its largest secuencia, read as `chainHeads` reads them for a
 * confirmation. */
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

/** Stands in for the other callers that find the latest record (the confirmation's writer, the
 * Clock row's state): they must pick the record `latestRecord` picks. */
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

/** A devices confirmation naming a record, with no `check_id`. */
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

describe("a confirmation lifts the stop for one step back", () => {
  it("keeps recording while the clock only moves forward", async () => {
    await attempt(T);
    await restart();
    expect(await attemptAll([R + M, R + 10 * H, R + 10 * H + 5 * M])).toEqual([
      "recorded",
      "recorded",
      "recorded",
    ]);
  });

  it("covers a 400-day gap", async () => {
    await attempt(T);
    await restart({ clockMs: T - 400 * 24 * H });
    expect(await attempt(T - 400 * 24 * H + M)).toBe("recorded");
    const [first, second] = chain();
    expect(second!.anterior).toBe(first!.huella);
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
});

describe("a confirmation whose stored heads a correct writer never stores covers nothing", () => {
  it("control: the same raw row with readable times covers the sale", async () => {
    await attempt(T);
    insertRawRestart({ proof: JSON.stringify({ heads: headsNow() }) });
    expect(await attempt(R + M)).toBe("recorded");
  });

  it("control: the heads the database holds cover the sale", async () => {
    await attempt(T);
    await restart({ proof: { heads: { [nodeId]: 1 } } });
    expect(await attempt(R + M)).toBe("recorded");
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
