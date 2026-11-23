import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { invoiceSeries, type Transaction } from "@waitron/db";
import { IssuanceRefusedError } from "@waitron/fiscal";
import "./errors.js";
import { appendHistory, historyNodeForRecord } from "./history.js";
import { filingCases } from "./schema/filing-cases.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";
import { verifactuHistory } from "./schema/verifactu-history.js";
import { verifactuSeriesConflicts } from "./schema/verifactu-series-conflicts.js";

export type { ConflictComparison, ConflictCause, ConflictEvidence } from "./conflict-types.js";

export type { ConflictRef, ActiveConflict } from "./conflict-types.js";
import type {
  ActiveConflict,
  ConflictCause,
  ConflictEvidence,
  LookupConflictEvidence,
} from "./conflict-types.js";

const observed = alias(verifactuHistory, "observed");
const lookup = alias(verifactuHistory, "lookup");
const observedCause = sql<ConflictCause | null>`json_extract(${observed.data}, '$.cause')`;

export async function assertNoActiveConflict(tx: Transaction, nodeId: string): Promise<void> {
  if ((await readActiveConflicts(tx, nodeId)).length !== 0) {
    throw new IssuanceRefusedError("sif.allocation_invalid", {
      reason: "conflict_requires_administrator",
      recoveryUrl: "/recovery/fiscal-conflict",
    });
  }
}

/** One box only: a conflict stops the box whose identity it concerns. One on a record of a box this
 * box took over from is recorded but cannot stop this box, which never appends to that chain. */
export async function readActiveConflicts(
  tx: Transaction,
  nodeId: string,
): Promise<readonly ActiveConflict[]> {
  const rows = await tx
    .select({
      registroId: verifactuRecords.id,
      caseId: filingCases.id,
      sifId: verifactuIdentities.id,
      installationIdentity: verifactuIdentities.numeroInstalacion,
      invoiceIdentity: verifactuRecords.numSerieFactura,
      caseCause: filingCases.cause,
      openedAt: filingCases.openedAt,
      observation: { id: observed.id, at: observed.at, data: observed.data },
      observedCause,
      lookup: { id: lookup.id, at: lookup.at, data: lookup.data },
    })
    .from(verifactuRecords)
    .innerJoin(
      verifactuIdentities,
      and(
        eq(verifactuIdentities.id, verifactuRecords.sifId),
        eq(verifactuIdentities.nodeId, verifactuRecords.nodeId),
      ),
    )
    .innerJoin(filingCases, eq(filingCases.registroId, verifactuRecords.id))
    .leftJoin(
      observed,
      and(eq(observed.registroId, verifactuRecords.id), eq(observed.kind, "conflict.observed")),
    )
    .leftJoin(
      lookup,
      and(eq(lookup.registroId, verifactuRecords.id), eq(lookup.kind, "conflict.lookup")),
    )
    .where(
      and(
        eq(verifactuIdentities.nodeId, nodeId),
        isNull(verifactuIdentities.revocadoEn),
        or(
          isNotNull(observed.id),
          isNotNull(lookup.id),
          inArray(filingCases.cause, ["fiscal.huella_divergente", "fiscal.duplicado_anulado"]),
        ),
      ),
    )
    .orderBy(
      asc(verifactuRecords.secuencia),
      asc(sql`json_extract(${observed.data}, '$.attempt')`),
      // The annulled cause code sorts first when both causes share an attempt.
      asc(observedCause),
    );
  const found = new Set<string>();
  const active: ActiveConflict[] = [];
  for (const row of rows) {
    if (found.has(row.registroId)) continue;
    const cause =
      row.observedCause ?? (row.lookup === null ? row.caseCause : "fiscal.huella_divergente");
    if (cause !== "fiscal.huella_divergente" && cause !== "fiscal.duplicado_anulado") continue;
    found.add(row.registroId);
    active.push({
      registroId: row.registroId,
      caseId: row.caseId,
      sifId: row.sifId,
      installationIdentity: row.installationIdentity,
      invoiceIdentity: row.invoiceIdentity,
      observedAt: (row.observation?.at ?? row.lookup?.at ?? row.openedAt).toISOString(),
      evidence:
        (row.observation?.data.evidence as ConflictEvidence | undefined) ??
        (row.lookup?.data.evidence as LookupConflictEvidence | undefined) ??
        null,
      cause,
      evidenceId: row.observation?.id ?? row.lookup?.id ?? null,
    });
  }
  const external = await tx
    .select({
      lookup: verifactuSeriesConflicts,
      installationIdentity: verifactuIdentities.numeroInstalacion,
    })
    .from(verifactuSeriesConflicts)
    .innerJoin(verifactuIdentities, eq(verifactuIdentities.id, verifactuSeriesConflicts.sifId))
    .innerJoin(
      invoiceSeries,
      and(
        eq(invoiceSeries.id, verifactuSeriesConflicts.seriesId),
        eq(invoiceSeries.nodeId, verifactuIdentities.nodeId),
      ),
    )
    .where(
      and(
        eq(verifactuIdentities.nodeId, nodeId),
        isNull(verifactuIdentities.revocadoEn),
        isNull(invoiceSeries.retiredAt),
      ),
    )
    .orderBy(asc(verifactuSeriesConflicts.recordedAt), asc(verifactuSeriesConflicts.id));
  for (const { lookup, installationIdentity } of external)
    active.push({
      lookupId: lookup.id,
      sifId: lookup.sifId,
      installationIdentity,
      invoiceIdentity: lookup.invoiceIdentity,
      observedAt: lookup.recordedAt.toISOString(),
      evidence: lookup.evidence,
      cause: "fiscal.huella_divergente",
      evidenceId: lookup.id,
    });
  return active;
}

export async function recordConflictEvidence(
  tx: Transaction,
  input: {
    registroId: string;
    attempt: number;
    cause: ConflictCause;
    evidence: ConflictEvidence;
    now: Date;
  },
): Promise<void> {
  await appendHistory(
    tx,
    {
      kind: "conflict.observed",
      nodeId: await historyNodeForRecord(tx, input.registroId),
      registroId: input.registroId,
      at: input.now,
      data: { attempt: input.attempt, cause: input.cause, evidence: input.evidence },
    },
    { ifAbsent: true },
  );
}
