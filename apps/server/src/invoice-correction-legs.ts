import { and, asc, eq, inArray } from "drizzle-orm";
import {
  invoiceCorrectionRefunds,
  invoiceCorrections,
  refunds as refundRows,
  tenders,
  type Transaction,
} from "@waitron/db";
import { previewCorrectionAmounts, type CorrectionPreview } from "@waitron/core";
import type { FiscalBackend } from "@waitron/fiscal";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import {
  AppError,
  centsToDecimal,
  hasCode,
  type ErrorParams,
  type NodeId,
  type SaleId,
} from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import "./errors.js";

export type InvoiceCorrectionRow = typeof invoiceCorrections.$inferSelect;

/** Asks core for whichever corrective the regime's admission says the invoice takes. */
export const AS_ADMITTED = { fullInvoice: "as_admitted" } as const;

/** The refusals of a filing that no later attempt on this box can get past. */
const NEVER_FILEABLE = new Set<ErrorParams["sale.correction_not_admitted"]["reason"]>([
  "replaced",
  "voided",
  "not_simplified",
  "refused_no_fix",
]);

/** Whether a filing's refusal is one no later attempt on this box gets past, so Close may end the
 * correction over it with its refunds kept. */
export function closableRefusal(error: AppError): boolean {
  return hasCode(error, "sale.correction_not_admitted") && NEVER_FILEABLE.has(error.params.reason);
}

/** The correction `correctionId`; refused `invoice_correction.not_found` when there is none. */
export async function readCorrectionRow(
  tx: Transaction,
  correctionId: string,
): Promise<InvoiceCorrectionRow> {
  const [correction] = await tx
    .select()
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, correctionId));
  if (correction === undefined)
    throw new AppError("invoice_correction.not_found", { correctionId });
  return correction;
}

export interface CorrectionMoney {
  completed: number;
  pending: number;
  pendingRefundId: string | null;
}

/** A correction's refunds, oldest link first and, among links made at one time, oldest payment
 * first, each with the request that made it; and the money they have given back and still hold
 * pending, in cents; failed refunds count nothing. */
export async function readCorrectionLegs(
  tx: Transaction,
  correctionId: string,
): Promise<CorrectionLegs> {
  return (await readCorrectionLegsOf(tx, [correctionId])).get(correctionId)!;
}

export interface CorrectionLegs {
  refunds: (typeof refundRows.$inferSelect)[];
  requestIds: string[];
  money: CorrectionMoney;
}

/** {@link readCorrectionLegs} of each named correction, by correction id, in one read per
 * {@link SQL_VARIABLE_LIMIT} ids. */
export async function readCorrectionLegsOf(
  tx: Transaction,
  correctionIds: readonly string[],
): Promise<Map<string, CorrectionLegs>> {
  const links: {
    correctionId: string;
    refund: typeof refundRows.$inferSelect;
    requestId: string;
  }[] = [];
  for (let start = 0; start < correctionIds.length; start += SQL_VARIABLE_LIMIT)
    links.push(
      ...(await tx
        .select({
          correctionId: invoiceCorrectionRefunds.invoiceCorrectionId,
          refund: refundRows,
          requestId: invoiceCorrectionRefunds.requestId,
        })
        .from(invoiceCorrectionRefunds)
        .innerJoin(refundRows, eq(refundRows.id, invoiceCorrectionRefunds.tenderRefundId))
        .innerJoin(tenders, eq(tenders.id, refundRows.tenderId))
        .where(
          inArray(
            invoiceCorrectionRefunds.invoiceCorrectionId,
            correctionIds.slice(start, start + SQL_VARIABLE_LIMIT),
          ),
        )
        .orderBy(
          asc(invoiceCorrectionRefunds.createdAt),
          asc(tenders.settledAt),
          asc(tenders.id),
          asc(invoiceCorrectionRefunds.id),
        )),
    );
  const legs = new Map(correctionIds.map((id) => [id, [] as typeof links]));
  for (const link of links) legs.get(link.correctionId)!.push(link);
  return new Map([...legs].map(([id, own]) => [id, legsOf(own)]));
}

function legsOf(
  links: readonly { refund: typeof refundRows.$inferSelect; requestId: string }[],
): CorrectionLegs {
  const refunds = links.map(({ refund }) => refund);
  const money: CorrectionMoney = {
    completed: 0,
    pending: 0,
    pendingRefundId: null,
  };
  for (const leg of refunds) {
    if (leg.state === "completed") money.completed += leg.appliedAmount;
    else if (leg.state === "pending") {
      money.pending += leg.appliedAmount;
      money.pendingRefundId ??= leg.id;
    }
  }
  return { refunds, requestIds: links.map(({ requestId }) => requestId), money };
}

/** The money a correction's refunds have given back and still hold pending, in cents. */
export async function readCorrectionMoney(
  tx: Transaction,
  correctionId: string,
): Promise<CorrectionMoney> {
  return (await readCorrectionLegs(tx, correctionId)).money;
}

/**
 * Refuses unless the correction is this sale's and open (`invoice_correction.not_open`
 * { correctionId, state }), a cash leg comes through the correction's cash request
 * (`invoice_correction.cash_route_only` { correctionId }), the tip is zero (`invalid("tipAmount")`),
 * no cancellation ids are named (`invalid("cancellationIds")`), and the leg fits what is left
 * (`invoice_correction.leg_too_large` { correctionId, left }), then runs {@link checkLegFileable}
 * unless `read.fileableChecked` says the caller already has. Answers the correction. Reads the
 * correction and its money unless `read` hands them in.
 */
