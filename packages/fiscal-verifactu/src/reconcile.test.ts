import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { recordSale, recordVoid } from "@waitron/core";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin } from "@waitron/identity";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { VerifactuBackend } from "./backend.js";
import { reconcile } from "./reconcile.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

// This file's fixtures all stamp `fecha_expedicion_factura` = 2026-07-20 (drain-fixtures' own
// PAST_FECHA), so every seeded record falls in this one period.
const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const DRAIN_AT = new Date("2026-07-21T00:01:00Z"); // past the seeded `proximo_intento_en`
const PERIOD = { year: "2026", month: "07" };

// IDENTITY_MIGRATIONS between core and fiscal (manifest order core → identity → fiscal): recordVoid
// now calls `authorize`, which reads identity's persons/sessions.
const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, FISCAL_MIGRATIONS] });

/**
 * Real per-test isolation, deliberately NOT drain.test.ts's shared-and-accumulating convention:
 * `envios`/`incidents` carry no append-only trigger (unlike `registros_facturacion`, which blocks
 * TRUNCATE — src/testing/seed.ts's own note), so truncating them before each test leaves the
 * drainer's own global `tenantsWithWork` sweep with nothing but THIS test's freshly-seeded rows to
 * find, and every incident-count assertion sees only this test's own incidents. The orphaned
 * `registros_facturacion` rows a prior test leaves behind are harmless: `reconcile` reaches a
 * record only through its `envios` join, so a registro with no `envios` row is never in scope.
 */
beforeEach(async () => {
  // `acks` joins this list now that reconcile corrects state and writes an ack in the same T2 tx;
  // truncating it keeps each test's post-correction acks from leaking into the next.
  await pg.db.execute(sql`truncate table acks, incidents, envios cascade`);
});

/** Drives AEAT to hold every seeded record as `Correcta` (keyed by `RefExterna` = registro id) and
 * marks our own `envios` `aceptado` — the drainer's happy path, the starting point every
 * divergence below is then produced from with the fake's Task-1 consulta hooks. */
async function storeAllAtAeat(backend: VerifactuBackend): Promise<void> {
  await backend.drain(DRAIN_AT);
}

async function incidentsFor(
  tenantId: string,
): Promise<{ code: string; severity: string; params: Record<string, unknown> }[]> {
  const { rows } = await withTenant(pg.db, tenantId, (tx) =>
    tx.execute<{ code: string; severity: string; params: Record<string, unknown> }>(
      sql`select code, severity, params from incidents where tenant_id = ${tenantId}`,
    ),
  );
  return rows;
}

/** The committed `envios.estado` per registro — used to prove reconcile now CORRECTS state toward
 * the authority (plan 3b Task 5), on top of the classification the cases above already assert. */
async function estadosFor(tenantId: string): Promise<Map<string, string>> {
  const { rows } = await withTenant(pg.db, tenantId, (tx) =>
    tx.execute<{ registro_id: string; estado: string }>(
      sql`select registro_id, estado from envios where tenant_id = ${tenantId}`,
    ),
  );
  return new Map(rows.map((r) => [r.registro_id, r.estado]));
}

/** The committed `acks.state` per registro — used to prove the ack↔estado invariant still holds
 * after a drift correction (the acks row must agree with whatever `envios.estado` converged to). */
async function ackStatesFor(tenantId: string): Promise<Map<string, string>> {
  const { rows } = await withTenant(pg.db, tenantId, (tx) =>
    tx.execute<{ registro_id: string; state: string }>(
      sql`select registro_id, state from acks where tenant_id = ${tenantId}`,
    ),
  );
  return new Map(rows.map((r) => [r.registro_id, r.state]));
}

/** The committed `envios.reconciled_resubmit_at` marker for one registro — the `noTrace`
 * remediation lifecycle's own state: null until a first `noTrace` detection stamps it, set while
 * the remediation is outstanding, and cleared again once AEAT has a trace of the record. */
