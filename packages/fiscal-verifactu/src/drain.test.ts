import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordSale, recordVoid } from "@waitron/core";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import type { TenantId } from "@waitron/shared";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { VerifactuBackend } from "./backend.js";
import { DEFAULT_SKIP_RETRY_MS, backoffMs, drain, type DrainDeps } from "./drain.js";
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

// IDENTITY_MIGRATIONS between core and fiscal (manifest order core → identity → fiscal): recordVoid
// now calls `authorize`, which reads identity's persons/sessions.
const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, FISCAL_MIGRATIONS] });

describe("drain — happy path", () => {
  let seeded: SeededDrain;
  let aeat: ReturnType<typeof createFakeAeat>;
  let backend: VerifactuBackend;

  beforeEach(async () => {
    aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    seeded = await seedPendingEnvios(pg.db, { count: 3 }); // 3 pending altas on one till/tenant
    backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
  });

  it("submits the pending batch, marks it aceptado, and persists a CSV on every row", async () => {
    const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

    expect(result.recordsSubmitted).toBe(3);
    expect(result.recordsAccepted).toBe(3);
    expect(result.batchesSent).toBe(1);

    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ estado: string; csv: string | null; confirmado_en: string | null }>(sql`
      select estado, csv, confirmado_en from envios order by registro_id
    `),
    );
    expect(rows.rows.every((r) => r.estado === "aceptado")).toBe(true);
    expect(rows.rows.every((r) => r.csv !== null && r.csv !== "")).toBe(true);
    expect(rows.rows.every((r) => r.confirmado_en !== null)).toBe(true);
  });

  it("stamps RefExterna = registro id, so AEAT stored our id", async () => {
    await backend.drain(new Date("2026-07-21T00:01:00Z"));
    const stored = aeat.stored();
    expect(new Set(stored.map((s) => s.refExterna))).toEqual(new Set(seeded.registroIds));
  });

  it("TEETH: dropping the CSV write leaves a row with no CSV — this test must fail if csv is not persisted", async () => {
    await backend.drain(new Date("2026-07-21T00:01:00Z"));
    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ csv: string | null }>(sql`select csv from envios`),
    );
    // If a future change drops `csv = ${csv}` from persistResponse, this assertion fails.
    expect(rows.rows.every((r) => r.csv !== null)).toBe(true);
  });
});

/**
 * `toEnvioRegistro`'s `tipo_registro === "anulacion"` branch is not speculative future scope: a
 * void today (`VerifactuBackend.recordVoid`, already shipped) inserts a `pendiente` `envios` row
 * for the anulación it appends (`void-path.e2e.test.ts`'s own "gives the anulación its own
 * pending sidecar row"), so a real `drain()` pass can and does claim one right now. Proven
 * end to end here — through `@waitron/core`'s `recordSale`/`recordVoid`, not `seedPendingEnvios`
 * (which, per its own doc comment, seeds altas only) — rather than left as an untested branch.
 */
describe("drain — happy path, an anulación row", () => {
  it("submits a voided sale's anulación through the same accept-and-persist path as an alta", async () => {
    const { tenantId, tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db);
    // recordVoid now requires `sale.void`: seed a manager and open its session to authorize the void.
    const { rows: mgr } = await pg.db.execute<{ id: string }>(
      sql`insert into persons (tenant_id, display_name, pin_hash, role)
          values (${tenantId}, 'P', ${hashPin("1234")}, 'manager') returning id`,
    );
    const voidSession = await withTenant(pg.db, tenantId, (tx) =>
      loginWithPin(tx, { tenantId, tillId, personId: mgr[0]!.id, pin: "1234" }),
    );
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });

    const sale = await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return recordSale(tx, backend, saleInput({ tenantId, tillId, nodeId, seriesId }));
    });
    await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await recordVoid(tx, backend, sale.saleId, "staff error", { sessionId: voidSession.id });
    });

    // Both envíos (the alta's and the anulación's) were inserted with the column's own
    // `defaultNow()` — comfortably before a `now` a minute past actual wall-clock time.
    const result = await backend.drain(new Date(Date.now() + 60_000));

    expect(result.recordsSubmitted).toBe(2);
    expect(result.recordsAccepted).toBe(2);

    // Filtered explicitly by tenant, not left to RLS alone: PGlite's default connection is a
    // superuser, which bypasses row-level security unconditionally (this package's own recurring
    // note, e.g. `../test/fixtures.ts`'s `seedTenantTillSif` doc comment) — so an unfiltered
    // `select … from envios` here would also pick up every earlier test's own accumulated rows in
    // this shared `pg.db`, the same reason `backend.ts`'s real `pendingCount` filters explicitly too.
    const rows = await withTenant(pg.db, tenantId, (tx) =>
      tx.execute<{ estado: string; csv: string | null }>(sql`
        select estado, csv from envios where tenant_id = ${tenantId}
      `),
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.estado === "aceptado")).toBe(true);
    expect(rows.rows.every((r) => r.csv !== null)).toBe(true);
  });
});

/**
 * Its own describe, with a beforeEach that seeds NOTHING beyond `aeat`: `drain()`'s own
 * top-level `tenantsWithWork` sweep (./drain.ts) is global across the WHOLE shared `pg.db`, not
 * scoped to whichever caller invokes it — so if this describe's beforeEach seeded its own
 * always-pending tenant (the "happy path" describe's convention), a self-built batching tenant
 * here would have its `result.batchesSent` count polluted by that OTHER tenant's own envío too.
 * Every other describe in this file either fully drains whatever it seeds before its `it` returns,
 * OR deletes the `envios` rows it seeded (the "deployment-environment guard" describe below, whose
 * whole point is rows no backend in this file can ever fully drain, in a `finally`; the "flow
 * control" describe, whose "defers behind a still-open gate" test intentionally leaves 3 rows
 * `pendiente`, in an `afterEach`), so nothing is left pending for this sweep to pick up.
 *
 * That no-leak invariant is STRICT now, where it was slack before: while the drain cap was
 * hardcoded at 1000, a leaked backlog behind a CLOSED gate (the "defers" test's 3 rows) was `< cap`
 * and the sweep deferred it, so the leak was invisible. Under the small INJECTED cap below those
 * same 3 rows are `>= cap`, the sweep sends them, and the starvation test's global counters read 4
 * submitted instead of 1 — which is why the "flow control" describe now cleans up after itself.
 *
 * The batch cap is INJECTED small (`maxRegistrosPorEnvio: 3`) so the split is proven against a
 * 4-row backlog rather than the 1001 rows the production cap (1000) would demand. Seeding 1000+
 * rows through `seedPendingEnvios`'s per-row insert loop (~4 round trips each) timed this test out
 * at 30s under CI Docker contention (~32s in CI vs ~1s locally) — the flake the cap seam fixes. The
 * semantics are identical to the production default: a full chunk of `maxRegistrosPorEnvio` sent
 * now, the sub-cap tail deferred to the next gated pass. See `DrainDeps.maxRegistrosPorEnvio`
 * (./drain.ts) for why the cap is injectable and why production never sets it.
 */
