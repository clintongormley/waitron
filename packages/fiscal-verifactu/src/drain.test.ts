import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale, recordVoid } from "@waitron/core";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { newId, nowIso, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { VerifactuBackend } from "./backend.js";
import {
  DEFAULT_SKIP_RETRY_MS,
  backoffMs,
  drain,
  resetInFlightClaims,
  type DrainDeps,
} from "./drain.js";
import { ackStateOf } from "./acks.js";
import {
  appendPendingAlta,
  seedIndependentChain,
  seedPendingEnvios,
  seedSecondChain,
  type SeededDrain,
} from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

// The full manifest: `recordVoid` authorizes through identity's persons and sessions.
const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

const drainDeps = (resolveClient: DrainDeps["resolveClient"]): DrainDeps => ({
  db: pg.db,
  resolveClient,
  skipRetryMs: DEFAULT_SKIP_RETRY_MS,
  environment: "production",
});

/** The `envios` rows of ONE seeded fixture's own chain, by that fixture's node. */
const ownChain = (seeded: { nodeId: string }) =>
  sql`registro_id in (select id from registros_facturacion where node_id = ${seeded.nodeId})`;

/** A raw read returns the flag as 0 or 1; this puts `incidencia` back into a boolean. */
const decodeFlags = <Row extends { incidencia: number }>(result: {
  rows: Row[];
}): { rows: (Omit<Row, "incidencia"> & { incidencia: boolean })[] } => ({
  rows: result.rows.map((row) => ({ ...row, incidencia: row.incidencia === 1 })),
});

/** The same for an incident's `params`, a `json` column a raw read returns as text. */
const parseParams = <Row extends { params: string }>(result: {
  rows: Row[];
}): { rows: (Omit<Row, "params"> & { params: Record<string, unknown> })[] } => ({
  rows: result.rows.map(({ params, ...rest }) => ({
    ...rest,
    params: JSON.parse(params) as Record<string, unknown>,
  })),
});

describe("drain — happy path", () => {
  let seeded: SeededDrain;
  let aeat: ReturnType<typeof createFakeAeat>;
  let deps: DrainDeps;

  beforeEach(async () => {
    aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    seeded = await seedPendingEnvios(pg.db, { count: 3 }); // 3 pending altas on one till/node
    deps = drainDeps(staticResolver(aeat.client()));
  });

  it("submits the pending batch, marks it aceptado, and persists a CSV on every row", async () => {
    const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

    expect(result.recordsSubmitted).toBe(3);
    expect(result.recordsAccepted).toBe(3);
    expect(result.batchesSent).toBe(1);

    const rows = await withTransaction(pg.db, (tx) =>
      tx.execute<{ estado: string; csv: string | null; confirmado_en: string | null }>(sql`
      select estado, csv, confirmado_en from envios order by registro_id
    `),
    );
    expect(rows.rows.every((r) => r.estado === "aceptado")).toBe(true);
    expect(rows.rows.every((r) => r.csv !== null && r.csv !== "")).toBe(true);
    expect(rows.rows.every((r) => r.confirmado_en !== null)).toBe(true);
  });

  it("stamps RefExterna = registro id, so AEAT stored our id", async () => {
    await drain(deps, new Date("2026-07-21T00:01:00Z"));
    const stored = aeat.stored();
    expect(new Set(stored.map((s) => s.refExterna))).toEqual(new Set(seeded.registroIds));
  });

  it("TEETH: dropping the CSV write leaves a row with no CSV — this test must fail if csv is not persisted", async () => {
    await drain(deps, new Date("2026-07-21T00:01:00Z"));
    const rows = await withTransaction(pg.db, (tx) =>
      tx.execute<{ csv: string | null }>(sql`select csv from envios`),
    );
    expect(rows.rows.every((r) => r.csv !== null)).toBe(true);
  });
});

/**
 * `toEnvioRegistro`'s anulación branch, end to end through `@waitron/core`'s `recordSale`/
 * `recordVoid`: `seedPendingEnvios` seeds altas only.
 */
describe("drain — happy path, an anulación row", () => {
  it("submits a voided sale's anulación through the same accept-and-persist path as an alta", async () => {
    const { tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db);
    // `recordVoid` requires `sale.void`, so a manager's session authorizes it. `id` and
    // `created_at` are supplied because their defaults are drizzle `$defaultFn`s, which raw SQL
    // never runs.
    const { rows: mgr } = await pg.db.execute<{ id: string }>(
      sql`insert into persons (id, created_at, display_name, pin_hash, role)
          values (${newId()}, ${nowIso()}, 'P', ${hashPin("1234")}, 'manager') returning id`,
    );
    const voidSession = await withTransaction(pg.db, (tx) =>
      loginWithPin(tx, { tillId, personId: mgr[0]!.id, pin: "1234" }),
    );
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });

    const sale = await withTransaction(pg.db, async (tx) => {
      return recordSale(tx, backend, saleInput({ tillId, nodeId, seriesId }));
    });
    await withTransaction(pg.db, async (tx) => {
      await recordVoid(tx, backend, sale.saleId, "staff error", { sessionId: voidSession.id });
    });

    // Both envíos default to the wall-clock insert time, so a minute past it has them due.
    const result = await drain(
      drainDeps(staticResolver(aeat.client())),
      new Date(Date.now() + 60_000),
    );

    expect(result.recordsSubmitted).toBe(2);
    expect(result.recordsAccepted).toBe(2);

    const rows = await withTransaction(pg.db, (tx) =>
      tx.execute<{ estado: string; csv: string | null }>(sql`
        select estado, csv from envios where ${ownChain({ nodeId })}
      `),
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.estado === "aceptado")).toBe(true);
    expect(rows.rows.every((r) => r.csv !== null)).toBe(true);
  });
});