async function reconciledResubmitAtFor(
  tenantId: string,
  registroId: string,
): Promise<string | null> {
  const { rows } = await withTenant(pg.db, tenantId, (tx) =>
    tx.execute<{ reconciled_resubmit_at: string | null }>(
      sql`select reconciled_resubmit_at from envios where tenant_id = ${tenantId} and registro_id = ${registroId}`,
    ),
  );
  return rows[0]?.reconciled_resubmit_at ?? null;
}

/** The alta registro's own id and its AEAT consulta key (`nif|numSerieFactura|DD-MM-YYYY`, the
 * same triple `@waitron/verifactu`'s fake `keyOf` builds — `to_char(..., 'DD-MM-YYYY')` renders
 * the date piece in AEAT's own form directly, so this never re-derives that formatting by hand).
 * Looked up post-hoc by `sale_id` rather than threaded through the caller: unlike
 * `seedPendingEnvios`'s fixture, a `recordSale`-created alta's identity is assigned by the write
 * path itself (series/invoice-number allocation), not chosen by the test. */
async function altaIdentityFor(
  tenantId: string,
  saleId: string,
): Promise<{ id: string; facturaKey: string }> {
  const { rows } = await withTenant(pg.db, tenantId, (tx) =>
    tx.execute<{ id: string; id_emisor_factura: string; num_serie_factura: string; fecha: string }>(
      sql`
        select id, id_emisor_factura, num_serie_factura,
          to_char(fecha_expedicion_factura, 'DD-MM-YYYY') as fecha
        from registros_facturacion
        where sale_id = ${saleId} and tipo_registro = 'alta'
      `,
    ),
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`altaIdentityFor: no alta registro for sale ${saleId}`);
  return {
    id: row.id,
    facturaKey: `${row.id_emisor_factura}|${row.num_serie_factura}|${row.fecha}`,
  };
}

/** Whether a sibling anulación registro (same `sale_id`) exists for the given alta — the local
 * mirror of `reconcile.ts`'s own `hasSiblingAnulacion`, used here only to confirm the fixture set
 * up the state the reconcile test actually means to exercise. */
async function hasAnulacion(tenantId: string, altaRegistroId: string): Promise<boolean> {
  const { rows } = await withTenant(pg.db, tenantId, (tx) =>
    tx.execute<{ sale_id: string }>(sql`
      select r2.sale_id from registros_facturacion r1
      join registros_facturacion r2
        on r2.sale_id = r1.sale_id and r2.tenant_id = r1.tenant_id and r2.tipo_registro = 'anulacion'
      where r1.id = ${altaRegistroId} and r1.tenant_id = ${tenantId}
    `),
  );
  return rows.length > 0;
}