describe("drain — batching (the >cap split)", () => {
  let aeat: ReturnType<typeof createFakeAeat>;

  beforeEach(() => {
    aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
  });

  it("splits a >cap backlog at the injected cap: a full 3-row chunk now, the <cap tail deferred until t", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 4 });
    // Call the drainer directly rather than through `VerifactuBackend`, so the injected cap reaches
    // `DrainDeps` (the backend exposes no batch-cap option — production always takes the default).
    // `VerifactuBackend.drain` is nothing but `runDrain({ db, resolveClient, skipRetryMs,
    // environment }, now)` — every other describe here exercises that wrapper — so the only
    // behavioural difference is the small cap this seam exists to inject.
    const deps: DrainDeps = {
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: "production",
      maxRegistrosPorEnvio: 3,
    };

    // First pass: 4 due rows, gate open (no `envio_flujo` row yet) — sends a FULL chunk of 3, sees
    // 1 row left (< cap) and defers that tail to `nextDueAt`, exactly as a 1001-row backlog sends
    // 1000 and defers 1 at the production cap.
    const first = await drain(deps, new Date("2026-07-21T00:01:00Z"));
    expect(first.batchesSent).toBe(1);
    expect(first.recordsSubmitted).toBe(3);
    expect(first.nextDueAt).not.toBeNull();

    const pending = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ count: string }>(sql`
      select count(*)::text as count from envios where tenant_id = ${seeded.tenantId} and estado = 'pendiente'
    `),
    );
    expect(Number(pending.rows[0].count)).toBe(1);

    // Second pass, gated on `t`: the deferred 1-row tail goes.
    const second = await drain(deps, first.nextDueAt!);
    expect(second.batchesSent).toBe(1);
    expect(second.recordsSubmitted).toBe(1);
  });
});

describe("drain — flow control (envio_flujo)", () => {
  let seeded: SeededDrain;
  let aeat: ReturnType<typeof createFakeAeat>;
  let backend: VerifactuBackend;

  beforeEach(async () => {
    aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    seeded = await seedPendingEnvios(pg.db, { count: 3 }); // 3 pending altas on one till/tenant
    backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
  });

  // Delete this describe's own seeded rows after every test — the same "deletes what it seeded in a
  // finally" hygiene the "deployment-environment guard" describe below applies, and the invariant
  // the "batching (the >cap split)" describe's header depends on: no test may leave `envios` rows
  // the file-global `drain()` sweep would pick up. The "defers a tenant behind a still-open gate"
  // test below LEAVES 3 rows `pendiente` behind a CLOSED gate — harmless while the drain cap was
  // hardcoded at 1000 (a 3-row backlog is `< 1000`, so the sweep defers it), but the ">cap split"
  // and starvation tests now inject a small cap (`maxRegistrosPorEnvio: 3`), under which those same
  // 3 leaked rows are `>= cap` and the global sweep SENDS them — inflating those tests' global
  // result counters. Cleaning up here removes the leak at its source rather than tuning each cap
  // around it. Deleting `envios` (not the tenant/registro) mirrors the env-guard describe's own
  // `delete from envios where tenant_id` pattern; the two draining tests above leave nothing
  // pending, so this is a no-op for them.
  afterEach(async () => {
    await pg.db.execute(sql`delete from envios where tenant_id = ${seeded.tenantId}`);
  });

  it("persists the server's TiempoEsperaEnvio into envio_flujo and sets nextDueAt when a partial batch remains for next time", async () => {
    // 3 records → one envío that drains the whole backlog; the tenant's NEXT envío waits t.
    const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));
    // Filtered explicitly by tenant, not left to RLS alone: PGlite's default connection is a
    // superuser, which bypasses row-level security unconditionally (this package's own recurring
    // note — see e.g. the anulación test above, or `backend.ts`'s `pendingCount` doc comment) — an
    // unfiltered `select … from envio_flujo` here would pick up whichever tenant's row (this
    // describe reseeds a FRESH tenant per `it`) sorts first, not necessarily this test's own.
    const flujo = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ proximo_envio_en: string; tiempo_espera_seg: number }>(
        sql`select proximo_envio_en, tiempo_espera_seg from envio_flujo where tenant_id = ${seeded.tenantId}`,
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
    const backend2 = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(big.client()),
    });
    await backend2.drain(new Date("2026-07-21T00:01:00Z"));
    // Same explicit-tenant-filter reasoning as the test above — this file's own shared `pg.db` may
    // still hold an EARLIER test's own `envio_flujo` row (e.g. this describe's previous `it`,
    // t=60) at the time this query runs, and RLS alone will not exclude it under PGlite's
    // superuser connection.
    const flujo = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ tiempo_espera_seg: number }>(
        sql`select tiempo_espera_seg from envio_flujo where tenant_id = ${seeded.tenantId}`,
      ),
    );
    expect(flujo.rows[0]?.tiempo_espera_seg).toBe(9999); // fake clamps its initial t to ≤9999 per the schema
  });

  /**
   * The "otherwise" half of the race (spec §7.2, art. 16.4): fewer than 1000 due AND the gate has
   * not yet elapsed defers the WHOLE tenant — nothing is claimed, nothing is sent, and the
   * existing `envio_flujo` row (simulating an earlier pass this test does not itself drive) is
   * read back rather than treated as absent. Proven by pre-seeding `envio_flujo` directly:
   * building this scenario by actually draining once and then racing a second `drain()` call
   * before the gate opens would need a SECOND, distinct pending backlog for the SAME tenant, which
   * none of this file's fixtures produce without duplicating `insertPendingAlta`'s own chain-
   * consistent insert — pre-seeding the flow row is the direct, minimal way to put the tenant in
   * "just sent, gate still closed" state.
   */
  it("defers a tenant behind a still-open gate, claiming nothing and leaving its backlog pending", async () => {
    const proximoEnvioEn = new Date("2026-07-21T00:05:00Z"); // still in the future relative to `now` below
    await pg.db.execute(sql`
      insert into envio_flujo (tenant_id, proximo_envio_en, tiempo_espera_seg)
      values (${seeded.tenantId}, ${proximoEnvioEn.toISOString()}, 60)
    `);

    const now = new Date("2026-07-21T00:01:00Z"); // before proximoEnvioEn — the gate is still closed
    const result = await backend.drain(now);

    expect(result.batchesSent).toBe(0);
    expect(result.recordsSubmitted).toBe(0);
    expect(result.nextDueAt).toEqual(proximoEnvioEn);

    // Filtered explicitly by tenant — same PGlite-superuser-bypasses-RLS reasoning as above.
    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ estado: string }>(
        sql`select estado from envios where tenant_id = ${seeded.tenantId}`,
      ),
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.every((r) => r.estado === "pendiente")).toBe(true);
  });
});

