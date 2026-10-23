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
import { noteClockProvedWrong, restartAfterClockStop } from "./clock-stop-restart.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 14.5 * H;
const FIRST = "33333333-3333-4333-8333-333333333333";
const SECOND = "55555555-5555-4555-8555-555555555555";

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

function device(id: string, boxMs: number, differenceMs = 2 * S): ClockWitness {
  return {
    kind: "device",
    id,
    boxAt: iso(boxMs),
    witnessAt: iso(boxMs + differenceMs),
    uncertaintyMs: 0,
  };
}

function twoDevices(at: number): ClockWitness[] {
  return [device("till-1", at - 30 * S), device("till-2", at - 20 * S, -3 * S)];
}

function latest(): { id: string; saleId: string } {
  return suite.db.all<{ id: string; saleId: string }>(
    sql`select id, sale_id as saleId from registros_facturacion
        order by fecha_hora_huso_gen_registro desc, id desc limit 1`,
  )[0]!;
}

function press(
  ms: number,
  witnesses: readonly ClockWitness[],
  options: { personId?: string; personName?: string; recordId?: string } = {},
) {
  return withTransaction(suite.db, (tx) =>
    restartAfterClockStop(tx, {
      reading: { instant: new Date(ms), offsetMinutes: 60 },
      witnesses,
      personId: options.personId ?? FIRST,
      personName: options.personName ?? "Ana",
      nodeId,
      recordId: options.recordId ?? latest().id,
    }),
  );
}

