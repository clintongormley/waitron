import { and, count, eq, inArray, min } from "drizzle-orm";
import type { AlertSource, OngoingAlert } from "@waitron/module";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import "./errors.js";

// A fiscal record's clock starts when it is generated; the count and the age come from the oldest
// record still waiting to reach AEAT, so a growing backlog surfaces as one alert, not one per record.
export const SUBMISSION_DELAYED_WARN_MS = 4 * 60 * 60 * 1000;
export const SUBMISSION_DELAYED_ERROR_MS = 24 * 60 * 60 * 1000;

/**
 * The fiscal-submission ongoing check. Warns when records have waited past
 * {@link SUBMISSION_DELAYED_WARN_MS} to reach AEAT (a stronger alert past
 * {@link SUBMISSION_DELAYED_ERROR_MS}), and reports when submission has stopped (`detenido`). The
 * module contributes it through its alerts seat so generic code never names the fiscal tables.
 */
export const fiscalSubmissionSource: AlertSource = {
  area: "fiscal",
  permission: "fiscal.view",
  async read({ tx, tenantId, now }): Promise<readonly OngoingAlert[]> {
    const alerts: OngoingAlert[] = [];

    const [waiting] = await tx
      .select({ oldest: min(registrosFacturacion.fechaHoraHusoGenRegistro), n: count() })
      .from(envios)
      .innerJoin(registrosFacturacion, eq(registrosFacturacion.id, envios.registroId))
      .where(and(eq(envios.tenantId, tenantId), inArray(envios.estado, ["pendiente", "enviando"])));
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
      .where(and(eq(envios.tenantId, tenantId), eq(envios.estado, "detenido")));
    if (stopped && Number(stopped.n) > 0) {
      // count > 0 means the innerJoin matched a registro, and fechaHoraHusoGenRegistro is notNull,
      // so `oldest` is always present here — no `: null` arm (it would be an uncovered branch, and
      // fiscal-verifactu holds the 98% branch bar).
      alerts.push({
        key: "fiscal.submission_stopped",
        code: "fiscal.submission_stopped",
        params: { count: Number(stopped.n) },
        severity: "error",
        since: new Date(stopped.oldest!).toISOString(),
      });
    }
    return alerts;
  },
};