/**
 * Task 8: a row left `enviando` proves a process crashed between T1 (claim, committed) and T2
 * (persist) — this is exactly what the T1/T2 split (Task 6) makes possible to recover: T1's commit
 * is what leaves a real, committed `enviando` row behind for a LATER drain() to find, rather than
 * an in-flight uncommitted claim that simply vanishes with the crashed process.
 *
 * Every update/select below filters explicitly by `tenant_id`, unlike the brief's own inline
 * sample — this file's shared `pg.db` accumulates rows from every earlier describe block (the
 * established convention throughout this file, e.g. the "flow control" describe's own comments),
 * and an unscoped `update envios set ...` with no WHERE at all would silently rewrite every row
 * any other test in this file has ever left behind.
 */
describe("drain — stale claim recovery", () => {
  it("recovers a stale enviando row back to pendiente with incidencia set, then resubmits it this same pass", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    // Simulate the crash: T1 committed (estado -> 'enviando') but the process died before T2
    // could persist a response. enviado_en is stamped well over RECUPERACION_ENVIANDO_MS (5 min)
    // in the past, so THIS drain() pass must recover it rather than leave it stuck forever.
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(sql`
        update envios set estado = 'enviando', enviado_en = ${new Date("2026-07-20T00:00:00Z").toISOString()}
        where tenant_id = ${seeded.tenantId}
      `),
    );
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(new Date("2026-07-21T00:01:00Z")); // > RECUPERACION_ENVIANDO_MS past enviado_en

    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ estado: string; incidencia: boolean }>(sql`
        select estado, incidencia from envios where tenant_id = ${seeded.tenantId}
      `),
    );
    // Recovered (-> pendiente) then re-claimed and resubmitted in this SAME pass, since nothing
    // else gates it — aceptado, but incidencia (raised by the recovery) is never cleared by the
    // happy path (Task 9's rejection/incident handling is out of this task's scope).
    expect(rows.rows[0]?.estado).toBe("aceptado");
    expect(rows.rows[0]?.incidencia).toBe(true);
  });

  it("does not recover an enviando row that is not yet past the recovery threshold", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const now = new Date("2026-07-21T00:01:00Z");
    // enviado_en 1 minute ago — well within RECUPERACION_ENVIANDO_MS (5 min). Models a genuinely
    // in-flight submission (mid network round-trip in another process), not a crash: recovering
    // this would resubmit a record someone else may still be about to persist a CSV for.
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(sql`
        update envios set estado = 'enviando', enviado_en = ${new Date(now.getTime() - 60_000).toISOString()}
        where tenant_id = ${seeded.tenantId}
      `),
    );
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    const result = await backend.drain(now);

    expect(result.recordsSubmitted).toBe(0); // untouched — not stale, so not reclaimed
    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ estado: string; incidencia: boolean }>(sql`
        select estado, incidencia from envios where tenant_id = ${seeded.tenantId}
      `),
    );
    expect(rows.rows[0]?.estado).toBe("enviando");
    expect(rows.rows[0]?.incidencia).toBe(false);
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
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(failing),
    });
    const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{
        estado: string;
        intentos: number;
        incidencia: boolean;
        proximo_intento_en: string;
      }>(sql`
        select estado, intentos, incidencia, proximo_intento_en from envios
        where tenant_id = ${seeded.tenantId}
      `),
    );
    // Claimed (intentos incremented to 1 at claim), then the submit threw — backed off to
    // pendiente rather than left stuck `enviando`, with incidencia raised.
    expect(rows.rows[0]?.estado).toBe("pendiente");
    expect(rows.rows[0]?.intentos).toBe(1);
    expect(rows.rows[0]?.incidencia).toBe(true);
    expect(new Date(rows.rows[0]!.proximo_intento_en).getTime()).toBe(
      new Date("2026-07-21T00:01:00Z").getTime() + 60_000,
    );
    // A retry is scheduled, not lost — the scheduler has something to wake up for.
    expect(result.nextDueAt).not.toBeNull();
  });
});

/**
 * Task 9: replaces the "everything accepted" happy path with real per-record resolution via
 * `resolveEstadoEfectivo` — rejection halts the chain and raises a structured incident,
 * AceptadoConErrores is still an accept but raises a warning, and a record that lands on an
 * already-halted chain is stopped without ever reaching AEAT.
 */
