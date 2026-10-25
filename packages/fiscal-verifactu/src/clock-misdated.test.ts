import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type {
  BootReading,
  ClockConfirmationSource,
  ClockWitness,
  TrustedClock,
} from "@waitron/fiscal";
import type { NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import {
  closeClockCheckByItself,
  correctedStart,
  openCheck,
  openClockCheck,
  writeClosing,
} from "./clock-checks.js";
import { confirmClockStop } from "./clock-confirmation.js";
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
  heads: Record<string, unknown>;
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
  check: { id: string } | null;
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
      checkId: input.check?.id ?? null,
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

function answer(confirmationId: string) {
  return withTransaction(suite.db, (tx) => misdatedRecords(tx, confirmationId));
}

/** The records of a closing the box can judge. */
async function list(confirmationId: string) {
  const found = await answer(confirmationId);
  if (found === null || !found.known)
    throw new Error(`expected a list, got ${JSON.stringify(found)}`);
  return found.records;
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

  it("lists the same from a closing the real writer stored", async () => {
    await aheadSales();
    await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    const confirmation = await withTransaction(suite.db, async (tx) =>
      writeClosing(tx, {
        check: (await openCheck(tx))!,
        reading: { instant: new Date(X + 90 * M), offsetMinutes: 60 },
        boot: { ms: BOOT_MS + 90 * M, id: "boot-1" },
        nodeId,
        source: "authority",
        personId: null,
        witnesses: { authority: null, devices: [], admin: null },
        unconfirmed: false,
      }),
    );
    expect(await list(confirmation.id)).toEqual(listed(after(X + M)));
    expect(await list(confirmation.id)).toHaveLength(24);
  });

  it("cannot tell for a closing stored unconfirmed, whatever its source", async () => {
    await aheadSales();
    for (const source of ["elapsed", "admin"] as const) {
      const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
      const closing = {
        ...closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" }),
        unconfirmed: true,
      };
      const id = await insertClosing({ check, confirmedAt: X + 90 * M, source, closing });
      expect(await answer(id)).toEqual({ known: false });
    }
  });

  it("cannot tell for a closing whose stored values cannot be read", async () => {
    await aheadSales();
    const good = (check: { detail: unknown }) =>
      closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" });
    const cases: { name: string; id: string }[] = [];
    const add = async (
      name: string,
      closing: (check: { detail: unknown }) => Record<string, unknown> | undefined,
      checkHeads: Record<string, unknown> = heads(),
      withCheck = true,
    ) => {
      const check = await insertCheck({ openedAt: X, boot: BOOT, heads: checkHeads });
      cases.push({
        name,
        id: await insertClosing({
          check: withCheck ? check : null,
          confirmedAt: X + 90 * M,
          closing: closing(check),
        }),
      });
    };
    await add("start not a time", (check) => ({ ...good(check), correctedStart: "not a time" }));
    await add("no start", (check) => ({ ...good(check), correctedStart: undefined }));
    await add("no unconfirmed flag", (check) => ({ ...good(check), unconfirmed: undefined }));
    await add("no closing", () => undefined);
    await add("unreadable heads", good, { [nodeId]: -1 });
    await add("no check", good, heads(), false);
    for (const { name, id } of cases)
      expect({ name, answer: await answer(id) }).toEqual({
        name,
        answer: { known: false },
      });
  });

  it("cannot tell for a closing whose proof or check detail is not JSON", async () => {
    await aheadSales();
    const check = await insertCheck({ openedAt: X, boot: BOOT, heads: heads() });
    const badProof = "88888888-8888-4888-8888-888888888888";
    suite.db.run(sql`
      insert into clock_confirmations
        (id, seq, node_id, box_clock_at, confirmed_at, step_ms, source, reason, proof, check_id)
      values (${badProof}, 1, ${nodeId}, ${new Date(X).toISOString()},
              ${new Date(X + 90 * M).toISOString()}, 0, 'elapsed', 'behind_chain', 'not json',
              ${check.id})`);
    const badDetail = "99999999-9999-4999-8999-999999999999";
    suite.db.run(sql`
      insert into clock_checks (id, seq, node_id, opened_at, reason, detail)
      values (${badDetail}, 2, ${nodeId}, ${new Date(X).toISOString()}, 'behind_chain', 'not json')`);
    const closing = closingFor(check, X + 90 * M, { ms: BOOT_MS + 90 * M, id: "boot-1" });
    const goodProof = await insertClosing({
      check: { id: badDetail },
      confirmedAt: X + 90 * M,
      closing,
    });
    expect(await answer(badProof)).toEqual({ known: false });
    expect(await answer(goodProof)).toEqual({ known: false });
  });

  it("answers null for an id no confirmation has", async () => {
    expect(await answer("no-such-confirmation")).toBeNull();
  });
});

