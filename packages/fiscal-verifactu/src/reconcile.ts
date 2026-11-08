import { inArray, sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import type { Database, DeploymentEnvironment, Transaction } from "@waitron/db";
import { recordIncident, recordIncidentOnce } from "@waitron/core";
import type { IncidentSeverity } from "@waitron/core";
import { AppError, jobOrigin } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
import type { ReconcileMismatch, ReconcileResult, TrustedClock } from "@waitron/fiscal";
import type {
  Cabecera,
  ConsultaFiltro,
  EstadoRegistroConsulta,
  RegistroConsultado,
  VerifactuClient,
} from "@waitron/verifactu";
import { deleteAck, writeAck } from "./acks.js";
import { openAcceptedWithErrorsCase } from "./filing-cases.js";
import { toAeatDate } from "./registro-row.js";
import { retainLookupConflict } from "./reconcile-conflicts.js";
import {
  liveLookupHeader,
  lookupSystem,
  readLiveReconciliationSeries,
  retainUnheldSeriesConflicts,
} from "./reconcile-series.js";
import type { LookupConflictEvidence } from "./conflict-types.js";

export interface ReconcileDeps {
  db: Database;
  /** Runtime sweeps name the identity they may observe and correct. */
  scope?: ReconcileScope;
  resolveClient: () => Promise<VerifactuClient>;
  clock: TrustedClock;
  signal?: AbortSignal;
}

export interface ReconcileScope {
  readonly nodeId: string;
  /** This box first, then the boxes it took over from: whose stored records the check covers. */
  readonly historyNodeIds: readonly string[];
  readonly taxpayerId: string;
  readonly environment: DeploymentEnvironment;
}

/**
 * `id` is `registros_facturacion.id`, which the drainer sends as `RefExterna`, so it keys AEAT's
 * view. `fecha_expedicion_factura` holds AEAT's `DD-MM-YYYY` form, NOT the stored `YYYY-MM-DD`
 * (`rowsForPeriod` converts it), so an incident's identity triple reads as the authority holds it.
 *
 * A `type` alias, not an `interface`: `tx.execute<T>` constrains `T` to `Record<string, unknown>`,
 * which a mergeable `interface` does not satisfy.
 */
type PeriodRow = {
  id: string;
  sale_id: string;
  /** For an alta, the id of its sale's anulación, if one exists; otherwise null. */
  anulacion_id: string | null;
  /** `[huella, NumeroInstalacion]` of every stored record of this invoice. */
  known_records: string;
  huella: string;
  tipo_registro: string;
  sistema_informatico: string;
  estado: string;
  intentos: number;
  csv: string | null;
  reconciled_resubmit_at: string | null;
  id_emisor_factura: string;
  nombre_razon_emisor: string;
  num_serie_factura: string;
  fecha_expedicion_factura: string;
};

/** What AEAT's consulta reports for one stored record: its state, and its error when it has one. */
type Reported = {
  estado: EstadoRegistroConsulta;
  codigo: number | null;
  mensaje: string | null;
};

/** `envios.estado` values we read as "we believe AEAT accepted this". A `rechazado`/`detenido`
 * record is in neither set: a sweep does not re-classify what we already know was refused or halted. */
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
  AceptadoConErrores: { severity: "warning", code: "fiscal.reconcile_drift_errores" },
  Anulado: { severity: "error", code: "fiscal.reconcile_drift_anulada" },
};

/**
 * Called only when `reported` is `AceptadoConErrores` or `Anulado`. `AceptadoConErrores` agrees
 * with a local `aceptado_con_errores`: without that, the row this sweep corrects would be
 * re-classified as drift on every later sweep.
 */
function isDrift(localEstado: string, reported: EstadoRegistroConsulta): boolean {
  return reported !== "AceptadoConErrores" || localEstado === "aceptado";
}

/**
 * The local `envios.estado` a mismatch is corrected to, keyed only by what AEAT reports. `Anulado`
 * is deliberately absent: there is no local estado for it, so it is never corrected.
 */