describe("drain — per-record resolution: rejection, halting, incidents", () => {
  it("halts a chain on a genuine rejection: the record is rechazado, its successors detenido, an error incident is raised", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 }); // secuencia 1,2,3 on one SIF
    aeat.reject(seeded.facturaKeys[1]!, 1100, "Campo obligatorio ausente"); // reject the middle record
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ secuencia: number; estado: string; incidencia: boolean }>(sql`
        select r.secuencia, e.estado, e.incidencia from envios e join registros_facturacion r on r.id = e.registro_id
        where e.tenant_id = ${seeded.tenantId}
        order by r.secuencia
      `),
    );
    expect(rows.rows.map((r) => r.estado)).toEqual(["aceptado", "rechazado", "detenido"]);
    expect(rows.rows[1]?.incidencia).toBe(true);
    expect(rows.rows[2]?.incidencia).toBe(true); // haltSuccessors marks the successor too
    expect(result.recordsHalted).toBe(2); // rechazado (1) + detenido successor (1)
    expect(result.recordsAccepted).toBe(1); // only secuencia 1
    expect(result.incidentsRaised).toBeGreaterThanOrEqual(1);

    const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ code: string; severity: string; params: Record<string, unknown> }>(sql`
        select code, severity, params from incidents where tenant_id = ${seeded.tenantId}
      `),
    );
    expect(
      inc.rows.some((i) => i.severity === "error" && i.code === "fiscal.registro_rechazado"),
    ).toBe(true);
    // Structured, never prose: the message text lives in a param, not baked into `code`.
    const rejected = inc.rows.find((i) => i.code === "fiscal.registro_rechazado");
    expect(rejected?.params).toMatchObject({ codigo: 1100, mensaje: "Campo obligatorio ausente" });
  });

  it("marks aceptado_con_errores and raises a warning incident, but the record still counts as accepted", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, futureDated: true }); // triggers 2004 → AceptadoConErrores
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ estado: string; csv: string | null }>(
        sql`select estado, csv from envios where tenant_id = ${seeded.tenantId}`,
      ),
    );
    expect(rows.rows[0]?.estado).toBe("aceptado_con_errores");
    expect(rows.rows[0]?.csv).not.toBeNull(); // still a genuine AEAT submission — CSV persisted
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(0);

    const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ severity: string; code: string }>(
        sql`select severity, code from incidents where tenant_id = ${seeded.tenantId}`,
      ),
    );
    expect(inc.rows).toHaveLength(1);
    expect(inc.rows[0]?.severity).toBe("warning");
    expect(inc.rows[0]?.code).toBe("fiscal.aceptado_con_errores");
  });

  it("sets Incidencia on a record enqueued while its chain has an open detenido incident, and never submits it", async () => {
    // `tiempoEsperaInicial: 5`, not this suite's usual default (60s): `drain()`'s own
    // `tenantsWithWork` sweep (./drain.ts) is global across the WHOLE shared `pg.db` (this file's own
    // repeated note, e.g. the "batching" describe above) — confirmed live while implementing this
    // task: the "retry backoff on a transient submit failure" describe (above) deliberately leaves
    // its OWN tenant `pendiente`, due again at exactly `2026-07-21T00:02:00Z` (its one row's
    // `proximo_intento_en`, backed off by `backoffMs(1)` = 60s past that test's own `now` of
    // `00:01:00Z`). The default 60s gate would put THIS test's second drain at that exact instant
    // too, and the OTHER test's leftover row — gate-less (no envio_flujo row of its own), so
    // immediately claimable — would be silently swept up and submitted by THIS test's own
    // `backend.drain()` call, inflating `second.recordsSubmitted`/`recordsAccepted` by one record
    // that has nothing to do with this test. A short, test-local `tiempoEsperaInicial` opens this
    // tenant's OWN gate well before that shared instant, decoupling the two.
    const aeat = createFakeAeat({
      serverNow: new Date("2026-07-21T00:00:00Z"),
      tiempoEsperaInicial: 5,
    });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    aeat.reject(seeded.facturaKeys[1]!, 1100, "Campo obligatorio ausente");
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    // First pass: secuencia 2 rechazado, secuencia 3 halted to detenido (the previous test's own
    // scenario) — the chain is left with an OPEN halt.
    const first = await backend.drain(new Date("2026-07-21T00:01:00Z"));
    expect(first.recordsHalted).toBe(2);

    // A NEW record lands on the SAME chain (sif) while the halt is still open — e.g. staff kept
    // selling at the till, oblivious to the AEAT-side rejection.
    await appendPendingAlta(pg.db, seeded, 4);

    // Gate opens at 00:01:05Z (tiempoEsperaInicial: 5 above); 00:01:30Z is comfortably past that
    // and comfortably short of the 00:02:00Z shared-`pg.db` hazard this test's own comment explains.
    const second = await backend.drain(new Date("2026-07-21T00:01:30Z"));

    const row4 = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ estado: string; incidencia: boolean }>(sql`
        select e.estado, e.incidencia from envios e join registros_facturacion r on r.id = e.registro_id
        where e.tenant_id = ${seeded.tenantId} and r.secuencia = 4
      `),
    );
    expect(row4.rows[0]?.estado).toBe("detenido");
    expect(row4.rows[0]?.incidencia).toBe(true);
    // Never reached AEAT: submitting a record over an unresolved gap in the chain would be
    // submitting out of order.
    expect(second.recordsSubmitted).toBe(0);
    expect(second.recordsHalted).toBe(1);

    // Confirms "never submits" concretely, not just via the counter: AEAT's own store has no
    // record under secuencia 4's identity at all.
    const stored = aeat.stored();
    expect(stored.some((s) => s.key.startsWith(`${seeded.nif}|S4/`))).toBe(false);
  });

  /**
   * `haltOpenChainClaims` (./drain.ts) must halt ONLY the chain that actually has an open
   * `rechazado`/`detenido` row — a tenant with a SECOND, entirely healthy chain (a different
   * till, its own SIF, e.g. a shop's second till) must still have that chain's due work claimed
   * and submitted normally in the SAME batch/drain pass, even while the first chain sits halted.
   * `seedSecondChain`'s own doc comment explains why `seedPendingEnvios`'s single-chain shape
   * cannot exercise this on its own.
   */
  it("does not halt an unrelated healthy chain claimed in the same batch as a halted one", async () => {
    const aeat = createFakeAeat({
      serverNow: new Date("2026-07-21T00:00:00Z"),
      tiempoEsperaInicial: 5,
    });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    aeat.reject(seeded.facturaKeys[1]!, 1100, "Campo obligatorio ausente");
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    const first = await backend.drain(new Date("2026-07-21T00:01:00Z"));
    expect(first.recordsHalted).toBe(2); // chain A: secuencia 2 rechazado + secuencia 3 detenido

    // A new record lands on the halted chain (A) AND an entirely separate, healthy chain (B) on
    // the SAME tenant both become due together — claimed in the SAME batch on the next pass.
    const chainA4 = await appendPendingAlta(pg.db, seeded, 4);
    // secuencia 5, not 1: `insertPendingAlta` derives `NumSerieFactura` from `secuencia`
    // (`S{secuencia}/1`), and invoice numbers are unique per (nif, series, fecha) REGARDLESS of
    // which chain/SIF they belong to (`registros_identidad_uq`) — chain A already used 1-4.
    const chainB1 = await seedSecondChain(pg.db, seeded, 5);

    // Gate opens at 00:01:05Z (tiempoEsperaInicial: 5); 00:01:30Z avoids this file's own shared-`pg.db`
    // hazards (see the previous test's own comment: 00:02:00Z and 00:05:00Z).
    const second = await backend.drain(new Date("2026-07-21T00:01:30Z"));

    const rowA = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ estado: string; incidencia: boolean }>(
        sql`select estado, incidencia from envios where registro_id = ${chainA4.registroId}`,
      ),
    );
    expect(rowA.rows[0]?.estado).toBe("detenido");
    expect(rowA.rows[0]?.incidencia).toBe(true);

    const rowB = await withTenant(pg.db, seeded.tenantId, (tx) =>
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
 * Task 10: replaces Task 9's `handleDuplicate` STUB with the real error-3000 resolution
 * `resolveEstadoEfectivo` (`@waitron/verifactu`) hands back for the two duplicate cases — see
 * ./drain.ts's own doc comment on `handleDuplicate`/`routeB` for the full reasoning. The outer
 * `EstadoRegistro` on every one of these lines reads `Incorrecto` (error 3000 is an "Incorrecto"
 * line at the envío level); what tells the four scenarios below apart is never that outer status,
 * always `RegistroDuplicado`'s own inner detail (or, for Route B, a follow-up consulta).
 *
 * `tiempoEsperaInicial: 5`, and every two-drain test's second call at `00:01:30Z` rather than the
 * suite's usual 60s-later pattern: `drain()`'s own `tenantsWithWork` sweep is global across the
 * WHOLE shared `pg.db` (this file's own repeated note — e.g. the "per-record resolution" describe
 * above). Confirmed live while implementing this task: this file's "retry backoff on a transient
 * submit failure" describe deliberately leaves its OWN tenant `pendiente`, due again at exactly
 * `2026-07-21T00:02:00Z`, and gate-less (its `envio_flujo` row also lands at exactly that instant —
 * see that describe's own scenario). A second drain at the suite's usual `:03:00Z` is AT OR PAST
 * that shared instant, and the very first test below to reach it silently sweeps that OTHER test's
 * leftover row up too, inflating `recordsAccepted` by one record that has nothing to do with this
 * describe (caught by the TEETH test's own `toBe(1)` failing as `2`). A short, per-test
 * `tiempoEsperaInicial` opens THIS tenant's own gate well before either that hazard or the
 * `defers a tenant behind a still-open gate` test's `00:05:00Z` gate (that tenant stays due-but-
 * gated forever in the same shared `pg.db`, since its own `it` never submits it), matching the
 * "sets Incidencia..." test's identical precedent a few describes above.
 */
describe("drain — error 3000: Route A + Route B resolution", () => {
  let aeat: ReturnType<typeof createFakeAeat>;

  beforeEach(() => {
    aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z"), tiempoEsperaInicial: 5 });
  });

  it("TEETH: a 3000 whose RegistroDuplicado is Correcta resolves to aceptado, not rechazado/detenido", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(new Date("2026-07-21T00:01:00Z")); // stores it — AEAT now genuinely holds "Correcta"

    // Resubmit the SAME identity without changing anything AEAT's store holds: a genuine
    // resubmission of our own already-accepted record — e.g. a lost response after a real T1/T2
    // crash. The fake reports this as error 3000 with RegistroDuplicado.EstadoRegistroDuplicado =
    // "Correcta" (its own `handleEnvio` doc comment) — the inversion `resolveEstadoEfectivo`
    // exists to read correctly instead of taking the outer Incorrecto at face value.
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${new Date("2026-07-21T00:01:00Z").toISOString()}
        where tenant_id = ${seeded.tenantId}
      `),
    );
    const result = await backend.drain(new Date("2026-07-21T00:01:30Z")); // gate opens 00:01:05Z

    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ estado: string }>(
        sql`select estado from envios where tenant_id = ${seeded.tenantId}`,
      ),
    );
    expect(rows.rows[0]?.estado).toBe("aceptado"); // despite the outer Incorrecto on the 3000 line
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(0);

    // No fresh incident from a genuine re-acceptance — mirrors the plain "accepted" branch, which
    // raises none either.
    const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ code: string }>(
        sql`select code from incidents where tenant_id = ${seeded.tenantId}`,
      ),
    );
    expect(inc.rows).toHaveLength(0);
  });

  /**
   * Two records on one chain (secuencia 1, 2), not one: proves Route A ALSO halts a successor
   * claimed in the SAME batch, mirroring `applyOutcome`'s `"rejected"` branch — see
   * `handleDuplicate`'s own doc comment on why. Both rows are resubmitted together here (both
   * already AEAT-stored from the first drain, so both come back as error-3000 duplicate lines in
   * ONE envío — secuencia 1 `Anulada`, secuencia 2 still genuinely `Correcta`); without the
   * `haltSuccessors` call inside Route A, secuencia 2's OWN "Correcta"-detail line (independently
   * resolving to a plain `accepted`, since the fake AEAT has no chain awareness — this file's own
   * established precedent, e.g. the "halts a chain on a genuine rejection" test above) would
   * overwrite the halt this test asserts and leave it wrongly `aceptado`.
   */
  it("Route A: duplicate_annulled halts detenido, and halts a same-batch successor too, raising a fiscal.duplicado_anulado incident", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 2 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(new Date("2026-07-21T00:01:00Z")); // stores both — AEAT now genuinely holds both "Correcta"

    aeat.annul(seeded.facturaKeys[0]!); // AEAT's own copy of secuencia 1's identity is now Anulada
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${new Date("2026-07-21T00:01:00Z").toISOString()}
        where tenant_id = ${seeded.tenantId}
      `),
    );
    const result = await backend.drain(new Date("2026-07-21T00:01:30Z")); // resubmit both -> 3000 each

    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ secuencia: number; estado: string; incidencia: boolean }>(sql`
        select r.secuencia, e.estado, e.incidencia from envios e join registros_facturacion r on r.id = e.registro_id
        where e.tenant_id = ${seeded.tenantId} order by r.secuencia
      `),
    );
    expect(rows.rows.map((r) => r.estado)).toEqual(["detenido", "detenido"]);
    expect(rows.rows.every((r) => r.incidencia)).toBe(true);
    expect(result.recordsHalted).toBe(2); // duplicate_annulled (1) + its halted successor (1)
    expect(result.recordsAccepted).toBe(0); // secuencia 2's own "Correcta" line never wins the halt

    const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ code: string; severity: string }>(
        sql`select code, severity from incidents where tenant_id = ${seeded.tenantId}`,
      ),
    );
    // Exactly ONE incident: haltSuccessors flags the successor but never raises a second incident
    // for it — this package's established "flag, don't duplicate" precedent (haltOpenChainClaims's
    // own doc comment, ./drain.ts).
    expect(inc.rows).toHaveLength(1);
    expect(inc.rows[0]?.code).toBe("fiscal.duplicado_anulado");
    expect(inc.rows[0]?.severity).toBe("error");
  });

  it("Route B: duplicate_unknown with a matching huella resolves to aceptado", async () => {
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(new Date("2026-07-21T00:01:00Z")); // AEAT now genuinely stores OUR real huella

    // Force the NEXT response for this identity to omit RegistroDuplicado.EstadoRegistroDuplicado
    // entirely — exactly what `resolveEstadoEfectivo` reads as `duplicate_unknown` rather than a
    // genuine accept (`dropRegistroDuplicadoDetail`'s own doc comment) — so the resubmit below
    // must go through `routeB`'s consulta rather than the TEETH test's direct "Correcta" path.
    aeat.dropRegistroDuplicadoDetail(seeded.facturaKeys[0]!);
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(sql`
        update envios set estado = 'pendiente', proximo_intento_en = ${new Date("2026-07-21T00:01:00Z").toISOString()}
        where tenant_id = ${seeded.tenantId}
      `),
    );
    const result = await backend.drain(new Date("2026-07-21T00:01:30Z"));

    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ estado: string; incidencia: boolean }>(
        sql`select estado, incidencia from envios where tenant_id = ${seeded.tenantId}`,
      ),
    );
    expect(rows.rows[0]?.estado).toBe("aceptado"); // routeB's consulta found AEAT's huella == ours
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsHalted).toBe(0);

    // No fresh incident on a match — mirrors the plain "accepted" branch, which raises none either.
    const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ code: string }>(
        sql`select code from incidents where tenant_id = ${seeded.tenantId}`,
      ),
    );
    expect(inc.rows).toHaveLength(0);
  });

  /**
   * `registros_facturacion` is append-only (immutable triggers) — our OWN stored huella cannot be
   * mutated to force a mismatch. AEAT's copy is made to diverge instead: a direct, separate submit
   * under the IDENTICAL invoice identity (same NIF/NumSerieFactura/FechaExpedicionFactura secuencia
   * 1 will itself use), carrying a different `Huella`, lands in the fake's store FIRST — a genuine
   * collision, not a resubmission of our own record. `dropRegistroDuplicadoDetail` then forces the
   * drainer's own (later) real submission of secuencia 1 down the `duplicate_unknown` path, so
   * `routeB`'s consulta reads back the divergent huella this direct submit planted, not ours.
   *
   * Two records (secuencia 1, 2), not one: secuencia 2 is left completely untouched — a genuinely
   * fresh registration the fake AEAT will happily accept ("Correcto") on its own per-line merits,
   * with no chain awareness of secuencia 1's mismatch. Proves Route B's mismatch branch ALSO halts
   * a same-batch successor (mirroring `applyOutcome`'s `"rejected"` branch and Route A above — see
   * `handleDuplicate`'s own doc comment): without that halt, secuencia 2's own accept would
   * overwrite the halt this test asserts.
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

    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    // secuencia 1 -> error 3000 (identity already taken), no detail -> duplicate_unknown -> routeB
    // consults -> gets back "D"*64, which is NOT our own stored huella. secuencia 2 is genuinely
    // fresh and, on its own per-line merits, would read "Correcto" -> accepted.
    const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

    const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ secuencia: number; estado: string; incidencia: boolean }>(sql`
        select r.secuencia, e.estado, e.incidencia from envios e join registros_facturacion r on r.id = e.registro_id
        where e.tenant_id = ${seeded.tenantId} order by r.secuencia
      `),
    );
    expect(rows.rows.map((r) => r.estado)).toEqual(["detenido", "detenido"]);
    expect(rows.rows.every((r) => r.incidencia)).toBe(true);
    expect(result.recordsHalted).toBe(2); // huella_divergente (1) + its halted successor (1)
    expect(result.recordsAccepted).toBe(0); // secuencia 2's own "Correcto" line never wins the halt

    const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ code: string; severity: string }>(
        sql`select code, severity from incidents where tenant_id = ${seeded.tenantId}`,
      ),
    );
    // Exactly ONE incident — same "flag, don't duplicate" reasoning as the Route A test above.
    expect(inc.rows).toHaveLength(1);
    expect(inc.rows[0]?.code).toBe("fiscal.huella_divergente");
    expect(inc.rows[0]?.severity).toBe("error");

    // AEAT's own store genuinely still holds the COLLIDING huella under secuencia 1's identity,
    // not ours — confirms the mismatch was real, not merely asserted via our own side's state. And
    // secuencia 2 genuinely WAS accepted at AEAT (it really did submit "Correcto" on its own
    // merits) even though our own bookkeeping halts it locally pending reconciliation — the fake
    // has no chain awareness, exactly like the real AEAT's per-record processing.
    const stored = aeat.stored();
    expect(stored.find((s) => s.key === seeded.facturaKeys[0])?.huella).toBe("D".repeat(64));
    expect(stored.find((s) => s.key === seeded.facturaKeys[1])?.estado).toBe("Correcta");
  });
});

/**
 * Plan 3b §7.2: a halted record stays counted AND flagged, and the flag rides its `acks` row. The
 * two BULK chain-halt paths in ./drain.ts (`haltOpenChainClaims` in T1, `haltSuccessors` in T2)
 * bypass `setEstado`'s per-row `writeAck` choke point, so before their own additive ack writes a
 * halted successor got its `detenido` estado but NO ack — the record would silently drop off the
 * ack stream. This drives `haltSuccessors`: a rejection on a chain with a still-`pendiente`
 * successor must leave BOTH a `rejected` ack for the rejected record AND a `halted` ack for the
 * successor, with the ack↔estado invariant holding for every acked row.
 *
 * Scoped to its own freshly-seeded tenant (`seedPendingEnvios` mints one per call) and asserted
 * strictly `where tenant_id = …`, so the shared-`pg.db`/global-sweep convention this file otherwise
 * carries cannot pollute these acks assertions.
 */