const MISDATED = "clock.records_misdated";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function reading(ms: number) {
  return { instant: new Date(ms), offsetMinutes: 60 };
}

/** The boot reading `ms` of real time after the check at X opened, on the same boot. */
function bootAt(ms: number): BootReading {
  return { ms: BOOT_MS + (ms - X), id: "boot-1" };
}

function authority(boxMs: number, differenceMs: number): ClockWitness {
  return {
    kind: "authority",
    id: "authority",
    boxAt: iso(boxMs),
    witnessAt: iso(boxMs + differenceMs),
    uncertaintyMs: S,
  };
}

function watchLooks(ms: number, boot = bootAt(ms)) {
  return withTransaction(suite.db, (tx) =>
    openClockCheck(tx, { reading: reading(ms), boot, nodeId }),
  );
}

function closesByItself(ms: number, witnesses: readonly ClockWitness[], boot = bootAt(ms)) {
  return withTransaction(suite.db, (tx) =>
    closeClockCheckByItself(tx, { reading: reading(ms), boot, witnesses, nodeId }),
  );
}

/** An administrator's device, two seconds from the box, confirms at `ms`. */
function adminConfirms(ms: number, boot = bootAt(ms)) {
  return withTransaction(suite.db, (tx) =>
    confirmClockStop(tx, {
      reading: reading(ms),
      boot,
      witnesses: [],
      nodeId,
      admin: {
        personId: "person-1",
        personName: "Ana",
        reading: { boxAt: iso(ms), witnessAt: iso(ms + 2 * S), uncertaintyMs: 0 },
      },
    }),
  );
}

function storedProof(confirmationId: string): { closing?: unknown; checkId: string | null } {
  const [row] = suite.db.all<{ proof: string; checkId: string | null }>(
    sql`select proof, check_id as checkId from clock_confirmations where id = ${confirmationId}`,
  );
  return { ...(JSON.parse(row!.proof) as object), checkId: row!.checkId };
}

function misdatedAlerts() {
  return suite.db
    .all<{ saleId: string | null; params: string; severity: string; source: string }>(
      sql`select sale_id as saleId, params, severity, source from incidents
          where code = ${MISDATED} order by detected_at, id`,
    )
    .map((row) => ({ ...row, params: JSON.parse(row.params) as Record<string, unknown> }));
}

function saleOf(recordId: string): string {
  return suite.db.all<{ saleId: string }>(
    sql`select sale_id as saleId from registros_facturacion where id = ${recordId}`,
  )[0]!.saleId;
}

