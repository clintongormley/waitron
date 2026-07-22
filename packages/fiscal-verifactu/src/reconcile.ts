import { sql } from "drizzle-orm";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { recordIncident } from "@waitron/core";
import type { IncidentSeverity } from "@waitron/core";
import { AppError } from "@waitron/shared";
import type { SaleId, TenantId, TillId } from "@waitron/shared";
import type { ReconcileMismatch, ReconcileResult, TrustedClock } from "@waitron/fiscal";
import type {
  Cabecera,
  ConsultaFiltro,
  EstadoRegistroConsulta,
  VerifactuClient,
} from "@waitron/verifactu";
import { writeAck } from "./acks.js";

export interface ReconcileDeps {
  db: Database;
  client: VerifactuClient;
  clock: TrustedClock;
}

/**
 * One `envios` row joined to just enough of its `registros_facturacion` record to (a) classify it
 * against AEAT's view and (b) build a reconcile incident if it diverges. `id` is
 * `registros_facturacion.id` — the value the drainer sends as `RefExterna` and therefore the key
 * AEAT's own view echoes back, so `id` is what a mismatch's `recordId` and the authority map are
 * both keyed by. `fecha_expedicion_factura` is projected in AEAT's own `DD-MM-YYYY` form so the
 * incident's identity triple reads exactly as the authority holds it (see `errors.ts`).
 *
 * A `type` alias, not an `interface`: `tx.execute<T>` constrains `T` to `Record<string, unknown>`,
 * which an object-literal type alias satisfies but a mergeable `interface` does not — the same
 * shape every other raw-execute row type in this package uses.
 */
type PeriodRow = {
  id: string;
  tenant_id: string;
  till_id: string;
  sale_id: string;
  estado: string;
  id_emisor_factura: string;
  nombre_razon_emisor: string;
  num_serie_factura: string;
  fecha_expedicion_factura: string;
};

/** `envios.estado` values we read as "still awaiting acknowledgement" — a Set, not an `a || b`
 * chain, so the mapping carries no branch of its own to leave half-covered. */
const PENDIENTE = new Set(["pendiente", "enviando"]);
/** `envios.estado` values we read as "we believe AEAT accepted this". `aceptado_con_errores`
 * counts as accepted, mirroring `DrainResult.recordsAccepted`/`AckState`'s own convention. Every
 * other estado (`rechazado`/`detenido`) is NEITHER: a record we already know AEAT refused or that
 * we halted is not something a sweep re-classifies as a disagreement. */
const ACEPTADO = new Set(["aceptado", "aceptado_con_errores"]);

const REPORTED_DRIFT: Partial<
  Record<
    EstadoRegistroConsulta,
    {
      severity: IncidentSeverity;
      code: "fiscal.reconcile_drift_errores" | "fiscal.reconcile_drift_anulada";
    }
  >
> = {
  AceptadaConErrores: { severity: "warning", code: "fiscal.reconcile_drift_errores" },
  Anulada: { severity: "error", code: "fiscal.reconcile_drift_anulada" },
};

/**
 * True when an accepted-family row's `REPORTED_DRIFT`-mapped state is a GENUINE divergence from
 * ours, not agreement. Only called once `REPORTED_DRIFT[reported]` is already known defined (i.e.
 * `reported` is `AceptadaConErrores` or `Anulada`) — it narrows THAT further by local estado.
 *
 * `Anulada` has no local estado that ever agrees with it (only `aceptado`/`aceptado_con_errores`
 * reach here, via `ACEPTADO`), so it is unconditionally a divergence.
 *
 * `AceptadaConErrores` disagrees ONLY when local is still `aceptado` (a genuine clean→errors
 * transition AEAT is reporting for the first time). When local is already `aceptado_con_errores`,
 * AEAT is simply confirming what the drainer already recorded (see `ackStateOf`) — agreement, not
 * drift. Without this gate, correcting `aceptado`→`aceptado_con_errores` on sweep 1 caused sweep 2
 * to re-classify the now-agreeing row as drift all over again: a new incident every sweep,
 * `delivered_at` reset every sweep, and no convergence (see the two-sweep convergence test in
 * reconcile.test.ts).
 */
