import { and, asc, eq, gt, lte, or, sql, type SQL } from "drizzle-orm";
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

const CANNOT_TELL = { known: false } as const;

function storedClosing(
  proof: unknown,
): { correctedStart: string; start: number; partial: boolean; unconfirmed: boolean } | null {
  const closing = (proof as { closing?: unknown } | null)?.closing as
    { correctedStart?: unknown; partial?: unknown; unconfirmed?: unknown } | null | undefined;
  if (typeof closing?.unconfirmed !== "boolean" || typeof closing.correctedStart !== "string")
    return null;
  const start = Date.parse(closing.correctedStart);
  return Number.isNaN(start)
    ? null
    : {
        correctedStart: closing.correctedStart,
        start,
        partial: closing.partial === true,
        unconfirmed: closing.unconfirmed,
      };
}

/** A closing that cannot tell, or the bound on its wrongly dated records. The bound holds one term
 * per chain, never one per record, so its query does not grow with the list. `where` is undefined
 * when the heads name no chain: `or()` of nothing would drop the bound. */
type Selection =
  | { known: false }
  | {
      known: true;
      source: ClockConfirmationSource;
      personId: string | null;
      confirmedAt: Date;
      closing: NonNullable<ReturnType<typeof storedClosing>>;
      startOffsetMinutes: number | null;
      where: SQL | undefined;
    };

async function misdatedSelection(
  tx: Transaction,
  confirmationId: string,
): Promise<Selection | null> {
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
  if (row === undefined) return null;
  const closing = storedClosing(parsedStored(row.proof));
  const check = row.detail === null ? null : parsedStored(row.detail);
  const heads = storedHeads(check);
  if (closing === null || heads === null || closing.unconfirmed) return CANNOT_TELL;
  const offsetMinutes = (check as { offsetMinutes?: unknown }).offsetMinutes;
  return {
    known: true,
    source: row.source as ClockConfirmationSource,
    personId: row.personId,
    confirmedAt: row.confirmedAt,
    closing,
    startOffsetMinutes: typeof offsetMinutes === "number" ? offsetMinutes : null,
    where:
      heads.size === 0
        ? undefined
        : and(
            or(
              ...[...heads].map(([node, head]) =>
                and(
                  eq(registrosFacturacion.nodeId, node as NodeId),
                  lte(registrosFacturacion.secuencia, head),
                ),
              ),
            ),
            gt(
              registrosFacturacion.fechaHoraHusoGenRegistro,
              new Date(closing.start + CLOCK_BEHIND_MARGIN_MS),
            ),
          ),
  };
}

const MISDATED_ORDER = [
  asc(registrosFacturacion.fechaHoraHusoGenRegistro),
  asc(registrosFacturacion.id),
] as const;

const LISTED = {
  recordId: registrosFacturacion.id,
  invoiceNumber: registrosFacturacion.numSerieFactura,
  at: registrosFacturacion.fechaHoraHusoGenRegistro,
  offsetMinutes: registrosFacturacion.offsetMinutos,
};

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
  const found = await misdatedSelection(tx, confirmationId);
  if (found === null || !found.known) return found;
  const { where } = found;
  const rows =
    where === undefined
      ? []
      : await tx
          .select(LISTED)
          .from(registrosFacturacion)
          .where(where)
          .orderBy(...MISDATED_ORDER);
  return {
    known: true,
    records: rows.map(({ at, ...record }) => ({ ...record, generatedAt: at.toISOString() })),
  };
}

/** `misdatedRecords`' list with each record's kind, stored issue date and stored amount, and the
 * closing's own values. Reads only, in two selects whose size does not grow with the list: the
 * confirmation's and the records'. Null when no confirmation has the id. */
export async function misdatedDetail(
  tx: Transaction,
  confirmationId: string,
): Promise<MisdatedDetail | null> {
  const found = await misdatedSelection(tx, confirmationId);
  if (found === null || !found.known) return found;
  const { closing, where } = found;
  const rows =
    where === undefined
      ? []
      : await tx
          .select({
            ...LISTED,
            kind: registrosFacturacion.tipoRegistro,
            issueDate: registrosFacturacion.fechaExpedicionFactura,
            amount: registrosFacturacion.importeTotal,
          })
          .from(registrosFacturacion)
          .where(where)
          .orderBy(...MISDATED_ORDER);
  return {
    known: true,
    closing: {
      source: found.source,
      personId: found.personId,
      confirmedAt: found.confirmedAt.toISOString(),
      correctedStart: closing.correctedStart,
      partial: closing.partial,
      startOffsetMinutes: found.startOffsetMinutes,
    },
    records: rows.map(({ at, kind, ...record }): MisdatedDetailRecord => ({
      ...record,
      generatedAt: at.toISOString(),
      kind: kind === "anulacion" ? "cancellation" : "issue",
    })),
  };
}
