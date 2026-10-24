import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BootReading, ClockConfirmationSource, TrustedClock } from "@waitron/fiscal";
import type { NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { correctedStart, openCheck, openClockCheck } from "./clock-checks.js";
import { misdatedRecords } from "./clock-misdated.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

// Every case records its sales in time order on a database of its own (`useVenueDb` resets per
// test), so no write is dated behind an earlier record.
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
// Real time 10:00, when the clock was put right and the stop opened.
const X = Date.parse("2026-10-19T10:00:00.000Z");
const BOOT_MS = 1_000_000;
const BOOT: BootReading = { ms: BOOT_MS, id: "boot-1" };

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

function clockAt(ms: number): TrustedClock {
  return {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(ms), offsetMinutes: 60 }),
  };
}

async function sale(ms: number): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId, clock: clockAt(ms) })),
  );
}

interface Row {
  id: string;
  numSerieFactura: string;
  at: string;
  offsetMinutos: number;
}

function rows(): Row[] {
  return suite.db.all<Row>(
    sql`select id, num_serie_factura as numSerieFactura, fecha_hora_huso_gen_registro as at,
          offset_minutos as offsetMinutos
        from registros_facturacion order by fecha_hora_huso_gen_registro, id`,
  );
}

function listed(filter: (row: Row) => boolean) {
  return rows()
    .filter(filter)
    .map((row) => ({
      recordId: row.id,
      invoiceNumber: row.numSerieFactura,
      generatedAt: row.at,
      offsetMinutes: row.offsetMinutos,
    }));
}

function heads(): Record<string, number> {
  const [row] = suite.db.all<{ n: number }>(
    sql`select max(secuencia) as n from registros_facturacion where node_id = ${nodeId}`,
  );
  return { [nodeId]: row!.n };
}

/** The worked example's sales, written while the clock read 2 h ahead: one at 10:00:30, then one
 * every 5 minutes from 10:05 to 12:00. */
async function aheadSales(): Promise<void> {
  await sale(X + 30 * S);
  for (let k = 1; k <= 24; k++) await sale(X + k * 5 * M);
}

async function insertCheck(input: {
  openedAt: number;
  boot: BootReading;
  heads: Record<string, number>;
}): Promise<{ id: string; detail: unknown }> {
  const detail = {
    clockAt: new Date(input.openedAt).toISOString(),
    bootMs: input.boot.ms,
    bootId: input.boot.id,
    lastRecordAt: rows().at(-1)!.at,
    lastRecordId: rows().at(-1)!.id,
    heads: input.heads,
  };
  const [row] = await suite.db
    .insert(clockChecks)
    .values({
      seq: suite.db.all<{ n: number }>(sql`select count(*) as n from clock_checks`)[0]!.n + 1,
      nodeId,
      openedAt: new Date(input.openedAt),
      reason: "behind_chain",
      detail,
    })
    .returning({ id: clockChecks.id });
  return { id: row!.id, detail };
}

async function insertClosing(input: {
  check: { id: string };
  confirmedAt: number;
  source?: ClockConfirmationSource;
  closing?: Record<string, unknown>;
  proofHeads?: Record<string, number>;
}): Promise<string> {
  const source = input.source ?? "admin";
  const [row] = await suite.db
    .insert(clockConfirmations)
    .values({
      seq:
        suite.db.all<{ n: number }>(sql`select count(*) as n from clock_confirmations`)[0]!.n + 1,
      nodeId,
      boxClockAt: new Date(input.confirmedAt),
      confirmedAt: new Date(input.confirmedAt),
      stepMs: 0,
      source,
      personId: source === "admin" ? "person-1" : null,
      reason: "behind_chain",
      proof: {
        authority: null,
        devices: [],
        admin: null,
        ...(input.proofHeads === undefined ? {} : { heads: input.proofHeads }),
        ...(input.closing === undefined ? {} : { closing: input.closing }),
      },
      checkId: input.check.id,
      registroId: null,
      recordAt: null,
    })
    .returning({ id: clockConfirmations.id });
  return row!.id;
}

/** A closing whose `proof.closing` is worked out as the confirmation path writes it. */
function closingFor(check: { detail: unknown }, confirmedAt: number, boot: BootReading) {
  return {
    bootMs: boot.ms,
    bootId: boot.id,
    ...correctedStart(check, {
      confirmedAt: new Date(confirmedAt),
      bootMs: boot.ms,
      bootId: boot.id,
    }),
    unconfirmed: false,
  };
}

function list(confirmationId: string) {
  return withTransaction(suite.db, (tx) => misdatedRecords(tx, confirmationId));
}

const after = (ms: number) => (row: Row) => Date.parse(row.at) > ms;

