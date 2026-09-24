import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { recordIncident, recordIncidentOnce } from "@waitron/core";
import type { IncidentSeverity } from "@waitron/core";
import { AppError } from "@waitron/shared";
import type { SaleId, TillId } from "@waitron/shared";
import type { ReconcileMismatch, ReconcileResult, TrustedClock } from "@waitron/fiscal";
import type {
  Cabecera,
  ConsultaFiltro,
  EstadoRegistroConsulta,
  VerifactuClient,
} from "@waitron/verifactu";
import { deleteAck, writeAck } from "./acks.js";
import { toAeatDate } from "./registro-row.js";

export interface ReconcileDeps {
  db: Database;
  /**
   * A function, not a resolved client: the real resolver decrypts a certificate, and `reconcile`
   * calls it only once it knows the period holds at least one row, so a period with nothing to
   * reconcile never has a certificate decrypted.
   */
  resolveClient: () => Promise<VerifactuClient>;
  clock: TrustedClock;
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
  till_id: string;
  sale_id: string;
  estado: string;
  reconciled_resubmit_at: string | null;
  id_emisor_factura: string;
  nombre_razon_emisor: string;
  num_serie_factura: string;
  fecha_expedicion_factura: string;
};

/** `envios.estado` values we read as "still awaiting acknowledgement". */
const PENDIENTE = new Set(["pendiente", "enviando"]);
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
  AceptadaConErrores: { severity: "warning", code: "fiscal.reconcile_drift_errores" },
  Anulada: { severity: "error", code: "fiscal.reconcile_drift_anulada" },
};

/**
 * Called only when `reported` is `AceptadaConErrores` or `Anulada`. `Anulada` never agrees with an
 * accepted local estado. `AceptadaConErrores` agrees with a local `aceptado_con_errores`: without
 * that, the row this sweep corrects would be re-classified as drift on every later sweep.
 */
function isDrift(localEstado: string, reported: EstadoRegistroConsulta): boolean {
  return reported !== "AceptadaConErrores" || localEstado === "aceptado";
}

/**
 * The local `envios.estado` a mismatch is corrected to, keyed only by what AEAT reports. `Anulada`
 * is deliberately absent: there is no local estado for it, so it is never corrected.
 */
const CORRECTION: Partial<Record<EstadoRegistroConsulta, "aceptado" | "aceptado_con_errores">> = {
  Correcta: "aceptado",
  AceptadaConErrores: "aceptado_con_errores",
};

