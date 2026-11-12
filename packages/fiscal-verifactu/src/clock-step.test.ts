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
import type { ErrorParams, NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { confirmClockStep } from "./clock-step.js";
import { recordCorrected } from "./clock-stop-incidents.js";
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
    reason: "unusable",
    source: "admin",
    admin: LUIS,
    witnesses: [],
    nodeId,
    ...over,
  };
}

function step(input: ClockStepRequest) {
  return withTransaction(suite.db, (tx) => confirmClockStep(tx, input));
}

describe("who a step of the box's clock names", () => {
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
    ["staff with no person", { source: "staff" as const, admin: undefined }],
    ["staff given an administrator", { source: "staff" as const, admin: LUIS }],
    [
      "staff with no till",
      { source: "staff" as const, admin: { ...ANA_ON_A_DEVICE, device: undefined } },
    ],
    ["admin with no person", { source: "admin" as const, admin: undefined }],
    ["admin given a staff member", { source: "admin" as const, admin: ANA_ON_A_DEVICE }],
  ])("refuses %s before writing anything", async (_name, over) => {
    await sale(T);
    await expect(step(request(T + 5 * M, over))).rejects.toThrow(/confirmClockStep/);
    expect(count("clock_confirmations")).toBe(0);
    expect(count("clock_checks")).toBe(0);
    expect(incidentsOf("clock.corrected")).toEqual([]);
  });
});

describe("a step of the box's clock", () => {
  it("writes a row naming no check and no record", async () => {
    await sale(R - 5 * M);
    const A = R + H;
    const input = request(A);
    await expect(step(input)).resolves.toMatchObject({
      confirmation: { checkId: null, recordId: null, confirmedAt: iso(A) },
    });

    const [row] = await rows();
    expect(row).toMatchObject({ checkId: null, registroId: null, reason: "unusable" });
    expect(row!.proof).toEqual({
      authority: null,
      devices: [],
      admin: LUIS.reading,
      step: { beforeAt: iso(R), afterAt: iso(A), stepMs: input.stepMs, targetAt: input.targetAt },
    });
    expect(count("clock_checks")).toBe(0);
    expect(incidentsOf("clock.corrected")).toHaveLength(1);
  });

  it("writes one row naming the staff member and reason start for a start's step, raising clock.corrected", async () => {
    await sale(R - 5 * M);
    const A = R + H;
    await step(
      request(A, {
        reason: "start",
        source: "staff",
        admin: ANA_ON_A_DEVICE,
        witnesses: [device("till-1", R - S, A - R, "10.0.0.1")],
      }),
    );

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      reason: "start",
      source: "staff",
      personId: "person-ana",
      checkId: null,
      registroId: null,
      confirmedAt: new Date(A),
    });
    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      { confirmationId: stored[0]!.id },
    ]);
  });

  it("says the clock moved back when an administrator sets it earlier", async () => {
    await sale(R - 5 * H);
    const A = R - H;
    await step(request(A, { source: "admin", admin: LUIS, witnesses: [], stepMs: A - R }));

    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      { stepMs: A - R, direction: "back" },
    ]);
  });

  it("records an unusable clock's step with no check and no record named", async () => {
    await sale(T);
    const before = Date.parse("2001-01-01T10:00:00.000Z");
    const A = T + 5 * M;
    await step(
      request(A, {
        before: reading(before),
        reason: "unusable",
        stepMs: A - before,
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
    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      { confirmationId: row!.id, before: iso(before) },
    ]);
  });
});

describe("a step that failed verification", () => {
  it("writes no row and records the measured step as unverified", async () => {
    await sale(T);
    const A = T + 5 * M;
    expect(await step(request(A, { verified: false }))).toEqual({
      confirmation: null,
      corrected: expect.anything(),
    });

    expect(count("clock_confirmations")).toBe(0);
    expect(count("clock_checks")).toBe(0);
    expect(incidentsOf("clock.corrected").map((i) => i.params)).toMatchObject([
      { confirmationId: null, verified: false, unverified: true, stepMs: A - R - 2 * S },
    ]);
  });

  it("records nothing when the clock moved by no more than a second", async () => {
    await sale(T);
    expect(await step(request(R + 3 * S, { verified: false }))).toEqual({
      confirmation: null,
      corrected: null,
    });

    expect(count("clock_confirmations")).toBe(0);
    expect(incidentsOf("clock.corrected")).toEqual([]);
  });
});

