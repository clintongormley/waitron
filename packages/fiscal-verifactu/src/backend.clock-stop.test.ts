import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { ClockWitness, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const H = 3_600_000;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 2 * H;
const PERSON = "33333333-3333-4333-8333-333333333333";

let backend: FiscalBackend;
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

const iso = (ms: number) => new Date(ms).toISOString();
const reading = (ms: number) => ({ instant: new Date(ms), offsetMinutes: 60 });

async function sellAt(ms: number): Promise<void> {
  const clock: TrustedClock = {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(ms), offsetMinutes: 60 }),
  };
  await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId, clock })),
  );
}

function device(id: string, boxMs: number): ClockWitness {
  return { kind: "device", id, boxAt: iso(boxMs), witnessAt: iso(boxMs + 2 * S), uncertaintyMs: 0 };
}

function latestId(): string {
  return suite.db.all<{ id: string }>(
    sql`select id from registros_facturacion order by fecha_hora_huso_gen_registro desc, id desc limit 1`,
  )[0]!.id;
}

const M = 60_000;
const BOOT = { ms: 1_000_000, id: "boot-1" };

function deviceAt(id: string, address: string, boxMs: number): ClockWitness {
  return { ...device(id, boxMs), address };
}

function invoiceNumber(recordId: string): string {
  return suite.db.all<{ n: string }>(
    sql`select num_serie_factura as n from registros_facturacion where id = ${recordId}`,
  )[0]!.n;
}

function count(table: string): number {
  return suite.db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(table)}`)[0]!.n;
}

describe("VerifactuBackend confirms the clock through the seat", () => {
  it("has no restart method left", () => {
    expect("restartAfterClockStop" in backend).toBe(false);
  });

  it("answers a stop with two agreeing devices as ready, then confirms it automatically", async () => {
    await sellAt(T);
    const witnesses = [
      deviceAt("till-1", "10.0.0.1", R - 30 * S),
      deviceAt("till-2", "10.0.0.2", R - 20 * S),
    ];
    const state = await withTransaction(suite.db, (tx) =>
      backend.clockStopState!(tx, reading(R), witnesses),
    );
    expect(state).toEqual({
      clockAt: iso(R),
      offsetMinutes: 60,
      lastRecordAt: iso(T),
      lastRecordOffsetMinutes: 60,
      recordId: latestId(),
      gapMs: 2 * H,
      proof: "ready",
      agreeing: { authority: null, devices: witnesses },
      contrary: { authority: null, devices: [] },
      confirmation: null,
    });

    const opened = await withTransaction(suite.db, (tx) =>
      backend.openClockCheck!(tx, { reading: reading(R), boot: BOOT, nodeId }),
    );
    expect(opened).toEqual({ id: expect.any(String) });
    expect(count("clock_confirmations")).toBe(0);
    const { confirmation } = await withTransaction(suite.db, (tx) =>
      backend.confirmClockStop!(tx, { reading: reading(R), boot: BOOT, witnesses, nodeId }),
    );
    expect(count("clock_confirmations")).toBe(1);
    expect(confirmation).toEqual({
      id: expect.any(String),
      seq: 1,
      source: "devices",
      personId: null,
      confirmedAt: iso(R),
      checkId: opened!.id,
      recordId: latestId(),
    });
    const after = await withTransaction(suite.db, (tx) =>
      backend.clockStopState!(tx, reading(R), witnesses),
    );
    expect(after?.proof).toBe("confirmed");
    expect(after?.confirmation).toEqual({
      id: confirmation!.id,
      source: "devices",
      personId: null,
      confirmedAt: iso(R),
    });
  });

  it("confirms on an administrator's device and lists the sales dated wrongly", async () => {
    await sellAt(T);
    const sold = latestId();
    await withTransaction(suite.db, (tx) =>
      backend.openClockCheck!(tx, { reading: reading(R), boot: BOOT, nodeId }),
    );
    const at = R + 10 * M;
    const { confirmation } = await withTransaction(suite.db, (tx) =>
      backend.confirmClockStop!(tx, {
        reading: reading(at),
        boot: { ms: BOOT.ms + 10 * M, id: BOOT.id },
        witnesses: [],
        nodeId,
        admin: {
          personId: PERSON,
          personName: "Ana",
          reading: { boxAt: iso(at), witnessAt: iso(at), uncertaintyMs: 0 },
        },
      }),
    );
    expect(confirmation).toMatchObject({ source: "admin", personId: PERSON, recordId: sold });
    expect(
      await withTransaction(suite.db, (tx) => backend.misdatedRecords!(tx, confirmation!.id)),
    ).toEqual({
      known: true,
      records: [
        {
          recordId: sold,
          invoiceNumber: invoiceNumber(sold),
          generatedAt: iso(T),
          offsetMinutes: 60,
        },
      ],
    });
    expect(
      await withTransaction(suite.db, (tx) =>
        backend.misdatedRecords!(tx, "00000000-0000-4000-8000-000000000000"),
      ),
    ).toBeNull();
  });

  it("answers a check that waits, and closes it only on a fresh witness", async () => {
    await sellAt(T);
    const opened = await withTransaction(suite.db, (tx) =>
      backend.openClockCheck!(tx, { reading: reading(R), boot: BOOT, nodeId }),
    );
    expect(
      await withTransaction(suite.db, (tx) => backend.waitingClockCheck!(tx, reading(T))),
    ).toEqual({ checkId: opened!.id, openedAt: iso(R) });

    expect(
      await withTransaction(suite.db, (tx) =>
        backend.closeClockCheckByItself!(tx, {
          reading: reading(T),
          boot: BOOT,
          witnesses: [],
          nodeId,
        }),
      ),
    ).toEqual({ confirmation: null });
    expect(count("clock_confirmations")).toBe(0);

    const witnesses = [deviceAt("till-1", "10.0.0.1", T), deviceAt("till-2", "10.0.0.2", T)];
    const { confirmation } = await withTransaction(suite.db, (tx) =>
      backend.closeClockCheckByItself!(tx, { reading: reading(T), boot: BOOT, witnesses, nodeId }),
    );
    expect(count("clock_confirmations")).toBe(1);
    expect(confirmation).toMatchObject({ source: "devices", checkId: opened!.id, recordId: null });
    expect(
      await withTransaction(suite.db, (tx) => backend.waitingClockCheck!(tx, reading(T))),
    ).toBeNull();
  });

  it("answers no stop while the clock is not behind", async () => {
    await sellAt(T);
    expect(
      await withTransaction(suite.db, (tx) => backend.clockStopState!(tx, reading(T), [])),
    ).toBeNull();
  });

  it("notes a clock proved wrong with no restart in force as touching nothing", async () => {
    await sellAt(T);
    expect(
      await withTransaction(suite.db, (tx) =>
        backend.noteClockProvedWrong!(tx, {
          trustedUntil: new Date(R),
          observedAt: new Date(T),
          reason: "jump",
        }),
      ),
    ).toEqual({ recorded: [], unused: [], held: [] });
  });
});
