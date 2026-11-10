import { asc, count, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readActiveConflicts } from "./conflict-evidence.js";
import type {
  ActiveConflictEvidence,
  ConflictComparison,
  ConflictEvidence,
  LookupConflictEvidence,
} from "./conflict-types.js";
import { heldRecords, openCaseRecordIds, openFilingCases } from "./filing-cases.js";
import type {
  ComparisonView,
  FilingOverview,
  FilingProgress,
  InvoiceIdView,
  LookupEvidenceView,
  ReplyEvidenceView,
  SystemView,
} from "./filing-overview-types.js";
import { ENVIO_STATES, type EnvioState } from "./handover-summary.js";
import { fiscalConflictEvidence } from "./schema/conflict-evidence.js";
import { envios } from "./schema/envios.js";
import { fiscalLookupConflicts } from "./schema/lookup-conflicts.js";
import { registrosFacturacion } from "./schema/registros.js";

/**
 * What the Fiscal filing screen shows, read in the caller's one transaction by a fixed number of
 * queries whatever the number of cases. `limit` bounds the case list (null: every open case).
 * Every object is built from named fields: a stored row or reply is never copied whole, so a
 * recipient or an AEAT request reference cannot reach the answer.
 */
export async function readFilingOverview(
  tx: Transaction,
  scope: { nodeId: string | null; limit: number | null },
): Promise<FilingOverview> {
  const readAt = new Date().toISOString();
  const progress = await readProgress(tx);
  const { cases, total } = await openFilingCases(tx, scope.limit);
  const listed = openCaseRecordIds(tx, scope.limit);
  const conflictRows = await tx
    .select({
      registroId: fiscalConflictEvidence.registroId,
      attempt: fiscalConflictEvidence.attempt,
      cause: fiscalConflictEvidence.cause,
      recordedAt: fiscalConflictEvidence.recordedAt,
      evidence: fiscalConflictEvidence.evidence,
    })
    .from(fiscalConflictEvidence)
    .where(inArray(fiscalConflictEvidence.registroId, listed))
    .orderBy(asc(fiscalConflictEvidence.attempt), sql`${fiscalConflictEvidence}.rowid`);
  const lookupRows = await tx
    .select({
      registroId: fiscalLookupConflicts.registroId,
      recordedAt: fiscalLookupConflicts.recordedAt,
      evidence: fiscalLookupConflicts.evidence,
    })
    .from(fiscalLookupConflicts)
    .where(inArray(fiscalLookupConflicts.registroId, listed))
    .orderBy(sql`${fiscalLookupConflicts}.rowid`);
  const held = await heldRecords(tx);
  const active = scope.nodeId === null ? [] : await readActiveConflicts(tx, scope.nodeId);

  const heldByCase = new Map<string, number>();
  let heldWithoutCase = 0;
  for (const { caseId } of held) {
    if (caseId === null) heldWithoutCase += 1;
    else heldByCase.set(caseId, (heldByCase.get(caseId) ?? 0) + 1);
  }
  const conflictsByRecord = groupBy(conflictRows, (row) => row.registroId);
  const lookupsByRecord = groupBy(lookupRows, (row) => row.registroId);

  return {
    readAt,
    progress,
    cases: cases.map((found) => ({
      registroId: found.registroId,
      cause: found.cause,
      openedAt: found.openedAt.toISOString(),
      evidence: {
        codigo: found.evidence.codigo,
        mensaje: found.evidence.mensaje,
        csv: found.evidence.csv,
      },
      record: {
        tipoRegistro: found.record.tipoRegistro,
        idEmisorFactura: found.record.idEmisorFactura,
        numSerieFactura: found.record.numSerieFactura,
        fechaExpedicionFactura: found.record.fechaExpedicionFactura,
        tipoFactura: found.record.tipoFactura,
        importeTotal: found.record.importeTotal,
        cuotaTotal: found.record.cuotaTotal,
        huella: found.record.huella,
        anteriorHuella: found.record.anteriorHuella,
        fechaHoraHusoGenRegistro: found.record.fechaHoraHusoGenRegistro.toISOString(),
        numeroInstalacion: found.record.numeroInstalacion,
      },
      submission:
        found.submission === null
          ? null
          : {
              estado: found.submission.estado,
              codigoError: found.submission.codigoError,
              mensajeError: found.submission.mensajeError,
              enviadoEn: found.submission.enviadoEn?.toISOString() ?? null,
            },
      conflicts: (conflictsByRecord.get(found.registroId) ?? []).map((row) => ({
        attempt: row.attempt,
        cause: row.cause,
        recordedAt: row.recordedAt.toISOString(),
        ...replyEvidence(row.evidence),
      })),
      lookups: (lookupsByRecord.get(found.registroId) ?? []).map((row) => ({
        recordedAt: row.recordedAt.toISOString(),
        ...lookupEvidence(row.evidence),
      })),
      heldBehind: heldByCase.get(found.caseId) ?? 0,
    })),
    totalCases: total,
    heldWithoutCase,
    activeConflicts: active.map((conflict) => ({
      invoiceNumber: conflict.invoiceIdentity,
      installationName: conflict.installationIdentity,
      cause: conflict.cause,
      observedAt: conflict.observedAt,
      evidence: activeEvidence(conflict.evidence),
    })),
  };
}