describe("the clock.corrected a step answers", () => {
  function openCorrected() {
    return suite.db.all<{ id: string; params: string }>(
      sql`select id, params from incidents where code = 'clock.corrected' and acknowledged_at is null`,
    );
  }

  it("answers a verified step's alert by its id, with the params it stored", async () => {
    await sale(T);
    const { corrected } = await step(request(T + 5 * M));

    const [open] = openCorrected();
    expect(corrected).toEqual({ id: open!.id, params: JSON.parse(open!.params) });
  });

  it("answers an unverified step's alert by its id, with the params it stored", async () => {
    await sale(T);
    const { corrected } = await step(request(T + 5 * M, { verified: false }));

    const [open] = openCorrected();
    expect(corrected).toEqual({ id: open!.id, params: JSON.parse(open!.params) });
  });

  it("answers the second step's alert, not the first one it marked handled", async () => {
    await sale(R - 5 * M);
    const first = R + H;
    await step(request(first));
    const { corrected } = await step(
      request(first + 2 * H, { before: reading(first + M), stepMs: H }),
    );

    const open = openCorrected();
    expect(open).toHaveLength(1);
    expect(corrected?.id).toBe(open[0]!.id);
  });

  it("answers none when the clock moved by no more than a second", async () => {
    await sale(T);
    const { corrected } = await step(request(R + 3 * S, { verified: false }));
    expect(corrected).toBeNull();
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

it("never marks the open clock.corrected handled before it was detected, when a second step goes back", async () => {
  await sale(R - 5 * M);
  const first = R + H;
  await step(request(first));
  const second = first - 30 * M;
  await step(request(second, { before: reading(first + M), stepMs: second - first - M }));

  const corrected = incidentsOf("clock.corrected");
  expect(corrected[0]).toMatchObject({ acknowledged_at: iso(first) });
  expect(corrected[1]).toMatchObject({ acknowledged_at: null });
});

describe("the seat's chain heads", () => {
  it("answers each chain's node with its highest record position, and none before a record", async () => {
    const heads = () => withTransaction(suite.db, (tx) => backend.recordHeads(tx));
    await expect(heads()).resolves.toEqual({});
    await sale(R);
    await sale(R + M);
    await expect(heads()).resolves.toEqual({ [nodeId]: 2 });
  });
});

describe("latestClockStep", () => {
  const latest = () => withTransaction(suite.db, (tx) => backend.latestClockStep(tx));

  it("answers null before the box has stepped its clock", async () => {
    await expect(latest()).resolves.toBeNull();
  });

  it("answers the step written last, by its order, not by its date", async () => {
    await sale(R - 5 * H);
    await step(request(R + H));
    const back = R - 2 * H;
    await step(request(back, { source: "admin", admin: LUIS, witnesses: [], stepMs: back - R }));

    await expect(latest()).resolves.toEqual({ confirmedAt: iso(back), stepMs: back - R });
  });

  it("answers a step it could not verify, which writes no row, and one written after a verified step", async () => {
    await sale(T);
    const A = T + 400 * 24 * H;
    await step(request(A, { verified: false }));
    await expect(latest()).resolves.toEqual({ confirmedAt: iso(A), stepMs: A - R - 2 * S });

    const back = R - 2 * H;
    await step(request(back, { source: "admin", admin: LUIS, witnesses: [], stepMs: back - R }));
    await step(request(R + H, { verified: false }));
    await expect(latest()).resolves.toEqual({ confirmedAt: iso(R + H), stepMs: R + H - R - 2 * S });
  });

  it("passes over a confirmation that moved nothing", async () => {
    await sale(R - 5 * M);
    await step(request(R + H));
    await withTransaction(suite.db, async (tx) => {
      const [{ seq }] = await tx
        .select({ seq: sql<number>`max(${clockConfirmations.seq})` })
        .from(clockConfirmations);
      await tx.insert(clockConfirmations).values({
        seq: seq + 1,
        nodeId,
        boxClockAt: new Date(R + 2 * H),
        confirmedAt: new Date(R + 2 * H),
        stepMs: 0,
        source: "authority",
        reason: "behind_chain",
        proof: {},
      });
      const { params } = incidentsOf("clock.corrected")[0]!;
      await recordCorrected(tx, {
        detectedAt: new Date(R + 2 * H),
        params: {
          ...(params as ErrorParams["clock.corrected"]),
          after: iso(R + 2 * H),
          stepMs: 0,
        },
      });
    });

    await expect(latest()).resolves.toEqual({
      confirmedAt: iso(R + H),
      stepMs: request(R + H).stepMs,
    });
  });
});
