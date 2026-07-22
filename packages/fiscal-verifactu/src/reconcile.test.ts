import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { VerifactuBackend } from "./backend.js";
import { reconcile } from "./reconcile.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { steadyClock } from "../test/write-path-fixtures.js";

// This file's fixtures all stamp `fecha_expedicion_factura` = 2026-07-20 (drain-fixtures' own
// PAST_FECHA), so every seeded record falls in this one period.
const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const DRAIN_AT = new Date("2026-07-21T00:01:00Z"); // past the seeded `proximo_intento_en`
const PERIOD = { year: "2026", month: "07" };

let db: Database;
beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, FISCAL_MIGRATIONS);
}, 60_000);
afterAll(async () => {
  await db.close();
});

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
  await db.execute(sql`truncate table acks, incidents, envios cascade`);
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
  const { rows } = await withTenant(db, tenantId, (tx) =>
    tx.execute<{ code: string; severity: string; params: Record<string, unknown> }>(
      sql`select code, severity, params from incidents where tenant_id = ${tenantId}`,
    ),
  );
  return rows;
}

/** The committed `envios.estado` per registro — used to prove reconcile now CORRECTS state toward
 * the authority (plan 3b Task 5), on top of the classification the cases above already assert. */
async function estadosFor(tenantId: string): Promise<Map<string, string>> {
  const { rows } = await withTenant(db, tenantId, (tx) =>
    tx.execute<{ registro_id: string; estado: string }>(
      sql`select registro_id, estado from envios where tenant_id = ${tenantId}`,
    ),
  );
  return new Map(rows.map((r) => [r.registro_id, r.estado]));
}

/** The committed `acks.state` per registro — used to prove the ack↔estado invariant still holds
 * after a drift correction (the acks row must agree with whatever `envios.estado` converged to). */
async function ackStatesFor(tenantId: string): Promise<Map<string, string>> {
  const { rows } = await withTenant(db, tenantId, (tx) =>
    tx.execute<{ registro_id: string; state: string }>(
      sql`select registro_id, state from acks where tenant_id = ${tenantId}`,
    ),
  );
  return new Map(rows.map((r) => [r.registro_id, r.state]));
}

describe("reconcile — the three audit cases", () => {
  it("clean audit: our records all match AEAT — empty lists", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(db, { count: 3 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
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
    const seeded = await seedPendingEnvios(db, { count: 3 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
    await storeAllAtAeat(backend); // AEAT now holds all three as Correcta

    // Our acknowledgement was lost: our side reads pendiente though AEAT already holds them.
    await withTenant(db, seeded.tenantId, (tx) =>
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

  it("noTrace: we believe aceptado, AEAT has no trace (forget) → noTrace + error incident", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(db, { count: 1 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
    await storeAllAtAeat(backend); // aceptado at us, stored at AEAT
    aeat.forget(seeded.facturaKeys[0]!); // AEAT loses all trace of it

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    expect(result.checked).toBe(1);
    expect(result.noTrace).toHaveLength(1);
    expect(result.noTrace[0]).toEqual({
      recordId: seeded.registroIds[0],
      localState: "aceptado",
      reportedState: null,
    });
    expect(result.lostAck).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.incidentsRaised).toBe(1);

    const inc = await incidentsFor(seeded.tenantId);
    expect(inc).toHaveLength(1);
    expect(inc[0]?.code).toBe("fiscal.reconcile_no_trace");
    expect(inc[0]?.severity).toBe("error");
    // The AEAT IDFactura triple rides in the incident params, never on the mismatch.
    expect(inc[0]?.params).toMatchObject({
      registroId: seeded.registroIds[0],
      idEmisorFactura: seeded.nif,
      numSerieFactura: "S1/1",
      fechaExpedicionFactura: "20-07-2026",
    });
  });

  it("drift: we believe aceptado, AEAT holds AceptadaConErrores → drift + warning incident", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(db, { count: 1 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
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
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(db, { count: 1 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
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

  it("drift-AceptadaConErrores CONVERGES: a second sweep does not re-raise the incident", async () => {
    // Reviewer finding (plan 3b Task 5): the drift branch fired on ACEPTADO.has(row.estado)
    // (which includes aceptado_con_errores) with no check that local and AEAT actually disagree.
    // Sweep 1 corrects aceptado → aceptado_con_errores; sweep 2 then saw local
    // aceptado_con_errores vs AEAT AceptadaConErrores and mis-classified that AGREEMENT as drift
    // all over again — a second incident, a reset `delivered_at`, and no convergence. This test
    // proves sweep 2 now finds a clean match: exactly ONE incident total, not two.
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(db, { count: 1 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
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
    const seeded = await seedPendingEnvios(db, { count: 1, futureDated: true }); // 2004 → AceptadoConErrores
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
    await backend.drain(DRAIN_AT); // sets local aceptado_con_errores; AEAT's own store already
    // holds AceptadaConErrores for this key too (createFakeAeat's future-dated branch) — no
    // `setConsultaState` needed, this is the drainer's own genuine happy-with-errors path.

    // Isolate reconcile's own incidents from the drainer's `fiscal.aceptado_con_errores` warning.
    await db.execute(sql`truncate table incidents`);

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
    const seeded = await seedPendingEnvios(db, { count: 5 });

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
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: counting });
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
    const seeded = await seedPendingEnvios(db, { count: 1 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
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
    const seeded = await seedPendingEnvios(db, { count: 1 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
    await storeAllAtAeat(backend);
    // A record we already know AEAT refused: not stored there, and our side reads rechazado.
    aeat.forget(seeded.facturaKeys[0]!);
    await withTenant(db, seeded.tenantId, (tx) =>
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
    const seeded = await seedPendingEnvios(db, { count: 1 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
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
    const { tenantId } = await seedTenantWithSif(db); // a tenant with a till/SIF but no envios
    const throwing: VerifactuClient = {
      submit: () => Promise.reject(new Error("reconcile must not submit")),
      consultar: () => Promise.reject(new Error("reconcile must not consult an empty period")),
    };
    const backend = new VerifactuBackend({ clock: steadyClock, db, client: throwing });

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
    const seeded = await seedPendingEnvios(db, { count: 3 });
    const backend = new VerifactuBackend({ clock: seeded.clock, db, client: aeat.client() });
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
    const seeded = await seedPendingEnvios(db, { count: 1 }); // ≥1 local row so T1 does not short-circuit
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
      reconcile({ db, client: malformed, clock: seeded.clock }, seeded.tenantId, PERIOD),
    ).rejects.toThrow(/ClavePaginacion/);
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
