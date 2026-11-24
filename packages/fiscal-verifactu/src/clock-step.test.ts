import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type {
  ClockAdminConfirm,
  ClockStepRequest,
  ClockWitness,
  TrustedClock,
} from "@waitron/fiscal";
import type { NodeId, SaleId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTaxpayerWithSif } from "../test/fixtures.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { confirmClockStep } from "./clock-step.js";

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
  ({ nodeId, seriesId } = await seedTaxpayerWithSif(suite.db));
  await seedPerson(suite.db, {
    id: ANA_ON_A_DEVICE.personId,
    displayName: ANA_ON_A_DEVICE.personName,
  });
  await seedPerson(suite.db, { id: LUIS.personId, displayName: LUIS.personName });
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
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

async function sale(ms: number, seller = { nodeId, seriesId }): Promise<SaleId> {
  const { saleId } = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ ...seller, clock: clockAt(ms) })),
  );
  return saleId;
}

function device(id: string, boxMs: number, differenceMs: number, address: string): ClockWitness {
  return {
    id,
    address,
    boxAt: iso(boxMs),
    witnessAt: iso(boxMs + differenceMs),
    uncertaintyMs: 0,
  };
}

function rows() {
  return suite.db
    .all<{ id: string; personId: string; at: string; data: string }>(
      sql`
    select id, person_id as personId, at, data
    from verifactu_history where kind = 'clock.confirmed' order by seq`,
    )
    .map(({ data, ...row }) => ({
      ...row,
      ...(JSON.parse(data) as {
        source: string;
        reason: string;
        confirmedAt: string;
        stepMs: number;
        proof: unknown;
      }),
    }));
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

    const [row] = rows();
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

    const [row] = rows();
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
    expect(rows()).toHaveLength(0);
    expect(incidentsOf("clock.corrected")).toEqual([]);
  });
});

describe("a step of the box's clock", () => {
  it("links a verified step to its evidence in fiscal history", async () => {
    await sale(R - 5 * M);
    const A = R + H;
    const input = request(A);
    const recorded = await step(input);
    expect(recorded).toMatchObject({
      confirmation: { checkId: null, recordId: null, confirmedAt: iso(A) },
    });

    const [row] = rows();
    expect(row).toMatchObject({ id: recorded.confirmation!.id, at: iso(R), reason: "unusable" });
    expect(row!.proof).toEqual({
      devices: [],
      admin: LUIS.reading,
      step: { beforeAt: iso(R), afterAt: iso(A), stepMs: input.stepMs, targetAt: input.targetAt },
    });
    expect(incidentsOf("clock.corrected")).toHaveLength(1);
  });

  it("rounds the stored step and keeps the measured value in its proof and incident", async () => {
    const { confirmation } = await step(request(R + 3 * S, { stepMs: 999.6 }));
    expect(rows()).toMatchObject([
      { id: confirmation!.id, stepMs: 1000, proof: { step: { stepMs: 999.6 } } },
    ]);
    expect(incidentsOf("clock.corrected").map((incident) => incident.params)).toMatchObject([
      { confirmationId: confirmation!.id, stepMs: 999.6 },
    ]);
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

    const stored = rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      reason: "start",
      source: "staff",
      personId: "person-ana",
      confirmedAt: iso(A),
    });
    expect((stored[0]!.proof as { devices: unknown }).devices).toEqual([
      { deviceId: "till-1", address: "10.0.0.1", boxAt: iso(R - S), witnessAt: iso(A - S) },
    ]);
    expect(stored[0]!.proof).toHaveProperty("staff", {
      deviceId: "till-1",
      address: "10.0.0.1",
      ...ANA_ON_A_DEVICE.reading,
    });
    expect(stored[0]!.proof).not.toHaveProperty("admin");
    expect(stored[0]!.proof).not.toHaveProperty("device");
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

  it("keeps the reading before an unusable clock is corrected", async () => {
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

    const [row] = rows();
    expect(row).toMatchObject({
      reason: "unusable",
      at: iso(before),
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

    expect(rows()).toHaveLength(0);
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

    expect(rows()).toHaveLength(0);
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

  it("answers a node's record at its highest position, never another node's", async () => {
    const other = await seedTaxpayerWithSif(suite.db);
    const latest = (node: NodeId) =>
      withTransaction(suite.db, (tx) => backend.latestRecord(tx, node));
    await expect(latest(nodeId)).resolves.toBeNull();

    await sale(R);
    const second = await sale(R + M);
    await expect(latest(nodeId)).resolves.toEqual({ position: 2, saleId: second });
    await expect(latest(other.nodeId)).resolves.toBeNull();

    for (const at of [2, 3]) await sale(R + at * M, other);
    const elsewhere = await sale(R + 4 * M, other);
    await expect(latest(nodeId)).resolves.toEqual({ position: 2, saleId: second });
    await expect(latest(other.nodeId)).resolves.toEqual({ position: 3, saleId: elsewhere });
  });
});

describe("latestClockStep", () => {
  const latest = () => withTransaction(suite.db, (tx) => backend.latestClockStep(tx));

  it("answers null before the box has stepped its clock", async () => {
    await expect(latest()).resolves.toBeNull();
  });

  it("answers the step the backend's confirmClockStep recorded, with the values sent", async () => {
    await sale(R - 5 * M);
    const input = request(R + H);
    const recorded = await withTransaction(suite.db, (tx) => backend.confirmClockStep(tx, input));

    expect(recorded.confirmation).toMatchObject({ source: "admin", confirmedAt: iso(R + H) });
    expect(rows()).toHaveLength(1);
    await expect(latest()).resolves.toEqual({ confirmedAt: iso(R + H), stepMs: input.stepMs });
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
    await step(request(R + 2 * H, { stepMs: 0 }));

    const corrected = incidentsOf("clock.corrected");
    expect(corrected).toHaveLength(2);
    expect(corrected[1]!.params).toMatchObject({ stepMs: 0 });
    await expect(latest()).resolves.toEqual({
      confirmedAt: iso(R + H),
      stepMs: request(R + H).stepMs,
    });
  });
});