describe("reconcile — the three audit cases", () => {
  it("clean audit: our records all match AEAT — empty lists", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend);

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(3);
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor(seeded.tenantId)).toHaveLength(0);
  });

  it("lostAck: we believe pendiente, AEAT holds it (Correcta) → lostAck", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend); // AEAT now holds all three as Correcta

    // Our acknowledgement was lost: our side reads pendiente though AEAT already holds them.
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(sql`update envios set estado = 'pendiente' where tenant_id = ${seeded.tenantId}`),
    );

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(3);
    expect([...result.lostAck.map((m) => m.recordId)].sort()).toEqual(
      [...seeded.registroIds].sort(),
    );
    expect(
      result.lostAck.every((m) => m.localState === "pendiente" && m.reportedState === "Correcta"),
    ).toBe(true);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    // A lost ack is never an incident (classification unchanged from Task 4).
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor(seeded.tenantId)).toHaveLength(0);

    // Task 5: reconcile ALSO corrects the local estado toward the authority (Correcta → aceptado).
    // The audit above still reports the mismatch; this proves the correction is applied too.
    const estados = await estadosFor(seeded.tenantId);
    expect([...estados.values()]).toEqual(["aceptado", "aceptado", "aceptado"]);
  });

  it("noTrace first detection: resets to pendiente, deletes the ack, sets the marker, no incident", async () => {
    // Task 4 (reconcile resolution semantics): a FIRST noTrace no longer raises an incident — it is
    // usually just consulta lag, so reconcile self-heals it silently by re-submitting (reset to
    // `pendiente`) and dropping the stale `accepted` ack (the acks invariant — a `pendiente` row
    // carries no ack). Only a SECOND, still-missing detection escalates (see the test below).
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend); // aceptado at us, stored at AEAT
    aeat.forget(seeded.facturaKeys[0]!); // AEAT loses all trace of it

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(1);
    // The audit finding is still reported, from the PRE-remediation snapshot.
    expect(result.noTrace).toHaveLength(1);
    expect(result.noTrace[0]).toEqual({
      recordId: seeded.registroIds[0],
      localState: "aceptado",
      reportedState: null,
    });
    expect(result.lostAck).toEqual([]);
    expect(result.drift).toEqual([]);
    // No incident on first detection.
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor(seeded.tenantId)).toHaveLength(0);

    // Remediated: reset to pendiente so the drainer re-submits it, and the marker is stamped.
    const estados = await estadosFor(seeded.tenantId);
    expect(estados.get(seeded.registroIds[0]!)).toBe("pendiente");
    const marker = await reconciledResubmitAtFor(seeded.tenantId, seeded.registroIds[0]!);
    expect(marker).not.toBeNull();

    // The acks invariant: a `pendiente` row carries NO ack.
    const acks = await ackStatesFor(seeded.tenantId);
    expect(acks.has(seeded.registroIds[0]!)).toBe(false);
  });

  it("noTrace already remediated (marker set) and still missing: raises one idempotent error incident, no re-reset", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend); // aceptado at us, stored at AEAT
    aeat.forget(seeded.facturaKeys[0]!); // AEAT loses all trace of it

    // Simulate an already-remediated record: the marker is set (a prior sweep's first detection),
    // but AEAT STILL has no trace of it.
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(
        sql`update envios set reconciled_resubmit_at = ${SERVER_NOW.toISOString()} where registro_id = ${seeded.registroIds[0]}`,
      ),
    );

    const first = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(first.checked).toBe(1);
    expect(first.noTrace).toHaveLength(1);
    expect(first.incidentsRaised).toBe(1);

    const inc = await incidentsFor(seeded.tenantId);
    expect(inc).toHaveLength(1);
    expect(inc[0]?.code).toBe("fiscal.reconcile_no_trace");
    expect(inc[0]?.severity).toBe("error");
    expect(inc[0]?.params).toMatchObject({
      registroId: seeded.registroIds[0],
      idEmisorFactura: seeded.nif,
      numSerieFactura: "S1/1",
      fechaExpedicionFactura: "20-07-2026",
    });

    // NOT reset again — estado stays exactly as it was (still `aceptado`, since this record was
    // never actually remediated, only marked as if it had been).
    const estados = await estadosFor(seeded.tenantId);
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado");

    // Sweep 2 re-detects the SAME persistent noTrace — still classified, still escalated, but must
    // NOT insert a second incident row (recordIncidentOnce dedup).
    const second = await backend.reconcile(seeded.tenantId, PERIOD);
    expect(second.noTrace).toHaveLength(1);
    expect(second.incidentsRaised).toBe(0); // deduped — no NEW incident counted this sweep

    const incidents = await incidentsFor(seeded.tenantId);
    expect(incidents).toHaveLength(1);
  });

  it("ack↔estado invariant holds across a noTrace reset: no accepted ack for a now-pendiente row", async () => {
    // The load-bearing property the marker-set/error-incident test above does not itself check:
    // after a first-detection remediation, the record must carry NO acks row at all — an `accepted`
    // ack sitting on a `pendiente` envío would disagree with the estado it is supposed to reflect
    // (the acks invariant `acks.test.ts`'s own INVARIANT test guards from the other direction).
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend); // aceptado at us, with an `accepted` ack, stored at AEAT
    aeat.forget(seeded.facturaKeys[0]!); // AEAT loses all trace of it

    expect((await ackStatesFor(seeded.tenantId)).size).toBe(1); // the pre-reset accepted ack

    await backend.reconcile(seeded.tenantId, PERIOD); // first detection — remediates silently

    const estados = await estadosFor(seeded.tenantId);
    expect(estados.get(seeded.registroIds[0]!)).toBe("pendiente");

    const acks = await ackStatesFor(seeded.tenantId);
    expect(acks.has(seeded.registroIds[0]!)).toBe(false); // no ack at all for the pendiente row
  });

  it("a record AEAT has a trace of clears a set marker", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend); // aceptado at us, AEAT holds it Correcta

    // Simulate a marker left over from an earlier noTrace remediation that has since self-healed.
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(
        sql`update envios set reconciled_resubmit_at = ${SERVER_NOW.toISOString()} where registro_id = ${seeded.registroIds[0]}`,
      ),
    );

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor(seeded.tenantId)).toHaveLength(0);

    const marker = await reconciledResubmitAtFor(seeded.tenantId, seeded.registroIds[0]!);
    expect(marker).toBeNull();
  });

  it("drift: we believe aceptado, AEAT holds AceptadaConErrores → drift + warning incident", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend);
    aeat.setConsultaState(seeded.facturaKeys[0]!, "AceptadaConErrores");

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(1);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toEqual({
      recordId: seeded.registroIds[0],
      localState: "aceptado",
      reportedState: "AceptadaConErrores",
    });
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.incidentsRaised).toBe(1);

    const inc = await incidentsFor(seeded.tenantId);
    expect(inc).toHaveLength(1);
    expect(inc[0]?.code).toBe("fiscal.reconcile_drift_errores");
    expect(inc[0]?.severity).toBe("warning");

    // Task 5: AceptadaConErrores drift is corrected toward the authority (→ aceptado_con_errores),
    // on top of the warning incident above.
    const estados = await estadosFor(seeded.tenantId);
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado_con_errores");
  });

  it("drift: we believe aceptado, AEAT holds Anulada → drift + error incident", async () => {
    // Task 6 (reconcile resolution semantics): this seeds an alta with NO sibling anulación, so
    // AEAT reporting Anulada here is the ANOMALOUS path (see `hasSiblingAnulacion` in reconcile.ts)
    // — AEAT never annuls on its own, but the classification must still hold when it does. This
    // test stays green unchanged; the genuine-void "clean" case and the anomalous path's
    // cross-sweep idempotency are covered by the two tests below.
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend);
    aeat.setConsultaState(seeded.facturaKeys[0]!, "Anulada");

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(1);
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toEqual({
      recordId: seeded.registroIds[0],
      localState: "aceptado",
      reportedState: "Anulada",
    });
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.incidentsRaised).toBe(1);

    const inc = await incidentsFor(seeded.tenantId);
    expect(inc).toHaveLength(1);
    expect(inc[0]?.code).toBe("fiscal.reconcile_drift_anulada");
    expect(inc[0]?.severity).toBe("error");

    // Task 5: Anulada has no clean local estado, so reconcile does NOT correct — it stays aceptado
    // (incident-only, exactly as Task 4 left it). The `correct` no-op branch must bite here.
    const estados = await estadosFor(seeded.tenantId);
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado");
  });

  it("drift-Anulada with a local anulacion is clean — no drift entry, no incident", async () => {
    // The genuine void path (Task 6): AEAT marks the alta Anulada once it accepts the anulación we
    // submitted for the SAME sale, while the alta's own envío stays `aceptado` (its own state never
    // changes — only the anulación's identity travels to AEAT via IDFacturaAnulada). Voided via the
    // REAL `recordVoid` (packages/core), exactly as `void-path.e2e.test.ts` drives it — never a raw
    // insert, since `registros_facturacion` is append-only and carries required chain columns.
    //
    // The alta itself must come from the REAL write path (`recordSale`), not `seedPendingEnvios`'s
    // fixture: that fixture hand-writes a deterministic-but-fake `huella` (its own doc comment)
    // purely to exercise the drainer, which is never chain-valid — `recordVoid`'s own
    // `checkIntegrity` call recomputes the chain for real and would raise a genuine
    // `chain.verification_failed` incident against it (confirmed live while writing this test),
    // an artifact of the fixture that has nothing to do with reconcile's own classification. This
    // mirrors `drain.test.ts`'s "drain — happy path, an anulación row" describe block, the one
    // other place in this package that pairs `recordSale`+`recordVoid` instead. `steadyClock`'s
    // fixed instant (write-path-fixtures.ts) is 2026-03-01, not this file's usual July, so this
    // test reconciles a LOCAL March period, not the shared `PERIOD` constant.
    const period = { year: "2026", month: "03" };
    const { tenantId, tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db);
    // recordVoid now requires `sale.void`: seed a manager and open its session to authorize the void.
    const { rows: mgr } = await pg.db.execute<{ id: string }>(
      sql`insert into persons (tenant_id, display_name, pin_hash, role)
          values (${tenantId}, 'P', ${hashPin("1234")}, 'manager') returning id`,
    );
    const voidSession = await withTenant(pg.db, tenantId, (tx) =>
      loginWithPin(tx, { tenantId, tillId, personId: mgr[0]!.id, pin: "1234" }),
    );
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
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
    // `recordSale`'s own envío row takes `proximo_intento_en`'s column DEFAULT (real wall-clock
    // `now()` at insert), NOT this file's simulated `DRAIN_AT` — `seedPendingEnvios`'s fixture stamps
    // that column itself, which is the only reason `DRAIN_AT` works for every OTHER test in this file.
    // Pin it to `DRAIN_AT` so the drain below is deterministic rather than wall-clock-relative (a
    // Copilot review point — clock skew / slow CI could otherwise flake a `Date.now()`-based due time).
    await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        sql`update envios set proximo_intento_en = ${DRAIN_AT.toISOString()} where tenant_id = ${tenantId}`,
      );
    });
    await backend.drain(DRAIN_AT); // alta: local aceptado, AEAT Correcta

    const alta = await altaIdentityFor(tenantId, sale.saleId);
    await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await recordVoid(tx, backend, sale.saleId, "staff error", { sessionId: voidSession.id });
    });
    // The void appends a sibling anulación registro (same sale_id) with its own pendiente envío —
    // present in this period too (it carries the annulled invoice's own expedition date), but never
    // submitted to AEAT here, so it stays an ordinary in-flight row, not a mismatch.
    expect(await hasAnulacion(tenantId, alta.id)).toBe(true);

    // AEAT now reports the alta itself Anulada — the expected authority state post-void.
    aeat.setConsultaState(alta.facturaKey, "Anulada");

    const result = await backend.reconcile(tenantId, period);

    expect(result.checked).toBe(2); // the alta's envío + the anulación's own pendiente envío
    expect(result.drift).toEqual([]); // agreement — the alta is NOT flagged
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]); // the anulación's own pendiente row is in-flight, not lost
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor(tenantId)).toHaveLength(0);

    // No correction either — the alta's envío stays exactly as the drainer left it.
    const estados = await estadosFor(tenantId);
    expect(estados.get(alta.id)).toBe("aceptado");
  });

  it("drift-Anulada with NO local anulacion is idempotent across sweeps — one incident, not two", async () => {
    // The anomalous path's OTHER property (on top of the "stays green" test above): `raiseOnce`
    // must dedup a persistently-reported Anulada, since Anulada is never corrected (`CORRECTION`
    // has no entry for it) and so re-detects as drift on every sweep for as long as it stays open.
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend);
    aeat.setConsultaState(seeded.facturaKeys[0]!, "Anulada"); // no local anulación at all

    const first = await backend.reconcile(seeded.tenantId, PERIOD);
    expect(first.drift).toHaveLength(1);
    expect(first.incidentsRaised).toBe(1);
    expect(await incidentsFor(seeded.tenantId)).toHaveLength(1);

    // Sweep 2 re-detects the SAME persistent Anulada — still classified as drift (there is no
    // converged state to agree with), but must NOT insert a second incident row.
    const second = await backend.reconcile(seeded.tenantId, PERIOD);
    expect(second.drift).toHaveLength(1);
    expect(second.incidentsRaised).toBe(0); // deduped — no NEW incident counted this sweep

    const incidents = await incidentsFor(seeded.tenantId);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.code).toBe("fiscal.reconcile_drift_anulada");
  });

  it("drift-AceptadaConErrores CONVERGES: a second sweep does not re-raise the incident", async () => {
    // Reviewer finding (plan 3b Task 5): the drift branch fired on ACEPTADO.has(row.estado)
    // (which includes aceptado_con_errores) with no check that local and AEAT actually disagree.
    // Sweep 1 corrects aceptado → aceptado_con_errores; sweep 2 then saw local
    // aceptado_con_errores vs AEAT AceptadaConErrores and mis-classified that AGREEMENT as drift
    // all over again — a second incident, a reset `delivered_at`, and no convergence. This test
    // proves sweep 2 now finds a clean match: exactly ONE incident total, not two.
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend); // local aceptado, AEAT Correcta
    aeat.setConsultaState(seeded.facturaKeys[0]!, "AceptadaConErrores"); // AEAT now disagrees

    // Sweep 1: genuine aceptado → AceptadaConErrores divergence — classifies as drift, raises the
    // warning incident, and corrects local estado toward the authority.
    const first = await backend.reconcile(seeded.tenantId, PERIOD);
    expect(first.drift).toHaveLength(1);
    expect(first.drift[0]).toEqual({
      recordId: seeded.registroIds[0],
      localState: "aceptado",
      reportedState: "AceptadaConErrores",
    });
    expect(first.incidentsRaised).toBe(1);
    expect(await incidentsFor(seeded.tenantId)).toHaveLength(1);
    await expect(estadosFor(seeded.tenantId)).resolves.toEqual(
      new Map([[seeded.registroIds[0]!, "aceptado_con_errores"]]),
    );

    // Sweep 2: local is now aceptado_con_errores, AEAT still reports AceptadaConErrores — the SAME
    // state, which is agreement, not a fresh divergence. The fix must classify this as a clean
    // match: no drift entry, no new incident, no re-correction.
    const second = await backend.reconcile(seeded.tenantId, PERIOD);
    expect(second.drift).toEqual([]);
    expect(second.incidentsRaised).toBe(0);

    // (a) exactly ONE incident for the tenant total — not a fresh one every sweep.
    const incidents = await incidentsFor(seeded.tenantId);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.code).toBe("fiscal.reconcile_drift_errores");

    // (b) estado converged to aceptado_con_errores and stays there.
    const estados = await estadosFor(seeded.tenantId);
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado_con_errores");

    // (c) the acks row still satisfies the ack↔estado invariant for the converged state.
    const ackStates = await ackStatesFor(seeded.tenantId);
    expect(ackStates.get(seeded.registroIds[0]!)).toBe("accepted_with_errors");
  });

  it("clean match: a drainer-set aceptado_con_errores agrees with AEAT's AceptadaConErrores — not drift", async () => {
    // The other half of the same reviewer finding: a record the DRAINER itself set to
    // aceptado_con_errores (the accept-with-errors path, drain.test.ts's own 2004/futureDated
    // case) must be recognised as a clean match against AEAT's AceptadaConErrores — never
    // re-flagged as drift just because aceptado_con_errores is a member of the accepted family.
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, futureDated: true }); // 2004 → AceptadoConErrores
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(DRAIN_AT); // sets local aceptado_con_errores; AEAT's own store already
    // holds AceptadaConErrores for this key too (createFakeAeat's future-dated branch) — no
    // `setConsultaState` needed, this is the drainer's own genuine happy-with-errors path.

    // Isolate reconcile's own incidents from the drainer's `fiscal.aceptado_con_errores` warning.
    await pg.db.execute(sql`truncate table incidents`);

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(1);
    expect(result.drift).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor(seeded.tenantId)).toHaveLength(0);

    // No correction needed — it was already a clean match.
    const estados = await estadosFor(seeded.tenantId);
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado_con_errores");
  });
});