export async function checkCorrectionLeg(
  tx: Transaction,
  fiscal: { backend: FiscalBackend; nodeId: NodeId },
  saleId: string,
  link: { id: string; cashRoute?: true },
  leg: {
    method: "cash" | "card";
    appliedCents: number;
    tipCents: number;
    cancellationIds: readonly string[] | undefined;
  },
  read?: CorrectionRead,
): Promise<InvoiceCorrectionRow> {
  const correction = read?.correction ?? (await readCorrectionRow(tx, link.id));
  if (correction.originalSaleId !== saleId || correction.state !== "open")
    throw new AppError("invoice_correction.not_open", {
      correctionId: correction.id,
      state: correction.state,
    });
  if (leg.method === "cash" && link.cashRoute !== true)
    throw new AppError("invoice_correction.cash_route_only", { correctionId: correction.id });
  if (leg.tipCents !== 0) throw invalid("tipAmount");
  if (leg.cancellationIds !== undefined) throw invalid("cancellationIds");
  const left =
    read?.left ?? correctionLeft(correction, await readCorrectionMoney(tx, correction.id));
  if (leg.appliedCents > left)
    throw new AppError("invoice_correction.leg_too_large", {
      correctionId: correction.id,
      left: centsToDecimal(left),
    });
  if (read?.fileableChecked !== true)
    await checkLegFileable(tx, fiscal, correction, correction.gross - left + leg.appliedCents);
  return correction;
}

/**
 * Refuses as `previewCorrectionAmounts` refuses the correction's corrective for `moneyBack` cents
 * (its admission, a full invoice's customer and registered address), except a refusal Close ends the
 * correction over (`closableRefusal`), whose money goes back unrecorded. A full invoice's
 * corrective that can still be filed is also refused `invoice_correction.chain_unsound` while the
 * box's invoice records need checking, so its money waits for them; a receipt's is not. The clock
 * check filing also runs is not repeated here.
 */
export async function checkLegFileable(
  tx: Transaction,
  fiscal: { backend: FiscalBackend; nodeId: NodeId },
  correction: InvoiceCorrectionRow,
  moneyBack: number,
): Promise<void> {
  let preview: CorrectionPreview;
  try {
    preview = await previewCorrectionAmounts(
      tx,
      fiscal.backend,
      correction.originalSaleId as SaleId,
      fiscal.nodeId,
      {
        gross: centsToDecimal(moneyBack),
        ...(correction.lineIds === null ? {} : { lineIds: correction.lineIds }),
      },
      AS_ADMITTED,
    );
  } catch (error) {
    if (!(error instanceof AppError) || !closableRefusal(error)) throw error;
    return;
  }
  if (await waitsForRecordsCheck(tx, fiscal, preview))
    throw new AppError("invoice_correction.chain_unsound", { saleId: correction.originalSaleId });
}

/** Whether the corrective `preview` answers is a full invoice's and the box's invoice records need
 * checking, so its money waits for them; a receipt's never waits here. */
export async function waitsForRecordsCheck(
  tx: Transaction,
  fiscal: { backend: FiscalBackend; nodeId: NodeId },
  preview: Pick<CorrectionPreview, "fullInvoice">,
): Promise<boolean> {
  return (
    preview.fullInvoice === true &&
    (await fiscal.backend.checkIntegrity(tx, fiscal.nodeId)).issues.length > 0
  );
}

/** The correction as its caller read it in this transaction, the cents it had left before this
 * leg, and whether the caller has run {@link checkLegFileable} for this leg's money or more. */
export interface CorrectionRead {
  correction: InvoiceCorrectionRow;
  left: number;
  fileableChecked?: true;
}

/** The cents of `correction` neither given back nor pending. */
export function correctionLeft(
  correction: Pick<InvoiceCorrectionRow, "gross">,
  money: CorrectionMoney,
): number {
  return correction.gross - money.completed - money.pending;
}

/** The id of the sale's open correction, if it has one. */
export async function openCorrectionOf(
  tx: Transaction,
  saleId: string,
): Promise<string | undefined> {
  const [open] = await tx
    .select({ id: invoiceCorrections.id })
    .from(invoiceCorrections)
    .where(
      and(eq(invoiceCorrections.originalSaleId, saleId), eq(invoiceCorrections.state, "open")),
    );
  return open?.id;
}

/** Refuses `invoice_correction.already_open` while the sale has an open correction. */
export async function refuseWhileCorrectionOpen(tx: Transaction, saleId: string): Promise<void> {
  const correctionId = await openCorrectionOf(tx, saleId);
  if (correctionId !== undefined) throw correctionOpenRefusal(saleId, correctionId);
}

/** {@link refuseWhileCorrectionOpen}'s refusal, for a caller that has read the open correction. */
export function correctionOpenRefusal(saleId: string, correctionId: string): AppError {
  return new AppError("invoice_correction.already_open", { saleId, correctionId });
}

export async function linkRefundToCorrection(
  tx: Transaction,
  link: {
    invoiceCorrectionId: string;
    tenderRefundId: string;
    requestId: string;
    createdAt: string;
  },
): Promise<void> {
  await tx.insert(invoiceCorrectionRefunds).values(link);
}
