import { and, count, desc, eq, isNotNull, isNull, min, sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";
import type { FilingCaseCause } from "./filing-states.js";
import { appendHistory, CASE_NOTE_PREFIX, historyNodeForRecord } from "./history.js";
import { verifactuHistory } from "./schema/verifactu-history.js";

export type { FilingCaseCause };

export interface FilingCaseEvidence {
  codigo: number | null;
  mensaje: string | null;
  csv: string | null;
}

export interface FilingCase {
  registroId: string;
  cause: FilingCaseCause;
  evidence: FilingCaseEvidence;
  openedAt: Date;
}

interface FilingCaseAction {
  registroId: string;
  actionKey: string;
  personId: string;
  action: string;
  recordedAt: Date;
}

export type FilingCaseEvent = FilingCaseAction &
  (
    | { kind: "resolved"; remedyRegistroId: string | null }
    | { kind: "note"; id: string; remedyRegistroId: null }
  );

const cases = verifactuSubmissions;
const caseColumns = {
  registroId: cases.registroId,
  cause: cases.caseCause,
  evidence: cases.caseEvidence,
  openedAt: cases.caseOpenedAt,
};
type NullableCase = { [K in keyof FilingCase]: FilingCase[K] | null };

function filingCase(row: NullableCase): FilingCase {
  // The case CHECK sets cause, evidence and time together.
  return row as FilingCase;
}

export async function findFilingCase(tx: Transaction, registroId: string) {
  const [row] = await tx
    .select({ ...caseColumns, estado: cases.estado, codigoError: cases.codigoError })
    .from(cases)
    .where(and(eq(cases.registroId, registroId), isNotNull(cases.caseOpenedAt)));
  return row === undefined ? undefined : { ...row, ...filingCase(row) };
}

export interface FilingCaseReport extends FilingCase {
  estado: string | null;
  status: "open" | "resolved";
  events: FilingCaseEvent[];
}

/**
 * The FROM and WHERE of a walk over the records before `record` on its chain, as `preceding` with
 * its envío `preceding_envio`, leaving out set-aside (`retenido`) records: one is never sent, so
 * it neither breaks nor lengthens a run of refusals, and is never the record before a held one. A
 * caller adds its own conditions, order and limit. A chain's records are all on its node
 * (`appendToChain`, ./chain.ts), and naming the node lets `verifactu_records_node_secuencia_uq` serve
 * the walk.
 */
export function recordsBefore(record: "r" | "d" | "p" | "h" | "held" | "runs"): SQL {
  const alias = sql.raw(record);
  return sql`
    from verifactu_records preceding
    left join verifactu_submissions preceding_envio on preceding_envio.registro_id = preceding.id
    where preceding.node_id = ${alias}.node_id and preceding.sif_id = ${alias}.sif_id
      and preceding.secuencia < ${alias}.secuencia
      and preceding_envio.estado is not 'retenido'
  `;
}

export interface HeldRecord {
  registroId: string;
  /** The case that holds this record (see `heldRecords`), or null when none does. */
  caseRegistroId: string | null;
}

/** Opens the case for a record, or returns the one it already has untouched. */
export async function openFilingCase(
  tx: Transaction,
  input: { registroId: string; cause: FilingCaseCause; evidence: FilingCaseEvidence; now: Date },
): Promise<FilingCase> {
  const [opened] = await tx
    .update(cases)
    .set({
      caseCause: input.cause,
      caseEvidence: input.evidence,
      caseOpenedAt: input.now,
      // Opening order survives equal times and a backward clock step.
      caseOpenSeq: sql`(select coalesce(max(case_open_seq), 0) + 1
        from verifactu_submissions where case_opened_at is not null)`,
    })
    .where(and(eq(cases.registroId, input.registroId), isNull(cases.caseOpenedAt)))
    .returning(caseColumns);
  if (opened !== undefined) return filingCase(opened);
  const existing = await findFilingCase(tx, input.registroId);
  if (existing === undefined) throw new Error("A filing case needs a submission row");
  return {
    registroId: existing.registroId,
    cause: existing.cause,
    evidence: existing.evidence,
    openedAt: existing.openedAt,
  };
}

/** The accepted-with-errors codes taken to need no correction. AEAT's validation document
 * (Validaciones_Errores_Veri-Factu v1.2.2, §4.3.1) says «Se excepciona este error de la necesidad
 * de ser subsanado» of two cases: no `ClaveRegimen` when the tax is IPSI, and a
 * `FechaHoraHusoGenRegistro` later than AEAT's clock. 2009 and 2004 are read as those cases' codes;
 * a late send also gets 2004, which that wording does not name (docs/compliance/verifactu-findings.md). */
const EXEMPT_FROM_CORRECTION = new Set([2004, 2009]);

/**
 * Opens the `fiscal.aceptado_con_errores` case for a record AEAT stored with an error, unless AEAT
 * exempts that error from correction. `codigo` is the stored copy's own error, never a duplicate
 * reply's 3000; a null one cannot be shown exempt, so it opens the case.
 */
export async function openAcceptedWithErrorsCase(
  tx: Transaction,
  input: {
    registroId: string;
    codigo: number | null;
    mensaje: string | null;
    csv: string | null;
    now: Date;
  },
): Promise<void> {
  if (input.codigo !== null && EXEMPT_FROM_CORRECTION.has(input.codigo)) return;
  await openFilingCase(tx, {
    registroId: input.registroId,
    cause: "fiscal.aceptado_con_errores",
    evidence: { codigo: input.codigo, mensaje: input.mensaje, csv: input.csv },
    now: input.now,
  });
}

const resolutionColumns = {
  registroId: cases.registroId,
  recordedAt: cases.caseResolvedAt,
  personId: cases.caseResolvedBy,
  action: cases.caseResolutionAction,
  actionKey: cases.caseResolutionKey,
  remedyRegistroId: cases.caseRemedyRegistroId,
};

function resolution(
  row: {
    [K in keyof FilingCaseAction]: FilingCaseAction[K] | null;
  } & { remedyRegistroId: string | null },
): FilingCaseEvent {
  // Every resolution fact except the optional remedy record is set together.
  return { ...(row as FilingCaseAction), kind: "resolved", remedyRegistroId: row.remedyRegistroId };
}

function note(row: typeof verifactuHistory.$inferSelect): FilingCaseEvent {
  return {
    kind: "note",
    id: row.id,
    registroId: row.registroId!,
    actionKey: row.eventKey!.slice(CASE_NOTE_PREFIX.length),
    personId: row.personId!,
    action: row.data.action as string,
    remedyRegistroId: null,
    recordedAt: row.at,
  };
}

export async function caseEventByActionKey(
  tx: Transaction,
  actionKey: string,
): Promise<FilingCaseEvent | undefined> {
  const [decided] = await tx
    .select(resolutionColumns)
    .from(cases)
    .where(eq(cases.caseResolutionKey, actionKey));
  if (decided !== undefined) return resolution(decided);
  const [recorded] = await tx
    .select()
    .from(verifactuHistory)
    .where(eq(verifactuHistory.eventKey, CASE_NOTE_PREFIX + actionKey));
  return recorded === undefined ? undefined : note(recorded);
}

/**
 * A case takes one resolution. A note may follow it. A retry returns the stored event when
 * the key and action facts match, even if the retry carries a later time.
 */
export async function recordCaseEvent(
  tx: Transaction,
  input: {
    caseRegistroId: string;
    actionKey: string;
    kind: FilingCaseEvent["kind"];
    personId: string;
    action: string;
    remedyRegistroId?: string | null;
    now: Date;
  },
): Promise<FilingCaseEvent> {
  const { caseRegistroId, actionKey, kind, personId, action, now } = input;
  const remedyRegistroId = input.remedyRegistroId ?? null;
  if ((await findFilingCase(tx, caseRegistroId)) === undefined)
    throw new AppError("filing_case.not_found", { caseRegistroId });
  if (remedyRegistroId !== null && (kind === "note" || remedyRegistroId === caseRegistroId))
    throw new AppError("filing_case.remedy_invalid", { caseRegistroId, remedyRegistroId });

  const stored = await caseEventByActionKey(tx, actionKey);
  if (stored !== undefined) {
    if (
      stored.registroId !== caseRegistroId ||
      stored.kind !== kind ||
      stored.personId !== personId ||
      stored.action !== action ||
      stored.remedyRegistroId !== remedyRegistroId
    ) {
      throw new AppError("filing_case.action_mismatch", { caseRegistroId, actionKey });
    }
    return stored;
  }

  if (kind === "note") {
    const { id } = await appendHistory(tx, {
      kind: "case.note",
      nodeId: await historyNodeForRecord(tx, caseRegistroId),
      registroId: caseRegistroId,
      at: now,
      personId,
      actionKey,
      data: { action },
    });
    return {
      kind,
      id,
      registroId: caseRegistroId,
      actionKey,
      personId,
      action,
      remedyRegistroId: null,
      recordedAt: now,
    };
  }

  const [decided] = await tx
    .update(cases)
    .set({
      caseResolvedAt: now,
      caseResolvedBy: personId,
      caseResolutionAction: action,
      caseResolutionKey: actionKey,
      caseRemedyRegistroId: remedyRegistroId,
    })
    .where(and(eq(cases.registroId, caseRegistroId), isNull(cases.caseResolvedAt)))
    .returning(resolutionColumns);
  if (decided === undefined) throw new AppError("filing_case.already_resolved", { caseRegistroId });
  return resolution(decided);
}

/** Cases in opening order, with notes in write order and the resolution placed by time. */
export async function listFilingCases(tx: Transaction): Promise<FilingCaseReport[]> {
  const rows = await tx
    .select({ ...caseColumns, estado: cases.estado, decision: resolutionColumns })
    .from(cases)
    .where(isNotNull(cases.caseOpenedAt))
    .orderBy(cases.caseOpenSeq);
  const notes = await tx
    .select()
    .from(verifactuHistory)
    .where(eq(verifactuHistory.kind, "case.note"))
    .orderBy(verifactuHistory.seq);
  const byCase = new Map<string, FilingCaseEvent[]>();
  for (const row of notes) {
    const event = note(row);
    const own = byCase.get(event.registroId);
    if (own === undefined) byCase.set(event.registroId, [event]);
    else own.push(event);
  }
  return rows.map(({ estado, decision, ...row }) => {
    const events = byCase.get(row.registroId) ?? [];
    if (decision.recordedAt === null) return { ...filingCase(row), estado, status: "open", events };
    const before = events.findIndex((event) => event.recordedAt >= decision.recordedAt!);
    events.splice(before === -1 ? events.length : before, 0, resolution(decision));
    return { ...filingCase(row), estado, status: "resolved", events };
  });
}

const openCase = and(isNotNull(cases.caseOpenedAt), isNull(cases.caseResolvedAt));

/**
 * The newest `limit` cases with no resolution yet, newest first (every one when `limit` is null),
 * each with its record, identity and submission, and how many cases are open in all. `recordIds` is the same list as a subquery of
 * the cases' record ids, so a caller can restrict a read to them without binding a list that grows.
 */
export async function openFilingCases(tx: Transaction, limit: number | null) {
  const query = tx
    .select({
      ...caseColumns,
      record: {
        tipoRegistro: verifactuRecords.tipoRegistro,
        idEmisorFactura: verifactuRecords.idEmisorFactura,
        numSerieFactura: verifactuRecords.numSerieFactura,
        fechaExpedicionFactura: verifactuRecords.fechaExpedicionFactura,
        tipoFactura: verifactuRecords.tipoFactura,
        importeTotal: verifactuRecords.importeTotal,
        cuotaTotal: verifactuRecords.cuotaTotal,
        descripcionOperacion: verifactuRecords.descripcionOperacion,
        huella: verifactuRecords.huella,
        anteriorHuella: verifactuRecords.anteriorHuella,
        fechaHoraHusoGenRegistro: verifactuRecords.fechaHoraHusoGenRegistro,
        numeroInstalacion: verifactuIdentities.numeroInstalacion,
      },
      submission: {
        estado: verifactuSubmissions.estado,
        codigoError: verifactuSubmissions.codigoError,
        mensajeError: verifactuSubmissions.mensajeError,
        enviadoEn: verifactuSubmissions.enviadoEn,
      },
    })
    .from(cases)
    .innerJoin(verifactuRecords, eq(verifactuRecords.id, cases.registroId))
    .innerJoin(verifactuIdentities, eq(verifactuIdentities.id, verifactuRecords.sifId))
    .where(openCase)
    .orderBy(desc(cases.caseOpenSeq));
  const listed = limit === null ? query : query.limit(limit);
  const rows = await listed;
  const [{ total }] = await tx.select({ total: count() }).from(cases).where(openCase);
  const inList = listed.as("listed");
  const recordIds = tx.select({ registroId: inList.registroId }).from(inList);
  return { cases: rows.map((row) => ({ ...row, ...filingCase(row) })), total, recordIds };
}

/** How many cases have no resolution yet, and when the oldest of them opened; null when none. */
export async function openFilingCasesSummary(
  tx: Transaction,
): Promise<{ count: number; oldestOpenedAt: Date } | null> {
  const [{ n, oldest }] = await tx
    .select({ n: count(), oldest: min(cases.caseOpenedAt) })
    .from(cases)
    .where(openCase);
  // `opened_at` is not null, so the oldest is null exactly when no case is open.
  if (oldest === null) return null;
  return { count: n, oldestOpenedAt: new Date(oldest) };
}

/**
 * Every `detenido` record that has no case of its own: the records held behind another record,
 * or behind a run of refusals with one code. A held cancellation whose current original alta
 * (same `sif_id`, same invoice identity) is `detenido` names its original's case. Any other held
 * record names the case of the nearest earlier `detenido` record on its chain (`sif_id`): that
 * record's own case, or, when it has none, the case it names in turn. With no earlier `detenido`
 * record, it names the case of the record immediately before it, set-aside records skipped
 * (`recordsBefore`), when that one is `rechazado`: the last refusal of the run that held it.
 * Otherwise it names none. Mirrors the hold rule in `./drain.ts`'s `haltOpenChainClaims`: the two
 * change together.
 */
export async function heldRecords(tx: Transaction): Promise<HeldRecord[]> {
  const { rows } = await tx.execute<{
    registro_id: string;
    sif_id: string;
    estado: string;
    tipo_registro: string;
    identity: string;
    case_id: string | null;
    refused_before_case_id: string | null;
  }>(sql`
    select e.registro_id, r.sif_id, e.estado, r.tipo_registro,
      r.id_emisor_factura || '|' || r.num_serie_factura || '|' || r.fecha_expedicion_factura
        as identity,
      case when e.case_opened_at is not null then e.registro_id end as case_id,
      case when e.estado = 'detenido' and e.case_opened_at is null then (
        select case when preceding_envio.estado = 'rechazado'
          and preceding_envio.case_opened_at is not null then preceding.id end
        ${recordsBefore("r")}
        order by preceding.secuencia desc
        limit 1
      ) end as refused_before_case_id
    from verifactu_submissions e
    join verifactu_records r on r.id = e.registro_id
    where e.estado in ('detenido', 'rechazado')
    order by r.sif_id, r.secuencia
  `);
  const held: HeldRecord[] = [];
  // Per chain: the case that holds each current held original alta, keyed by invoice identity.
  const altaCases = new Map<string, string | null>();
  let chain: string | null = null;
  let holding: string | null = null;
  let heldEarlier = false;
  for (const row of rows) {
    if (row.sif_id !== chain) {
      chain = row.sif_id;
      holding = null;
      heldEarlier = false;
      altaCases.clear();
    }
    let caseRegistroId = row.case_id;
    if (row.estado === "detenido" && caseRegistroId === null) {
      caseRegistroId =
        row.tipo_registro === "anulacion" && altaCases.has(row.identity)
          ? altaCases.get(row.identity)!
          : heldEarlier
            ? holding
            : row.refused_before_case_id;
      held.push({ registroId: row.registro_id, caseRegistroId });
    }
    if (row.tipo_registro === "alta" && row.estado === "detenido")
      altaCases.set(row.identity, caseRegistroId);
    if (row.estado === "detenido") {
      holding = caseRegistroId;
      heldEarlier = true;
    }
  }
  return held;
}
