import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { recordSale, recordVoid } from "@waitron/core";
import { newId, nowIso, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import { VerifactuBackend } from "./backend.js";
import { DEFAULT_SKIP_RETRY_MS, drain, type DrainDeps } from "./drain.js";
import { reconcile, type ReconcileDeps } from "./reconcile.js";
import { toAeatDate } from "./registro-row.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

// The drain fixtures stamp `fecha_expedicion_factura` = 2026-07-20, inside this one period.
const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const DRAIN_AT = new Date("2026-07-21T00:01:00Z"); // past the seeded `proximo_intento_en`
const PERIOD = { year: "2026", month: "07" };

const pg = useVenueDb({ migrations: TEST_MIGRATIONS });

// Every case relies on `useVenueDb` emptying the data tables between tests: the drainer's due-work
// sweep and every incident count must see only this test's own rows.

const drainDeps = (resolveClient: DrainDeps["resolveClient"]): DrainDeps => ({
  db: pg.db,
  resolveClient,
  skipRetryMs: DEFAULT_SKIP_RETRY_MS,
  environment: "production",
});
const reconcileDeps = (
  resolveClient: ReconcileDeps["resolveClient"],
  clock: ReconcileDeps["clock"],
): ReconcileDeps => ({ db: pg.db, resolveClient, clock });

/** Drives AEAT to hold every seeded record as `Correcta` (keyed by `RefExterna` = registro id) and
 * marks our own `envios` `aceptado` — the drainer's happy path, the starting point every
 * divergence below is then produced from with the fake's Task-1 consulta hooks. */
async function storeAllAtAeat(resolveClient: DrainDeps["resolveClient"]): Promise<void> {
  await drain(drainDeps(resolveClient), DRAIN_AT);
}

async function incidentsFor(): Promise<
  { code: string; severity: string; params: Record<string, unknown> }[]
> {
  const { rows } = await withTransaction(pg.db, (tx) =>
    tx.execute<{ code: string; severity: string; params: string }>(
      sql`select code, severity, params from incidents`,
    ),
  );
  // A raw read hands back a `json` column's stored text.
  return rows.map((row) => ({ ...row, params: JSON.parse(row.params) as Record<string, unknown> }));
}

async function estadosFor(): Promise<Map<string, string>> {
  const { rows } = await withTransaction(pg.db, (tx) =>
    tx.execute<{ registro_id: string; estado: string }>(
      sql`select registro_id, estado from envios`,
    ),
  );
  return new Map(rows.map((r) => [r.registro_id, r.estado]));
}

async function ackStatesFor(): Promise<Map<string, string>> {
  const { rows } = await withTransaction(pg.db, (tx) =>
    tx.execute<{ registro_id: string; state: string }>(sql`select registro_id, state from acks`),
  );
  return new Map(rows.map((r) => [r.registro_id, r.state]));
}

async function reconciledResubmitAtFor(registroId: string): Promise<string | null> {
  const { rows } = await withTransaction(pg.db, (tx) =>
    tx.execute<{ reconciled_resubmit_at: string | null }>(
      sql`select reconciled_resubmit_at from envios where registro_id = ${registroId}`,
    ),
  );
  return rows[0]?.reconciled_resubmit_at ?? null;
}

/** The alta registro's id and its fake-AEAT consulta key (`nif|numSerieFactura|DD-MM-YYYY`, the
 * triple `@waitron/verifactu`'s fake `keyOf` builds). Looked up by `sale_id` because a
 * `recordSale`-created alta's identity is assigned by the write path, not chosen by the test. */
async function altaIdentityFor(saleId: string): Promise<{ id: string; facturaKey: string }> {
  const { rows } = await withTransaction(pg.db, (tx) =>
    tx.execute<{ id: string; id_emisor_factura: string; num_serie_factura: string; fecha: string }>(
      sql`
        select id, id_emisor_factura, num_serie_factura,
          fecha_expedicion_factura as fecha
        from registros_facturacion
        where sale_id = ${saleId} and tipo_registro = 'alta'
      `,
    ),
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`altaIdentityFor: no alta registro for sale ${saleId}`);
  return {
    id: row.id,
    facturaKey: `${row.id_emisor_factura}|${row.num_serie_factura}|${toAeatDate(row.fecha)}`,
  };
}

/** Confirms the fixture set up the sibling anulación the void case means to exercise. */
async function hasAnulacion(altaRegistroId: string): Promise<boolean> {
  const { rows } = await withTransaction(pg.db, (tx) =>
    tx.execute<{ sale_id: string }>(sql`
      select r2.sale_id from registros_facturacion r1
      join registros_facturacion r2
        on r2.sale_id = r1.sale_id and r2.tipo_registro = 'anulacion'
      where r1.id = ${altaRegistroId}
    `),
  );
  return rows.length > 0;
}

describe("reconcile — the three audit cases", () => {
  it("clean audit: our records all match AEAT — empty lists", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient);

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

    expect(result.checked).toBe(3);
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor()).toHaveLength(0);
  });

  it("lostAck: we believe pendiente, AEAT holds it (Correcta) → lostAck", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient); // AEAT now holds all three as Correcta

    // Our acknowledgement was lost.
    await withTransaction(pg.db, (tx) => tx.execute(sql`update envios set estado = 'pendiente'`));

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

    expect(result.checked).toBe(3);
    expect([...result.lostAck.map((m) => m.recordId)].sort()).toEqual(
      [...seeded.registroIds].sort(),
    );
    expect(
      result.lostAck.every((m) => m.localState === "pendiente" && m.reportedState === "Correcta"),
    ).toBe(true);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    // A lost ack is never an incident.
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor()).toHaveLength(0);

    // Reported above AND corrected toward the authority.
    const estados = await estadosFor();
    expect([...estados.values()]).toEqual(["aceptado", "aceptado", "aceptado"]);
  });

  it("noTrace first detection: resets to pendiente, deletes the ack, sets the marker, no incident", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient); // aceptado at us, stored at AEAT
    aeat.forget(seeded.facturaKeys[0]!); // AEAT loses all trace of it

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

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
    expect(await incidentsFor()).toHaveLength(0);

    // Remediated: reset to pendiente so the drainer re-submits it, and the marker is stamped.
    const estados = await estadosFor();
    expect(estados.get(seeded.registroIds[0]!)).toBe("pendiente");
    const marker = await reconciledResubmitAtFor(seeded.registroIds[0]!);
    expect(marker).not.toBeNull();

    // The acks invariant: a `pendiente` row carries NO ack.
    const acks = await ackStatesFor();
    expect(acks.has(seeded.registroIds[0]!)).toBe(false);
  });

  it("noTrace already remediated (marker set) and still missing: raises one idempotent error incident, no re-reset", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient); // aceptado at us, stored at AEAT
    aeat.forget(seeded.facturaKeys[0]!); // AEAT loses all trace of it

    // Simulate an already-remediated record: the marker is set (a prior sweep's first detection),
    // but AEAT STILL has no trace of it.
    await withTransaction(pg.db, (tx) =>
      tx.execute(
        sql`update envios set reconciled_resubmit_at = ${SERVER_NOW.toISOString()} where registro_id = ${seeded.registroIds[0]}`,
      ),
    );

    const first = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

    expect(first.checked).toBe(1);
    expect(first.noTrace).toHaveLength(1);
    expect(first.incidentsRaised).toBe(1);

    const inc = await incidentsFor();
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
    const estados = await estadosFor();
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado");

    // Sweep 2 re-detects the SAME persistent noTrace — still classified, still escalated, but must
    // NOT insert a second incident row (recordIncidentOnce dedup).
    const second = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);
    expect(second.noTrace).toHaveLength(1);
    expect(second.incidentsRaised).toBe(0); // deduped — no NEW incident counted this sweep

    const incidents = await incidentsFor();
    expect(incidents).toHaveLength(1);
  });

  it("ack↔estado invariant holds across a noTrace reset: no accepted ack for a now-pendiente row", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient); // aceptado at us, with an `accepted` ack, stored at AEAT
    aeat.forget(seeded.facturaKeys[0]!); // AEAT loses all trace of it

    expect((await ackStatesFor()).size).toBe(1); // the pre-reset accepted ack

    await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD); // first detection — remediates silently

    const estados = await estadosFor();
    expect(estados.get(seeded.registroIds[0]!)).toBe("pendiente");

    const acks = await ackStatesFor();
    expect(acks.has(seeded.registroIds[0]!)).toBe(false); // no ack at all for the pendiente row
  });

  it("a record AEAT has a trace of clears a set marker", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient); // aceptado at us, AEAT holds it Correcta

    // Simulate a marker left over from an earlier noTrace remediation that has since self-healed.
    await withTransaction(pg.db, (tx) =>
      tx.execute(
        sql`update envios set reconciled_resubmit_at = ${SERVER_NOW.toISOString()} where registro_id = ${seeded.registroIds[0]}`,
      ),
    );

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor()).toHaveLength(0);

    const marker = await reconciledResubmitAtFor(seeded.registroIds[0]!);
    expect(marker).toBeNull();
  });

  it("drift: we believe aceptado, AEAT holds AceptadaConErrores → drift + warning incident", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient);
    aeat.setConsultaState(seeded.facturaKeys[0]!, "AceptadaConErrores");

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

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

    const inc = await incidentsFor();
    expect(inc).toHaveLength(1);
    expect(inc[0]?.code).toBe("fiscal.reconcile_drift_errores");
    expect(inc[0]?.severity).toBe("warning");

    const estados = await estadosFor();
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado_con_errores");
  });

  it("drift: we believe aceptado, AEAT holds Anulada → drift + error incident", async () => {
    // No sibling anulación, so this is the anomalous Anulada path.
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient);
    aeat.setConsultaState(seeded.facturaKeys[0]!, "Anulada");

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

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

    const inc = await incidentsFor();
    expect(inc).toHaveLength(1);
    expect(inc[0]?.code).toBe("fiscal.reconcile_drift_anulada");
    expect(inc[0]?.severity).toBe("error");

    // Anulada has no local estado to correct toward.
    const estados = await estadosFor();
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado");
  });

  it("drift-Anulada with a local anulacion is clean — no drift entry, no incident", async () => {
    // AEAT marks the alta Anulada once it accepts the anulación we submitted for the same sale,
    // while the alta's own envío stays `aceptado`.
    //
    // The sale comes from the real `recordSale`, not `seedPendingEnvios`: that fixture's `huella`
    // is not chain-valid, and `recordVoid` verifies the chain. `steadyClock`'s instant is in March,
    // hence the local period.
    const period = { year: "2026", month: "03" };
    const { tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db);
    // recordVoid requires `sale.void`: a manager session authorizes it.
    const { rows: mgr } = await pg.db.execute<{ id: string }>(
      // `id` and `created_at` have no SQL DEFAULT (drizzle's `$defaultFn` runs only for a builder
      // insert), so raw SQL supplies them.
      sql`insert into persons (id, created_at, display_name, pin_hash, role)
          values (${newId()}, ${nowIso()}, 'P', ${hashPin("1234")}, 'manager') returning id`,
    );
    const voidSession = await withTransaction(pg.db, (tx) =>
      loginWithPin(tx, { tillId, personId: mgr[0]!.id, pin: "1234" }),
    );
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const resolveClient = staticResolver(aeat.client());
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: pg.db,
      resolveClient,
    });

    const sale = await withTransaction(pg.db, async (tx) => {
      return recordSale(tx, backend, saleInput({ tillId, nodeId, seriesId }));
    });
    // `recordSale`'s envío takes `proximo_intento_en` from the wall clock; pin it so the drain is
    // deterministic.
    await withTransaction(pg.db, async (tx) => {
      await tx.execute(sql`update envios set proximo_intento_en = ${DRAIN_AT.toISOString()}`);
    });
    await drain(drainDeps(resolveClient), DRAIN_AT); // alta: local aceptado, AEAT Correcta

    const alta = await altaIdentityFor(sale.saleId);
    await withTransaction(pg.db, async (tx) => {
      await recordVoid(tx, backend, sale.saleId, "staff error", { sessionId: voidSession.id });
    });
    // The void's own anulación envío is never submitted here, so it stays in flight.
    expect(await hasAnulacion(alta.id)).toBe(true);

    // AEAT now reports the alta itself Anulada — the expected authority state post-void.
    aeat.setConsultaState(alta.facturaKey, "Anulada");

    const result = await reconcile(reconcileDeps(resolveClient, steadyClock), period);

    expect(result.checked).toBe(2); // the alta's envío + the anulación's own pendiente envío
    expect(result.drift).toEqual([]); // agreement — the alta is NOT flagged
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]); // the anulación's own pendiente row is in-flight, not lost
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor()).toHaveLength(0);

    // No correction either — the alta's envío stays exactly as the drainer left it.
    const estados = await estadosFor();
    expect(estados.get(alta.id)).toBe("aceptado");
  });

  it("drift-Anulada with NO local anulacion is idempotent across sweeps — one incident, not two", async () => {
    // Anulada is never corrected, so it re-detects as drift on every sweep.
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient);
    aeat.setConsultaState(seeded.facturaKeys[0]!, "Anulada"); // no local anulación at all

    const first = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);
    expect(first.drift).toHaveLength(1);
    expect(first.incidentsRaised).toBe(1);
    expect(await incidentsFor()).toHaveLength(1);

    // Sweep 2: still drift, but no second incident row.
    const second = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);
    expect(second.drift).toHaveLength(1);
    expect(second.incidentsRaised).toBe(0); // deduped — no NEW incident counted this sweep

    const incidents = await incidentsFor();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.code).toBe("fiscal.reconcile_drift_anulada");
  });

  it("drift-AceptadaConErrores CONVERGES: a second sweep does not re-raise the incident", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient); // local aceptado, AEAT Correcta
    aeat.setConsultaState(seeded.facturaKeys[0]!, "AceptadaConErrores"); // AEAT now disagrees

    // Sweep 1: drift, a warning incident, and a correction.
    const first = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);
    expect(first.drift).toHaveLength(1);
    expect(first.drift[0]).toEqual({
      recordId: seeded.registroIds[0],
      localState: "aceptado",
      reportedState: "AceptadaConErrores",
    });
    expect(first.incidentsRaised).toBe(1);
    expect(await incidentsFor()).toHaveLength(1);
    await expect(estadosFor()).resolves.toEqual(
      new Map([[seeded.registroIds[0]!, "aceptado_con_errores"]]),
    );

    // Sweep 2: the corrected state now agrees with AEAT.
    const second = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);
    expect(second.drift).toEqual([]);
    expect(second.incidentsRaised).toBe(0);

    // (a) exactly ONE incident in total — not a fresh one every sweep.
    const incidents = await incidentsFor();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.code).toBe("fiscal.reconcile_drift_errores");

    // (b) estado converged to aceptado_con_errores and stays there.
    const estados = await estadosFor();
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado_con_errores");

    // (c) the acks row still satisfies the ack↔estado invariant for the converged state.
    const ackStates = await ackStatesFor();
    expect(ackStates.get(seeded.registroIds[0]!)).toBe("accepted_with_errors");
  });

  it("clean match: a drainer-set aceptado_con_errores agrees with AEAT's AceptadaConErrores — not drift", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1, futureDated: true }); // 2004 → AceptadoConErrores
    const resolveClient = staticResolver(aeat.client());
    await drain(drainDeps(resolveClient), DRAIN_AT); // local aceptado_con_errores, AEAT AceptadaConErrores

    // Isolate reconcile's own incidents from the drainer's `fiscal.aceptado_con_errores` warning.
    await pg.db.execute(sql`delete from incidents`);

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

    expect(result.checked).toBe(1);
    expect(result.drift).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor()).toHaveLength(0);

    // No correction needed — it was already a clean match.
    const estados = await estadosFor();
    expect(estados.get(seeded.registroIds[0]!)).toBe("aceptado_con_errores");
  });
});

