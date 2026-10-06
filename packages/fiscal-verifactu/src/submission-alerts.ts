import { count, eq, inArray, min, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { AlertSource, OngoingAlert } from "@waitron/module";
import { SAME_CODE_REFUSAL_LIMIT } from "./drain.js";
import { envios } from "./schema/envios.js";
import { openFilingCasesSummary } from "./filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";
import "./errors.js";

// A fiscal record's clock starts when it is generated; the count and the age come from the oldest
// record still waiting to reach AEAT, so a growing backlog surfaces as one alert, not one per record.
export const SUBMISSION_DELAYED_WARN_MS = 4 * 60 * 60 * 1000;
export const SUBMISSION_DELAYED_ERROR_MS = 24 * 60 * 60 * 1000;

/**
 * The fiscal-submission ongoing check. Warns when records have waited past
 * {@link SUBMISSION_DELAYED_WARN_MS} to reach AEAT (a stronger alert past
 * {@link SUBMISSION_DELAYED_ERROR_MS}), reports when submission has stopped (`detenido`), reports
 * the filing cases no one has resolved yet, and reports each chain held after a run of refusals
 * with one code (`refusalsRepeated`). A rejected record is not `detenido`, so only the case alert
 * counts it. The module contributes this check through its alerts seat so generic code never
 * names the fiscal tables.
 */
export const fiscalSubmissionSource: AlertSource = {
  area: "fiscal",
  permission: "fiscal.view",
  async read({ tx, now }): Promise<readonly OngoingAlert[]> {
    const alerts: OngoingAlert[] = [];

    const [waiting] = await tx
      .select({ oldest: min(registrosFacturacion.fechaHoraHusoGenRegistro), n: count() })
      .from(envios)
      .innerJoin(registrosFacturacion, eq(registrosFacturacion.id, envios.registroId))
      .where(inArray(envios.estado, ["pendiente", "enviando"]));
    if (waiting?.oldest) {
      const ageMs = now.getTime() - new Date(waiting.oldest).getTime();
      if (ageMs >= SUBMISSION_DELAYED_WARN_MS) {
        alerts.push({
          key: "fiscal.submission_delayed",
          code: "fiscal.submission_delayed",
          params: { count: Number(waiting.n), hours: Math.floor(ageMs / 3_600_000) },
          severity: ageMs >= SUBMISSION_DELAYED_ERROR_MS ? "error" : "warning",
          since: new Date(waiting.oldest).toISOString(),
        });
      }
    }

    const [stopped] = await tx
      .select({ n: count(), oldest: min(registrosFacturacion.fechaHoraHusoGenRegistro) })
      .from(envios)
      .innerJoin(registrosFacturacion, eq(registrosFacturacion.id, envios.registroId))
      .where(eq(envios.estado, "detenido"));
    if (stopped && Number(stopped.n) > 0) {
      // count > 0 means the join matched a registro, whose `fechaHoraHusoGenRegistro` is not null.
      alerts.push({
        key: "fiscal.submission_stopped",
        code: "fiscal.submission_stopped",
        params: { count: Number(stopped.n) },
        severity: "error",
        since: new Date(stopped.oldest!).toISOString(),
      });
    }

    const open = await openFilingCasesSummary(tx);
    if (open !== null) {
      alerts.push({
        key: "fiscal.filing_cases_open",
        code: "fiscal.filing_cases_open",
        params: { count: open.count },
        severity: "error",
        since: open.oldestOpenedAt.toISOString(),
      });
    }
    alerts.push(...(await refusalsRepeated(tx)));
    return alerts;
  },
};

/**
 * One alert per chain whose earliest `detenido` record has no case of its own and follows at least
 * `SAME_CODE_REFUSAL_LIMIT` `rechazado` records with one code: the hold `haltOpenChainClaims`
 * (./drain.ts) puts on a run of refusals. `count` is the whole run, which one envío can make
 * longer than the limit.
 *
 * Each walk back names the chain's node, so `registros_node_secuencia_idx` serves it, and the
 * `materialized` steps compute each chain's walks once rather than once per reference. A run with
 * nothing before it is counted from 0: `registros_secuencia_ck` keeps every position above it.
 */
async function refusalsRepeated(tx: Transaction): Promise<OngoingAlert[]> {
  const { rows } = await tx.execute<{
    sif_id: string;
    codigo: string;
    opened_at: string;
    run_length: number;
  }>(sql`
    with detenidos as (
      select r.id, r.node_id, r.sif_id, r.secuencia,
        row_number() over (partition by r.sif_id order by r.secuencia) as position
      from envios e
      join registros_facturacion r on r.id = e.registro_id
      where e.estado = 'detenido'
    ),
    held as materialized (
      select h.node_id, h.sif_id, h.secuencia, (
        select preceding.id from registros_facturacion preceding
        where preceding.node_id = h.node_id and preceding.sif_id = h.sif_id
          and preceding.secuencia < h.secuencia
        order by preceding.secuencia desc
        limit 1
      ) as last_id
      from detenidos h
      where h.position = 1
        and not exists (select 1 from filing_cases own where own.registro_id = h.id)
    ),
    runs as materialized (
      select held.node_id, held.sif_id, held.secuencia, last_envio.codigo_error as codigo,
        last_case.opened_at, (
          select preceding.secuencia from registros_facturacion preceding
          left join envios preceding_envio on preceding_envio.registro_id = preceding.id
          where preceding.node_id = held.node_id and preceding.sif_id = held.sif_id
            and preceding.secuencia < held.secuencia
            and (preceding_envio.estado is not 'rechazado'
              or preceding_envio.codigo_error is not last_envio.codigo_error)
          order by preceding.secuencia desc
          limit 1
        ) as break_secuencia
      from held
      join envios last_envio on last_envio.registro_id = held.last_id
      join filing_cases last_case on last_case.registro_id = held.last_id
      where last_envio.estado = 'rechazado' and last_envio.codigo_error is not null
    )
    select sif_id, codigo, opened_at, (
      select count(*) from registros_facturacion preceding
      where preceding.node_id = runs.node_id and preceding.sif_id = runs.sif_id
        and preceding.secuencia < runs.secuencia
        and preceding.secuencia > coalesce(runs.break_secuencia, 0)
    ) as run_length
    from runs
  `);
  return rows
    .filter((row) => Number(row.run_length) >= SAME_CODE_REFUSAL_LIMIT)
    .map((row) => ({
      key: `fiscal.refusals_repeated:${row.sif_id}`,
      code: "fiscal.refusals_repeated",
      params: { codigo: row.codigo, count: Number(row.run_length) },
      severity: "error",
      since: new Date(row.opened_at).toISOString(),
    }));
}
