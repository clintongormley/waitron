import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type {
  ClockAdminConfirm,
  ClockStepRequest,
  ClockWitness,
  TrustedClock,
} from "@waitron/fiscal";
import type { NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { clockBehindChain } from "./clock-behind.js";
import { nextCheckSeq, openCheck as openCheckOf } from "./clock-checks.js";
import { confirmClockStep } from "./clock-step.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 14.5 * H;
const BOOT_BEFORE = { ms: 10 * M, id: "boot-1" };
const BOOT_AFTER = { ms: 10 * M + 2 * S, id: "boot-1" };

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

async function sale(ms: number): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId, clock: clockAt(ms) })),
  );
}

function authority(boxMs: number, differenceMs: number): ClockWitness {
  return {
    kind: "authority",
    id: "authority",
    boxAt: iso(boxMs),
    witnessAt: iso(boxMs + differenceMs),
    uncertaintyMs: 50,
  };
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

/** A `behind_chain` check opened at `ms` on `boot`, as the clock watch opens one. */
function openCheck(ms: number, boot = BOOT_BEFORE): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const [row] = await tx
      .insert(clockChecks)
      .values({
        seq: await nextCheckSeq(tx),
        nodeId,
        openedAt: new Date(ms),
        reason: "behind_chain",
        detail: {
          clockAt: iso(ms),
          offsetMinutes: 60,
          bootMs: boot.ms,
          bootId: boot.id,
          heads: headsNow(),
        },
      })
      .returning({ id: clockChecks.id });
    return row!.id;
  });
}

function checkIds(): string[] {
  return suite.db
    .all<{ id: string }>(sql`select id from clock_checks order by seq`)
    .map((r) => r.id);
}

function rows() {
  return suite.db.select().from(clockConfirmations).orderBy(clockConfirmations.seq);
}

function incidentsOf(code: string) {
  return suite.db
    .all<{
      params: string;
      acknowledged_at: string | null;
      acknowledged_by: string | null;
      severity: string;
      sale_id: string | null;
    }>(
      sql`select params, acknowledged_at, acknowledged_by, severity, sale_id from incidents where code = ${code} order by rowid`,
    )
    .map((row) => ({ ...row, params: JSON.parse(row.params) as Record<string, unknown> }));
}

const ANA_ON_A_DEVICE: ClockAdminConfirm = {
  personId: "person-ana",
  personName: "Ana",
  role: "staff",
  reading: { boxAt: iso(R), witnessAt: iso(T - 2 * H), uncertaintyMs: 40 },
  device: { deviceId: "till-1", deviceLabel: "Barra 1", address: "10.0.0.1" },
};

const LUIS: ClockAdminConfirm = {
  personId: "person-luis",
  personName: "Luis",
  reading: { boxAt: iso(R), witnessAt: iso(T + 5 * M), uncertaintyMs: 30 },
};

function request(after: number, over: Partial<ClockStepRequest> = {}): ClockStepRequest {
  return {
    before: reading(R),
    after: reading(after),
    bootBefore: BOOT_BEFORE,
    bootAfter: BOOT_AFTER,
    targetAt: iso(after - 2 * S),
    stepMs: after - R - 2 * S,
    verified: true,
    reason: "behind_chain",
    source: "authority",
    witnesses: [authority(R - S, after - R)],
    nodeId,
    ...over,
  };
}

function step(input: ClockStepRequest) {
  return withTransaction(suite.db, (tx) => confirmClockStep(tx, input));
}

function behindAt(ms: number) {
  return withTransaction(suite.db, (tx) => clockBehindChain(tx, reading(ms)));
}

