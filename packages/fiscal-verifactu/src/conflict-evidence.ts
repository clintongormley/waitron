import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { IssuanceRefusedError } from "@waitron/fiscal";
import "./errors.js";
import {
  fiscalConflictEvidence,
  type ConflictCause,
  type ConflictEvidence,
} from "./schema/conflict-evidence.js";
import { filingCases } from "./schema/filing-cases.js";
import { registrosFacturacion } from "./schema/registros.js";
import { registroSif } from "./schema/sif.js";

export type {
  ConflictComparison,
  ConflictCause,
  ConflictEvidence,
} from "./schema/conflict-evidence.js";

export interface ConflictRef {
  registroId: string;
  caseId: string;
  sifId: string;
}

export interface ActiveConflict extends ConflictRef {
  installationIdentity: string;
  invoiceIdentity: string;
  observedAt: string;
  evidence: ConflictEvidence | null;
  cause: ConflictCause;
  evidenceId: string | null;
}

export async function assertNoActiveConflict(tx: Transaction, nodeId: string): Promise<void> {
  if ((await readActiveConflicts(tx, nodeId)).length !== 0) {
    throw new IssuanceRefusedError("sif.allocation_invalid", {
      reason: "conflict_requires_administrator",
    });
  }
}

export async function readActiveConflicts(
  tx: Transaction,
  nodeId: string,
): Promise<readonly ActiveConflict[]> {
  const rows = await tx
    .select({
      registroId: registrosFacturacion.id,
      caseId: filingCases.id,
      sifId: registroSif.id,
      installationIdentity: registroSif.numeroInstalacion,
      invoiceIdentity: registrosFacturacion.numSerieFactura,
      caseCause: filingCases.cause,
      openedAt: filingCases.openedAt,
      observation: fiscalConflictEvidence,
    })
    .from(registrosFacturacion)
    .innerJoin(
      registroSif,
      and(
        eq(registroSif.id, registrosFacturacion.sifId),
        eq(registroSif.nodeId, registrosFacturacion.nodeId),
      ),
    )
    .innerJoin(filingCases, eq(filingCases.registroId, registrosFacturacion.id))
    .leftJoin(
      fiscalConflictEvidence,
      and(
        eq(fiscalConflictEvidence.registroId, registrosFacturacion.id),
        eq(fiscalConflictEvidence.caseId, filingCases.id),
      ),
    )
    .where(
      and(
        eq(registroSif.nodeId, nodeId),
        isNull(registroSif.revocadoEn),
        or(
          isNotNull(fiscalConflictEvidence.id),
          inArray(filingCases.cause, ["fiscal.huella_divergente", "fiscal.duplicado_anulado"]),
        ),
      ),
    )
    .orderBy(asc(registrosFacturacion.secuencia), asc(fiscalConflictEvidence.attempt));
  const found = new Set<string>();
  const active: ActiveConflict[] = [];
  for (const row of rows) {
    if (found.has(row.registroId)) continue;
    const cause = row.observation?.cause ?? row.caseCause;
    if (cause !== "fiscal.huella_divergente" && cause !== "fiscal.duplicado_anulado") continue;
    found.add(row.registroId);
    active.push({
      registroId: row.registroId,
      caseId: row.caseId,
      sifId: row.sifId,
      installationIdentity: row.installationIdentity,
      invoiceIdentity: row.invoiceIdentity,
      observedAt: (row.observation?.recordedAt ?? row.openedAt).toISOString(),
      evidence: row.observation?.evidence ?? null,
      cause,
      evidenceId: row.observation?.id ?? null,
    });
  }
  return active;
}

export async function recordConflictEvidence(
  tx: Transaction,
  input: {
    registroId: string;
    caseId: string;
    attempt: number;
    cause: ConflictCause;
    evidence: ConflictEvidence;
    now: Date;
  },
): Promise<void> {
  await tx
    .insert(fiscalConflictEvidence)
    .values({
      registroId: input.registroId,
      caseId: input.caseId,
      attempt: input.attempt,
      cause: input.cause,
      evidence: input.evidence,
      recordedAt: input.now,
    })
    .onConflictDoNothing({
      target: [
        fiscalConflictEvidence.registroId,
        fiscalConflictEvidence.attempt,
        fiscalConflictEvidence.cause,
      ],
    });
}
