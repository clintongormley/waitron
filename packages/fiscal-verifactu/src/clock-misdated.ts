import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type {
  ClockConfirmationSource,
  MisdatedDetail,
  MisdatedDetailRecord,
  MisdatedRecords,
} from "@waitron/fiscal";
import type { NodeId } from "@waitron/shared";
import { CLOCK_BEHIND_MARGIN_MS, parsedStored, storedHeads } from "./clock-behind.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";
import { registrosFacturacion } from "./schema/registros.js";

const CANNOT_TELL: MisdatedRecords = { known: false };

function storedClosing(proof: unknown): { start: number; unconfirmed: boolean } | null {
  const closing = (proof as { closing?: unknown } | null)?.closing as
    { correctedStart?: unknown; unconfirmed?: unknown } | null | undefined;
  if (typeof closing?.unconfirmed !== "boolean" || typeof closing.correctedStart !== "string")
    return null;
  const start = Date.parse(closing.correctedStart);
  return Number.isNaN(start) ? null : { start, unconfirmed: closing.unconfirmed };
}

/** The records a closing finds wrongly dated: written before its check opened (within the check's
 * `detail.heads`) and stamped more than a minute after the stop's stored corrected start, ordered
 * by time. Reads only stored values, so the list never moves once written. The stored
 * `proof.closing.unconfirmed` flag, not the source, decides that the box cannot tell; so does a
 * closing whose check, start, flag or heads cannot be read, because an empty list there would read
 * as "nothing dated wrongly". Null when no confirmation has the id. */
export async function misdatedRecords(
  tx: Transaction,
  confirmationId: string,
): Promise<MisdatedRecords | null> {
  const [row] = await tx
    .select({
      proof: sql<string>`${clockConfirmations.proof}`,
      detail: sql<string | null>`${clockChecks.detail}`,
    })
    .from(clockConfirmations)
    .leftJoin(clockChecks, eq(clockChecks.id, clockConfirmations.checkId))
    .where(eq(clockConfirmations.id, confirmationId));
  if (row === undefined) return null;
  const closing = storedClosing(parsedStored(row.proof));
  const heads = storedHeads(row.detail === null ? null : parsedStored(row.detail));
  if (closing === null || heads === null || closing.unconfirmed) return CANNOT_TELL;
  const { start } = closing;
  // `or()` of nothing would drop the bound altogether.
  if (heads.size === 0) return { known: true, records: [] };
  const rows = await tx
    .select({
      recordId: registrosFacturacion.id,
      invoiceNumber: registrosFacturacion.numSerieFactura,
      at: registrosFacturacion.fechaHoraHusoGenRegistro,
      offsetMinutes: registrosFacturacion.offsetMinutos,
    })
    .from(registrosFacturacion)
    .where(
      and(
        or(
          ...[...heads].map(([node, head]) =>
            and(
              eq(registrosFacturacion.nodeId, node as NodeId),
              lte(registrosFacturacion.secuencia, head),
            ),
          ),
        ),
        gt(registrosFacturacion.fechaHoraHusoGenRegistro, new Date(start + CLOCK_BEHIND_MARGIN_MS)),
      ),
    )
    .orderBy(asc(registrosFacturacion.fechaHoraHusoGenRegistro), asc(registrosFacturacion.id));
  return {
    known: true,
    records: rows.map(({ at, ...record }) => ({ ...record, generatedAt: at.toISOString() })),
  };
}

/** `misdatedRecords`' list with each record's kind, stored issue date and stored amount, and the
 * closing's own values. Reads only, two selects in turn after the list's. Null when no
 * confirmation has the id. */
export async function misdatedDetail(
  tx: Transaction,
  confirmationId: string,
): Promise<MisdatedDetail | null> {
  const list = await misdatedRecords(tx, confirmationId);
  if (list === null || !list.known) return list;
  const [row] = await tx
    .select({
      source: clockConfirmations.source,
      personId: clockConfirmations.personId,
      confirmedAt: clockConfirmations.confirmedAt,
      proof: sql<string>`${clockConfirmations.proof}`,
      detail: sql<string | null>`${clockChecks.detail}`,
    })
    .from(clockConfirmations)
    .leftJoin(clockChecks, eq(clockChecks.id, clockConfirmations.checkId))
    .where(eq(clockConfirmations.id, confirmationId));
  // misdatedRecords answered a list, so the row and its readable closing exist.
  const closing = (
    parsedStored(row!.proof) as {
      closing: { correctedStart: string; partial?: unknown };
    }
  ).closing;
  const stored = (row!.detail === null ? null : parsedStored(row!.detail)) as {
    offsetMinutes?: unknown;
  } | null;
  const startOffsetMinutes =
    typeof stored?.offsetMinutes === "number" ? stored.offsetMinutes : null;
  const ids = list.records.map((record) => record.recordId);
  const found =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: registrosFacturacion.id,
            kind: registrosFacturacion.tipoRegistro,
            issueDate: registrosFacturacion.fechaExpedicionFactura,
            amount: registrosFacturacion.importeTotal,
          })
          .from(registrosFacturacion)
          .where(inArray(registrosFacturacion.id, ids));
  const byId = new Map(found.map((record) => [record.id, record]));
  const records = list.records.map((record): MisdatedDetailRecord => {
    const stored = byId.get(record.recordId)!;
    return {
      ...record,
      kind: stored.kind === "anulacion" ? "cancellation" : "issue",
      issueDate: stored.issueDate,
      amount: stored.amount,
    };
  });
  return {
    known: true,
    closing: {
      source: row!.source as ClockConfirmationSource,
      personId: row!.personId,
      confirmedAt: row!.confirmedAt.toISOString(),
      correctedStart: closing.correctedStart,
      partial: closing.partial === true,
      startOffsetMinutes,
    },
    records,
  };
}