function isDrift(localEstado: string, reported: EstadoRegistroConsulta): boolean {
  return reported !== "AceptadaConErrores" || localEstado === "aceptado";
}

/**
 * The local `envios.estado` a mismatch is corrected to, keyed ONLY by what AEAT reports — uniform
 * across a `lostAck` (local `pendiente`) and a `drift` (local `aceptado`), because the authority's
 * state is the thing being reconciled toward. `Correcta` → `aceptado`, `AceptadaConErrores` →
 * `aceptado_con_errores`. `Anulada` is deliberately absent: there is no clean local estado for it,
 * so it stays incident-only, exactly as Task 4 left it. A `noTrace` (reportedState null) is also
 * never corrected — AEAT has nothing to reconcile toward.
 */
const CORRECTION: Partial<Record<EstadoRegistroConsulta, "aceptado" | "aceptado_con_errores">> = {
  Correcta: "aceptado",
  AceptadaConErrores: "aceptado_con_errores",
};

/**
 * The reconciliation sweep (plan 3b design §4): audit one tenant's calendar period against what
 * AEAT reports back for it, classifying every disagreement into `lostAck`/`noTrace`/`drift` and
 * raising an incident for each `noTrace`/`drift` (never for `lostAck`). The returned lists are the
 * audit finding and are ALWAYS reported, even for a mismatch this sweep also corrects.
 *
 * Where AEAT holds a clean local estado to reconcile toward, T2 also CORRECTS our state and writes
 * the ack the lost/drifted response would have (`correct` → `CORRECTION` + `writeAck`), atomically
 * with the classification: `lostAck`/`drift` reported as `Correcta`→`aceptado` or
 * `AceptadaConErrores`→`aceptado_con_errores`. `Anulada` and `noTrace` have no clean local estado,
 * so they stay incident-only — no state change, no ack — exactly as Task 4 left them. The
 * correction IS idempotent for the two paths that ever run it: a second sweep over a
 * `Correcta`-corrected row now finds local `aceptado` agreeing with `Correcta` — a clean match, no
 * re-classification; a second sweep over an `AceptadaConErrores`-corrected row now finds local
 * `aceptado_con_errores` agreeing with `AceptadaConErrores` — likewise a clean match (see
 * `isDrift` below). `Anulada`/`noTrace` are never corrected, so this idempotency question does not
 * apply to them — a persistently-annulled or persistently-missing record re-raises its incident
 * every sweep by design, a separate concern carried to the final review.
 *
 * The consulta network call runs OUTSIDE any transaction, between two short `withTenant`
 * transactions — never held across the round trip, mirroring the drainer's own T1/T2 split (plan
 * 3a, `drain.ts`). T1 reads our period rows; if there are none there is nothing to reconcile and
 * the sweep returns `checked: 0` WITHOUT contacting AEAT at all. Otherwise the consulta is paged
 * into an authority map, then T2 classifies the already-read rows against that map and writes any
 * incidents, corrections and acks. Classification is pure computation over rows T1 already read —
 * no query depends on the network response, so nothing reopens the read under a stale snapshot.
 *
 * Diff on `EstadoRegistro`, not presence (design §4.3, the in-flight tolerance that makes this
 * correct against a paged, presentation-date-ordered response):
 *
 *   - a `pendiente`/`enviando` record ABSENT from AEAT is ordinary in-flight state — it may be
 *     mid-submission or on a later, not-yet-paged page — so it is NEVER `noTrace`;
 *   - a `pendiente`/`enviando` record PRESENT at AEAT is `lostAck` — the authority already holds
 *     it while we still think it unsent, so our acknowledgement was lost;
 *   - an accepted record ABSENT from AEAT is `noTrace` (an error incident) — we reported it filed
 *     and the authority has no trace of it;
 *   - an accepted record whose AEAT state genuinely DISAGREES with ours is `drift` (a warning /
 *     an error incident, see `isDrift`); a matching `Correcta` (local `aceptado`) or a matching
 *     `AceptadaConErrores` (local `aceptado_con_errores`, the drainer's own accept-with-errors
 *     path) is agreement, no entry — `Anulada` always disagrees, since no local estado agrees
 *     with it.
 *
 * Uses `EstadoRegistroConsulta` (the consulta enum) directly and deliberately does NOT route these
 * through the drainer's submission-scoped `resolveEstadoEfectivo` (design §5): the two enums model
 * different state spaces (a consulta can report `Anulada` and never reports a rejected record;
 * submission is the mirror image), and sharing the resolver would model states one side cannot
 * reach and miss states the other can.
 */