describe("reconcile — paging", () => {
  it("pages across ≥2 pages (presentation-date order) without missing records", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW, consultaPageSize: 2 });
    const seeded = await seedPendingEnvios(pg.db, { count: 5 });

    // Count the reconcile sweep's own consulta round trips. Reset AFTER `drain` so only the sweep's
    // pages are counted (drain's happy path never consults, but the reset makes that irrelevant).
    let consultarCalls = 0;
    const base = aeat.client();
    const counting: VerifactuClient = {
      submit: (cabecera, registros) => base.submit(cabecera, registros),
      consultar: (cabecera, filtro) => {
        consultarCalls += 1;
        return base.consultar(cabecera, filtro);
      },
    };
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(counting),
    });
    await backend.drain(DRAIN_AT); // all 5 stored at AEAT as Correcta, ours aceptado
    consultarCalls = 0;

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(5);
    // The teeth: if paging stopped after page 1, records 3-5 would be aceptado locally but absent
    // from the authority map, surfacing as noTrace. An empty noTrace with checked=5 proves every
    // page was fetched and keyed.
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(consultarCalls).toBe(3); // ceil(5 / pageSize 2) genuine pages
  });
});

describe("reconcile — in-flight tolerance and non-cases", () => {
  it("does NOT flag a pendiente record as noTrace (in-flight tolerance)", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    // Deliberately DO NOT drain: our record is pendiente and AEAT holds nothing for this NIF —
    // exactly the mid-submission / later-page case §4.3 forbids calling noTrace.
    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(1);
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor(seeded.tenantId)).toHaveLength(0);
  });

  it("skips a rechazado record — neither pending nor accepted, so never a mismatch", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend);
    // A record we already know AEAT refused: not stored there, and our side reads rechazado.
    aeat.forget(seeded.facturaKeys[0]!);
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(sql`update envios set estado = 'rechazado' where tenant_id = ${seeded.tenantId}`),
    );

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(1);
    // Absent from AEAT, yet NOT noTrace: noTrace is asserted only for a record we believe accepted.
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor(seeded.tenantId)).toHaveLength(0);
  });

  it("ignores an AEAT record with no RefExterna (one we cannot attribute)", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend); // our one record: aceptado + Correcta

    // A record AEAT holds for the SAME obligado that WE did not submit — no RefExterna keys it to
    // any of our registros (the multi-OT case: another software system filing for this NIF).
    await aeat
      .client()
      .submit({ ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } }, [
        { RegistroAlta: foreignAlta(seeded.nif, seeded.legalName) },
      ]);

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    // The foreign record is skipped, never keyed; our own record still matches cleanly.
    expect(result.checked).toBe(1); // only OUR envios row is in scope
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
  });

  it("no records for the period → checked 0, and never contacts AEAT", async () => {
    const { tenantId } = await seedTenantWithSif(pg.db); // a tenant with a till/SIF but no envios
    const throwing: VerifactuClient = {
      submit: () => Promise.reject(new Error("reconcile must not submit")),
      consultar: () => Promise.reject(new Error("reconcile must not consult an empty period")),
    };
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: pg.db,
      resolveClient: staticResolver(throwing),
    });

    const result = await backend.reconcile(tenantId, PERIOD);

    expect(result).toEqual({
      year: "2026",
      month: "07",
      checked: 0,
      lostAck: [],
      noTrace: [],
      drift: [],
      incidentsRaised: 0,
    });
  });
});

