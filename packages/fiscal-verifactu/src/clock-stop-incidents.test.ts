import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordIncident, recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { ClockWitness, TrustedClock } from "@waitron/fiscal";
import { AppError, jobOrigin } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { confirmClockStop, noteClockProvedWrong } from "./clock-confirmation.js";

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

async function sale(ms: number, on = { nodeId, seriesId }): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ ...on, clock: clockAt(ms) })),
  );
}

function latest(): { id: string; saleId: string } {
  return suite.db.all<{ id: string; saleId: string }>(
    sql`select id, sale_id as saleId from registros_facturacion
        order by fecha_hora_huso_gen_registro desc, id desc limit 1`,
  )[0]!;
}

interface Admin {
  personId: string;
  personName: string;
  /** How far the administrator's device reads from the box. */
  differenceMs?: number;
}

function confirm(ms: number, witnesses: readonly ClockWitness[], admin?: Admin) {
  return withTransaction(suite.db, (tx) =>
    confirmClockStop(tx, {
      reading: reading(ms),
      boot: BOOT,
      witnesses,
      nodeId,
      ...(admin === undefined
        ? {}
        : {
            admin: {
              personId: admin.personId,
              personName: admin.personName,
              reading: {
                boxAt: iso(ms),
                witnessAt: iso(ms + (admin.differenceMs ?? 2 * S)),
                uncertaintyMs: 0,
              },
            },
          }),
    }),
  );
}

// When the disproof is noticed: later than any trusted time the cases use, so a case can tell the
// two apart.
const OBSERVED = T + 5 * H;

function disprove(trustedUntil: number) {
  return withTransaction(suite.db, (tx) =>
    noteClockProvedWrong(tx, {
      trustedUntil: new Date(trustedUntil),
      observedAt: new Date(OBSERVED),
      reason: "jump",
    }),
  );
}

interface IncidentRow {
  source: string;
  deviceId: string | null;
  saleId: string | null;
  code: string;
  params: unknown;
  severity: string;
  detectedAt: string;
}

function incidents(code: string): IncidentRow[] {
  return suite.db
    .all<Omit<IncidentRow, "params"> & { params: string }>(
      sql`select source, device_id as deviceId, sale_id as saleId, code, params, severity,
                 detected_at as detectedAt
          from incidents where code = ${code} order by detected_at, id`,
    )
    .map((row) => ({ ...row, params: JSON.parse(row.params) as unknown }));
}

const RESTARTED = "clock.behind_chain_restarted";

describe("a lift's alert", () => {
  it("is not recorded when nothing confirms the clock", async () => {
    await sale(T);
    const before = count("incidents");
    expect(await confirm(R, [])).toEqual({ confirmation: null });
    expect(count("incidents")).toBe(before);
  });
});

describe("a restart whose disproof cannot be told apart", () => {
  it.each([
    ["heads that are null", '{"heads":null}'],
    ["a proof that is not JSON", "not json"],
  ])("answers a restart with %s unused, recording nothing", async (_name, proof) => {
    await sale(T);
    const confirmationId = "77777777-7777-4777-8777-777777777777";
    suite.db.run(sql`
      insert into clock_confirmations
        (id, seq, node_id, box_clock_at, confirmed_at, step_ms, source, person_id, reason, proof,
         check_id, registro_id, record_at)
      values (${confirmationId}, 1, ${nodeId}, ${iso(R)}, ${iso(R)}, 0, 'devices', null, 'behind_chain',
              ${proof}, null, ${latest().id}, ${iso(T)})`);
    // Covers nothing, so the record after it is at a forward clock.
    await sale(T + M);
    const before = count("incidents");
    expect(await disprove(R + 2 * M)).toEqual({ recorded: [], unused: [confirmationId], held: [] });
    expect(count("incidents")).toBe(before);
  });
});

describe("two restarts of two records", () => {
  it("control: two alerts of one code on one sale leave one open row", async () => {
    await sale(T);
    const { saleId } = latest();
    await withTransaction(suite.db, async (tx) => {
      for (const confirmationId of ["one", "two"]) {
        await recordIncident(tx, {
          origin: jobOrigin("dashboard"),
          saleId: saleId as SaleId,
          error: new AppError(RESTARTED, {
            confirmationId,
            confirmedBy: "devices",
            person: null,
            clockAt: iso(R),
            lastRecordAt: iso(T),
          }),
          severity: "warning",
          detectedAt: new Date(R),
        });
      }
    });
    expect(incidents(RESTARTED)).toHaveLength(1);
  });
});
