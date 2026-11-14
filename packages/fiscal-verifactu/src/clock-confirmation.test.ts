import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { ClockAdminConfirm, ClockWitness, TrustedClock } from "@waitron/fiscal";
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

describe("the stop and the record", () => {
  it.each([
    ["the latest record's time", T],
    ["a minute behind it", T - M],
  ])("at %s, no stop: no state and nothing confirmed", async (_name, at) => {
    await sale(T);
    expect(await stateAt(at, twoDevices(at))).toBeNull();
    await confirmsNothing(at, twoDevices(at));
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

type AdminInput = ClockAdminConfirm;

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

  it("two devices disagreeing beside two agreeing, with no AEAT, refuse it as contrary proof", async () => {
    await waitingCheck();
    await adminRefused(
      T,
      [...twoDevices(T), ...twoDevicesAgainst(T)],
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

function incidentParams(code: string): Record<string, unknown>[] {
  return suite.db
    .all<{
      params: string;
    }>(sql`select params from incidents where code = ${code} order by rowid`)
    .map((row) => JSON.parse(row.params) as Record<string, unknown>);
}

const DEVICE = { deviceId: "device-bar", deviceLabel: "Bar", address: "10.0.0.9" };

/** A staff member's reading on the till `DEVICE`, `differenceMs` from the box at `boxMs`. */
function staffReading(boxMs: number, differenceMs: number): AdminInput {
  return {
    ...adminReading(boxMs, differenceMs, S),
    personName: "Ana Staff",
    role: "staff",
    device: DEVICE,
  };
}

describe("a staff member on a till", () => {
  it("without a till, is refused before any write: a caller's bug", async () => {
    await sale(T);
    await openCheck(R);
    const noDevice = { ...staffReading(R - 2 * S, 10 * S), device: undefined };
    await expect(confirmAsAdmin(R, [], noDevice)).rejects.toThrow(/staff/);
    expect(count("clock_confirmations")).toBe(0);
    expect(incidentParams("clock.behind_chain_restarted")).toEqual([]);
  });

  it("never closes a check that waits: refused as not stopped, writing nothing", async () => {
    await sale(T);
    await openCheck(R);
    await adminRefused(T, [], staffReading(T, 0), "clock.confirm_refused", {
      reason: "not_stopped",
    });
    expect(await confirmAsAdmin(T, [], adminReading(T, 0, 0))).toMatchObject({
      confirmation: { source: "admin" },
    });
  });
});