describe("a step of the box's clock during a payment stop", () => {
  it("records AEAT setting the clock forward past the latest record, closing a check opened at the before reading", async () => {
    await sale(T);
    const A = T + 5 * M;
    const input = request(A);
    const answer = await step(input);

    const [row] = await rows();
    expect(await rows()).toHaveLength(1);
    expect(checkIds()).toHaveLength(1);
    expect(row).toMatchObject({
      boxClockAt: new Date(R),
      confirmedAt: new Date(A),
      stepMs: input.stepMs,
      source: "authority",
      personId: null,
      reason: "behind_chain",
      checkId: checkIds()[0],
      registroId: null,
      recordAt: null,
    });
    expect(answer).toEqual({
      confirmation: {
        id: row!.id,
        seq: 1,
        source: "authority",
        personId: null,
        confirmedAt: iso(A),
        checkId: checkIds()[0],
        recordId: null,
      },
    });
    // A proof key is written only when set: no staff and no device key on AEAT's step.
    expect(row!.proof).toEqual({
      authority: { boxAt: iso(R - S), witnessAt: iso(A - S), uncertaintyMs: 50 },
      devices: [],
      admin: null,
      step: { beforeAt: iso(R), afterAt: iso(A), stepMs: input.stepMs, targetAt: input.targetAt },
      heads: headsNow(),
      closing: {
        bootMs: BOOT_AFTER.ms,
        bootId: BOOT_AFTER.id,
        // The check opened at the before reading on the same boot, two seconds earlier.
        correctedStart: iso(A - 2 * S),
        partial: true,
        unconfirmed: false,
      },
    });
    expect(await behindAt(A)).toBeNull();
    expect(incidentsOf("clock.corrected")).toEqual([
      {
        params: {
          confirmationId: row!.id,
          source: "authority",
          person: null,
          deviceId: null,
          device: null,
          before: iso(R),
          beforeOffsetMinutes: 60,
          after: iso(A),
          afterOffsetMinutes: 60,
          stepMs: input.stepMs,
          direction: "forward",
          verified: true,
          unverified: false,
          byAdmin: false,
          byStaff: false,
        },
        acknowledged_at: null,
        acknowledged_by: null,
        severity: "warning",
        sale_id: null,
      },
    ]);
    expect(incidentsOf("clock.behind_chain_restarted")).toEqual([]);
  });

  it("names the latest record when a staff member's till sets the clock to a time still behind it, lifting the stop from the after reading", async () => {
    await sale(T);
    const A = T - 2 * H;
    await step(
      request(A, {
        source: "staff",
        admin: ANA_ON_A_DEVICE,
        witnesses: [device("till-1", R - S, A - R, "10.0.0.1")],
      }),
    );

    const [row] = await rows();
    expect(row).toMatchObject({
      source: "staff",
      personId: "person-ana",
      registroId: latestId(),
      recordAt: new Date(T),
      confirmedAt: new Date(A),
    });
    const proof = row!.proof as Record<string, unknown>;
    expect(proof["staff"]).toEqual({
      deviceId: "till-1",
      address: "10.0.0.1",
      boxAt: iso(R),
      witnessAt: iso(T - 2 * H),
      uncertaintyMs: 40,
    });
    expect(proof).not.toHaveProperty("admin");
    expect(proof).not.toHaveProperty("device");
    expect(proof["devices"]).toEqual([
      {
        deviceId: "till-1",
        address: "10.0.0.1",
        boxAt: iso(R - S),
        witnessAt: iso(A - S),
      },
    ]);

    expect(await behindAt(A)).toBeNull();
    expect(await behindAt(A - 61 * S)).not.toBeNull();
    expect(incidentsOf("clock.behind_chain_restarted").map((i) => i.params)).toEqual([
      {
        confirmationId: row!.id,
        confirmedBy: "staff",
        person: "Ana",
        clockAt: iso(A),
        lastRecordAt: iso(T),
        byStaff: true,
        device: "Barra 1",
      },
    ]);
    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      {
        confirmationId: row!.id,
        source: "staff",
        person: "Ana",
        deviceId: "till-1",
        device: "Barra 1",
        byAdmin: false,
        byStaff: true,
      },
    ]);
  });

  it("stores an administrator's step from a till under admin with the till beside it as its device", async () => {
    await sale(T);
    const A = T + 5 * M;
    const terraza = { deviceId: "till-2", deviceLabel: "Terraza", address: "10.0.0.2" };
    await step(request(A, { source: "admin", admin: { ...LUIS, device: terraza }, witnesses: [] }));

    const [row] = await rows();
    expect(row).toMatchObject({ source: "admin", personId: "person-luis" });
    const proof = row!.proof as Record<string, unknown>;
    expect(proof["admin"]).toEqual(LUIS.reading);
    expect(proof["device"]).toEqual({ deviceId: "till-2", address: "10.0.0.2" });
    expect(proof).not.toHaveProperty("staff");
    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      {
        source: "admin",
        person: "Luis",
        deviceId: "till-2",
        device: "Terraza",
        byAdmin: true,
        byStaff: false,
      },
    ]);
  });

  it("stores an administrator's step from the dashboard under admin with no device key, naming no till", async () => {
    await sale(T);
    await step(request(T + 5 * M, { source: "admin", admin: LUIS, witnesses: [] }));

    const [row] = await rows();
    const proof = row!.proof as Record<string, unknown>;
    expect(proof["admin"]).toEqual(LUIS.reading);
    expect(proof).not.toHaveProperty("device");
    expect(proof).not.toHaveProperty("staff");
    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      { source: "admin", person: "Luis", deviceId: null, device: null, byAdmin: true },
    ]);
  });

  it.each([
    ["staff with no person", { source: "staff" as const }],
    ["staff given an administrator", { source: "staff" as const, admin: LUIS }],
    [
      "staff with no till",
      { source: "staff" as const, admin: { ...ANA_ON_A_DEVICE, device: undefined } },
    ],
    ["admin with no person", { source: "admin" as const }],
    ["admin given a staff member", { source: "admin" as const, admin: ANA_ON_A_DEVICE }],
    ["authority given a person", { source: "authority" as const, admin: LUIS }],
  ])("refuses %s before writing anything", async (_name, over) => {
    await sale(T);
    await expect(step(request(T + 5 * M, over))).rejects.toThrow(/confirmClockStep/);
    expect(count("clock_confirmations")).toBe(0);
    expect(count("clock_checks")).toBe(0);
    expect(incidentsOf("clock.corrected")).toEqual([]);
  });

  it("lists a record written before the check opened and stamped more than a minute after the corrected start", async () => {
    await sale(T);
    const checkId = await openCheck(R);
    const A = T - 2 * H;
    const bootAfter = { ms: BOOT_BEFORE.ms + 30 * M, id: "boot-1" };
    await step(request(A, { source: "staff", admin: ANA_ON_A_DEVICE, bootAfter, witnesses: [] }));

    const [row] = await rows();
    expect(row!.checkId).toBe(checkId);
    expect((row!.proof as { closing: unknown }).closing).toEqual({
      bootMs: bootAfter.ms,
      bootId: "boot-1",
      correctedStart: iso(A - 30 * M),
      partial: false,
      unconfirmed: false,
    });
    expect(incidentsOf("clock.records_misdated").map((i) => i.params)).toMatchObject([
      { confirmationId: row!.id, count: 1, from: iso(T), to: iso(T), partial: false },
    ]);
  });
});