export async function reconcile(
  deps: ReconcileDeps,
  tenantId: TenantId,
  period: { year: string; month: string },
): Promise<ReconcileResult> {
  // Normalized BEFORE any use: `to_char(fecha_expedicion_factura, 'MM')` always yields a
  // zero-padded 2-digit month, so an unpadded caller-supplied `period.month` (e.g. "7") would
  // otherwise match nothing in `rowsForPeriod`'s SQL comparison and silently return a false-clean
  // `checked: 0` instead of auditing the period — a Copilot review finding. Every downstream use
  // (the SQL filter, the AEAT `Ejercicio`/`Periodo` filter, and the echoed result) reads this
  // normalized value, never the raw `period` argument.
  const normalizedPeriod = {
    year: String(period.year).padStart(4, "0"),
    month: String(period.month).padStart(2, "0"),
  };

  const result: ReconcileResult = {
    year: normalizedPeriod.year,
    month: normalizedPeriod.month,
    checked: 0,
    lostAck: [],
    noTrace: [],
    drift: [],
    incidentsRaised: 0,
  };

  // T1 — read our period rows in a short transaction. No network call inside it.
  const rows = await withTenant(deps.db, tenantId, (tx) =>
    rowsForPeriod(tx, tenantId, normalizedPeriod),
  );
  result.checked = rows.length;
  // Nothing recorded for this period: no consulta at all (there is nothing its answer could
  // change), and no T2. Answers the interface's "nothing to check" contract directly.
  if (rows.length === 0) return result;

  // Network — OUTSIDE any transaction. Page AEAT's view for the period, keyed by RefExterna
  // (= our registro id). All rows share one obligado (the tenant↔NIF invariant), so any row's own
  // emisor identity builds the cabecera.
  const authority = await fetchAuthority(deps.client, cabeceraFor(rows[0]!), normalizedPeriod);

  // T2 — classify the already-read rows against the authority map and write incidents.
  const detectedAt = deps.clock.now().instant;
  await withTenant(deps.db, tenantId, async (tx) => {
    for (const row of rows) {
      const reported = authority.get(row.id) ?? null;

      if (PENDIENTE.has(row.estado)) {
        // Present while we still believe pending → lost ack. Absent → in-flight, not a mismatch.
        if (reported !== null) {
          result.lostAck.push(mismatchOf(row, reported));
          // Correct our state toward the authority's and produce the ack the lost response would
          // have. `Anulada` → no clean local estado, so `correct` no-ops (incident-only path).
          await correct(tx, row, reported, detectedAt);
        }
        continue;
      }
      if (!ACEPTADO.has(row.estado)) continue; // rechazado/detenido — neither case, skip.

      // We believe accepted.
      if (reported === null) {
        result.noTrace.push(mismatchOf(row, null));
        await raise(tx, row, "error", "fiscal.reconcile_no_trace", detectedAt);
        result.incidentsRaised += 1;
        continue;
      }
      const drift = REPORTED_DRIFT[reported];
      if (drift !== undefined && isDrift(row.estado, reported)) {
        result.drift.push(mismatchOf(row, reported));
        await raise(tx, row, drift.severity, drift.code, detectedAt);
        result.incidentsRaised += 1;
        // Correct toward AEAT (AceptadaConErrores → aceptado_con_errores) and re-ack; Anulada
        // no-ops in `correct`, staying incident-only.
        await correct(tx, row, reported, detectedAt);
      }
      // Clean agreement, nothing to do (the drainer already acked it — never re-ack a record that
      // was not a mismatch): `reported === "Correcta"` on a local `aceptado` row, OR
      // `reported === "AceptadaConErrores"` on a local `aceptado_con_errores` row (see `isDrift`).
    }
  });

  return result;
}