const CORRECTION: Partial<Record<EstadoRegistroConsulta, "aceptado" | "aceptado_con_errores">> = {
  Correcto: "aceptado",
  AceptadoConErrores: "aceptado_con_errores",
};

/** The lookup stays outside the write transaction. Its snapshot is checked again before any
 * correction so another caller's filing result or retry is not overwritten. */
export async function reconcile(
  deps: ReconcileDeps,
  period: { year: string; month: string },
): Promise<ReconcileResult> {
  // The stored month is always two digits, so an unpadded `period.month` ("7") would match no row
  // and return a false-clean `checked: 0`. Every use below reads this, never the raw `period`.
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

  const rows = await withTransaction(deps.db, (tx) =>
    rowsForPeriod(tx, normalizedPeriod, deps.scope),
  );
  result.checked = rows.length;
  const liveSeries =
    deps.scope === undefined
      ? []
      : await withTransaction(deps.db, (tx) => readLiveReconciliationSeries(tx, deps.scope!));
  if (rows.length === 0 && liveSeries.length === 0) return result;
  const cabecera =
    rows.length > 0
      ? cabeceraFor(rows[0]!)
      : await withTransaction(deps.db, (tx) => liveLookupHeader(tx, deps.scope!));
  deps.signal?.throwIfAborted();
  const client = await deps.resolveClient();
  const { authority, conflicts, unknown, observed } = await fetchAuthority(
    client,
    cabecera,
    normalizedPeriod,
    rows,
    deps.scope !== undefined,
    deps.signal,
  );

  const detectedAt = deps.clock.now().instant;
  await withTransaction(deps.db, async (tx) => {
    deps.signal?.throwIfAborted();
    if (deps.scope !== undefined)
      await retainUnheldSeriesConflicts(
        tx,
        deps.scope,
        observed,
        new Set(rows.filter((row) => conflicts.has(row.id)).map((row) => row.num_serie_factura)),
        detectedAt,
        normalizedPeriod,
      );
    const current = new Map(
      (await rowsForPeriod(tx, normalizedPeriod, deps.scope)).map((row) => [row.id, row]),
    );
    for (const row of rows) {
      deps.signal?.throwIfAborted();
      const latest = current.get(row.id);
      // A lookup cannot replace a filing result or retry committed while the network was pending.
      if (
        row.estado === "enviando" ||
        latest === undefined ||
        (Object.keys(row) as (keyof PeriodRow)[]).some((key) => latest[key] !== row[key])
      ) {
        (result.deferred ??= []).push(row.id);
        continue;
      }
      const conflict = conflicts.get(row.id);
      if (conflict !== undefined) {
        await retainLookupConflict(tx, row.id, conflict, detectedAt);
        if (await raiseOnce(tx, row, "error", "fiscal.huella_divergente", detectedAt))
          result.incidentsRaised += 1;
        (result.conflicts ??= []).push(mismatchOf(row, conflict.state));
        continue;
      }
      if (unknown.has(row.id)) {
        (result.deferred ??= []).push(row.id);
        continue;
      }
      const found = authority.get(row.id) ?? reportedThroughAnulacion(row, authority);
      const reported = found?.estado ?? null;

      if (row.estado === "pendiente") {
        if (found !== null) {
          result.lostAck.push(mismatchOf(row, found.estado));
          await correct(tx, row, found, detectedAt, { lostAck: true, result });
        }
        continue;
      }
      if (!ACEPTADO.has(row.estado)) continue; // rechazado/detenido — neither case, skip.

      if (reported === null) {
        result.noTrace.push(mismatchOf(row, null));
        if (row.reconciled_resubmit_at === null) {
          // First detection — remediate silently: re-submit (reset to pendiente) and drop the stale
          // ack. Usually just consulta lag; self-heals on the next drain. No incident yet.
          await remediateNoTrace(tx, row, detectedAt);
        } else {
          // Already re-submitted once and STILL absent → a genuine, un-self-healing gap → escalate
          // to an idempotent error incident; do NOT reset again (no loop).
          if (await raiseOnce(tx, row, "error", "fiscal.reconcile_no_trace", detectedAt)) {
            result.incidentsRaised += 1;
          }
        }
        continue;
      }

      // AEAT has a trace again, so a future absence remediates afresh rather than escalating.
      if (row.reconciled_resubmit_at !== null) {
        await clearReconciledMarker(tx, row);
      }

      const drift = REPORTED_DRIFT[reported];
      if (drift !== undefined && isDrift(row.estado, reported)) {
        if (reported === "Anulado" && (await hasSiblingAnulacion(tx, row))) {
          // The expected state of a voided sale: AEAT marks the alta Anulado once it accepts the
          // anulación we submitted, while the alta's own envío stays `aceptado`. We hold the local
          // anulación, so this is agreement, not drift — no entry, no incident, no correction.
          continue;
        }
        result.drift.push(mismatchOf(row, reported));
        if (reported === "Anulado") {
          // No local anulación. Idempotent, since a persistent Anulado is re-detected every sweep.
          if (
            await raiseOnce(tx, row, drift.severity, "fiscal.reconcile_drift_anulada", detectedAt)
          ) {
            result.incidentsRaised += 1;
          }
        } else {
          // drift-AceptadoConErrores: converges (isDrift makes it agree after correction), so it is
          // raised at most once per genuine clean→errors transition — the unconditional `raise`.
          await raise(tx, row, drift.severity, drift.code, detectedAt);
          result.incidentsRaised += 1;
          await correct(tx, row, found!, detectedAt, { lostAck: false, result });
        }
      }
      // Clean agreement, nothing to do (the drainer already acked it — never re-ack a record that
      // was not a mismatch): `reported === "Correcto"` on a local `aceptado` row, OR
      // `reported === "AceptadoConErrores"` on a local `aceptado_con_errores` row (see `isDrift`).
    }
    deps.signal?.throwIfAborted();
  });

  return result;
}