/**
 * Audits one calendar period against what AEAT reports for it, classifying every disagreement into
 * `lostAck`/`noTrace`/`drift`. The returned lists are the audit finding and always include a
 * mismatch this sweep also corrects. Where AEAT's state maps to a local estado (`CORRECTION`), the
 * sweep also corrects ours and writes the ack the lost response would have, in the same
 * transaction as the classification.
 *
 * The consulta runs OUTSIDE any transaction, between a short read (T1) and a short write (T2), so
 * no transaction is held across the network round trip.
 *
 * Diff on `EstadoRegistro`, not presence (design §4.3), because the response is paged and a
 * record may not be on a page yet:
 *
 *   - a `pendiente`/`enviando` record ABSENT from AEAT is in flight, so it is NEVER `noTrace`;
 *   - a `pendiente`/`enviando` record PRESENT at AEAT is `lostAck`;
 *   - an accepted record ABSENT from AEAT is `noTrace`;
 *   - an accepted record whose AEAT state disagrees with ours is `drift` (see `isDrift`).
 *
 * Deliberately does NOT reuse the drainer's `resolveEstadoEfectivo` (design §5): a consulta can
 * report `Anulada` and never reports a rejected record, and a submission response is the mirror
 * image.
 */
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

  // T1
  const rows = await withTransaction(deps.db, (tx) => rowsForPeriod(tx, normalizedPeriod));
  result.checked = rows.length;
  // Nothing to reconcile: no consulta, and no certificate resolved.
  if (rows.length === 0) return result;

  const client = await deps.resolveClient();

  // All rows share one obligado (one database, one taxpayer), so any row builds the cabecera.
  const authority = await fetchAuthority(client, cabeceraFor(rows[0]!), normalizedPeriod);

  // T2
  const detectedAt = deps.clock.now().instant;
  await withTransaction(deps.db, async (tx) => {
    for (const row of rows) {
      const reported = authority.get(row.id) ?? null;

      if (PENDIENTE.has(row.estado)) {
        if (reported !== null) {
          result.lostAck.push(mismatchOf(row, reported));
          await correct(tx, row, reported, detectedAt);
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
        if (reported === "Anulada" && (await hasSiblingAnulacion(tx, row))) {
          // The expected state of a voided sale: AEAT marks the alta Anulada once it accepts the
          // anulación we submitted, while the alta's own envío stays `aceptado`. We hold the local
          // anulación, so this is agreement, not drift — no entry, no incident, no correction.
          continue;
        }
        result.drift.push(mismatchOf(row, reported));
        if (reported === "Anulada") {
          // No local anulación. Idempotent, since a persistent Anulada is re-detected every sweep.
          if (
            await raiseOnce(tx, row, drift.severity, "fiscal.reconcile_drift_anulada", detectedAt)
          ) {
            result.incidentsRaised += 1;
          }
        } else {
          // drift-AceptadaConErrores: converges (isDrift makes it agree after correction), so it is
          // raised at most once per genuine clean→errors transition — the unconditional `raise`.
          await raise(tx, row, drift.severity, drift.code, detectedAt);
          result.incidentsRaised += 1;
          await correct(tx, row, reported, detectedAt);
        }
      }
      // Clean agreement, nothing to do (the drainer already acked it — never re-ack a record that
      // was not a mismatch): `reported === "Correcta"` on a local `aceptado` row, OR
      // `reported === "AceptadaConErrores"` on a local `aceptado_con_errores` row (see `isDrift`).
    }
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
): Promise<PeriodRow[]> {
  const { rows } = await tx.execute<PeriodRow>(sql`
    select
      r.id, r.till_id, r.sale_id,
      e.estado, e.reconciled_resubmit_at,
      r.id_emisor_factura, r.nombre_razon_emisor, r.num_serie_factura,
      r.fecha_expedicion_factura
    from envios e
    join registros_facturacion r on r.id = e.registro_id
    where substr(r.fecha_expedicion_factura, 1, 7) = ${`${period.year}-${period.month}`}
  `);
  return rows.map((row) => ({
    ...row,
    fecha_expedicion_factura: toAeatDate(row.fecha_expedicion_factura),
  }));
}

function cabeceraFor(row: PeriodRow): Cabecera {
  return { ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura } };
}

/**
 * Pages the whole period consulta into `RefExterna → EstadoRegistro`. A record with no `RefExterna`
 * is one we cannot attribute to any of our registros (e.g. filed for this obligado by another
 * software system), so it is skipped.
 *
 * Throws on "more pages" without a `ClavePaginacion` rather than stopping: an under-paged map would
 * make records on the unreached pages read as absent and raise false `noTrace` incidents.
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
 * Corrects one mismatch's local estado toward what AEAT reports, then writes the ack the lost
 * response would have produced, on the same transaction so the ack reflects the estado this commit
 * writes. No-ops for a state `CORRECTION` does not map.
 *
 * A targeted `update` rather than the drainer's `setEstado`, which requires a csv: a consulta never
 * returns one, so `csv` keeps whatever the row already held.
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
    where registro_id = ${row.id}
  `);
  await writeAck(tx, row.id, now);
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
    | "fiscal.reconcile_drift_anulada",
  detectedAt: Date,
): Promise<void> {
  await recordIncident(tx, {
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

/** Not period-scoped: an anulación's expedition date may differ from its alta's. */
async function hasSiblingAnulacion(tx: Transaction, row: PeriodRow): Promise<boolean> {
  const { rows } = await tx.execute<{ one: number }>(sql`
    select 1 as one from registros_facturacion
    where sale_id = ${row.sale_id} and tipo_registro = 'anulacion'
    limit 1
  `);
  return rows.length > 0;
}

/** `raise`, but idempotent per open `(till, code, sale)`, for the incidents a sweep re-detects while
 * still open. Returns whether a new incident was inserted. */
async function raiseOnce(
  tx: Transaction,
  row: PeriodRow,
  severity: IncidentSeverity,
  code: "fiscal.reconcile_no_trace" | "fiscal.reconcile_drift_anulada",
  detectedAt: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
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