describe("drain — halted records get a halted ack (the bulk chain-halt paths)", () => {
  it("writes a rejected ack for the rejection and a halted ack for its still-pending successor", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 }); // secuencia 1,2,3 on one SIF
    aeat.reject(seeded.facturaKeys[1]!, 1100, "Campo obligatorio ausente"); // reject the middle record
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(new Date("2026-07-21T00:01:00Z"));

    // secuencia 1 accepted, 2 rejected, 3 halted — the successor `haltSuccessors` swept to detenido.
    const envios = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ registro_id: string; secuencia: number; estado: string }>(sql`
        select e.registro_id, r.secuencia, e.estado from envios e
        join registros_facturacion r on r.id = e.registro_id
        where e.tenant_id = ${seeded.tenantId}
        order by r.secuencia
      `),
    );
    expect(envios.rows.map((r) => r.estado)).toEqual(["aceptado", "rechazado", "detenido"]);

    const acks = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ registro_id: string; state: string }>(
        sql`select registro_id, state from acks where tenant_id = ${seeded.tenantId}`,
      ),
    );
    const ackState = new Map(acks.rows.map((a) => [a.registro_id, a.state]));

    // The rejected record's ack (this one already flowed through setEstado's writeAck).
    const rejected = envios.rows.find((r) => r.secuencia === 2)!;
    expect(ackState.get(rejected.registro_id)).toBe("rejected");

    // The halted successor's ack — the bug: haltSuccessors bypassed writeAck, so before the fix
    // this record had a `detenido` estado but NO acks row at all (this assertion is the RED→GREEN).
    const halted = envios.rows.find((r) => r.secuencia === 3)!;
    expect(ackState.get(halted.registro_id)).toBe("halted");

    // The ack↔estado invariant: every acked row's ack agrees with its committed estado — and every
    // terminal row (all three here) is acked, so none silently drops off the ack stream.
    for (const env of envios.rows) {
      const state = ackState.get(env.registro_id);
      expect(state).toBeDefined();
      expect(state).toBe(ackStateOf(env.estado));
    }
  });
});

