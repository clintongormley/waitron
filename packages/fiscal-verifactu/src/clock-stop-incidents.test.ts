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
import { closeClockCheckByItself, openClockCheck } from "./clock-checks.js";
import { confirmClockStop, noteClockProvedWrong } from "./clock-confirmation.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const S = 1_000;
const M = 60_000;
const H = 3_600_000;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 14.5 * H;
const BOOT = { ms: 5 * M, id: null };
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

function authority(boxMs: number, differenceMs: number): ClockWitness {
  return {
    kind: "authority",
    id: "authority",
    boxAt: iso(boxMs),
    witnessAt: iso(boxMs + differenceMs),
    uncertaintyMs: S,
  };
}

function twoDevices(at: number): ClockWitness[] {
  return [
    device("till-1", at - 30 * S, 2 * S, "10.0.0.1"),
    device("till-2", at - 20 * S, -3 * S, "10.0.0.2"),
  ];
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

/** A confirmation that lifts the stop at `ms`, naming the latest record. */
async function lift(ms: number, witnesses: readonly ClockWitness[], admin?: Admin) {
  const { confirmation } = await confirm(ms, witnesses, admin);
  expect(confirmation?.recordId).toBe(latest().id);
  return confirmation!;
}

function openCheckAt(ms: number) {
  return withTransaction(suite.db, (tx) =>
    openClockCheck(tx, { reading: reading(ms), boot: BOOT, nodeId }),
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
const DISPROVED = "clock.behind_chain_disproved";

describe("a lift's alert", () => {
  it("is recorded once, in the lift's transaction, naming the confirmation and the record's sale", async () => {
    await sale(T);
    const named = latest();
    const confirmation = await lift(R, twoDevices(R));
    expect(incidents(RESTARTED)).toEqual([
      {
        source: "dashboard",
        deviceId: null,
        saleId: named.saleId,
        code: RESTARTED,
        params: {
          confirmationId: confirmation.id,
          confirmedBy: "devices",
          person: null,
          clockAt: iso(R),
          lastRecordAt: iso(T),
        },
        severity: "warning",
        detectedAt: iso(R),
      },
    ]);
  });

  it("says the tax agency confirmed the clock, with no person", async () => {
    await sale(T);
    const confirmation = await lift(R, [authority(R - 30 * S, 2 * S)]);
    expect(incidents(RESTARTED).map((row) => row.params)).toEqual([
      {
        confirmationId: confirmation.id,
        confirmedBy: "authority",
        person: null,
        clockAt: iso(R),
        lastRecordAt: iso(T),
      },
    ]);
  });

  it("names the administrator whose device confirmed the clock", async () => {
    await sale(T);
    const confirmation = await lift(R, [], { personId: FIRST, personName: "Ana" });
    expect(incidents(RESTARTED).map((row) => row.params)).toEqual([
      {
        confirmationId: confirmation.id,
        confirmedBy: "admin",
        person: "Ana",
        clockAt: iso(R),
        lastRecordAt: iso(T),
      },
    ]);
  });

  it("is not recorded when nothing confirms the clock", async () => {
    await sale(T);
    const before = count("incidents");
    expect(await confirm(R, [])).toEqual({ confirmation: null });
    expect(count("incidents")).toBe(before);
  });

  it("is not recorded for a refused confirmation", async () => {
    await sale(T);
    const before = { incidents: count("incidents"), rows: count("clock_confirmations") };
    await expect(
      confirm(R, [], { personId: FIRST, personName: "Ana", differenceMs: 2 * M }),
    ).rejects.toMatchObject({ code: "clock.confirm_refused", params: { reason: "differs" } });
    expect(count("incidents")).toBe(before.incidents);
    expect(count("clock_confirmations")).toBe(before.rows);
  });

  it("control: the same confirmation with proof records it", async () => {
    await sale(T);
    const before = count("incidents");
    await lift(R, twoDevices(R));
    // Beside it, the wrongly dated sale's alert.
    expect(count("incidents")).toBe(before + 2);
    expect(incidents(RESTARTED)).toHaveLength(1);
    expect(incidents("clock.records_misdated")).toHaveLength(1);
  });

  it("is not recorded again while the lift covers", async () => {
    await sale(T);
    await lift(R, twoDevices(R));
    const before = count("incidents");
    expect(await confirm(R, twoDevices(R))).toEqual({ confirmation: null });
    await expect(confirm(R, [], { personId: SECOND, personName: "Berta" })).rejects.toMatchObject({
      code: "clock.confirm_refused",
      params: { reason: "not_stopped" },
    });
    expect(count("incidents")).toBe(before);
    expect(incidents(RESTARTED)).toHaveLength(1);
  });
});

describe("a closing that names no record", () => {
  // The stop opens at R and ends by itself when the clock is put right at T + M.
  async function waitingCheck(): Promise<void> {
    await sale(T);
    expect(await openCheckAt(R)).not.toBeNull();
  }

  it("records no restarted alert when an administrator confirms a check that waits", async () => {
    await waitingCheck();
    const before = count("clock_confirmations");
    const { confirmation } = await confirm(T + M, [], { personId: FIRST, personName: "Ana" });
    expect(confirmation).toMatchObject({ source: "admin", recordId: null });
    expect(count("clock_confirmations")).toBe(before + 1);
    expect(incidents(RESTARTED)).toEqual([]);
  });

  it.each([
    ["the tax agency agreeing", 2 * S, "authority"],
    ["the tax agency disagreeing", 2 * H, "elapsed"],
  ] as const)(
    "records no restarted alert when the check closes by itself on %s",
    async (_name, differenceMs, source) => {
      await waitingCheck();
      const before = count("clock_confirmations");
      const { confirmation } = await withTransaction(suite.db, (tx) =>
        closeClockCheckByItself(tx, {
          reading: reading(T + M),
          boot: BOOT,
          witnesses: [authority(T + 30 * S, differenceMs)],
          nodeId,
        }),
      );
      expect(confirmation).toMatchObject({ source, recordId: null });
      expect(count("clock_confirmations")).toBe(before + 1);
      expect(incidents(RESTARTED)).toEqual([]);
    },
  );
});

describe("the wrongly dated sales' alert", () => {
  const MISDATED = "clock.records_misdated";

  function closesByItself(ms: number, witnesses: readonly ClockWitness[]) {
    return withTransaction(suite.db, (tx) =>
      closeClockCheckByItself(tx, { reading: reading(ms), boot: BOOT, witnesses, nodeId }),
    );
  }

  it("stays one open alert when a second closing that cannot tell names the same sale", async () => {
    await sale(T);
    const named = latest();
    // A stop opens at R and ends by itself; AEAT disagrees, so the box cannot tell.
    await openCheckAt(R);
    const first = (await closesByItself(T + M, [authority(T + 30 * S, 2 * H)])).confirmation!;
    // The clock steps back again with no sale in between, and that stop ends the same way.
    await openCheckAt(R + H);
    const second = (await closesByItself(T + 2 * M, [authority(T + 90 * S, 2 * H)])).confirmation!;
    expect([first.source, second.source]).toEqual(["elapsed", "elapsed"]);
    expect(
      suite.db
        .all<{ id: string }>(sql`select id from clock_confirmations order by seq`)
        .map((row) => row.id),
    ).toEqual([first.id, second.id]);
    expect(incidents(MISDATED)).toEqual([
      {
        source: "dashboard",
        deviceId: null,
        saleId: named.saleId,
        code: MISDATED,
        params: {
          confirmationId: first.id,
          count: 0,
          from: iso(R),
          fromOffsetMinutes: 60,
          partial: true,
          unconfirmed: true,
        },
        severity: "error",
        detectedAt: iso(T + M),
      },
    ]);
  });
});

describe("a restarted clock proved wrong", () => {
  async function restartWithThreeSales(): Promise<{ restartId: string; saleId: string }> {
    await sale(T);
    const named = latest();
    const confirmation = await lift(R, twoDevices(R));
    await sale(R + M);
    await sale(R + 2 * S);
    await sale(R + 90 * S);
    return { restartId: confirmation.id, saleId: named.saleId };
  }

  it("records one alert from the earliest to the latest time written under the restart", async () => {
    const { restartId, saleId } = await restartWithThreeSales();
    const before = {
      registros: count("registros_facturacion"),
      confirmations: count("clock_confirmations"),
    };
    const answer = await disprove(R + 2 * M);
    expect(answer).toEqual({ recorded: [restartId], unused: [], held: [] });
    expect(incidents(DISPROVED)).toEqual([
      {
        source: "fiscal_filing",
        deviceId: null,
        saleId,
        code: DISPROVED,
        params: { restartId, from: iso(R + 2 * S), to: iso(R + 90 * S) },
        severity: "error",
        detectedAt: iso(OBSERVED),
      },
    ]);
    expect(count("registros_facturacion")).toBe(before.registros);
    expect(count("clock_confirmations")).toBe(before.confirmations);
  });

  it("records no second alert for the same restart, even once the first is handled", async () => {
    await restartWithThreeSales();
    await disprove(R + 2 * M);
    expect(await disprove(R + 3 * M)).toEqual({ recorded: [], unused: [], held: [] });
    suite.db.run(sql`update incidents set acknowledged_at = ${iso(T)} where code = ${DISPROVED}`);
    expect(await disprove(R + 3 * M)).toEqual({ recorded: [], unused: [], held: [] });
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
    const restart = await lift(R, twoDevices(R));
    const before = count("incidents");
    expect(await disprove(R + M)).toEqual({ recorded: [], unused: [restart.id], held: [] });
    expect(count("incidents")).toBe(before);
  });
});

describe("a disproof beside a closing that names no record", () => {
  it("passes over the closing, which restarted nothing", async () => {
    await sale(T);
    expect(await openCheckAt(R)).not.toBeNull();
    const { confirmation } = await confirm(T + M, [], { personId: FIRST, personName: "Ana" });
    expect(confirmation?.recordId).toBeNull();
    await sale(T + 2 * M);
    const before = count("incidents");
    expect(await disprove(T + 90 * S)).toEqual({ recorded: [], unused: [], held: [] });
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
      const restart = await lift(R, twoDevices(R));
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
      insert into clock_confirmations
        (id, seq, node_id, box_clock_at, confirmed_at, step_ms, source, person_id, reason, proof,
         check_id, registro_id, record_at)
      values (${restartId}, 1, ${nodeId}, ${iso(R)}, ${iso(R)}, 0, 'devices', null, 'behind_chain',
              ${proof}, null, ${latest().id}, ${iso(T)})`);
    // Covers nothing, so the record after it is at a forward clock.
    await sale(T + M);
    const before = count("incidents");
    expect(await disprove(R + 2 * M)).toEqual({ recorded: [], unused: [restartId], held: [] });
    expect(count("incidents")).toBe(before);
  });

  it("answers the restart held while another open disproof holds the named record's sale", async () => {
    await sale(T);
    const { saleId } = latest();
    const restart = await lift(R, twoDevices(R));
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
    expect(await disprove(R + 2 * M)).toEqual({ recorded: [], unused: [], held: [restart.id] });
    expect(incidents(DISPROVED)).toHaveLength(1);
  });
});

describe("two restarts of two records", () => {
  const R2 = T - 9 * H;

  async function twoRestarts() {
    await sale(T);
    const firstNamed = latest();
    const first = await lift(R, [], { personId: FIRST, personName: "Ana" });
    await sale(R + 10 * S);
    // The clock set forward past the first record, then a new stop.
    await sale(T + H);
    const secondNamed = latest();
    const second = await lift(R2, [], { personId: SECOND, personName: "Berta" });
    await sale(R2 + 10 * S);
    await sale(T + 2 * H);
    return { first, second, firstNamed, secondNamed };
  }

  it("records each restart's alert with its own person and times", async () => {
    const { first, second, firstNamed, secondNamed } = await twoRestarts();
    expect(first.id).not.toBe(second.id);
    expect(incidents(RESTARTED).map((row) => [row.saleId, row.params])).toEqual([
      [
        firstNamed.saleId,
        {
          confirmationId: first.id,
          confirmedBy: "admin",
          person: "Ana",
          clockAt: iso(R),
          lastRecordAt: iso(T),
        },
      ],
      [
        secondNamed.saleId,
        {
          confirmationId: second.id,
          confirmedBy: "admin",
          person: "Berta",
          clockAt: iso(R2),
          lastRecordAt: iso(T + H),
        },
      ],
    ]);
  });

  it("records a disproof for each restart in force, each with the times written under it alone", async () => {
    const { first, second, firstNamed, secondNamed } = await twoRestarts();
    const answer = await disprove(T - H);
    expect([...answer.recorded].sort()).toEqual([first.id, second.id].sort());
    expect(answer.unused).toEqual([]);
    expect(answer.held).toEqual([]);
    const rows = incidents(DISPROVED).map((row) => [row.saleId, row.params]);
    expect(rows).toEqual(
      expect.arrayContaining([
        [firstNamed.saleId, { restartId: first.id, from: iso(R + 10 * S), to: iso(T + H) }],
        [secondNamed.saleId, { restartId: second.id, from: iso(R2 + 10 * S), to: iso(T + 2 * H) }],
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
      restartId: first.id,
      from: iso(R + 10 * S),
      to: iso(T + H),
    });
  });

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