/**
 * Our `envios` rows for the period, joined to their registro. Period = expedition MONTH: our
 * records carry no `FechaOperacion`, so operation month is always expedition month (spec §1), and
 * `fecha_expedicion_factura` (a `date`) is the column to filter on — `to_char` compares the stored
 * year/month against the requested `Ejercicio`/`Periodo` directly. Scoped to the tenant (and run
 * under `withTenant`, so the RLS tenant-isolation policy matches these rows under a non-superuser
 * deployment role — the same scoping `pendingCount` relies on).
 */
async function rowsForPeriod(
  tx: Transaction,
  tenantId: string,
  period: { year: string; month: string },
): Promise<PeriodRow[]> {
  const { rows } = await tx.execute<PeriodRow>(sql`
    select
      r.id, r.tenant_id, r.till_id, r.sale_id,
      e.estado,
      r.id_emisor_factura, r.nombre_razon_emisor, r.num_serie_factura,
      to_char(r.fecha_expedicion_factura, 'DD-MM-YYYY') as fecha_expedicion_factura
    from envios e
    -- r.tenant_id = e.tenant_id keeps the join tenant-consistent by construction: an envios row's
    -- tenant_id always equals its registro's (both stamped from the same sale at insert), so this is
    -- redundant under that invariant and under RLS, but hardens the join against a cross-tenant match
    -- in any superuser/RLS-bypass context (the same defense-in-depth pendingCount adds explicitly).
    join registros_facturacion r on r.id = e.registro_id and r.tenant_id = e.tenant_id
    where e.tenant_id = ${tenantId}
      and to_char(r.fecha_expedicion_factura, 'YYYY') = ${period.year}
      and to_char(r.fecha_expedicion_factura, 'MM') = ${period.month}
  `);
  return rows;
}

/** The obligado emisor for the consulta cabecera — read off any period row (all share one NIF
 * under the tenant↔NIF 1:1 invariant), exactly as the drainer builds its own from a batch row. */
function cabeceraFor(row: PeriodRow): Cabecera {
  return { ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura } };
}

/**
 * Pages the whole period consulta into `RefExterna → EstadoRegistro`. Continues while
 * `IndicadorPaginacion === "S"`, echoing `ClavePaginacion` back verbatim, until AEAT reports no
 * further pages. A record with no `RefExterna` is one we cannot attribute to any of our registros
 * (e.g. filed for this obligado by another software system — the multi-OT case `SistemaInformatico`
 * allows), so it is skipped rather than keyed under `undefined`.
 *
 * If AEAT ever reports `IndicadorPaginacion === "S"` (more pages follow) but omits
 * `ClavePaginacion` (the key needed to fetch the next one), THROWS rather than silently stopping —
 * a Copilot review finding. Silently stopping there would under-page the authority map, so records
 * that only appear on the unreached pages would read as absent: an `aceptado` record on those pages
 * would be mis-flagged `noTrace` (a false error incident), or a record needing correction would be
 * missed. A loud failure is the correct outcome for a compliance audit; a wrong "clean" result is
 * not.
 */
