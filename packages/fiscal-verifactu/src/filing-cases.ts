import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { envios } from "./schema/envios.js";
import {
  filingCaseEvents,
  filingCases,
  type FilingCaseCause,
  type FilingCaseEvidence,
} from "./schema/filing-cases.js";

export type { FilingCaseCause, FilingCaseEvidence };

export type FilingCase = typeof filingCases.$inferSelect;
export type FilingCaseEvent = typeof filingCaseEvents.$inferSelect;
export type FilingCaseEventKind = FilingCaseEvent["kind"];

export interface FilingCaseReport extends FilingCase {
  /** The original record's CURRENT `envios.estado`; a case action never changes it. */
  estado: string | null;
  status: "open" | "resolved";
  events: FilingCaseEvent[];
}

export interface HeldRecord {
  registroId: string;
  /** The case that holds this record (see `heldRecords`), or null when none does. */
  caseId: string | null;
}

/** Opens the case for a record, or returns the one it already has untouched. */
export async function openFilingCase(
  tx: Transaction,
  input: { registroId: string; cause: FilingCaseCause; evidence: FilingCaseEvidence; now: Date },
): Promise<FilingCase> {
  const [existing] = await tx
    .select()
    .from(filingCases)
    .where(eq(filingCases.registroId, input.registroId));
  if (existing !== undefined) return existing;
  const [opened] = await tx
    .insert(filingCases)
    .values({
      registroId: input.registroId,
      cause: input.cause,
      evidence: input.evidence,
      openedAt: input.now,
    })
    .returning();
  return opened!;
}

/**
 * Records what a person did about a case. `actionKey` is the caller's idempotency key: a retry with
 * the same content returns the event already stored, and the same key with other content is
 * refused. A case takes one resolution; notes may follow it. Only a resolution names a corrective
 * record, and never the case's own record.
 */
export async function recordCaseEvent(
  tx: Transaction,
  input: {
    caseId: string;
    actionKey: string;
    kind: FilingCaseEventKind;
    personId: string;
    action: string;
    remedyRegistroId?: string | null;
    now: Date;
  },
): Promise<FilingCaseEvent> {
  const remedyRegistroId = input.remedyRegistroId ?? null;
  const [found] = await tx
    .select({ registroId: filingCases.registroId })
    .from(filingCases)
    .where(eq(filingCases.id, input.caseId));
  if (found === undefined) throw new AppError("filing_case.not_found", { caseId: input.caseId });
  if (
    remedyRegistroId !== null &&
    (input.kind === "note" || remedyRegistroId === found.registroId)
  ) {
    throw new AppError("filing_case.remedy_invalid", { caseId: input.caseId, remedyRegistroId });
  }

  const [stored] = await tx
    .select()
    .from(filingCaseEvents)
    .where(eq(filingCaseEvents.actionKey, input.actionKey));
  if (stored !== undefined) {
    const sameContent =
      stored.caseId === input.caseId &&
      stored.kind === input.kind &&
      stored.personId === input.personId &&
      stored.action === input.action &&
      stored.remedyRegistroId === remedyRegistroId;
    if (!sameContent) {
      throw new AppError("filing_case.action_mismatch", {
        caseId: input.caseId,
        actionKey: input.actionKey,
      });
    }
    return stored;
  }

  if (input.kind === "resolved") {
    const [resolution] = await tx
      .select({ id: filingCaseEvents.id })
      .from(filingCaseEvents)
      .where(and(eq(filingCaseEvents.caseId, input.caseId), eq(filingCaseEvents.kind, "resolved")));
    if (resolution !== undefined) {
      throw new AppError("filing_case.already_resolved", { caseId: input.caseId });
    }
  }

  const [recorded] = await tx
    .insert(filingCaseEvents)
    .values({
      caseId: input.caseId,
      actionKey: input.actionKey,
      kind: input.kind,
      personId: input.personId,
      action: input.action,
      remedyRegistroId,
      recordedAt: input.now,
    })
    .returning();
  return recorded!;
}

/** Every case, oldest first, with its events in the order they were recorded. */
export async function listFilingCases(tx: Transaction): Promise<FilingCaseReport[]> {
  const cases = await tx
    .select({ filingCase: filingCases, estado: envios.estado })
    .from(filingCases)
    .leftJoin(envios, eq(envios.registroId, filingCases.registroId))
    .orderBy(filingCases.openedAt, sql`${filingCases}.rowid`);
  const events = await tx
    .select()
    .from(filingCaseEvents)
    .orderBy(filingCaseEvents.recordedAt, sql`rowid`);
  const byCase = new Map<string, FilingCaseEvent[]>();
  for (const event of events) {
    const own = byCase.get(event.caseId);
    if (own === undefined) byCase.set(event.caseId, [event]);
    else own.push(event);
  }
  return cases.map(({ filingCase, estado }) => {
    const own = byCase.get(filingCase.id) ?? [];
    return {
      ...filingCase,
      estado,
      status: own.some((event) => event.kind === "resolved") ? "resolved" : "open",
      events: own,
    };
  });
}

/**
 * Every `detenido` record that has no case of its own: the records held behind another one. A
 * held cancellation whose original alta (same `sif_id`, same invoice identity) is `rechazado` or
 * `detenido` names its original's case. Any other held record names the case of the nearest
 * earlier `detenido` record on its chain (`sif_id`): that record's own case, or, when it has none,
 * the case it names in turn. A `rechazado` record holds nothing, so its case is never named for a
 * record after it.
 */
export async function heldRecords(tx: Transaction): Promise<HeldRecord[]> {
  const { rows } = await tx.execute<{
    registro_id: string;
    sif_id: string;
    estado: string;
    tipo_registro: string;
    identity: string;
    case_id: string | null;
  }>(sql`
    select e.registro_id, r.sif_id, e.estado, r.tipo_registro,
      r.id_emisor_factura || '|' || r.num_serie_factura || '|' || r.fecha_expedicion_factura
        as identity,
      c.id as case_id
    from envios e
    join registros_facturacion r on r.id = e.registro_id
    left join filing_cases c on c.registro_id = e.registro_id
    where e.estado in ('detenido', 'rechazado')
    order by r.sif_id, r.secuencia
  `);
  const held: HeldRecord[] = [];
  // Per chain: the case each original alta answers to, keyed by invoice identity.
  const altaCases = new Map<string, string | null>();
  let chain: string | null = null;
  let holding: string | null = null;
  for (const row of rows) {
    if (row.sif_id !== chain) {
      chain = row.sif_id;
      holding = null;
      altaCases.clear();
    }
    let caseId = row.case_id;
    if (row.estado === "detenido" && caseId === null) {
      caseId =
        row.tipo_registro === "anulacion" && altaCases.has(row.identity)
          ? altaCases.get(row.identity)!
          : holding;
      held.push({ registroId: row.registro_id, caseId });
    }
    if (row.tipo_registro === "alta") altaCases.set(row.identity, caseId);
    if (row.estado === "detenido") holding = caseId;
  }
  return held;
}