function count(table: string): number {
  return suite.db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(table)}`)[0]!.n;
}

/** The model's fixture: a sale every 5 minutes stamped 10:00 to 11:55, while the clock read ahead. */
async function modelSales(): Promise<void> {
  for (let k = 0; k <= 23; k++) await sale(X + k * 5 * M);
}

/** The alert a closing that lists `records` records, as R7 words it. */
function listAlert(confirmationId: string, records: ReturnType<typeof listed>, partial: boolean) {
  return {
    source: "dashboard",
    severity: "error",
    saleId: saleOf(records[0]!.recordId),
    params: {
      confirmationId,
      count: records.length,
      from: records[0]!.generatedAt,
      fromOffsetMinutes: 60,
      to: records.at(-1)!.generatedAt,
      toOffsetMinutes: 60,
      partial,
      unconfirmed: false,
    },
  };
}

describe("the closings list and alert what they find", () => {
  it("an administrator 90 minutes late lists from the stop's start, and stores the closing (case 1)", async () => {
    await aheadSales();
    const check = await watchLooks(X);
    const { confirmation } = await adminConfirms(X + 90 * M);
    expect(count("clock_checks")).toBe(1);
    expect(storedProof(confirmation!.id)).toMatchObject({
      checkId: check!.id,
      closing: {
        bootMs: BOOT_MS + 90 * M,
        bootId: "boot-1",
        correctedStart: iso(X),
        partial: false,
        unconfirmed: false,
      },
    });
    const records = await list(confirmation!.id);
    expect(records).toEqual(listed(after(X + M)));
    expect(records).toHaveLength(24);
    expect(misdatedAlerts()).toEqual([listAlert(confirmation!.id, records, false)]);
  });

  it("with no check open yet, opens one and closes it partial in the same transaction (case 1b)", async () => {
    await aheadSales();
    expect(count("clock_checks")).toBe(0);
    const { confirmation } = await adminConfirms(X + 90 * M);
    const checks = suite.db.all<{ id: string; openedAt: string; detail: string }>(
      sql`select id, opened_at as openedAt, detail from clock_checks`,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.openedAt).toBe(iso(X + 90 * M));
    expect(JSON.parse(checks[0]!.detail)).toMatchObject({
      clockAt: iso(X + 90 * M),
      bootMs: BOOT_MS + 90 * M,
      bootId: "boot-1",
      heads: heads(),
    });
    expect(storedProof(confirmation!.id)).toMatchObject({
      checkId: checks[0]!.id,
      closing: {
        bootMs: BOOT_MS + 90 * M,
        bootId: "boot-1",
        correctedStart: iso(X + 90 * M),
        partial: true,
        unconfirmed: false,
      },
    });
    const records = await list(confirmation!.id);
    // 11:35 to 12:00, not case 1's 24.
    expect(records).toEqual(listed(after(X + 91 * M)));
    expect(records).toHaveLength(6);
    expect(misdatedAlerts()).toEqual([listAlert(confirmation!.id, records, true)]);
  });

  it("after a lift at 11:30, alerts once, and never lists a sale made under the lift (case 2b)", async () => {
    await modelSales();
    const stampedAhead = rows();
    await watchLooks(X);
    const { confirmation } = await adminConfirms(X + 90 * M);
    // A sale every 5 minutes, real time, until 13:00, the watch looking at each.
    for (let at = X + 95 * M; at <= X + 3 * H; at += 5 * M) {
      await sale(at);
      expect(await watchLooks(at + 10 * S)).toBeNull();
      expect(await closesByItself(at + 10 * S, [authority(at + 10 * S, 0)])).toEqual({
        confirmation: null,
      });
    }
    expect(count("clock_confirmations")).toBe(1);
    const records = await list(confirmation!.id);
    // 10:05 to 11:55: every sale stamped ahead but the one at 10:00.
    expect(records.map((record) => record.recordId)).toEqual(
      stampedAhead.slice(1).map((row) => row.id),
    );
    expect(records).toHaveLength(23);
    expect(records[0]!.generatedAt).toBe(iso(X + 5 * M));
    expect(records.at(-1)!.generatedAt).toBe(iso(X + 115 * M));
    expect(rows()).toHaveLength(24 + 18);
    expect(misdatedAlerts()).toEqual([listAlert(confirmation!.id, records, false)]);
  });

  it("does not list sales made between the stop's end and its closing (case 5b)", async () => {
    await modelSales();
    await watchLooks(X);
    // The stop ends by itself at 11:54:00; two sales follow before AEAT agrees at 11:54:06.
    expect(await watchLooks(X + 114 * M)).toBeNull();
    await sale(X + 114 * M + 2 * S);
    await sale(X + 114 * M + 4 * S);
    const at = X + 114 * M + 6 * S;
    const { confirmation } = await closesByItself(at, [authority(at, 0)]);
    expect(confirmation).toMatchObject({ source: "authority", recordId: null });
    const records = await list(confirmation!.id);
    expect(records).toHaveLength(23);
    expect(records[0]!.generatedAt).toBe(iso(X + 5 * M));
    expect(records.at(-1)!.generatedAt).toBe(iso(X + 115 * M));
    const between = rows()
      .filter((row) => row.at === iso(X + 114 * M + 2 * S) || row.at === iso(X + 114 * M + 4 * S))
      .map((row) => row.id);
    expect(between).toHaveLength(2);
    expect(records.filter((record) => between.includes(record.recordId))).toEqual([]);
    expect(misdatedAlerts()).toEqual([listAlert(confirmation!.id, records, false)]);
  });

  it("a clock set back by mistake and put right lists nothing and alerts nothing (case 5c)", async () => {
    // The clock is right: sales at 09:50, 09:55 and 10:00.
    await sale(X - 10 * M);
    await sale(X - 5 * M);
    await sale(X);
    // At 10:00 it is set 30 minutes back, so it reads 09:30, and the stop opens.
    await watchLooks(X - 30 * M, BOOT);
    const disagreeing = authority(X - 29 * M, 30 * M);
    expect(await closesByItself(X - 29 * M, [disagreeing], bootAt(X + M))).toEqual({
      confirmation: null,
    });
    // At 10:10 it is put right; a sale at 10:10:02, then AEAT agrees at 10:10:06.
    await sale(X + 10 * M + 2 * S);
    const at = X + 10 * M + 6 * S;
    const before = count("incidents");
    const { confirmation } = await closesByItself(at, [disagreeing, authority(at, 0)]);
    expect(confirmation).toMatchObject({ source: "authority" });
    expect(storedProof(confirmation!.id)).toMatchObject({
      closing: { correctedStart: iso(X), partial: false, unconfirmed: false },
    });
    expect(await answer(confirmation!.id)).toEqual({ known: true, records: [] });
    expect(misdatedAlerts()).toEqual([]);
    expect(count("incidents")).toBe(before);
  });

  it("a stop that ends by itself lists once AEAT agrees, with no restarted alert (case 2)", async () => {
    await aheadSales();
    await watchLooks(X);
    // Real time passes 12:00, and AEAT agrees.
    const at = X + 2 * H + 10 * S;
    const { confirmation } = await closesByItself(at, [authority(at, 0)]);
    expect(confirmation).toMatchObject({ source: "authority", recordId: null });
    const records = await list(confirmation!.id);
    expect(records).toEqual(listed(after(X + M)));
    expect(records).toHaveLength(24);
    expect(misdatedAlerts()).toEqual([listAlert(confirmation!.id, records, false)]);
    expect(count("incidents")).toBe(1);
  });

  it("a stop that ends by itself cannot tell once AEAT disagrees, naming no sale (case 2)", async () => {
    await aheadSales();
    await watchLooks(X);
    const at = X + 2 * H + 10 * S;
    const { confirmation } = await closesByItself(at, [authority(at, 20 * M)]);
    expect(confirmation).toMatchObject({ source: "elapsed", recordId: null });
    expect(await answer(confirmation!.id)).toEqual({ known: false });
    expect(misdatedAlerts()).toEqual([
      {
        source: "dashboard",
        severity: "error",
        saleId: null,
        params: {
          confirmationId: confirmation!.id,
          count: 0,
          from: iso(X),
          fromOffsetMinutes: 60,
          partial: false,
          unconfirmed: true,
        },
      },
    ]);
    expect(count("incidents")).toBe(1);
  });

  it("the stop back while a check waited: the old check cannot tell, the new one lists its own (case 7)", async () => {
    await aheadSales();
    await watchLooks(X);
    // Real time passes 12:00 with no witness: the check waits, and a sale is recorded at 12:00:30.
    await sale(X + 2 * H + 30 * S);
    expect(await closesByItself(X + 2 * H + 40 * S, [])).toEqual({ confirmation: null });
    // At 12:05 the clock jumps 2 hours ahead: two sales stamped 14:05 and 14:10.
    await sale(X + 4 * H + 5 * M);
    await sale(X + 4 * H + 10 * M);
    const newStop = rows().slice(-2);
    // At 12:15 it is put right: the stop is back, so the old check closes and a new one opens.
    const before = count("clock_confirmations");
    const fresh = await watchLooks(X + 2 * H + 15 * M);
    expect(count("clock_confirmations")).toBe(before + 1);
    const [old] = suite.db.all<{ id: string }>(
      sql`select id from clock_confirmations where source = 'elapsed'`,
    );
    expect(misdatedAlerts()).toEqual([
      {
        source: "dashboard",
        severity: "error",
        saleId: null,
        params: {
          confirmationId: old!.id,
          count: 0,
          from: iso(X),
          fromOffsetMinutes: 60,
          partial: false,
          unconfirmed: true,
        },
      },
    ]);
    // An administrator confirms the new stop at 12:30.
    const { confirmation } = await adminConfirms(X + 2 * H + 30 * M);
    expect(storedProof(confirmation!.id)).toMatchObject({
      checkId: fresh!.id,
      closing: { correctedStart: iso(X + 2 * H + 15 * M), partial: false, unconfirmed: false },
    });
    const records = await list(confirmation!.id);
    expect(records.map((record) => record.recordId)).toEqual(newStop.map((row) => row.id));
    expect(misdatedAlerts()).toHaveLength(2);
    expect(misdatedAlerts()[1]).toEqual(listAlert(confirmation!.id, records, false));
  });

  it("the stop back and an administrator confirming before the watch looks: the old check cannot tell, the lift lists the new stop", async () => {
    await aheadSales();
    const old = await watchLooks(X);
    await sale(X + 2 * H + 30 * S);
    await sale(X + 4 * H + 5 * M);
    await sale(X + 4 * H + 10 * M);
    const newStop = rows().slice(-2);
    // The clock is put right at 12:15, and the administrator confirms at 12:30 before any look.
    const { confirmation } = await adminConfirms(X + 2 * H + 30 * M);
    const closings = suite.db.all<{ id: string; source: string; checkId: string }>(
      sql`select id, source, check_id as checkId from clock_confirmations order by seq`,
    );
    expect(closings.map((row) => [row.source, row.checkId === old!.id])).toEqual([
      ["elapsed", true],
      ["admin", false],
    ]);
    expect(count("clock_checks")).toBe(2);
    // The new check opened in the lift's own transaction, so its start is not known.
    expect(storedProof(confirmation!.id)).toMatchObject({
      closing: { correctedStart: iso(X + 2 * H + 30 * M), partial: true, unconfirmed: false },
    });
    const records = await list(confirmation!.id);
    expect(records.map((record) => record.recordId)).toEqual(newStop.map((row) => row.id));
    // Both are dated at the confirmation's reading, so they are put in the closings' order.
    const byClosing = misdatedAlerts().sort(
      (a, b) =>
        closings.findIndex((row) => row.id === a.params.confirmationId) -
        closings.findIndex((row) => row.id === b.params.confirmationId),
    );
    expect(byClosing).toEqual([
      {
        source: "dashboard",
        severity: "error",
        saleId: null,
        params: {
          confirmationId: closings[0]!.id,
          count: 0,
          from: iso(X),
          fromOffsetMinutes: 60,
          partial: false,
          unconfirmed: true,
        },
      },
      listAlert(confirmation!.id, records, true),
    ]);
  });

  it("cannot tell on a check that names no latest record: the alert names no sale", async () => {
    await aheadSales();
    const [row] = await suite.db
      .insert(clockChecks)
      .values({
        seq: 1,
        nodeId,
        openedAt: new Date(X),
        reason: "behind_chain",
        detail: { clockAt: iso(X), bootMs: BOOT_MS, bootId: "boot-1", heads: heads() },
      })
      .returning({ id: clockChecks.id });
    const at = X + 2 * H + 10 * S;
    const { confirmation } = await closesByItself(at, [authority(at, 20 * M)]);
    expect(confirmation).toMatchObject({ source: "elapsed", checkId: row!.id });
    expect(misdatedAlerts()).toEqual([
      {
        source: "dashboard",
        severity: "error",
        saleId: null,
        params: {
          confirmationId: confirmation!.id,
          count: 0,
          from: iso(X),
          fromOffsetMinutes: 60,
          partial: false,
          unconfirmed: true,
        },
      },
    ]);
  });
});