/**
 * Deployment-environment plan, Task 6: `drain` must never submit a registro generated for the
 * OTHER deployment — submitting a pre-production record to the real AEAT is unrecoverable, since
 * chains cannot be merged or migrated and invoice numbers are never reused. `claimBatch`
 * (./drain.ts) checks each claimed row's OWN `entorno` (`seedPendingEnvios`'s new `entorno`
 * option, defaulting to `"production"` so every OTHER describe in this file keeps submitting
 * unaffected) against `DrainDeps.environment` — threaded here via
 * `VerifactuBackendOptions.deploymentEnvironment` — BEFORE ever flipping a row to `enviando`, so a
 * mismatched or unrecorded row is reported and left `pendiente` rather than submitted or backed
 * off with `backoffMs` like a transient failure.
 *
 * Adapted from the brief's own illustrative snippet to this file's established shape (a real
 * `VerifactuBackend.drain(now)` call, `withTenant`-scoped assertions against the real `envios`/
 * `incidents` tables) rather than the bare `drain(db, {...deps, environment})` sketch, which does
 * not match `drain`'s actual `(deps, now)` signature or this suite's `deps`-free convention.
 *
 * **Fix round after review** added two more properties `claimBatch`'s own doc comment covers in
 * full (chain-order: a refused row's successors must not submit either; starvation: a large
 * backlog of refused rows must not block sendable work behind it) — see the two new tests below —
 * and a `finally` per test deleting what it seeded: unlike every OTHER describe in this file, a
 * refused row is NEVER drained to completion by any backend this file constructs, so leaving it
 * behind would violate the "batching (the >cap split)" describe's own documented assumption (its
 * header comment, corrected below) that nothing else in this file leaves `envios` rows pending.
 */