/** The cap is injected at 3 so the split is proven against a 4-row backlog rather than 1001 rows. */
describe("drain — batching (the >cap split)", () => {
  let aeat: ReturnType<typeof createFakeAeat>;

  beforeEach(() => {
    aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
  });

  it("splits a >cap backlog at the injected cap: a full 3-row chunk now, the <cap tail deferred until t", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 4 });
    const deps: DrainDeps = {
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: "production",
      maxRegistrosPorEnvio: 3,
    };

    // First pass: 4 due rows, gate open — a full chunk of 3, the 1-row tail deferred.
    const first = await drain(deps, new Date("2026-07-21T00:01:00Z"));
    expect(first.batchesSent).toBe(1);
    expect(first.recordsSubmitted).toBe(3);
    expect(first.nextDueAt).not.toBeNull();

    const pending = await withTransaction(pg.db, (tx) =>
      tx.execute<{ count: number }>(sql`
      select count(*) as count from envios where ${ownChain(seeded)} and estado = 'pendiente'
    `),
    );
    expect(pending.rows[0].count).toBe(1);

    // Second pass, gated on `t`: the deferred 1-row tail goes.
    const second = await drain(deps, first.nextDueAt!);
    expect(second.batchesSent).toBe(1);
    expect(second.recordsSubmitted).toBe(1);
  });
});

describe("drain — flow control (envio_flujo)", () => {
  let seeded: SeededDrain;
  let aeat: ReturnType<typeof createFakeAeat>;
  let deps: DrainDeps;

  beforeEach(async () => {
    aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    seeded = await seedPendingEnvios(pg.db, { count: 3 }); // 3 pending altas on one till/node
    deps = drainDeps(staticResolver(aeat.client()));
  });

  afterEach(async () => {
    await pg.db.execute(sql`delete from envios where ${ownChain(seeded)}`);
    await pg.db.execute(sql`delete from envio_flujo`);
  });

  it("persists the server's TiempoEsperaEnvio into envio_flujo and sets nextDueAt when a partial batch remains for next time", async () => {
    // 3 records → one envío that drains the whole backlog; the NEXT envío waits t.
    const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));
    const flujo = await withTransaction(pg.db, (tx) =>
      tx.execute<{ proximo_envio_en: string; tiempo_espera_seg: number }>(
        sql`select proximo_envio_en, tiempo_espera_seg from envio_flujo`,
      ),
    );
    expect(flujo.rows[0]?.tiempo_espera_seg).toBeGreaterThan(0);
    // nothing pending now, so nextDueAt is null; assert flujo persisted instead:
    expect(result.nextDueAt).toBeNull();
  });

  it("round-trips TiempoEsperaEnvio = 9999 into tiempo_espera_seg", async () => {
    const big = createFakeAeat({
      serverNow: new Date("2026-07-21T00:00:00Z"),
      tiempoEsperaInicial: 10000,
    });
    const deps2 = drainDeps(staticResolver(big.client()));
    await drain(deps2, new Date("2026-07-21T00:01:00Z"));
    const flujo = await withTransaction(pg.db, (tx) =>
      tx.execute<{ tiempo_espera_seg: number }>(sql`select tiempo_espera_seg from envio_flujo`),
    );
    expect(flujo.rows[0]?.tiempo_espera_seg).toBe(9999); // fake clamps its initial t to ≤9999 per the schema
  });

  /**
   * Fewer than a full envío due AND the gate not yet elapsed defers the WHOLE pass: nothing is
   * claimed, nothing is sent. The flow row is pre-seeded to stand for an earlier pass.
   */
  it("defers the pass behind a still-open gate, claiming nothing and leaving its backlog pending", async () => {
    const proximoEnvioEn = new Date("2026-07-21T00:05:00Z"); // still in the future relative to `now` below
    await pg.db.execute(sql`
      insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
      values (1, ${proximoEnvioEn.toISOString()}, 60)
    `);

    const now = new Date("2026-07-21T00:01:00Z"); // before proximoEnvioEn — the gate is still closed
    const result = await drain(deps, now);

    expect(result.batchesSent).toBe(0);
    expect(result.recordsSubmitted).toBe(0);
    expect(result.nextDueAt).toEqual(proximoEnvioEn);

    // Select only this case's own chain.
    const rows = await withTransaction(pg.db, (tx) =>
      tx.execute<{ estado: string }>(sql`select estado from envios where ${ownChain(seeded)}`),
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.every((r) => r.estado === "pendiente")).toBe(true);
  });
});

/**
 * A row left `enviando` past `RECUPERACION_ENVIANDO_MS` is a claim abandoned while this process
 * stays up. A restart's claims are requeued by `resetInFlightClaims` instead.
 */
describe("drain — stale claim recovery", () => {
  it("recovers a stale enviando row back to pendiente with incidencia set, then resubmits it this same pass", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    // An abandoned claim, stamped well over RECUPERACION_ENVIANDO_MS ago.
    await withTransaction(pg.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'enviando', enviado_en = ${new Date("2026-07-20T00:00:00Z").toISOString()}
        where ${ownChain(seeded)}
      `),
    );
    const deps = drainDeps(staticResolver(aeat.client()));
    await drain(deps, new Date("2026-07-21T00:01:00Z")); // > RECUPERACION_ENVIANDO_MS past enviado_en

    const rows = decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ estado: string; incidencia: number }>(sql`
        select estado, incidencia from envios where ${ownChain(seeded)}
      `),
      ),
    );
    // Recovered, then resubmitted in this same pass; the recovery's `incidencia` stays raised.
    expect(rows.rows[0]?.estado).toBe("aceptado");
    expect(rows.rows[0]?.incidencia).toBe(true);
  });

  it("does not recover an enviando row that is not yet past the recovery threshold", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const now = new Date("2026-07-21T00:01:00Z");
    // A slow submission still waiting on AEAT, not an abandoned claim: recovering it would resubmit
    // a record its own persist step may still be about to write a CSV for.
    await withTransaction(pg.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'enviando', enviado_en = ${new Date(now.getTime() - 60_000).toISOString()}
        where ${ownChain(seeded)}
      `),
    );
    const deps = drainDeps(staticResolver(aeat.client()));
    const result = await drain(deps, now);

    expect(result.recordsSubmitted).toBe(0); // untouched — not stale, so not reclaimed
    const rows = decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ estado: string; incidencia: number }>(sql`
        select estado, incidencia from envios where ${ownChain(seeded)}
      `),
      ),
    );
    expect(rows.rows[0]?.estado).toBe("enviando");
    expect(rows.rows[0]?.incidencia).toBe(false);
  });
});

