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

function restartRows(): number {
  return suite.db.all<{ n: number }>(sql`select count(*) as n from clock_stop_restarts`)[0]!.n;
}

describe("VerifactuBackend offers and performs the restart through the seat", () => {
  it("answers a stopped clock with two agreeing devices as offered, then restarts it", async () => {
    await sellAt(T);
    const witnesses = [device("till-1", R - 30 * S), device("till-2", R - 20 * S)];
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
      restart: null,
      offer: "offered",
      proof: { authority: null, devices: witnesses },
      contrary: { authority: null, devices: [] },
    });

    expect(restartRows()).toBe(0);
    const answer = await withTransaction(suite.db, (tx) =>
      backend.restartAfterClockStop!(tx, {
        reading: reading(R),
        witnesses,
        personId: PERSON,
        personName: "Ana",
        nodeId,
        recordId: latestId(),
      }),
    );
    expect(restartRows()).toBe(1);
    expect(answer).toEqual({
      restart: {
        id: expect.any(String),
        personId: PERSON,
        restartedAt: iso(R),
        clockAt: iso(R),
        lastRecordAt: iso(T),
        proofKind: "devices",
      },
      replayed: false,
    });
    const after = await withTransaction(suite.db, (tx) =>
      backend.clockStopState!(tx, reading(R), witnesses),
    );
    expect(after?.offer).toBe("restarted");
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