describe("reconcile — period normalization", () => {
  it("Copilot finding A: an unpadded month audits the SAME records as the zero-padded form", async () => {
    // `to_char(fecha_expedicion_factura, 'MM')` always yields a zero-padded 2-digit month, so an
    // unpadded `period.month` like "7" must be normalized before it reaches the SQL comparison —
    // otherwise the query matches nothing and reconcile silently reports a false-clean `checked: 0`
    // instead of auditing July.
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await storeAllAtAeat(backend); // all three: local aceptado, AEAT Correcta — a clean match

    const result = await backend.reconcile(seeded.tenantId, { year: "2026", month: "7" });

    // Must audit the same 3 records the zero-padded "07" form audits (see the "clean audit" case
    // above) — not the false-clean `checked: 0` an un-normalized query silently returns.
    expect(result.checked).toBe(3);
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    // The result echoes back what was ACTUALLY audited, not the caller's raw (unpadded) input.
    expect(result.year).toBe("2026");
    expect(result.month).toBe("07");
  });
});

describe("reconcile — malformed consulta paging", () => {
  it("Copilot finding B: throws when AEAT reports more pages but gives no continuation key", async () => {
    // `fetchAuthority` pages while `IndicadorPaginacion === "S"`, echoing `ClavePaginacion` back. If
    // AEAT ever reports "S" with NO `ClavePaginacion`, the old code set the continuation key to
    // `undefined` and silently STOPPED — later, unpaged records then get mis-flagged as `noTrace`
    // (false error incidents) or missed entirely. Failing loud is correct for a compliance audit.
    const seeded = await seedPendingEnvios(pg.db, { count: 1 }); // ≥1 local row so T1 does not short-circuit
    const malformed: VerifactuClient = {
      submit: () => Promise.reject(new Error("this test must not submit")),
      consultar: () =>
        Promise.resolve({
          ResultadoConsulta: "ConDatos",
          IndicadorPaginacion: "S",
          ClavePaginacion: undefined,
          registros: [],
        }),
    };

    await expect(
      reconcile(
        { db: pg.db, resolveClient: staticResolver(malformed), clock: seeded.clock },
        seeded.tenantId,
        PERIOD,
      ),
    ).rejects.toThrow(/ClavePaginacion/);
  });
});