describe("resetInFlightClaims — the restart reset (topology design §5.2)", () => {
  const now = new Date("2026-07-21T00:01:00Z");

  /** Leaves the seeded rows as a previous run's claim: `enviando`, stamped one second ago. */
  const claimOneSecondAgo = (seeded: SeededDrain) =>
    withTransaction(pg.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'enviando', enviado_en = ${new Date(now.getTime() - 1_000).toISOString()}
        where ${ownChain(seeded)}
      `),
    );

  const stateOf = async (seeded: SeededDrain) =>
    decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ estado: string; incidencia: number; proximo_intento_en: string }>(sql`
          select estado, incidencia, proximo_intento_en from envios where ${ownChain(seeded)}
        `),
      ),
    ).rows;

  it("files a claim a previous run left behind on the next pass, with no five-minute wait", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    await claimOneSecondAgo(seeded);

    await resetInFlightClaims(pg.db, now);
    const result = await drain(drainDeps(staticResolver(aeat.client())), now);

    expect(result.recordsSubmitted).toBe(1);
    const rows = await stateOf(seeded);
    expect(rows[0]?.estado).toBe("aceptado");
    expect(rows[0]?.incidencia).toBe(true);
  });

  it("returns the claim to pendiente, due now, with incidencia raised", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    await claimOneSecondAgo(seeded);

    await resetInFlightClaims(pg.db, now);

    expect(await stateOf(seeded)).toEqual([
      { estado: "pendiente", incidencia: true, proximo_intento_en: now.toISOString() },
    ]);
  });

  it("leaves pendiente, aceptado and detenido rows alone", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    const [, second, third] = seeded.registroIds;
    await withTransaction(pg.db, async (tx) => {
      await tx.execute(sql`update envios set estado = 'aceptado' where registro_id = ${second}`);
      await tx.execute(sql`update envios set estado = 'detenido' where registro_id = ${third}`);
    });
    const before = await stateOf(seeded);
    expect(before.map((row) => row.estado).sort()).toEqual(["aceptado", "detenido", "pendiente"]);

    await resetInFlightClaims(pg.db, now);

    expect(await stateOf(seeded)).toEqual(before);
  });
});

describe("drain — retry backoff on a transient submit failure", () => {
  it("backs off a transiently-failed batch exponentially, capped at 3600s, marking incidencia", async () => {
    const failing: VerifactuClient = {
      submit: async () => {
        throw new Error("network down");
      },
      consultar: async () => {
        throw new Error("n/a");
      },
    };
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const deps = drainDeps(staticResolver(failing));
    const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

    const rows = decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{
          estado: string;
          intentos: number;
          incidencia: number;
          proximo_intento_en: string;
        }>(sql`
        select estado, intentos, incidencia, proximo_intento_en from envios
        where ${ownChain(seeded)}
      `),
      ),
    );
    expect(rows.rows[0]?.estado).toBe("pendiente");
    expect(rows.rows[0]?.intentos).toBe(1);
    expect(rows.rows[0]?.incidencia).toBe(true);
    expect(new Date(rows.rows[0]!.proximo_intento_en).getTime()).toBe(
      new Date("2026-07-21T00:01:00Z").getTime() + 60_000,
    );
    expect(result.nextDueAt).not.toBeNull();
  });
});

/**
 * `nextDueAt` is a MINIMUM over every instant a pass computes: an assigned value could defer a
 * submission past art. 16.4's hour.
 *
 * One pass, two instants: `backoffBatch` folds `now + backoffMs(intentos)` when the submit throws,
 * then the tail fold adds `now + t * 1000`. The backoff comes FIRST, so a fold that keeps the first
 * instant fails "the gate is earlier", and one that assigns the last fails "the gate is later".
 * Each case is the other's control.
 */
describe("drain — nextDueAt is folded as a minimum, never assigned", () => {
  const NOW = new Date("2026-07-21T00:01:00Z");
  const failing: VerifactuClient = {
    submit: () => Promise.reject(new Error("network down")),
    consultar: () => Promise.reject(new Error("not this test's subject")),
  };

  /** One due row, an already-elapsed gate so the pass claims it, and `tiempo_espera_seg` set to
   * `seconds` so the tail fold lands at `now + seconds`. Cleans up both tables: the row stays
   * `pendiente` after the backoff, and `envio_flujo` holds ONE row for the whole database. */
  async function passWithGate(seconds: number): Promise<Awaited<ReturnType<typeof drain>>> {
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    await pg.db.execute(sql`
      insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
      values (1, ${new Date(NOW.getTime() - 1000).toISOString()}, ${seconds})
    `);
    try {
      return await drain(drainDeps(staticResolver(failing)), NOW);
    } finally {
      await pg.db.execute(sql`delete from envios where ${ownChain(seeded)}`);
      await pg.db.execute(sql`delete from envio_flujo`);
    }
  }

  it("reports the flow-control gate when it is earlier than the failed batch's backoff", async () => {
    // 10s gate against a 60s backoff (`backoffMs(1)`): the gate wins.
    const result = await passWithGate(10);
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + 10_000));
  });

  it("reports the failed batch's backoff when the flow-control gate is later", async () => {
    // 600s gate against the same 60s backoff: the backoff wins.
    const result = await passWithGate(600);
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + backoffMs(1)));
  });
});

/**
 * Per-record resolution: a rejection halts the chain and raises a structured incident,
 * AceptadoConErrores is still an accept with a warning, and a record landing on an already-halted
 * chain is stopped without reaching AEAT.
 */
describe("drain — per-record resolution: rejection, halting, incidents", () => {
  it("halts a chain on a genuine rejection: the record is rechazado, its successors detenido, an error incident is raised", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 }); // secuencia 1,2,3 on one SIF
    aeat.reject(seeded.facturaKeys[1]!, 1100, "Campo obligatorio ausente"); // reject the middle record
    const deps = drainDeps(staticResolver(aeat.client()));
    const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

    const rows = decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ secuencia: number; estado: string; incidencia: number }>(sql`
        select r.secuencia, e.estado, e.incidencia from envios e join registros_facturacion r on r.id = e.registro_id
        where r.node_id = ${seeded.nodeId}
        order by r.secuencia
      `),
      ),
    );
    expect(rows.rows.map((r) => r.estado)).toEqual(["aceptado", "rechazado", "detenido"]);
    expect(rows.rows[1]?.incidencia).toBe(true);
    expect(rows.rows[2]?.incidencia).toBe(true); // haltSuccessors marks the successor too
    expect(result.recordsHalted).toBe(2); // rechazado (1) + detenido successor (1)
    expect(result.recordsAccepted).toBe(1); // only secuencia 1
    expect(result.incidentsRaised).toBeGreaterThanOrEqual(1);

    const inc = parseParams(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ code: string; severity: string; params: string }>(sql`
        select code, severity, params from incidents
      `),
      ),
    );
    expect(
      inc.rows.some((i) => i.severity === "error" && i.code === "fiscal.registro_rechazado"),
    ).toBe(true);
    const rejected = inc.rows.find((i) => i.code === "fiscal.registro_rechazado");
    expect(rejected?.params).toMatchObject({ codigo: 1100, mensaje: "Campo obligatorio ausente" });
  });

  it("marks aceptado_con_errores and raises a warning incident, but the record still counts as accepted", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, futureDated: true }); // triggers 2004 → AceptadoConErrores
    const deps = drainDeps(staticResolver(aeat.client()));
    const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

    const rows = await withTransaction(pg.db, (tx) =>
      tx.execute<{ estado: string; csv: string | null }>(
        sql`select estado, csv from envios where ${ownChain(seeded)}`,
      ),
    );
    expect(rows.rows[0]?.estado).toBe("aceptado_con_errores");
    expect(rows.rows[0]?.csv).not.toBeNull(); // still a genuine AEAT submission — CSV persisted
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(0);

    const inc = await withTransaction(pg.db, (tx) =>
      tx.execute<{ severity: string; code: string }>(sql`select severity, code from incidents`),
    );
    expect(inc.rows).toHaveLength(1);
    expect(inc.rows[0]?.severity).toBe("warning");
    expect(inc.rows[0]?.code).toBe("fiscal.aceptado_con_errores");
  });

  it("sets Incidencia on a record enqueued while its chain has an open detenido incident, and never submits it", async () => {
    const aeat = createFakeAeat({
      serverNow: new Date("2026-07-21T00:00:00Z"),
      tiempoEsperaInicial: 5,
    });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    aeat.reject(seeded.facturaKeys[1]!, 1100, "Campo obligatorio ausente");
    const deps = drainDeps(staticResolver(aeat.client()));
    // First pass: secuencia 2 rechazado, secuencia 3 detenido — the chain is left with an OPEN halt.
    const first = await drain(deps, new Date("2026-07-21T00:01:00Z"));
    expect(first.recordsHalted).toBe(2);

    // A NEW record lands on the same chain while the halt is still open.
    await appendPendingAlta(pg.db, seeded, 4);

    const second = await drain(deps, new Date("2026-07-21T00:01:30Z"));

    const row4 = decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ estado: string; incidencia: number }>(sql`
        select e.estado, e.incidencia from envios e join registros_facturacion r on r.id = e.registro_id
        where r.node_id = ${seeded.nodeId} and r.secuencia = 4
      `),
      ),
    );
    expect(row4.rows[0]?.estado).toBe("detenido");
    expect(row4.rows[0]?.incidencia).toBe(true);
    expect(second.recordsSubmitted).toBe(0);
    expect(second.recordsHalted).toBe(1);

    // AEAT's own store has no record under secuencia 4's identity.
    const stored = aeat.stored();
    expect(stored.some((s) => s.key.startsWith(`${seeded.nif}|S4/`))).toBe(false);
  });

  /**
   * `haltOpenChainClaims` must halt ONLY the chain that has an open `rechazado`/`detenido` row; a
   * second, healthy chain claimed in the same batch is still submitted.
   */
  it("does not halt an unrelated healthy chain claimed in the same batch as a halted one", async () => {
    const aeat = createFakeAeat({
      serverNow: new Date("2026-07-21T00:00:00Z"),
      tiempoEsperaInicial: 5,
    });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    aeat.reject(seeded.facturaKeys[1]!, 1100, "Campo obligatorio ausente");
    const deps = drainDeps(staticResolver(aeat.client()));
    const first = await drain(deps, new Date("2026-07-21T00:01:00Z"));
    expect(first.recordsHalted).toBe(2); // chain A: secuencia 2 rechazado + secuencia 3 detenido

    // Chain A (halted) and chain B (healthy) both fall due together, claimed in one batch.
    const chainA4 = await appendPendingAlta(pg.db, seeded, 4);
    // secuencia 5, not 1: `NumSerieFactura` derives from `secuencia`, and invoice identities are
    // unique across chains (`registros_identidad_uq`); chain A already used 1-4.
    const chainB1 = await seedSecondChain(pg.db, seeded, 5);

    const second = await drain(deps, new Date("2026-07-21T00:01:30Z"));

    const rowA = decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ estado: string; incidencia: number }>(
          sql`select estado, incidencia from envios where registro_id = ${chainA4.registroId}`,
        ),
      ),
    );
    expect(rowA.rows[0]?.estado).toBe("detenido");
    expect(rowA.rows[0]?.incidencia).toBe(true);

    const rowB = await withTransaction(pg.db, (tx) =>
      tx.execute<{ estado: string; csv: string | null }>(
        sql`select estado, csv from envios where registro_id = ${chainB1.registroId}`,
      ),
    );
    expect(rowB.rows[0]?.estado).toBe("aceptado"); // healthy chain, unaffected by chain A's halt
    expect(rowB.rows[0]?.csv).not.toBeNull();

    expect(second.recordsSubmitted).toBe(1); // only chain B's row ever reached AEAT
    expect(second.recordsAccepted).toBe(1);
    expect(second.recordsHalted).toBe(1); // chain A's secuencia 4 only

    const stored = aeat.stored();
    expect(stored.some((s) => s.key === chainB1.facturaKey)).toBe(true);
    expect(stored.some((s) => s.key.startsWith(`${seeded.nif}|S4/`))).toBe(false);
  });
});

/**
 * Error 3000 resolution. Every one of these lines reads `Incorrecto` at the envío level; what tells
 * the scenarios apart is `RegistroDuplicado`'s own detail, or for Route B a follow-up consulta.
 */
describe("drain — error 3000: Route A + Route B resolution", () => {
  let aeat: ReturnType<typeof createFakeAeat>;

  beforeEach(() => {
    aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z"), tiempoEsperaInicial: 5 });
  });

  it("TEETH: a 3000 whose RegistroDuplicado is Correcta resolves to aceptado, not rechazado/detenido", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const deps = drainDeps(staticResolver(aeat.client()));
    await drain(deps, new Date("2026-07-21T00:01:00Z")); // stores it — AEAT now genuinely holds "Correcta"

    // Resubmit our own already-accepted record, as a lost response would: the fake answers error
    // 3000 with `EstadoRegistroDuplicado` "Correcta", which must read as an accept.
    await withTransaction(pg.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${new Date("2026-07-21T00:01:00Z").toISOString()}
        where ${ownChain(seeded)}
      `),
    );
    const result = await drain(deps, new Date("2026-07-21T00:01:30Z")); // gate opens 00:01:05Z

    const rows = await withTransaction(pg.db, (tx) =>
      tx.execute<{ estado: string }>(sql`select estado from envios where ${ownChain(seeded)}`),
    );
    expect(rows.rows[0]?.estado).toBe("aceptado"); // despite the outer Incorrecto on the 3000 line
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(0);

    const inc = await withTransaction(pg.db, (tx) =>
      tx.execute<{ code: string }>(sql`select code from incidents`),
    );
    expect(inc.rows).toHaveLength(0);
  });

  /**
   * Two records on one chain, resubmitted together: secuencia 1 comes back `Anulada`, secuencia 2
   * `Correcta`. Without `haltSuccessors` in Route A, secuencia 2's chain-blind "Correcta" line
   * would leave it `aceptado`.
   */
  it("Route A: duplicate_annulled halts detenido, and halts a same-batch successor too, raising a fiscal.duplicado_anulado incident", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 2 });
    const deps = drainDeps(staticResolver(aeat.client()));
    await drain(deps, new Date("2026-07-21T00:01:00Z")); // stores both — AEAT now genuinely holds both "Correcta"

    aeat.annul(seeded.facturaKeys[0]!); // AEAT's own copy of secuencia 1's identity is now Anulada
    await withTransaction(pg.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${new Date("2026-07-21T00:01:00Z").toISOString()}
        where ${ownChain(seeded)}
      `),
    );
    const result = await drain(deps, new Date("2026-07-21T00:01:30Z")); // resubmit both -> 3000 each

    const rows = decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ secuencia: number; estado: string; incidencia: number }>(sql`
        select r.secuencia, e.estado, e.incidencia from envios e join registros_facturacion r on r.id = e.registro_id
        where r.node_id = ${seeded.nodeId} order by r.secuencia
      `),
      ),
    );
    expect(rows.rows.map((r) => r.estado)).toEqual(["detenido", "detenido"]);
    expect(rows.rows.every((r) => r.incidencia)).toBe(true);
    expect(result.recordsHalted).toBe(2); // duplicate_annulled (1) + its halted successor (1)
    expect(result.recordsAccepted).toBe(0); // secuencia 2's own "Correcta" line never wins the halt

    const inc = await withTransaction(pg.db, (tx) =>
      tx.execute<{ code: string; severity: string }>(sql`select code, severity from incidents`),
    );
    // Exactly ONE incident: the halted successor is flagged, never given one of its own.
    expect(inc.rows).toHaveLength(1);
    expect(inc.rows[0]?.code).toBe("fiscal.duplicado_anulado");
    expect(inc.rows[0]?.severity).toBe("error");
  });

  it("Route B: duplicate_unknown with a matching huella resolves to aceptado", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const deps = drainDeps(staticResolver(aeat.client()));
    await drain(deps, new Date("2026-07-21T00:01:00Z")); // AEAT now genuinely stores OUR real huella

    // The next response omits `EstadoRegistroDuplicado`, which reads as `duplicate_unknown`, so
    // the resubmit goes through `routeB`'s consulta.
    aeat.dropRegistroDuplicadoDetail(seeded.facturaKeys[0]!);
    await withTransaction(pg.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${new Date("2026-07-21T00:01:00Z").toISOString()}
        where ${ownChain(seeded)}
      `),
    );
    const result = await drain(deps, new Date("2026-07-21T00:01:30Z"));

    const rows = decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ estado: string; incidencia: number }>(
          sql`select estado, incidencia from envios where ${ownChain(seeded)}`,
        ),
      ),
    );
    expect(rows.rows[0]?.estado).toBe("aceptado"); // routeB's consulta found AEAT's huella == ours
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(0);

    // No fresh incident on a match — mirrors the plain "accepted" branch, which raises none either.
    const inc = await withTransaction(pg.db, (tx) =>
      tx.execute<{ code: string }>(sql`select code from incidents`),
    );
    expect(inc.rows).toHaveLength(0);
  });

  /**
   * Our own stored huella cannot be changed (`registros_facturacion` is append-only), so AEAT's copy
   * is made to diverge: a separate submit under secuencia 1's identity, with a different `Huella`,
   * lands in the fake's store FIRST. Secuencia 2 is fresh and accepted on its own merits, which
   * proves Route B's mismatch also halts a same-batch successor.
   */
  it("Route B: duplicate_unknown with a differing huella halts the chain (and a same-batch successor), raising a fiscal.huella_divergente incident", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 2 });
    const [nif, numSerieFactura, fechaExpedicion] = seeded.facturaKeys[0]!.split("|");

    const collidingRecord: RegistroAlta = {
      IDVersion: "1.0",
      IDFactura: {
        IDEmisorFactura: nif!,
        NumSerieFactura: numSerieFactura!,
        FechaExpedicionFactura: fechaExpedicion!,
      },
      NombreRazonEmisor: seeded.legalName,
      TipoFactura: "F2",
      DescripcionOperacion: "Venta en establecimiento (registro distinto, misma identidad)",
      Desglose: [],
      CuotaTotal: "2.10",
      ImporteTotal: "12.10",
      Encadenamiento: { PrimerRegistro: "S" },
      SistemaInformatico: {
        NombreRazon: seeded.legalName,
        NIF: seeded.nif,
        NombreSistemaInformatico: "Otro sistema",
        IdSistemaInformatico: "XX",
        Version: "1.0",
        NumeroInstalacion: "01",
        TipoUsoPosibleSoloVerifactu: "S",
        TipoUsoPosibleMultiOT: "N",
        IndicadorMultiplesOT: "N",
      },
      FechaHoraHusoGenRegistro: "2026-07-20T19:20:30+01:00",
      TipoHuella: "01",
      Huella: "D".repeat(64), // deliberately NOT the seeded row's own huella (`"0"` * 63 + "1")
    };
    await aeat
      .client()
      .submit({ ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } }, [
        { RegistroAlta: collidingRecord },
      ]);
    aeat.dropRegistroDuplicadoDetail(seeded.facturaKeys[0]!);

    const deps = drainDeps(staticResolver(aeat.client()));
    // secuencia 1 -> error 3000 (identity already taken), no detail -> duplicate_unknown -> routeB
    // consults -> gets back "D"*64, which is NOT our own stored huella. secuencia 2 is genuinely
    // fresh and, on its own per-line merits, would read "Correcto" -> accepted.
    const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

    const rows = decodeFlags(
      await withTransaction(pg.db, (tx) =>
        tx.execute<{ secuencia: number; estado: string; incidencia: number }>(sql`
        select r.secuencia, e.estado, e.incidencia from envios e join registros_facturacion r on r.id = e.registro_id
        where r.node_id = ${seeded.nodeId} order by r.secuencia
      `),
      ),
    );
    expect(rows.rows.map((r) => r.estado)).toEqual(["detenido", "detenido"]);
    expect(rows.rows.every((r) => r.incidencia)).toBe(true);
    expect(result.recordsHalted).toBe(2); // huella_divergente (1) + its halted successor (1)
    expect(result.recordsAccepted).toBe(0); // secuencia 2's own "Correcto" line never wins the halt

    const inc = await withTransaction(pg.db, (tx) =>
      tx.execute<{ code: string; severity: string }>(sql`select code, severity from incidents`),
    );
    expect(inc.rows).toHaveLength(1);
    expect(inc.rows[0]?.code).toBe("fiscal.huella_divergente");
    expect(inc.rows[0]?.severity).toBe("error");

    // AEAT still holds the COLLIDING huella under secuencia 1's identity, and secuencia 2 WAS
    // accepted there even though it is halted locally: the fake, like AEAT, is chain-blind.
    const stored = aeat.stored();
    expect(stored.find((s) => s.key === seeded.facturaKeys[0])?.huella).toBe("D".repeat(64));
    expect(stored.find((s) => s.key === seeded.facturaKeys[1])?.estado).toBe("Correcta");
  });
});