function disprove(trustedUntil: number) {
  return withTransaction(suite.db, (tx) =>
    noteClockProvedWrong(tx, { trustedUntil: new Date(trustedUntil), reason: "jump" }),
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
const DISPROVED = "clock.behind_chain_disproved";

describe("a restart's alert", () => {
  it("is recorded once, in the restart's transaction, naming the restart and the record's sale", async () => {
    await sale(T);
    const named = latest();
    const answer = await press(R, twoDevices(R));
    expect(incidents(RESTARTED)).toEqual([
      {
        source: "dashboard",
        deviceId: null,
        saleId: named.saleId,
        code: RESTARTED,
        params: {
          restartId: answer.restart.id,
          person: "Ana",
          clockAt: iso(R),
          lastRecordAt: iso(T),
          proof: "devices",
        },
        severity: "warning",
        detectedAt: iso(R),
      },
    ]);
  });

  it("is not recorded for a refused restart", async () => {
    await sale(T);
    const before = count("incidents");
    await expect(press(R, [])).rejects.toMatchObject({
      code: "clock.restart_refused",
      params: { reason: "no_proof" },
    });
    expect(count("incidents")).toBe(before);
  });

  it("control: the same press with proof records it", async () => {
    await sale(T);
    const before = count("incidents");
    await press(R, twoDevices(R));
    expect(count("incidents")).toBe(before + 1);
  });

  it("is not recorded again for a replay", async () => {
    await sale(T);
    await press(R, twoDevices(R));
    const before = count("incidents");
    const replay = await press(R, twoDevices(R), { personId: SECOND, personName: "Berta" });
    expect(replay.replayed).toBe(true);
    expect(count("incidents")).toBe(before);
    expect(incidents(RESTARTED)).toHaveLength(1);
  });
});

describe("a restarted clock proved wrong", () => {
  async function restartWithThreeSales(): Promise<{ restartId: string; saleId: string }> {
    await sale(T);
    const named = latest();
    const { restart } = await press(R, twoDevices(R));
    await sale(R + M);
    await sale(R + 2 * S);
    await sale(R + 90 * S);
    return { restartId: restart.id, saleId: named.saleId };
  }

  it("records one alert from the earliest to the latest time written under the restart", async () => {
    const { restartId, saleId } = await restartWithThreeSales();
    const before = {
      registros: count("registros_facturacion"),
      restarts: count("clock_stop_restarts"),
    };
    const answer = await disprove(R + 2 * M);
    expect(answer).toEqual({ recorded: [restartId], unused: [] });
    expect(incidents(DISPROVED)).toEqual([
      {
        source: "fiscal_filing",
        deviceId: null,
        saleId,
        code: DISPROVED,
        params: { restartId, from: iso(R + 2 * S), to: iso(R + 90 * S) },
        severity: "error",
        detectedAt: iso(R + 2 * M),
      },
    ]);
    expect(count("registros_facturacion")).toBe(before.registros);
    expect(count("clock_stop_restarts")).toBe(before.restarts);
  });

  it("records no second alert for the same restart, even once the first is handled", async () => {
    await restartWithThreeSales();
    await disprove(R + 2 * M);
    expect(await disprove(R + 3 * M)).toEqual({ recorded: [], unused: [] });
    suite.db.run(sql`update incidents set acknowledged_at = ${iso(T)} where code = ${DISPROVED}`);
    expect(await disprove(R + 3 * M)).toEqual({ recorded: [], unused: [] });
    expect(incidents(DISPROVED)).toHaveLength(1);
  });

  it.each([
    ["at the restart's own reading", R, 1],
    ["just before the restart's reading", R - 1, 0],
    ["just before the record it names", T - 1, 1],
    ["at the record it names", T, 0],
    ["after the record it names", T + S, 0],
  ])("judges a trusted time %s", async (_name, trustedUntil, alerts) => {
    await restartWithThreeSales();
    await disprove(trustedUntil);
    expect(incidents(DISPROVED)).toHaveLength(alerts);
  });

  it("records nothing for a restart with no record written under it, and answers it unused", async () => {
    await sale(T);
    const { restart } = await press(R, twoDevices(R));
    const before = count("incidents");
    expect(await disprove(R + M)).toEqual({ recorded: [], unused: [restart.id] });
    expect(count("incidents")).toBe(before);
  });
});

describe("a disproof over two chains", () => {
  it.each([
    ["the older chain", "box"],
    ["box", "the older chain"],
  ] as const)(
    "takes the earliest and latest across both when %s holds them",
    async (holder, other) => {
      const older = await seedTenantWithSif(suite.db);
      const chains = { "the older chain": older, box: { nodeId, seriesId } };
      await sale(T, older);
      const { restart } = await press(R, twoDevices(R));
      await sale(R + M, chains[other]);
      await sale(R + 2 * S, chains[holder]);
      await sale(R + 90 * S, chains[holder]);
      await disprove(R + 2 * M);
      expect(incidents(DISPROVED).map((row) => row.params)).toEqual([
        { restartId: restart.id, from: iso(R + 2 * S), to: iso(R + 90 * S) },
      ]);
    },
  );
});

describe("a restart whose disproof cannot be told apart", () => {
  it.each([
    ["heads that are null", '{"heads":null}'],
    ["a proof that is not JSON", "not json"],
  ])("answers a restart with %s unused, recording nothing", async (_name, proof) => {
    await sale(T);
    const restartId = "77777777-7777-4777-8777-777777777777";
    suite.db.run(sql`
      insert into clock_stop_restarts
        (id, node_id, person_id, restarted_at, clock_at, registro_id, record_at, proof)
      values (${restartId}, ${nodeId}, ${FIRST}, ${iso(R)}, ${iso(R)}, ${latest().id}, ${iso(T)},
              ${proof})`);
    // Covers nothing, so the record after it is at a forward clock.
    await sale(T + M);
    const before = count("incidents");
    expect(await disprove(R + 2 * M)).toEqual({ recorded: [], unused: [restartId] });
    expect(count("incidents")).toBe(before);
  });

  it("records nothing while another open disproof holds the named record's sale", async () => {
    await sale(T);
    const { saleId } = latest();
    await press(R, twoDevices(R));
    await sale(R + M);
    await withTransaction(suite.db, (tx) =>
      recordIncident(tx, {
        origin: jobOrigin("fiscal_filing"),
        saleId: saleId as SaleId,
        error: new AppError(DISPROVED, { restartId: "another", from: iso(R), to: iso(R) }),
        severity: "error",
        detectedAt: new Date(R),
      }),
    );
    expect(await disprove(R + 2 * M)).toEqual({ recorded: [], unused: [] });
    expect(incidents(DISPROVED)).toHaveLength(1);
  });
});

describe("two restarts of two records", () => {
  const R2 = T - 9 * H;

  async function twoRestarts() {
    await sale(T);
    const firstNamed = latest();
    const first = await press(R, twoDevices(R));
    await sale(R + 10 * S);
    // The clock set forward past the first record, then a new stop.
    await sale(T + H);
    const secondNamed = latest();
    const second = await press(R2, twoDevices(R2), { personId: SECOND, personName: "Berta" });
    await sale(R2 + 10 * S);
    await sale(T + 2 * H);
    return { first, second, firstNamed, secondNamed };
  }

  it("records each restart's alert with its own person and times", async () => {
    const { first, second, firstNamed, secondNamed } = await twoRestarts();
    expect(first.restart.id).not.toBe(second.restart.id);
    expect(incidents(RESTARTED).map((row) => [row.saleId, row.params])).toEqual([
      [
        firstNamed.saleId,
        {
          restartId: first.restart.id,
          person: "Ana",
          clockAt: iso(R),
          lastRecordAt: iso(T),
          proof: "devices",
        },
      ],
      [
        secondNamed.saleId,
        {
          restartId: second.restart.id,
          person: "Berta",
          clockAt: iso(R2),
          lastRecordAt: iso(T + H),
          proof: "devices",
        },
      ],
    ]);
  });

  it("records a disproof for each restart in force, each with the times written under it alone", async () => {
    const { first, second, firstNamed, secondNamed } = await twoRestarts();
    const answer = await disprove(T - H);
    expect([...answer.recorded].sort()).toEqual([first.restart.id, second.restart.id].sort());
    expect(answer.unused).toEqual([]);
    const rows = incidents(DISPROVED).map((row) => [row.saleId, row.params]);
    expect(rows).toEqual(
      expect.arrayContaining([
        [firstNamed.saleId, { restartId: first.restart.id, from: iso(R + 10 * S), to: iso(T + H) }],
        [
          secondNamed.saleId,
          { restartId: second.restart.id, from: iso(R2 + 10 * S), to: iso(T + 2 * H) },
        ],
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("counts a chain the later restart's heads leave out as written under the later one", async () => {
    const { first } = await twoRestarts();
    const another = await seedTenantWithSif(suite.db);
    await sale(T + 3 * H, another);
    await disprove(T - H);
    const params = incidents(DISPROVED).map((row) => row.params);
    expect(params).toContainEqual({
      restartId: first.restart.id,
      from: iso(R + 10 * S),
      to: iso(T + H),
    });
  });

  it("control: two alerts of one code on one sale leave one open row", async () => {
    await sale(T);
    const { saleId } = latest();
    await withTransaction(suite.db, async (tx) => {
      for (const restartId of ["one", "two"]) {
        await recordIncident(tx, {
          origin: jobOrigin("dashboard"),
          saleId: saleId as SaleId,
          error: new AppError(RESTARTED, {
            restartId,
            person: "Ana",
            clockAt: iso(R),
            lastRecordAt: iso(T),
            proof: "devices",
          }),
          severity: "warning",
          detectedAt: new Date(R),
        });
      }
    });
    expect(incidents(RESTARTED)).toHaveLength(1);
  });
});