describe("a step of the box's clock with no payment stop", () => {
  it("writes a row naming no check and no record when nothing stops and no check is open", async () => {
    await sale(R - 5 * M);
    const A = R + H;
    const input = request(A);
    await expect(step(input)).resolves.toMatchObject({
      confirmation: { checkId: null, recordId: null, confirmedAt: iso(A) },
    });

    const [row] = await rows();
    expect(row).toMatchObject({ checkId: null, registroId: null, reason: "behind_chain" });
    expect(row!.proof).toEqual({
      authority: { boxAt: iso(R - S), witnessAt: iso(A - S), uncertaintyMs: 50 },
      devices: [],
      admin: null,
      step: { beforeAt: iso(R), afterAt: iso(A), stepMs: input.stepMs, targetAt: input.targetAt },
    });
    expect(count("clock_checks")).toBe(0);
    expect(incidentsOf("clock.records_misdated")).toEqual([]);
    expect(incidentsOf("clock.corrected")).toHaveLength(1);
  });

  it("says the clock moved back when an administrator sets it earlier", async () => {
    await sale(R - 5 * H);
    const A = R - H;
    await step(request(A, { source: "admin", admin: LUIS, witnesses: [], stepMs: A - R }));

    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      { stepMs: A - R, direction: "back" },
    ]);
  });

  it("closes a check whose stop ended by itself", async () => {
    await sale(R - 5 * M);
    const checkId = await openCheck(R - 30 * M);
    await step(request(R + H));

    const [row] = await rows();
    expect(row!.checkId).toBe(checkId);
    expect(row!.registroId).toBeNull();
    expect(count("clock_checks")).toBe(1);
  });

  it("records an unusable clock's step with no check, no record named and nothing listed, leaving an open check open", async () => {
    await sale(T);
    const checkId = await openCheck(R);
    const before = Date.parse("2001-01-01T10:00:00.000Z");
    const A = T + 5 * M;
    await step(
      request(A, {
        before: reading(before),
        reason: "unusable",
        stepMs: A - before,
        witnesses: [authority(before, A - before)],
      }),
    );

    const [row] = await rows();
    expect(row).toMatchObject({
      reason: "unusable",
      checkId: null,
      registroId: null,
      boxClockAt: new Date(before),
    });
    expect(row!.proof).not.toHaveProperty("closing");
    expect(checkIds()).toEqual([checkId]);
    expect(await withTransaction(suite.db, (tx) => openCheckOf(tx))).toMatchObject({ id: checkId });
    expect(incidentsOf("clock.records_misdated")).toEqual([]);
    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      { confirmationId: row!.id, before: iso(before) },
    ]);
  });
});

describe("a step that failed verification", () => {
  it("writes no row and records the measured step as unverified", async () => {
    await sale(T);
    const A = T + 5 * M;
    expect(await step(request(A, { verified: false }))).toEqual({ confirmation: null });

    expect(count("clock_confirmations")).toBe(0);
    expect(count("clock_checks")).toBe(0);
    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      { confirmationId: null, verified: false, unverified: true, stepMs: A - R - 2 * S },
    ]);
  });

  it("records nothing when the clock moved by no more than a second", async () => {
    await sale(T);
    expect(await step(request(R + 3 * S, { verified: false }))).toEqual({ confirmation: null });

    expect(count("clock_confirmations")).toBe(0);
    expect(incidentsOf("clock.corrected")).toEqual([]);
  });
});

it("marks the open clock.corrected handled by the system when a second step is recorded", async () => {
  await sale(R - 5 * M);
  const first = R + H;
  await step(request(first));
  const second = first + 2 * H;
  await step(request(second, { before: reading(first + M), stepMs: H }));

  const corrected = incidentsOf("clock.corrected");
  expect(corrected).toHaveLength(2);
  expect(corrected[0]).toMatchObject({ acknowledged_at: iso(second), acknowledged_by: null });
  expect(corrected[1]).toMatchObject({ acknowledged_at: null });
  expect(corrected[1]!.params).toMatchObject({ after: iso(second) });
});