async function readProgress(tx: Transaction): Promise<FilingProgress> {
  const groups = await tx
    .select({
      estado: envios.estado,
      n: count(),
      oldestGenerated: sql<string | null>`min(${registrosFacturacion.fechaHoraHusoGenRegistro})`,
      latestConfirmed: sql<string | null>`max(${envios.confirmadoEn})`,
    })
    .from(envios)
    .innerJoin(registrosFacturacion, eq(registrosFacturacion.id, envios.registroId))
    .groupBy(envios.estado);
  const counts = Object.fromEntries(ENVIO_STATES.map((state) => [state, 0])) as Record<
    EnvioState,
    number
  >;
  let oldestWaiting: string | null = null;
  let lastConfirmed: string | null = null;
  for (const group of groups) {
    counts[group.estado as EnvioState] = group.n;
    if (
      (group.estado === "pendiente" || group.estado === "enviando") &&
      group.oldestGenerated !== null &&
      (oldestWaiting === null || group.oldestGenerated < oldestWaiting)
    )
      oldestWaiting = group.oldestGenerated;
    if (
      group.latestConfirmed !== null &&
      (lastConfirmed === null || group.latestConfirmed > lastConfirmed)
    )
      lastConfirmed = group.latestConfirmed;
  }
  return {
    counts,
    oldestWaitingGeneratedAt: oldestWaiting === null ? null : new Date(oldestWaiting).toISOString(),
    lastConfirmedAt: lastConfirmed === null ? null : new Date(lastConfirmed).toISOString(),
  };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const own = grouped.get(key(row));
    if (own === undefined) grouped.set(key(row), [row]);
    else own.push(row);
  }
  return grouped;
}

function invoiceId(invoice: InvoiceIdView): InvoiceIdView {
  return {
    IDEmisorFactura: invoice.IDEmisorFactura,
    NumSerieFactura: invoice.NumSerieFactura,
    FechaExpedicionFactura: invoice.FechaExpedicionFactura,
  };
}

function systemOf(system: SystemView | null): SystemView | null {
  return system === null
    ? null
    : { taxId: system.taxId, softwareId: system.softwareId, installation: system.installation };
}

function comparisonOf(comparison: ConflictComparison): ComparisonView {
  return comparison.kind === "lookup-mismatch"
    ? {
        kind: comparison.kind,
        storedFingerprint: comparison.storedFingerprint,
        storedSystem: systemOf(comparison.storedSystem),
      }
    : { kind: comparison.kind, storedFingerprint: null, storedSystem: null };
}

function replyEvidence(evidence: ConflictEvidence): ReplyEvidenceView {
  const { line } = evidence;
  const duplicate = line.RegistroDuplicado;
  return {
    line: {
      IDFactura: invoiceId(line.IDFactura),
      EstadoRegistro: line.EstadoRegistro ?? null,
      CodigoErrorRegistro: line.CodigoErrorRegistro ?? null,
      DescripcionErrorRegistro: line.DescripcionErrorRegistro ?? null,
      RegistroDuplicado:
        duplicate === undefined
          ? null
          : {
              EstadoRegistroDuplicado: duplicate.EstadoRegistroDuplicado ?? null,
              CodigoErrorRegistro: duplicate.CodigoErrorRegistro ?? null,
              DescripcionErrorRegistro: duplicate.DescripcionErrorRegistro ?? null,
            },
    },
    comparison: comparisonOf(evidence.comparison),
  };
}

function lookupEvidence(evidence: LookupConflictEvidence): LookupEvidenceView {
  return {
    invoice: invoiceId(evidence.invoice),
    state: evidence.state,
    fingerprint: evidence.fingerprint,
    system: systemOf(evidence.system),
  };
}

function activeEvidence(
  evidence: ActiveConflictEvidence | null,
): ReplyEvidenceView | LookupEvidenceView | null {
  if (evidence === null) return null;
  return "source" in evidence ? lookupEvidence(evidence) : replyEvidence(evidence);
}