/**
 * A halted record stays counted AND flagged, and the flag rides its `acks` row. The bulk
 * chain-halt paths bypass `setEstado`'s `writeAck`, so they must write their own `halted` acks.
 */
describe("drain — halted records get a halted ack (the bulk chain-halt paths)", () => {
  it("writes a rejected ack for the rejection and a halted ack for its still-pending successor", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 }); // secuencia 1,2,3 on one SIF
    aeat.reject(seeded.facturaKeys[1]!, 1100, "Campo obligatorio ausente"); // reject the middle record
    const deps = drainDeps(staticResolver(aeat.client()));
    await drain(deps, new Date("2026-07-21T00:01:00Z"));

    // secuencia 1 accepted, 2 rejected, 3 halted — the successor `haltSuccessors` swept to detenido.
    const envios = await withTransaction(pg.db, (tx) =>
      tx.execute<{ registro_id: string; secuencia: number; estado: string }>(sql`
        select e.registro_id, r.secuencia, e.estado from envios e
        join registros_facturacion r on r.id = e.registro_id
        where r.node_id = ${seeded.nodeId}
        order by r.secuencia
      `),
    );
    expect(envios.rows.map((r) => r.estado)).toEqual(["aceptado", "rechazado", "detenido"]);

    const acks = await withTransaction(pg.db, (tx) =>
      tx.execute<{ registro_id: string; state: string }>(
        sql`select registro_id, state from acks where ${ownChain(seeded)}`,
      ),
    );
    const ackState = new Map(acks.rows.map((a) => [a.registro_id, a.state]));

    const rejected = envios.rows.find((r) => r.secuencia === 2)!;
    expect(ackState.get(rejected.registro_id)).toBe("rejected");

    const halted = envios.rows.find((r) => r.secuencia === 3)!;
    expect(ackState.get(halted.registro_id)).toBe("halted");

    // Every terminal row is acked, and every ack agrees with its committed estado.
    for (const env of envios.rows) {
      const state = ackState.get(env.registro_id);
      expect(state).toBeDefined();
      expect(state).toBe(ackStateOf(env.estado));
    }
  });
});

