import { and, asc, eq, inArray, max, sql, type SQLWrapper } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ClockStepRequest } from "@waitron/fiscal";
import type { NodeId } from "@waitron/shared";
import type { ConflictCause, ConflictEvidence, LookupConflictEvidence } from "./conflict-types.js";
import { verifactuHistory } from "./schema/verifactu-history.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";

interface ClockHistoryEntry {
  kind: "clock.confirmed";
  nodeId: NodeId;
  at: Date;
  personId: string;
  data: {
    confirmedAt: string;
    stepMs: number;
    source: "admin" | "staff";
    reason: ClockStepRequest["reason"];
    proof: Record<string, unknown>;
  };
}

interface ObservedConflictData {
  attempt: number;
  cause: ConflictCause;
  evidence: ConflictEvidence;
}

interface LookupConflictData {
  evidence: LookupConflictEvidence;
}

type ConflictHistoryEntry = { nodeId: NodeId; at: Date; registroId: string } & (
  | { kind: "conflict.observed"; data: ObservedConflictData }
  | { kind: "conflict.lookup"; data: LookupConflictData }
);

interface CaseNoteHistoryEntry {
  kind: "case.note";
  nodeId: NodeId;
  at: Date;
  registroId: string;
  personId: string;
  actionKey: string;
  data: { action: string };
}

export interface AnswerValues {
  csv: string | null;
  codigoError: number | null;
  mensajeError: string | null;
  confirmadoEn: Date | null;
}

type ClearedAnswerHistoryEntry = {
  kind: "aeat.answer_cleared";
  nodeId: NodeId;
  at: Date;
  registroId: string;
  data: AnswerValues & { by: "drain" | "reconcile" };
};

export type HistoryEntry =
  ClockHistoryEntry | ConflictHistoryEntry | CaseNoteHistoryEntry | ClearedAnswerHistoryEntry;

interface StoredHistoryEntry {
  id: string;
  seq: number;
}

export function appendHistory(tx: Transaction, entry: HistoryEntry): Promise<StoredHistoryEntry>;
export function appendHistory(
  tx: Transaction,
  entry: HistoryEntry,
  options: { ifAbsent: true },
): Promise<StoredHistoryEntry | null>;
export async function appendHistory(
  tx: Transaction,
  entry: HistoryEntry,
  options?: { ifAbsent: true },
): Promise<StoredHistoryEntry | null> {
  const eventKey = keyFor(entry);
  if (options?.ifAbsent && eventKey === null) throw new Error("History entry has no event key");
  const [latest] = await tx.select({ seq: max(verifactuHistory.seq) }).from(verifactuHistory);
  const seq = (latest?.seq ?? 0) + 1;
  const insert = tx
    .insert(verifactuHistory)
    .values({ ...entry, data: { ...entry.data }, seq, eventKey });
  const [row] = await (
    options?.ifAbsent ? insert.onConflictDoNothing({ target: verifactuHistory.eventKey }) : insert
  ).returning({ id: verifactuHistory.id });
  return row === undefined ? null : { id: row.id, seq };
}

export const CASE_NOTE_PREFIX = "case.note:";

function keyFor(entry: HistoryEntry): string | null {
  switch (entry.kind) {
    case "clock.confirmed":
    case "aeat.answer_cleared":
      return null;
    case "conflict.observed":
      return `conflict:${entry.registroId}:${entry.data.attempt}:${entry.data.cause}`;
    case "conflict.lookup":
      return `lookup:${entry.registroId}`;
    case "case.note":
      return CASE_NOTE_PREFIX + entry.actionKey;
  }
}

export async function keepAnswerBeforeClearing(
  tx: Transaction,
  registroId: string,
  by: ClearedAnswerHistoryEntry["data"]["by"],
  next: Partial<AnswerValues>,
  now: Date,
): Promise<void> {
  const [row] = await tx
    .select({
      nodeId: verifactuRecords.nodeId,
      csv: verifactuSubmissions.csv,
      codigoError: verifactuSubmissions.codigoError,
      mensajeError: verifactuSubmissions.mensajeError,
      confirmadoEn: verifactuSubmissions.confirmadoEn,
    })
    .from(verifactuSubmissions)
    .innerJoin(verifactuRecords, eq(verifactuRecords.id, verifactuSubmissions.registroId))
    .where(eq(verifactuSubmissions.registroId, registroId));
  if (row === undefined) return;

  // An omitted field stays on the submission. Null explicitly clears it.
  const changes = [
    [row.csv, next.csv],
    [
      row.codigoError,
      typeof next.codigoError === "number" ? String(next.codigoError) : next.codigoError,
    ],
    [row.mensajeError, next.mensajeError],
    [row.confirmadoEn?.getTime() ?? null, next.confirmadoEn?.getTime() ?? next.confirmadoEn],
  ];
  if (
    !changes.some(
      ([held, replacement]) => held !== null && replacement !== undefined && held !== replacement,
    )
  )
    return;

  await appendHistory(tx, {
    kind: "aeat.answer_cleared",
    nodeId: row.nodeId as NodeId,
    at: now,
    registroId,
    data: {
      by,
      csv: row.csv,
      codigoError: row.codigoError === null ? null : Number(row.codigoError),
      mensajeError: row.mensajeError,
      confirmadoEn: row.confirmadoEn,
    },
  });
}

export async function historyNodeForRecord(tx: Transaction, registroId: string): Promise<NodeId> {
  const [record] = await tx
    .select({ nodeId: verifactuRecords.nodeId })
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, registroId));
  return record!.nodeId as NodeId;
}

const retainedConflict = {
  id: verifactuHistory.id,
  registroId: verifactuHistory.registroId,
  recordedAt: verifactuHistory.at,
  data: verifactuHistory.data,
};

interface RetainedConflict {
  id: string;
  registroId: string;
  recordedAt: Date;
}

export async function observedConflicts(
  tx: Transaction,
  registroIds: SQLWrapper,
): Promise<(RetainedConflict & ObservedConflictData)[]> {
  const rows = await tx
    .select({
      ...retainedConflict,
      cause: sql<ConflictCause>`json_extract(${verifactuHistory.data}, '$.cause')`,
    })
    .from(verifactuHistory)
    .where(
      and(
        inArray(verifactuHistory.registroId, registroIds),
        eq(verifactuHistory.kind, "conflict.observed"),
      ),
    )
    .orderBy(
      asc(sql`json_extract(${verifactuHistory.data}, '$.attempt')`),
      asc(verifactuHistory.seq),
    );
  return rows.map(({ data, registroId, ...row }) => ({
    ...row,
    registroId: registroId!,
    attempt: data.attempt as number,
    evidence: data.evidence as ConflictEvidence,
  }));
}

export async function lookupConflicts(
  tx: Transaction,
  registroIds: SQLWrapper | readonly string[],
): Promise<(RetainedConflict & LookupConflictData)[]> {
  const rows = await tx
    .select(retainedConflict)
    .from(verifactuHistory)
    .where(
      and(
        inArray(verifactuHistory.registroId, registroIds),
        eq(verifactuHistory.kind, "conflict.lookup"),
      ),
    )
    .orderBy(asc(verifactuHistory.seq));
  return rows.map(({ data, registroId, ...row }) => ({
    ...row,
    registroId: registroId!,
    evidence: data.evidence as LookupConflictEvidence,
  }));
}

export async function lookupConflict(
  tx: Transaction,
  registroId: string,
): Promise<(RetainedConflict & LookupConflictData) | null> {
  const [row] = await lookupConflicts(tx, [registroId]);
  return row ?? null;
}