/**
 * Our envios for the expedition month, joined to their registros. Records carry no FechaOperacion,
 * so the period filter uses fecha_expedicion_factura.
 *
 * Plain text work on the stored `YYYY-MM-DD` string, no engine date parsing near a value AEAT will
 * judge. The prefix filter relies on the stored month always being two digits: the column's only
 * writer is `toIsoDate` (./registro-row.ts), which reorders the digits of AEAT's fixed-width
 * `DD-MM-YYYY`. `toAeatDate` is its exact inverse, so an incident's `IDFactura` triple reads as the
 * digits AEAT received. Guard: reconcile.period.test.ts.
 */
async function rowsForPeriod(
  tx: Transaction,
  period: { year: string; month: string },
  scope?: ReconcileScope,
): Promise<PeriodRow[]> {
  const scoped =
    scope === undefined
      ? sql``
      : sql`
    and ${inArray(sql`r.node_id`, scope.historyNodeIds)}
    and r.id_emisor_factura = ${scope.taxpayerId}
    and r.entorno = ${scope.environment}
  `;
  // A box that took over may cancel an invoice another box in its history issued, so the same
  // invoice's records sit on two boxes under two installations.
  const knownNode =
    scope === undefined
      ? sql`known.node_id = r.node_id`
      : inArray(sql`known.node_id`, scope.historyNodeIds);
  const sameInvoice = sql`
        known.sale_id = r.sale_id and ${knownNode}
          and known.id_emisor_factura = r.id_emisor_factura
          and known.entorno is r.entorno
          and known.num_serie_factura = r.num_serie_factura
          and known.fecha_expedicion_factura = r.fecha_expedicion_factura`;
  const { rows } = await tx.execute<PeriodRow>(sql`
    select
      r.id, r.sale_id,
      case when r.tipo_registro = 'alta' then (
        select a.id from registros_facturacion a
        where a.sale_id = r.sale_id and a.tipo_registro = 'anulacion'
        limit 1
      ) end as anulacion_id,
      (
        select json_group_array(
          json_array(
            known.huella, json_extract(known.sistema_informatico, '$.NumeroInstalacion')
          )
        )
        from registros_facturacion known
        where ${sameInvoice}
      ) as known_records,
      r.huella, r.tipo_registro, r.sistema_informatico,
      e.estado, e.intentos, e.csv, e.reconciled_resubmit_at,
      r.id_emisor_factura, r.nombre_razon_emisor, r.num_serie_factura,
      r.fecha_expedicion_factura
    from envios e
    join registros_facturacion r on r.id = e.registro_id
    where substr(r.fecha_expedicion_factura, 1, 7) = ${`${period.year}-${period.month}`}
      and not exists (
        select 1 from registros_facturacion replacement
        where replacement.corrects_registro_id = r.id
      )
    ${scoped}
  `);
  return rows.map((row) => ({
    ...row,
    fecha_expedicion_factura: toAeatDate(row.fecha_expedicion_factura),
  }));
}