async function fetchAuthority(
  client: VerifactuClient,
  cabecera: Cabecera,
  period: { year: string; month: string },
): Promise<Map<string, EstadoRegistroConsulta>> {
  const authority = new Map<string, EstadoRegistroConsulta>();
  let clave: ConsultaFiltro["ClavePaginacion"];
  do {
    const resp = await client.consultar(cabecera, {
      Ejercicio: period.year,
      Periodo: period.month,
      ClavePaginacion: clave,
    });
    for (const r of resp.registros) {
      const ref = (r.DatosRegistroFacturacion as { RefExterna?: string }).RefExterna;
      if (ref !== undefined) authority.set(ref, r.EstadoRegistro);
    }
    if (resp.IndicadorPaginacion === "S") {
      if (resp.ClavePaginacion === undefined) {
        throw new Error("consulta returned IndicadorPaginacion=S without a ClavePaginacion");
      }
      clave = resp.ClavePaginacion;
    } else {
      clave = undefined;
    }
  } while (clave !== undefined);
  return authority;
}

function mismatchOf(row: PeriodRow, reported: EstadoRegistroConsulta | null): ReconcileMismatch {
  return { recordId: row.id, localState: row.estado, reportedState: reported };
}

/**
 * Corrects one mismatch's local estado toward what AEAT reports, then writes the ack the lost or
 * drifted response would have produced — both on THIS T2 transaction, so the ack reflects the
 * estado this same commit writes (the acks invariant). The correction target depends ONLY on the
 * reported state (`CORRECTION`), so it is identical for a `lostAck` and a `drift`. `Anulada`/any
 * unmapped state has no clean local estado, so this no-ops there — reconcile still reports the
 * mismatch and raises its incident (where Task 4 does), it just does not rewrite state.
 *
 * A targeted `update` rather than the drainer's `setEstado`: reconcile has no envío-response CSV in
 * hand (consulta never returns one — `RegistroConsultado`'s own doc comment), and `setEstado`
 * REQUIRES a csv. Leaving `csv` untouched here keeps whatever the row already held (null for a true
 * lost ack) — `writeAck` reads it back, so the ack's csv is null, exactly as expected.
 */
async function correct(
  tx: Transaction,
  row: PeriodRow,
  reported: EstadoRegistroConsulta,
  now: Date,
): Promise<void> {
  const target = CORRECTION[reported];
  if (target === undefined) return; // Anulada / no clean local estado — incident-only.
  await tx.execute(sql`
    update envios set estado = ${target}, confirmado_en = ${now.toISOString()}
    where registro_id = ${row.id} and tenant_id = ${row.tenant_id}
  `);
  await writeAck(tx, row.id, now);
}

/**
 * Raises one reconciliation incident on THIS transaction (never a fresh connection — an incident
 * must never commit while the sweep it describes rolls back), via `@waitron/core`'s
 * `recordIncident`, exactly as the drainer's own `raiseIncident` does. The `IDFactura` triple goes
 * into the incident params (not onto the regime-neutral `ReconcileMismatch`) so an operator can
 * trace the record back to AEAT — see `errors.ts`.
 */
async function raise(
  tx: Transaction,
  row: PeriodRow,
  severity: IncidentSeverity,
  code:
    | "fiscal.reconcile_no_trace"
    | "fiscal.reconcile_drift_errores"
    | "fiscal.reconcile_drift_anulada",
  detectedAt: Date,
): Promise<void> {
  await recordIncident(tx, {
    tenantId: row.tenant_id as TenantId,
    tillId: row.till_id as TillId,
    saleId: row.sale_id as SaleId,
    error: new AppError(code, {
      registroId: row.id,
      idEmisorFactura: row.id_emisor_factura,
      numSerieFactura: row.num_serie_factura,
      fechaExpedicionFactura: row.fecha_expedicion_factura,
    }),
    severity,
    detectedAt,
  });
}