describe("reconcile — lazy client resolution", () => {
  it("a zero-row period never resolves a client, even one that would throw", async () => {
    // The regression this test guards: `reconcile` used to resolve the client BEFORE checking
    // whether the period held any records at all, so a tenant with nothing to reconcile — a clean
    // `checked: 0` no-op that contacts AEAT for nothing — was turned into a hard failure whenever
    // that tenant's credential happened to be missing or unusable. `resolveClient` below rejects
    // with a distinctive, unmistakable message (never a client that merely COULD have been asked and
    // happened to succeed) so this test fails loudly if the fix regresses, and asserts the resolver
    // was never even called — a test that only checked the returned result would still pass if the
    // resolver were called and happened to succeed.
    const { tenantId } = await seedTenantWithSif(pg.db); // a tenant with a till/SIF but no envios
    let calls = 0;
    const resolveClient = (): Promise<VerifactuClient> => {
      calls += 1;
      // A plain Error with a distinctive message, not an AppError: `credentials.missing` is
      // `@waitron/credentials`'s own code, and this package does not depend on that package — the
      // point here is only that resolution is unmistakably never reached, not to construct a
      // cross-package error type this test has no business typing.
      return Promise.reject(new Error("resolveClient must not be called for a zero-row period"));
    };

    const result = await reconcile(
      { db: pg.db, resolveClient, clock: steadyClock },
      tenantId,
      PERIOD,
    );

    expect(result).toEqual({
      year: "2026",
      month: "07",
      checked: 0,
      lostAck: [],
      noTrace: [],
      drift: [],
      incidentsRaised: 0,
    });
    expect(calls).toBe(0);
  });
});

/** A well-formed alta for the querying obligado carrying NO RefExterna and a distinct identity, so
 * the fake stores and later reports it in a consulta but `reconcile` cannot attribute it to any of
 * our registros. Mirrors drain.test.ts's own hand-built `collidingRecord` shape. */
function foreignAlta(nif: string, legalName: string): RegistroAlta {
  return {
    IDVersion: "1.0",
    IDFactura: {
      IDEmisorFactura: nif,
      NumSerieFactura: "OTRO/1",
      FechaExpedicionFactura: "20-07-2026",
    },
    NombreRazonEmisor: legalName,
    TipoFactura: "F2",
    DescripcionOperacion: "Registro de otro sistema informático",
    Desglose: [],
    CuotaTotal: "0.00",
    ImporteTotal: "0.00",
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: {
      NombreRazon: legalName,
      NIF: nif,
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
    Huella: "E".repeat(64),
  };
}