function reportedThroughAnulacion(
  row: PeriodRow,
  authority: Map<string, Reported>,
): Reported | null {
  if (row.anulacion_id === null) return null;
  return authority.get(row.anulacion_id)?.estado === "Anulado"
    ? { estado: "Anulado", codigo: null, mensaje: null }
    : null;
}

function cabeceraFor(row: PeriodRow): Cabecera {
  return { ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura } };
}

/** An incomplete period lookup cannot establish that an accepted record is missing. */
async function fetchAuthority(
  client: VerifactuClient,
  cabecera: Cabecera,
  period: { year: string; month: string },
  rows: readonly PeriodRow[],
  compareContents: boolean,
  signal?: AbortSignal,
): Promise<{
  authority: Map<string, Reported>;
  conflicts: Map<string, LookupConflictEvidence>;
  unknown: Set<string>;
  observed: RegistroConsultado[];
}> {
  const expected = new Map(rows.map((row) => [row.id, row]));
  const authority = new Map<string, Reported>();
  const visited = new Set<string>();
  const observed: RegistroConsultado[] = [];
  const records = new Map<string, RegistroConsultado[]>();
  let clave: ConsultaFiltro["ClavePaginacion"];
  do {
    signal?.throwIfAborted();
    const resp = await client.consultar(cabecera, {
      Ejercicio: period.year,
      Periodo: period.month,
      ClavePaginacion: clave,
      ...(compareContents
        ? { DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" as const } }
        : {}),
    });
    signal?.throwIfAborted();
    for (const r of resp.registros) {
      if (compareContents) {
        const date = r.IDFactura.FechaExpedicionFactura;
        if (
          !/^\d{2}-\d{2}-\d{4}$/.test(date) ||
          date.slice(6) !== period.year ||
          date.slice(3, 5) !== period.month
        )
          throw new Error("consulta returned an invoice outside the requested period");
        observed.push(r);
        const key = JSON.stringify([r.IDFactura.IDEmisorFactura, r.IDFactura.NumSerieFactura]);
        const group = records.get(key) ?? [];
        group.push(r);
        records.set(key, group);
      }
      const ref = (r.DatosRegistroFacturacion as { RefExterna?: string }).RefExterna;
      if (ref !== undefined) {
        const row = expected.get(ref);
        if (
          row !== undefined &&
          (r.IDFactura.IDEmisorFactura !== row.id_emisor_factura ||
            r.IDFactura.NumSerieFactura !== row.num_serie_factura ||
            r.IDFactura.FechaExpedicionFactura !== row.fecha_expedicion_factura)
        ) {
          throw new Error("consulta identity does not match stored record");
        }
        authority.set(ref, {
          estado: r.EstadoRegistro,
          codigo: r.CodigoErrorRegistro ?? null,
          mensaje: r.DescripcionErrorRegistro ?? null,
        });
      }
    }
    if (resp.IndicadorPaginacion === "S") {
      if (resp.ClavePaginacion === undefined) {
        throw new Error("consulta returned IndicadorPaginacion=S without a ClavePaginacion");
      }
      const key = JSON.stringify([
        resp.ClavePaginacion.IDEmisorFactura,
        resp.ClavePaginacion.NumSerieFactura,
        resp.ClavePaginacion.FechaExpedicionFactura,
      ]);
      if (visited.has(key)) {
        throw new Error("consulta repeated a ClavePaginacion");
      }
      visited.add(key);
      clave = resp.ClavePaginacion;
    } else {
      clave = undefined;
    }
  } while (clave !== undefined);
  const conflicts = new Map<string, LookupConflictEvidence>();
  const unknown = new Set<string>();
  if (compareContents) {
    for (const row of rows) {
      const key = JSON.stringify([row.id_emisor_factura, row.num_serie_factura]);
      for (const record of records.get(key) ?? []) {
        // A still-live invoice reports its alta, not an unfiled cancellation of that invoice.
        if (row.tipo_registro === "anulacion" && record.EstadoRegistro !== "Anulado") continue;
        const data = record.DatosRegistroFacturacion;
        const system = lookupSystem(data.SistemaInformatico);
        const local = JSON.parse(row.sistema_informatico) as Record<string, unknown>;
        const reportedHuella =
          typeof data.Huella === "string" && data.Huella.length > 0 ? data.Huella : null;
        const reportedInstallation = system?.installation ?? null;
        // Matched separately: a cancelled invoice's lookup carries the cancellation's fingerprint
        // (docs/compliance/verifactu-findings.md §19); which installation it names is unmeasured.
        const stored = JSON.parse(row.known_records) as [string, unknown][];
        const known =
          (reportedHuella === null || stored.some(([huella]) => huella === reportedHuella)) &&
          (reportedInstallation === null ||
            stored.some(([, installation]) => installation === reportedInstallation));
        const externalCancellation =
          record.EstadoRegistro === "Anulado" &&
          row.tipo_registro === "alta" &&
          row.anulacion_id === null;
        const different =
          record.IDFactura.FechaExpedicionFactura !== row.fecha_expedicion_factura ||
          (!externalCancellation &&
            (!known ||
              (system !== null &&
                ((system.taxId !== null && system.taxId !== local.NIF) ||
                  (system.softwareId !== null &&
                    system.softwareId !== local.IdSistemaInformatico)))));
        if (different) {
          conflicts.set(row.id, {
            source: "consulta",
            invoice: record.IDFactura,
            reference: typeof data.RefExterna === "string" ? data.RefExterna : null,
            state: record.EstadoRegistro,
            fingerprint: typeof data.Huella === "string" ? data.Huella : null,
            system,
          });
        } else if (
          typeof data.Huella !== "string" ||
          data.Huella.length === 0 ||
          (record.EstadoRegistro !== "Anulado" && data.Huella !== row.huella) ||
          system === null ||
          Object.values(system).some((value) => value === null)
        ) {
          unknown.add(row.id);
        } else {
          authority.set(row.id, {
            estado: record.EstadoRegistro,
            codigo: record.CodigoErrorRegistro ?? null,
            mensaje: record.DescripcionErrorRegistro ?? null,
          });
        }
      }
    }
  }
  return { authority, conflicts, unknown, observed };
}

function mismatchOf(row: PeriodRow, reported: EstadoRegistroConsulta | null): ReconcileMismatch {
  return { recordId: row.id, localState: row.estado, reportedState: reported };
}

/**
 * Corrects one mismatch's local estado toward what AEAT reports, then writes the ack the lost
 * response would have produced, on the same transaction so the ack reflects the estado this commit
 * writes. No-ops for a state `CORRECTION` does not map. A record corrected to
 * `aceptado_con_errores` gets the drainer's case for it, with the error AEAT reports, and, on the
 * lost-acknowledgement path, the drainer's `fiscal.aceptado_con_errores` warning; on the drift
 * path the sweep has already raised `fiscal.reconcile_drift_errores` for it.
 *
 * A targeted `update` rather than the drainer's `setEstado`, which requires a csv: a consulta never
 * returns one, so `csv` keeps whatever the row already held.
 */
async function correct(
  tx: Transaction,
  row: PeriodRow,
  reported: Reported,
  now: Date,
  { lostAck, result }: { lostAck: boolean; result: ReconcileResult },
): Promise<void> {
  const target = CORRECTION[reported.estado];
  if (target === undefined) return; // Anulado / no clean local estado — incident-only.
  await tx.execute(sql`
    update envios set estado = ${target}, confirmado_en = ${now.toISOString()}
    where registro_id = ${row.id}
  `);
  await writeAck(tx, row.id, now);
  if (target === "aceptado_con_errores") {
    if (lostAck) {
      await recordIncident(tx, {
        origin: jobOrigin("fiscal_filing"),
        saleId: row.sale_id as SaleId,
        error: new AppError("fiscal.aceptado_con_errores", {
          registroId: row.id,
          codigo: reported.codigo,
          mensaje: reported.mensaje,
        }),
        severity: "warning",
        detectedAt: now,
      });
      result.incidentsRaised += 1;
    }
    await openAcceptedWithErrorsCase(tx, {
      registroId: row.id,
      codigo: reported.codigo,
      mensaje: reported.mensaje,
      csv: row.csv,
      now,
    });
  }
}

/** First-detection `noTrace` remediation: reset to `pendiente` so the drainer re-submits it (safe:
 * a resubmission AEAT already holds comes back as error 3000), stamping `reconciled_resubmit_at` so a
 * later sweep can tell this from a first detection. A `pendiente` row carries no ack. */
async function remediateNoTrace(tx: Transaction, row: PeriodRow, now: Date): Promise<void> {
  await tx.execute(sql`
    update envios set
      estado = 'pendiente',
      csv = null,
      confirmado_en = null,
      codigo_error = null,
      mensaje_error = null,
      proximo_intento_en = ${now.toISOString()},
      reconciled_resubmit_at = ${now.toISOString()}
    where registro_id = ${row.id}
  `);
  await deleteAck(tx, row.id);
}

async function clearReconciledMarker(tx: Transaction, row: PeriodRow): Promise<void> {
  await tx.execute(sql`
    update envios set reconciled_resubmit_at = null
    where registro_id = ${row.id}
  `);
}

/** On the sweep's own transaction: an incident must never commit while the sweep it describes
 * rolls back. */
async function raise(
  tx: Transaction,
  row: PeriodRow,
  severity: IncidentSeverity,
  code:
    | "fiscal.reconcile_no_trace"
    | "fiscal.reconcile_drift_errores"
    | "fiscal.reconcile_drift_anulada"
    | "fiscal.huella_divergente",
  detectedAt: Date,
): Promise<void> {
  await recordIncident(tx, {
    origin: jobOrigin("fiscal_filing"),
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

/** Not period-scoped: an anulación's expedition date may differ from its alta's. */
async function hasSiblingAnulacion(tx: Transaction, row: PeriodRow): Promise<boolean> {
  const { rows } = await tx.execute<{ one: number }>(sql`
    select 1 as one from registros_facturacion
    where sale_id = ${row.sale_id} and tipo_registro = 'anulacion'
    limit 1
  `);
  return rows.length > 0;
}

/** `raise`, but idempotent per open `(code, sale)`, for the incidents a sweep re-detects while
 * still open. Returns whether a new incident was inserted. */
async function raiseOnce(
  tx: Transaction,
  row: PeriodRow,
  severity: IncidentSeverity,
  code: "fiscal.reconcile_no_trace" | "fiscal.reconcile_drift_anulada" | "fiscal.huella_divergente",
  detectedAt: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    origin: jobOrigin("fiscal_filing"),
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