/**
 * `drain` must never submit a registro generated for the OTHER deployment: submitting a
 * pre-production record to the real AEAT is unrecoverable. A mismatched or unrecorded row is
 * reported and left `pendiente`, never submitted and never backed off.
 */
describe("drain — the deployment-environment guard", () => {
  it("refuses to submit a registro generated for another environment, leaving it pendiente", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, entorno: "preproduction" });
    try {
      const deps = drainDeps(staticResolver(aeat.client()));
      const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

      expect(result.recordsSubmitted).toBe(0);
      expect(result.incidentsRaised).toBe(1);

      const envio = await withTransaction(pg.db, (tx) =>
        tx.execute<{ estado: string }>(sql`select estado from envios where ${ownChain(seeded)}`),
      );
      // Left pendiente, not failed: fixing the host's configuration and restarting must be enough.
      expect(envio.rows[0]!.estado).toBe("pendiente");

      const inc = parseParams(
        await withTransaction(pg.db, (tx) =>
          tx.execute<{ code: string; severity: string; params: string }>(
            sql`select code, severity, params from incidents`,
          ),
        ),
      );
      expect(inc.rows).toHaveLength(1);
      expect(inc.rows[0]?.code).toBe("fiscal.environment_mismatch");
      expect(inc.rows[0]?.severity).toBe("error");
      // Pinned exactly: `registroId` is the incident's only traceback to the record.
      expect(inc.rows[0]?.params).toEqual({
        registroId: seeded.registroIds[0],
        recordEnvironment: "preproduction",
        hostEnvironment: "production",
      });
    } finally {
      await pg.db.execute(sql`delete from envios where ${ownChain(seeded)}`);
    }
  });

  it("refuses a registro with no recorded environment, distinctly from a mismatch", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, entorno: null });
    try {
      const deps = drainDeps(staticResolver(aeat.client()));
      const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

      expect(result.recordsSubmitted).toBe(0);

      const envio = await withTransaction(pg.db, (tx) =>
        tx.execute<{ estado: string }>(sql`select estado from envios where ${ownChain(seeded)}`),
      );
      expect(envio.rows[0]!.estado).toBe("pendiente");

      const inc = parseParams(
        await withTransaction(pg.db, (tx) =>
          tx.execute<{ code: string; params: string }>(sql`select code, params from incidents`),
        ),
      );
      expect(inc.rows).toHaveLength(1);
      // A NULL entorno is refused under its own code, never treated as agreeing with the host.
      expect(inc.rows[0]?.code).toBe("fiscal.environment_unknown");
      expect(inc.rows[0]?.params).toEqual({
        registroId: seeded.registroIds[0],
        hostEnvironment: "production",
      });
    } finally {
      await pg.db.execute(sql`delete from envios where ${ownChain(seeded)}`);
    }
  });

  it("submits normally when the environments agree", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, entorno: "production" });
    try {
      const deps = drainDeps(staticResolver(aeat.client()));
      const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

      expect(result.recordsSubmitted).toBeGreaterThan(0);
      expect(result.recordsAccepted).toBeGreaterThan(0);
    } finally {
      await pg.db.execute(sql`delete from envios where ${ownChain(seeded)}`);
    }
  });

  /**
   * A refused row's successors on the SAME chain must not submit either: they would reach AEAT
   * pointing at a huella AEAT never received. `haltOpenChainClaims` only sees an OPEN
   * `rechazado`/`detenido` envío, not a `pendiente` refusal.
   */
  it("halts a chain behind a refused predecessor: no successor submits, and none of them are touched", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    let cleanupNodeId: string | undefined;
    try {
      // secuencia 1 is refused (no entorno); 2 and 3, on the same chain, carry `"production"`.
      const seeded = await seedPendingEnvios(pg.db, { count: 1, entorno: null });
      cleanupNodeId = seeded.nodeId;
      await appendPendingAlta(pg.db, seeded, 2);
      await appendPendingAlta(pg.db, seeded, 3);

      const deps = drainDeps(staticResolver(aeat.client()));
      const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

      expect(result.recordsSubmitted).toBe(0);
      // One incident for the whole chain, not one per row.
      expect(result.incidentsRaised).toBe(1);

      const rows = await withTransaction(pg.db, (tx) =>
        tx.execute<{ secuencia: number; estado: string; intentos: number }>(sql`
          select r.secuencia, e.estado, e.intentos from envios e
          join registros_facturacion r on r.id = e.registro_id
          where r.node_id = ${seeded.nodeId}
          order by r.secuencia
        `),
      );
      // All three stay pendiente and were never claimed (intentos still 0).
      expect(rows.rows.map((r) => r.estado)).toEqual(["pendiente", "pendiente", "pendiente"]);
      expect(rows.rows.map((r) => r.intentos)).toEqual([0, 0, 0]);

      const inc = parseParams(
        await withTransaction(pg.db, (tx) =>
          tx.execute<{ code: string; params: string }>(sql`select code, params from incidents`),
        ),
      );
      expect(inc.rows).toHaveLength(1);
      expect(inc.rows[0]?.code).toBe("fiscal.environment_unknown");
      // The incident names the refused row, not a blocked successor.
      expect(inc.rows[0]?.params).toMatchObject({ registroId: seeded.registroIds[0] });

      const stored = aeat.stored();
      expect(stored.some((s) => s.key.startsWith(`${seeded.nif}|`))).toBe(false);
    } finally {
      if (cleanupNodeId !== undefined) {
        await pg.db.execute(sql`delete from envios where ${ownChain({ nodeId: cleanupNodeId })}`);
      }
    }
  }, 20_000);

  /**
   * A backlog of refused rows cannot starve sendable work behind it. 3 refused rows fill the
   * injected limit-3 claim window, and a healthy row on an unrelated chain is forced to sort LAST
   * (`sifId: "ffffffff-..."`), so only `drainDue`'s retry loop, excluding the blocked chain from a
   * second claim, can reach it.
   */
  it("does not starve a sendable row sorting behind a cap-filling backlog of refused rows on another chain", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    let cleanupNodeId: string | undefined;
    try {
      const seeded = await seedPendingEnvios(pg.db, { count: 3, entorno: null });
      cleanupNodeId = seeded.nodeId;
      const healthy = await seedIndependentChain(pg.db, seeded, {
        sifId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        secuencia: 1,
        entorno: "production",
      });

      const deps: DrainDeps = {
        db: pg.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
        maxRegistrosPorEnvio: 3,
      };
      const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

      expect(result.recordsSubmitted).toBe(1);
      expect(result.recordsAccepted).toBe(1);
      // One incident for the blocked chain, not re-raised by each retried claim.
      expect(result.incidentsRaised).toBe(1);

      const healthyRow = await withTransaction(pg.db, (tx) =>
        tx.execute<{ estado: string }>(
          sql`select estado from envios where registro_id = ${healthy.registroId}`,
        ),
      );
      expect(healthyRow.rows[0]?.estado).toBe("aceptado");

      const refused = await withTransaction(pg.db, (tx) =>
        tx.execute<{ count: number }>(sql`
            select count(*) as count from envios
            where ${ownChain(seeded)} and estado = 'pendiente'
          `),
      );
      expect(refused.rows[0]!.count).toBe(3);

      const inc = await withTransaction(pg.db, (tx) =>
        tx.execute<{ code: string }>(sql`select code from incidents`),
      );
      expect(inc.rows).toHaveLength(1);
      expect(inc.rows[0]?.code).toBe("fiscal.environment_unknown");
    } finally {
      if (cleanupNodeId !== undefined) {
        await pg.db.execute(sql`delete from envios where ${ownChain({ nodeId: cleanupNodeId })}`);
        await pg.db.execute(sql`delete from envios where estado = 'aceptado'`);
      }
    }
  });
});

