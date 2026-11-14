import "./errors.js";
import { and, asc, count, desc, inArray, isNull, sql } from "drizzle-orm";
import { incidents, type Transaction } from "@waitron/db";
import type { ErrorParams } from "@waitron/shared";
import type {
  FilingWarnings,
  RecordWarningView,
  ReplyMismatchView,
  WarnedRecordView,
} from "./filing-overview-types.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";

const REPLY = "fiscal.respuesta_descuadrada";
const TOTALS = "fiscal.record_totals_disagree";
const FLAGGED = "fiscal.record_flagged";
const CODES = [REPLY, TOTALS, FLAGGED];

const open = and(inArray(incidents.code, CODES), isNull(incidents.acknowledgedAt));

/**
 * The open alerts of the three codes, newest first, at most `limit` (null: every one), with the
 * records each names, by three queries in the caller's transaction whatever the number listed.
 */
export async function readFilingWarnings(
  tx: Transaction,
  scope: { limit: number | null },
): Promise<FilingWarnings> {
  const ordered = tx
    .select({
      id: incidents.id,
      code: incidents.code,
      params: incidents.params,
      detectedAt: incidents.detectedAt,
      saleId: incidents.saleId,
    })
    .from(incidents)
    .where(open)
    .orderBy(desc(incidents.detectedAt), asc(incidents.id));
  const listedQuery = scope.limit === null ? ordered : ordered.limit(scope.limit);
  const listed = await listedQuery;
  const [counted] = await tx.select({ n: count() }).from(incidents).where(open);

  // `listed` is the query above again, not its ids bound one by one, whose number grows with the
  // data. A reply's records come from its `registroIds` in the order sent; a validation warning's
  // candidates are every record of its sale. Each `cross join` keeps the listed alerts as the outer
  // loop, so `registros_facturacion` is searched by its indexes rather than scanned: a box gathers
  // no planner statistics, and without them SQLite chose to scan it. The sale lookup also names
  // its index.
  const candidates = await tx.execute<{
    incident_id: string;
    position: number | null;
    num_serie_factura: string;
    fecha_expedicion_factura: string;
    tipo_registro: string;
    generated: string;
    estado: string | null;
  }>(sql`
    with listed as materialized (select * from ${listedQuery}),
    named as materialized (
      select l.id as incident_id, j.value as registro_id, j.key as position
      from listed l, json_each(l.params, '$.registroIds') j
      where l.code = ${REPLY}
      union all
      select l.id, r.id, null
      from listed l cross join ${registrosFacturacion} r indexed by registros_sale_idx
        on r.sale_id = l.sale_id
      where l.code <> ${REPLY}
    )
    select n.incident_id, n.position, r.num_serie_factura, r.fecha_expedicion_factura,
      r.tipo_registro, r.fecha_hora_huso_gen_registro as generated, e.estado
    from named n
    cross join ${registrosFacturacion} r on r.id = n.registro_id
    left join ${envios} e on e.registro_id = r.id
    order by n.incident_id, n.position
  `);
  const byIncident = new Map<string, typeof candidates.rows>();
  for (const row of candidates.rows) {
    const own = byIncident.get(row.incident_id);
    if (own === undefined) byIncident.set(row.incident_id, [row]);
    else own.push(row);
  }

  const replyMismatches: ReplyMismatchView[] = [];
  const recordWarnings: RecordWarningView[] = [];
  for (const incident of listed) {
    const detectedAt = new Date(incident.detectedAt);
    const records = byIncident.get(incident.id) ?? [];
    if (incident.code === REPLY) {
      const params = incident.params as Partial<ErrorParams[typeof REPLY]>;
      replyMismatches.push({
        detectedAt: detectedAt.toISOString(),
        csv: typeof params.csv === "string" ? params.csv : null,
        sent: records.map(recordView),
        lines: listOf(params.lineasRespuesta).map((line) => ({
          numSerieFactura: line.numSerieFactura,
          fechaExpedicionFactura: line.fechaExpedicionFactura,
          tipoOperacion: line.tipoOperacion,
          estado: line.estado,
          codigo: line.codigo,
          mensaje: line.mensaje,
        })),
      });
    } else {
      const params = incident.params as Partial<ErrorParams[typeof FLAGGED]>;
      // The stored generation time keeps whole seconds; the incident keeps the instant.
      const second = Math.floor(detectedAt.getTime() / 1000);
      const matches = records.filter(
        (row) => Math.floor(Date.parse(row.generated) / 1000) === second,
      );
      recordWarnings.push({
        detectedAt: detectedAt.toISOString(),
        kind: incident.code === TOTALS ? "totals" : "flagged",
        fields: listOf(params.fields),
        codes: listOf(params.codes),
        record: matches.length === 1 ? recordView(matches[0]!) : null,
      });
    }
  }
  return { replyMismatches, recordWarnings, total: counted!.n };
}

/** A stored alert's params are not checked when read back; a list that is missing or is not a
 * list reads as empty. Its items are not checked. */
function listOf<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? [...value] : [];
}

function recordView(row: {
  num_serie_factura: string;
  fecha_expedicion_factura: string;
  tipo_registro: string;
  estado: string | null;
}): WarnedRecordView {
  return {
    numSerieFactura: row.num_serie_factura,
    fechaExpedicionFactura: row.fecha_expedicion_factura,
    tipoRegistro: row.tipo_registro,
    estado: row.estado,
  };
}