describe("drain — the deployment-environment guard", () => {
  it("refuses to submit a registro generated for another environment, leaving it pendiente", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, entorno: "preproduction" });
    try {
      const backend = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: seeded.clock,
        db: pg.db,
        resolveClient: staticResolver(aeat.client()),
      });
      const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

      expect(result.recordsSubmitted).toBe(0);
      expect(result.incidentsRaised).toBe(1);

      const envio = await withTenant(pg.db, seeded.tenantId, (tx) =>
        tx.execute<{ estado: string }>(
          sql`select estado from envios where tenant_id = ${seeded.tenantId}`,
        ),
      );
      // Left pendiente, not failed: fixing the host's configuration and restarting must be enough.
      expect(envio.rows[0]!.estado).toBe("pendiente");

      const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
        tx.execute<{ code: string; severity: string; params: Record<string, unknown> }>(
          sql`select code, severity, params from incidents where tenant_id = ${seeded.tenantId}`,
        ),
      );
      expect(inc.rows).toHaveLength(1);
      expect(inc.rows[0]?.code).toBe("fiscal.environment_mismatch");
      expect(inc.rows[0]?.severity).toBe("error");
      // Pinned exactly, not just `toMatchObject` on the environment fields (M3 of the fix-round
      // review): `registroId` is the ONLY traceback from this incident row to the record it
      // describes (`incidents` carries no FK onto `registros_facturacion` — `errors.ts`'s own doc
      // comment) — a wrong value here is the one param failure that makes the incident useless to
      // whoever is resolving it, and nothing before this asserted it at all.
      expect(inc.rows[0]?.params).toEqual({
        registroId: seeded.registroIds[0],
        recordEnvironment: "preproduction",
        hostEnvironment: "production",
      });
    } finally {
      // This tenant's row is refused, never drained, by every backend this file constructs — left
      // in place it would sit `pendiente` forever in this file's SHARED `pg.db`, violating the
      // "batching (the >cap split)" describe's own documented assumption that nothing else here
      // leaves work behind (its header comment, corrected in this same fix round). Deleting the
      // `envios` row (not the tenant/registro — `envios_tenants_with_work` reads only this table)
      // is `boot.test.ts`'s own established pattern for the identical need.
      await pg.db.execute(sql`delete from envios where tenant_id = ${seeded.tenantId}`);
    }
  });

  it("refuses a registro with no recorded environment, distinctly from a mismatch", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, entorno: null });
    try {
      const backend = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: seeded.clock,
        db: pg.db,
        resolveClient: staticResolver(aeat.client()),
      });
      const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

      expect(result.recordsSubmitted).toBe(0);

      const envio = await withTenant(pg.db, seeded.tenantId, (tx) =>
        tx.execute<{ estado: string }>(
          sql`select estado from envios where tenant_id = ${seeded.tenantId}`,
        ),
      );
      expect(envio.rows[0]!.estado).toBe("pendiente");

      const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
        tx.execute<{ code: string; params: Record<string, unknown> }>(
          sql`select code, params from incidents where tenant_id = ${seeded.tenantId}`,
        ),
      );
      expect(inc.rows).toHaveLength(1);
      // Distinct code from the mismatch test above — a NULL entorno is refused rather than assumed
      // to be ours, never silently treated as agreeing with the host.
      expect(inc.rows[0]?.code).toBe("fiscal.environment_unknown");
      // Same M3 pinning as the mismatch test above — `registroId` is this incident's only
      // traceback to the record it describes.
      expect(inc.rows[0]?.params).toEqual({
        registroId: seeded.registroIds[0],
        hostEnvironment: "production",
      });
    } finally {
      await pg.db.execute(sql`delete from envios where tenant_id = ${seeded.tenantId}`);
    }
  });

  it("submits normally when the environments agree", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, entorno: "production" });
    try {
      const backend = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: seeded.clock,
        db: pg.db,
        resolveClient: staticResolver(aeat.client()),
      });
      const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

      expect(result.recordsSubmitted).toBeGreaterThan(0);
      expect(result.recordsAccepted).toBeGreaterThan(0);
    } finally {
      // This one DOES fully drain (it's the agreeing-environments case) — deleted anyway, for the
      // same reason `seedPendingEnvios`-seeding describes elsewhere in this file scope their own
      // tenant: harmless once accepted, but consistent, and immune to a future edit changing what
      // this test seeds without remembering to add cleanup.
      await pg.db.execute(sql`delete from envios where tenant_id = ${seeded.tenantId}`);
    }
  });

  /**
   * I1 of the fix-round review: a refused row's successors on the SAME chain must not submit
   * either. Before the fix, `haltOpenChainClaims` — which only recognises an OPEN `rechazado`/
   * `detenido` envío — is blind to a `pendiente` refusal, so secuencia 2 and 3 here would have
   * gone to AEAT carrying `Encadenamiento.RegistroAnterior` pointing at secuencia 1's huella, a
   * record AEAT never received. Reachable on the ordinary upgrade path (`deployment-guard.ts` lets
   * an unstamped database boot, and migration 0009 backfills nothing), not merely hypothetical.
   */
  it("halts a chain behind a refused predecessor: no successor submits, and none of them are touched", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    // Seeding lives INSIDE the try (I3's own fix-round-2 correction): a throw partway through
    // seeding — `seedPendingEnvios` succeeding but `appendPendingAlta` failing, say — would
    // otherwise leave a permanently-`pendiente` row in this shared `pg.db` with no `finally` covering
    // it at all, the exact hazard I3 was raised to close in the first place. Only the tenant id
    // (not the whole `seeded` object) escapes into `finally` — TypeScript does not narrow a `let`
    // across the closures `withTenant`'s own callbacks below create, so keeping `seeded` itself
    // `const` and scoped to the try body sidesteps that rather than sprinkling `!` assertions.
    let cleanupTenantId: TenantId | undefined;
    try {
      // secuencia 1 is refused (no entorno). `registros_facturacion` is append-only (immutable
      // triggers block ANY update — this file's own Route B tests rely on the identical fact), so
      // secuencia 2 and 3 — individually fine, correctly stamped `"production"` from the START —
      // are added via `appendPendingAlta` (which always stamps `DEFAULT_ENTORNO`) rather than by
      // mutating rows `seedPendingEnvios` already inserted. Same chain either way:
      // `appendPendingAlta` extends `seeded`'s own `sif_id`.
      const seeded = await seedPendingEnvios(pg.db, { count: 1, entorno: null });
      cleanupTenantId = seeded.tenantId;
      await appendPendingAlta(pg.db, seeded, 2);
      await appendPendingAlta(pg.db, seeded, 3);

      const backend = new VerifactuBackend({
        deploymentEnvironment: "production",
        clock: seeded.clock,
        db: pg.db,
        resolveClient: staticResolver(aeat.client()),
      });
      const result = await backend.drain(new Date("2026-07-21T00:01:00Z"));

      expect(result.recordsSubmitted).toBe(0);
      // Exactly ONE incident for the whole chain — the first refusal, not one per row — mirroring
      // `haltOpenChainClaims`'s own "flag once, don't duplicate" precedent for the identical shape
      // of problem (a chain-wide condition, not a per-row fact).
      expect(result.incidentsRaised).toBe(1);

      const rows = await withTenant(pg.db, seeded.tenantId, (tx) =>
        tx.execute<{ secuencia: number; estado: string; intentos: number }>(sql`
          select r.secuencia, e.estado, e.intentos from envios e
          join registros_facturacion r on r.id = e.registro_id
          where e.tenant_id = ${seeded.tenantId}
          order by r.secuencia
        `),
      );
      // ALL THREE stay pendiente — including secuencia 2 and 3, whose own entorno was fine — and
      // NONE of them were ever claimed (intentos untouched at 0): the chain halts entirely behind
      // the refusal. Unlike a MISMATCHED entorno, no value of WAITRON_ENV releases this chain —
      // secuencia 1 was seeded with entorno: null (`fiscal.environment_unknown`, not
      // `fiscal.environment_mismatch`), and no host configuration ever makes NULL agree. The only
      // way out is re-registering this till as a SIF (a fresh chain, leaving this one permanently
      // unfiled) or superuser DDL — not a configuration change.
      expect(rows.rows.map((r) => r.estado)).toEqual(["pendiente", "pendiente", "pendiente"]);
      expect(rows.rows.map((r) => r.intentos)).toEqual([0, 0, 0]);

      const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
        tx.execute<{ code: string; params: Record<string, unknown> }>(
          sql`select code, params from incidents where tenant_id = ${seeded.tenantId}`,
        ),
      );
      expect(inc.rows).toHaveLength(1);
      expect(inc.rows[0]?.code).toBe("fiscal.environment_unknown");
      // The incident names the ACTUAL refused row (secuencia 1), not one of the blocked
      // successors it dragged down with it.
      expect(inc.rows[0]?.params).toMatchObject({ registroId: seeded.registroIds[0] });

      // Confirms "never submits" concretely, not just via the counters: AEAT's own store holds
      // none of this chain's identities at all.
      const stored = aeat.stored();
      expect(stored.some((s) => s.key.startsWith(`${seeded.nif}|`))).toBe(false);
    } finally {
      // Guarded: `cleanupTenantId` is still `undefined` if `seedPendingEnvios` itself threw before
      // ever assigning it.
      if (cleanupTenantId !== undefined) {
        await pg.db.execute(sql`delete from envios where tenant_id = ${cleanupTenantId}`);
      }
    }
  }, 20_000);

  /**
   * I2/property 3 of the fix-round review: a backlog of refused rows cannot starve sendable work
   * behind it. A cap-filling backlog of refused rows on one chain fills `claimBatch`'s ENTIRE first
   * claim window (`maxRegistrosPorEnvio: 3` is injected here, so 3 refused rows fill a limit-3
   * window — the same shape the production cap of 1000 would need 1000 refused rows to reproduce); a
   * `seedIndependentChain` row on a second, UNRELATED chain is forced to sort strictly LAST
   * (`sifId: "ffffffff-..."`, a near-maximal literal `registerSif`'s own `defaultRandom()` id could
   * never produce) — so only `drainTenant`'s retry loop, excluding the now-blocked chain from a
   * SECOND `claimBatch` call, can ever reach it. Before the fix this healthy row was unreachable,
   * this pass and every later one, since nothing about a refused row changes its own due-ness.
   *
   * The small injected cap is a TEST SEAM (see the ">cap split" describe above and
   * `DrainDeps.maxRegistrosPorEnvio`): seeding 1000 refused rows to fill the production window timed
   * this test out under CI Docker contention, and 3 rows reproduce the identical starvation.
   */
  it("does not starve a sendable row sorting behind a cap-filling backlog of refused rows on another chain", async () => {
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    // Seeding lives INSIDE the try (I3's own fix-round-2 correction — same reasoning as the
    // chain-halt test above): a throw between the two seed calls would otherwise leak
    // permanently-`pendiente` rows into this shared `pg.db` with no `finally` covering them. Only the
    // tenant id crosses into `finally` — same "avoid narrowing through a closure" reasoning as the
    // chain-halt test above.
    let cleanupTenantId: TenantId | undefined;
    try {
      // 3 refused rows (entorno null → `fiscal.environment_unknown`) exactly fill the injected
      // limit-3 claim window, so the healthy row below sorts strictly beyond it.
      const seeded = await seedPendingEnvios(pg.db, { count: 3, entorno: null });
      cleanupTenantId = seeded.tenantId;
      const healthy = await seedIndependentChain(pg.db, seeded, {
        sifId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        secuencia: 1,
        entorno: "production",
      });

      // Direct `drain()` call (not `VerifactuBackend`) so the small cap reaches `DrainDeps`; see the
      // ">cap split" test above for why the wrapper is bypassed only where a cap must be injected.
      const deps: DrainDeps = {
        db: pg.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
        maxRegistrosPorEnvio: 3,
      };
      const result = await drain(deps, new Date("2026-07-21T00:01:00Z"));

      // The healthy row got through despite sorting behind the cap-filling refused backlog.
      expect(result.recordsSubmitted).toBe(1);
      expect(result.recordsAccepted).toBe(1);
      // Exactly one incident for the whole blocked chain (property 3: `incidentsRaised` must not
      // disagree with what was actually written within this ONE pass) — not one per row, and not
      // re-raised across however many `claimBatch` calls the retry needed.
      expect(result.incidentsRaised).toBe(1);

      const healthyRow = await withTenant(pg.db, seeded.tenantId, (tx) =>
        tx.execute<{ estado: string }>(
          sql`select estado from envios where registro_id = ${healthy.registroId}`,
        ),
      );
      expect(healthyRow.rows[0]?.estado).toBe("aceptado");

      const refused = await withTenant(pg.db, seeded.tenantId, (tx) =>
        tx.execute<{ count: string }>(sql`
            select count(*)::text as count from envios
            where tenant_id = ${seeded.tenantId} and estado = 'pendiente'
          `),
      );
      expect(Number(refused.rows[0]!.count)).toBe(3);

      const inc = await withTenant(pg.db, seeded.tenantId, (tx) =>
        tx.execute<{ code: string }>(
          sql`select code from incidents where tenant_id = ${seeded.tenantId}`,
        ),
      );
      expect(inc.rows).toHaveLength(1);
      expect(inc.rows[0]?.code).toBe("fiscal.environment_unknown");
    } finally {
      // Guarded: `cleanupTenantId` is still `undefined` if `seedPendingEnvios` itself threw before
      // `seedIndependentChain` (which reuses that same tenant) ever ran.
      if (cleanupTenantId !== undefined) {
        await pg.db.execute(sql`delete from envios where tenant_id = ${cleanupTenantId}`);
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