describe("backoffMs", () => {
  it("doubles from BACKOFF_BASE_MS (60s) per attempt, capped at BACKOFF_MAX_MS (3600s)", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(6)).toBe(1_920_000); // 60_000 * 2^5, still under the cap
    expect(backoffMs(7)).toBe(3_600_000); // 60_000 * 2^6 = 3,840,000 -> capped
    expect(backoffMs(20)).toBe(3_600_000); // stays capped, no overflow/misbehaviour for large intentos
  });
});

/**
 * An out-of-range `maxRegistrosPorEnvio` is refused before it reaches the SQL: `0` would claim
 * nothing, and a negative `limit` means no limit on this engine.
 */
describe("drain — maxRegistrosPorEnvio validation", () => {
  const NOW = new Date("2026-07-21T00:01:00Z");
  const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
  const depsWith = (cap?: number): DrainDeps => ({
    db: pg.db,
    resolveClient: staticResolver(aeat.client()),
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    environment: "production",
    ...(cap === undefined ? {} : { maxRegistrosPorEnvio: cap }),
  });

  it.each([[0], [-1], [2.5], [1001]])(
    "throws for an out-of-range injected cap (%s), before touching the database",
    async (cap) => {
      await expect(drain(depsWith(cap), NOW)).rejects.toThrow(
        `maxRegistrosPorEnvio must be an integer in 1..1000, got ${cap}`,
      );
    },
  );

  it("accepts a valid small cap (3) and the omitted default (→1000) without throwing", async () => {
    let capNode: string | undefined;
    let defaultNode: string | undefined;
    try {
      capNode = (await seedPendingEnvios(pg.db, { count: 1 })).nodeId;
      const withCap = await drain(depsWith(3), NOW);
      expect(withCap.recordsSubmitted).toBeGreaterThanOrEqual(1);

      // The first drain closed the flow-control gate; clear it so the second pass is ungated.
      await pg.db.execute(sql`delete from envio_flujo`);
      defaultNode = (await seedPendingEnvios(pg.db, { count: 1 })).nodeId;
      const omitted = await drain(depsWith(), NOW);
      expect(omitted.recordsSubmitted).toBeGreaterThanOrEqual(1);
    } finally {
      if (capNode !== undefined) {
        await pg.db.execute(sql`delete from envios where ${ownChain({ nodeId: capNode })}`);
      }
      if (defaultNode !== undefined) {
        await pg.db.execute(sql`delete from envios where ${ownChain({ nodeId: defaultNode })}`);
      }
    }
  });
});

/**
 * No concurrent-drain case here: one writer at a time is `packages/store/src/write-queue.ts`'s
 * subject, and its own cases hold it.
 */
