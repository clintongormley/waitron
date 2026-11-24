import { and, count, eq, exists, isNotNull, or, sql } from "drizzle-orm";
import { deployment, invoiceSeries, readTaxpayer, type Transaction } from "@waitron/db";
import { readActiveConflicts } from "./conflict-evidence.js";
import type {
  ActiveConflictEvidence,
  ConflictComparison,
  ConflictEvidence,
  LookupConflictEvidence,
} from "./conflict-types.js";
import { heldRecords, openFilingCases } from "./filing-cases.js";
import { lookupConflicts, observedConflicts } from "./history.js";
import type {
  ComparisonView,
  FilingOverview,
  FilingProgress,
  InvoiceIdView,
  LookupEvidenceView,
  MissingHistory,
  ReplyEvidenceView,
  SystemView,
} from "./filing-overview-types.js";
import { ENVIO_STATES, type EnvioState } from "./handover-summary.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { verifactuSeriesConflicts } from "./schema/verifactu-series-conflicts.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";

/**
 * What the Fiscal filing screen shows, read in the caller's one transaction by a fixed number of
 * queries whatever the number of cases. `limit` bounds the case list (null: every open case).
 * Every object is built from fields named here or in `openFilingCases`' selection: a stored row
 * or reply is never copied whole, so a recipient or an AEAT request reference cannot reach the
 * answer.
 */
export async function readFilingOverview(
  tx: Transaction,
  scope: { nodeId: string | null; limit: number | null },
): Promise<FilingOverview> {
  const readAt = new Date().toISOString();
  const progress = await readProgress(tx);
  const { cases, total, recordIds: listed } = await openFilingCases(tx, scope.limit);
  const conflictRows = await observedConflicts(tx, listed);
  const lookupRows = await lookupConflicts(tx, listed);
  const held = await heldRecords(tx);
  const active = scope.nodeId === null ? [] : await readActiveConflicts(tx, scope.nodeId);
  const missingHistory = await readMissingHistory(tx);

  const heldByCase = new Map<string, number>();
  let heldWithoutCase = 0;
  for (const { caseRegistroId } of held) {
    if (caseRegistroId === null) heldWithoutCase += 1;
    else heldByCase.set(caseRegistroId, (heldByCase.get(caseRegistroId) ?? 0) + 1);
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
        ...found.record,
        fechaHoraHusoGenRegistro: found.record.fechaHoraHusoGenRegistro.toISOString(),
      },
      submission:
        found.submission === null
          ? null
          : { ...found.submission, enviadoEn: found.submission.enviadoEn?.toISOString() ?? null },
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
      heldBehind: heldByCase.get(found.registroId) ?? 0,
    })),
    totalCases: total,
    heldWithoutCase,
    activeConflicts: active.map((conflict) => ({
      source: conflict.registroId === undefined ? "series" : "record",
      invoiceNumber: conflict.invoiceIdentity,
      installationName: conflict.installationIdentity,
      cause: conflict.cause,
      observedAt: conflict.observedAt,
      evidence: activeEvidence(conflict.evidence),
    })),
    missingHistory,
  };
}

async function readMissingHistory(tx: Transaction): Promise<MissingHistory> {
  const taxpayer = await readTaxpayer(tx);
  const [stamp] = await tx
    .select({ environment: deployment.environment })
    .from(deployment)
    .where(eq(deployment.id, 1));
  const environment = stamp?.environment;
  if (taxpayer === null || environment === undefined)
    return { notIssuedHere: [], identityChanges: [] };
  const notIssuedHere = await tx
    .select({
      seriesCode: invoiceSeries.code,
      recordedAt: verifactuSeriesConflicts.recordedAt,
      evidence: verifactuSeriesConflicts.evidence,
    })
    .from(verifactuSeriesConflicts)
    .innerJoin(verifactuIdentities, eq(verifactuIdentities.id, verifactuSeriesConflicts.sifId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, verifactuSeriesConflicts.seriesId))
    .where(
      and(
        eq(verifactuIdentities.nif, taxpayer.taxId),
        isNotNull(invoiceSeries.retiredAt),
        or(
          eq(verifactuIdentities.environment, environment),
          exists(
            tx
              .select({ one: sql`1` })
              .from(verifactuRecords)
              .where(
                and(
                  eq(verifactuRecords.sifId, verifactuIdentities.id),
                  eq(verifactuRecords.entorno, environment),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(sql`${verifactuSeriesConflicts}.rowid`);
  return {
    notIssuedHere: notIssuedHere.map((row) => ({
      seriesCode: row.seriesCode,
      recordedAt: row.recordedAt.toISOString(),
      ...lookupEvidence(row.evidence),
    })),
    identityChanges: await readIdentityChanges(tx, taxpayer.taxId, environment),
  };
}

/** Use insertion order for identity changes because recovery can move the clock backwards. */
async function readIdentityChanges(
  tx: Transaction,
  taxId: string,
  environment: string,
): Promise<MissingHistory["identityChanges"]> {
  const rows = await tx.execute<
    { installation: string; activated_at: string; earlier_installation: string } & (
      | { num_serie_factura: string; fecha_expedicion_factura: string }
      | { num_serie_factura: null; fecha_expedicion_factura: null }
    )
  >(sql`
    with identities as (
      select s.rowid as position, s.id, s.node_id, s.numero_instalacion as installation
      from verifactu_identities s
      where s.nif = ${taxId} and (
        s.environment = ${environment}
        or exists (select 1 from verifactu_records r where r.sif_id = s.id and r.entorno = ${environment})
      )
    ),
    changes as (
      select n.rowid as position, n.registrado_en as activated_at, n.numero_instalacion as installation, (
        select i.position from identities i
        where i.position < n.rowid
        order by i.position desc limit 1
      ) as earlier
      from verifactu_identities n
      where n.nif = ${taxId} and n.environment = ${environment} and n.event_key is not null
        and not (
          json_extract(n.approval, '$.version') = 2
          and json_type(n.approval, '$.oldMachineRelinquished') = 'true'
        )
    )
    select c.installation, c.activated_at, e.installation as earlier_installation,
      r.num_serie_factura, r.fecha_expedicion_factura
    from changes c
    join identities e on e.position = c.earlier
    left join verifactu_records r on r.id = (
      select l.id from verifactu_records l
      -- appendToChain and receiveReturnedOriginals refuse an identity of another node
      where l.node_id = e.node_id and l.sif_id = e.id and l.entorno = ${environment}
      order by l.secuencia desc limit 1
    )
    order by c.position
  `);
  return rows.rows.map((row) => ({
    installationName: row.installation,
    earlierInstallationName: row.earlier_installation,
    lastHeldInvoice:
      row.num_serie_factura === null
        ? null
        : {
            numSerieFactura: row.num_serie_factura,
            fechaExpedicionFactura: row.fecha_expedicion_factura,
          },
    activatedAt: new Date(row.activated_at).toISOString(),
  }));
}

async function readProgress(tx: Transaction): Promise<FilingProgress> {
  const groups = await tx
    .select({
      estado: verifactuSubmissions.estado,
      n: count(),
      oldestGenerated: sql<string | null>`min(${verifactuRecords.fechaHoraHusoGenRegistro})`,
      latestConfirmed: sql<string | null>`max(${verifactuSubmissions.confirmadoEn})`,
    })
    .from(verifactuSubmissions)
    .innerJoin(verifactuRecords, eq(verifactuRecords.id, verifactuSubmissions.registroId))
    .groupBy(verifactuSubmissions.estado);
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