describe("reconcile — paging", () => {
  it("pages across ≥2 pages (presentation-date order) without missing records", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW, consultaPageSize: 2 });
    const seeded = await seedPendingEnvios(pg.db, { count: 5 });

    let consultarCalls = 0;
    const base = aeat.client();
    const counting: VerifactuClient = {
      submit: (cabecera, registros) => base.submit(cabecera, registros),
      consultar: (cabecera, filtro) => {
        consultarCalls += 1;
        return base.consultar(cabecera, filtro);
      },
    };
    const resolveClient = staticResolver(counting);
    await drain(drainDeps(resolveClient), DRAIN_AT); // all 5 stored at AEAT as Correcta, ours aceptado
    consultarCalls = 0;

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

    expect(result.checked).toBe(5);
    // Had paging stopped after page 1, records 3-5 would surface as noTrace.
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
    const resolveClient = staticResolver(aeat.client());
    // Deliberately DO NOT drain: our record is pendiente and AEAT holds nothing for this NIF —
    // exactly the mid-submission / later-page case §4.3 forbids calling noTrace.
    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

    expect(result.checked).toBe(1);
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor()).toHaveLength(0);
  });

  it("skips a rechazado record — neither pending nor accepted, so never a mismatch", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient);
    // A record we already know AEAT refused: not stored there, and our side reads rechazado.
    aeat.forget(seeded.facturaKeys[0]!);
    await withTransaction(pg.db, (tx) => tx.execute(sql`update envios set estado = 'rechazado'`));

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

    expect(result.checked).toBe(1);
    // Absent from AEAT, yet NOT noTrace: noTrace is asserted only for a record we believe accepted.
    expect(result.noTrace).toEqual([]);
    expect(result.lostAck).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
    expect(await incidentsFor()).toHaveLength(0);
  });

  it("ignores an AEAT record with no RefExterna (one we cannot attribute)", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient); // our one record: aceptado + Correcta

    // A record AEAT holds for the SAME obligado that WE did not submit — no RefExterna keys it to
    // any of our registros (the multi-OT case: another software system filing for this NIF).
    await aeat
      .client()
      .submit({ ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } }, [
        { RegistroAlta: foreignAlta(seeded.nif, seeded.legalName) },
      ]);

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), PERIOD);

    // The foreign record is skipped, never keyed; our own record still matches cleanly.
    expect(result.checked).toBe(1); // only OUR envios row is in scope
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(0);
  });

  it("no records for the period → checked 0, and never contacts AEAT", async () => {
    await seedTenantWithSif(pg.db); // a venue with a till/SIF but no envios
    const throwing: VerifactuClient = {
      submit: () => Promise.reject(new Error("reconcile must not submit")),
      consultar: () => Promise.reject(new Error("reconcile must not consult an empty period")),
    };
    const resolveClient = staticResolver(throwing);

    const result = await reconcile(reconcileDeps(resolveClient, steadyClock), PERIOD);

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
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 3 });
    const resolveClient = staticResolver(aeat.client());
    await storeAllAtAeat(resolveClient); // all three: local aceptado, AEAT Correcta — a clean match

    const result = await reconcile(reconcileDeps(resolveClient, seeded.clock), {
      year: "2026",
      month: "7",
    });

    expect(result.checked).toBe(3);
    expect(result.lostAck).toEqual([]);
    expect(result.noTrace).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.year).toBe("2026");
    expect(result.month).toBe("07");
  });
});

describe("reconcile — malformed consulta paging", () => {
  it("Copilot finding B: throws when AEAT reports more pages but gives no continuation key", async () => {
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
        PERIOD,
      ),
    ).rejects.toThrow(/ClavePaginacion/);
  });
});

describe("reconcile — lazy client resolution", () => {
  it("a zero-row period never resolves a client, even one that would throw", async () => {
    // A zero-row period must not fail because the venue's credential is missing or unusable.
    await seedTenantWithSif(pg.db); // a venue with a till/SIF but no envios
    let calls = 0;
    const resolveClient = (): Promise<VerifactuClient> => {
      calls += 1;
      return Promise.reject(new Error("resolveClient must not be called for a zero-row period"));
    };

    const result = await reconcile({ db: pg.db, resolveClient, clock: steadyClock }, PERIOD);

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

/** A well-formed alta for the querying obligado carrying NO RefExterna, so the fake reports it in a
 * consulta but `reconcile` cannot attribute it to any of our registros. */
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