describe("misdatedRecords", () => {
  it("lists every sale stamped more than a minute after the stop began (the worked example)", async () => {
    await aheadSales();
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    // An administrator confirms at 11:30, 90 minutes of boot time after the check opened.
    const closing = closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" });
    expect(closing).toMatchObject({ correctedStart: new Date(X).toISOString(), partial: false });
    const id = await insertClosing({ check, confirmedAt: X + 90 * M, closing });
    const answer = await list(id);
    expect(answer).toHaveLength(24);
    expect(answer).toEqual(listed(after(X + M)));
    expect(answer[0]!.generatedAt).toBe(new Date(X + 5 * M).toISOString());
    expect(answer.at(-1)!.generatedAt).toBe(new Date(X + 2 * H).toISOString());
    expect(answer.every((record) => record.offsetMinutes === 60)).toBe(true);
    // The one stamped at 10:00:30 is not listed.
    expect(answer.map((record) => record.generatedAt)).not.toContain(
      new Date(X + 30 * S).toISOString(),
    );
  });

  it("keeps the stored start when the watch restarted mid-stop on the same boot", async () => {
    await aheadSales();
    const first = await withTransaction(suite.db, (tx) =>
      openClockCheck(tx, {
        reading: { instant: new Date(X), offsetMinutes: 60 },
        boot: BOOT,
        nodeId,
      }),
    );
    // The watch restarts 30 minutes later and looks again: the same check answers, unchanged.
    const again = await withTransaction(suite.db, (tx) =>
      openClockCheck(tx, {
        reading: { instant: new Date(X + 30 * M), offsetMinutes: 60 },
        boot: { ms: BOOT_MS + 30 * M, id: "boot-1" },
        nodeId,
      }),
    );
    expect(again).toEqual(first);
    const check = (await withTransaction(suite.db, (tx) => openCheck(tx)))!;
    const closing = closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" });
    const id = await insertClosing({ check, confirmedAt: X + 90 * M, closing });
    expect(await list(id)).toEqual(listed(after(X + M)));
    expect(await list(id)).toHaveLength(24);
  });

  it("lists only the sales stamped after the closing plus a minute after a machine restart", async () => {
    await aheadSales();
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    const closing = closingFor(check, X + 90 * M, { ms: 20_000, id: "boot-2" });
    expect(closing).toMatchObject({
      correctedStart: new Date(X + 90 * M).toISOString(),
      partial: true,
    });
    const id = await insertClosing({ check, confirmedAt: X + 90 * M, closing });
    const answer = await list(id);
    // 11:35 to 12:00.
    expect(answer).toHaveLength(6);
    expect(answer).toEqual(listed(after(X + 91 * M)));
  });

  it("lists a record at the start plus 60 001 ms, not one at plus 60 000 ms", async () => {
    await sale(X + M);
    await sale(X + 2 * H);
    const recordAtMinute = rows()[0]!;
    expect(recordAtMinute.at).toBe(new Date(X + M).toISOString());
    const stop = { bootMs: BOOT_MS, bootId: "boot-1", partial: false, unconfirmed: false };
    const onTheMinute = await insertClosing({
      check: await insertCheck({ openedAt: X, boot: BOOT, heads: heads() }),
      confirmedAt: X + H,
      closing: { ...stop, correctedStart: new Date(X).toISOString() },
    });
    const pastTheMinute = await insertClosing({
      check: await insertCheck({ openedAt: X, boot: BOOT, heads: heads() }),
      confirmedAt: X + H,
      closing: { ...stop, correctedStart: new Date(X - 1).toISOString() },
    });
    expect((await list(onTheMinute)).map((record) => record.recordId)).toEqual([rows()[1]!.id]);
    expect((await list(pastTheMinute)).map((record) => record.recordId)).toEqual([
      recordAtMinute.id,
      rows()[1]!.id,
    ]);
  });

  it("does not list a record written after the check opened, whatever the closing's own heads say", async () => {
    await sale(X + H);
    await sale(X + 2 * H);
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    await sale(X + 3 * H);
    const closing = closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" });
    const id = await insertClosing({
      check,
      confirmedAt: X + 90 * M,
      closing,
      proofHeads: heads(),
    });
    expect(heads()).toEqual({ [nodeId]: 3 });
    const answer = await list(id);
    expect(answer.map((record) => record.generatedAt)).toEqual([
      new Date(X + H).toISOString(),
      new Date(X + 2 * H).toISOString(),
    ]);
  });

  it("lists nothing on a chain the check's opening heads leave out", async () => {
    await sale(X + H);
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: { "another-node": 9 } });
    const closing = closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" });
    const id = await insertClosing({ check, confirmedAt: X + 90 * M, closing });
    expect(await list(id)).toEqual([]);
  });

  it("lists nothing when the check's opening heads name no chain", async () => {
    await sale(X + H);
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: {} });
    const closing = closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" });
    const id = await insertClosing({ check, confirmedAt: X + 90 * M, closing });
    expect(await list(id)).toEqual([]);
  });

  it("answers the same list when read again after more sales (it takes no clock)", async () => {
    await aheadSales();
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    const closing = closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" });
    const id = await insertClosing({ check, confirmedAt: X + 90 * M, closing });
    const first = await list(id);
    await sale(X + 2 * H + 5 * M);
    await sale(X + 2 * H + 10 * M);
    expect(rows()).toHaveLength(27);
    expect(await list(id)).toEqual(first);
    expect(first).toHaveLength(24);
  });

  it("lists nothing for an elapsed closing", async () => {
    await aheadSales();
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    const closing = {
      ...closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" }),
      unconfirmed: true,
    };
    const id = await insertClosing({ check, confirmedAt: X + 90 * M, source: "elapsed", closing });
    expect(await list(id)).toEqual([]);
  });

  it("lists nothing for a confirmation it cannot read a stop from", async () => {
    await aheadSales();
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    const id = await insertClosing({
      check,
      confirmedAt: X + 90 * M,
      closing: { correctedStart: "not a time" },
    });
    expect(await list(id)).toEqual([]);
    const withoutClosing = await insertClosing({
      check: await insertCheck({ openedAt: X, boot: BOOT, heads: heads() }),
      confirmedAt: X + 90 * M,
    });
    expect(await list(withoutClosing)).toEqual([]);
    expect(await list("no-such-confirmation")).toEqual([]);
  });
});
