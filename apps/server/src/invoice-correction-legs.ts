import { and, asc, eq } from "drizzle-orm";
import {
  invoiceCorrectionRefunds,
  invoiceCorrections,
  tenderRefunds,
  type Transaction,
} from "@waitron/db";
import { AppError, centsToDecimal } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import "./errors.js";

/** The money a correction's refunds have given back and still hold pending, in cents; failed
 * refunds count nothing. */
export async function readCorrectionMoney(
  tx: Transaction,
  correctionId: string,
): Promise<{
  completed: number;
  pending: number;
  pendingRefundId: string | null;
  firstCompletedAt: string | null;
}> {
  const legs = await tx
    .select({
      id: tenderRefunds.id,
      state: tenderRefunds.state,
      cents: tenderRefunds.appliedAmount,
      completedAt: tenderRefunds.completedAt,
    })
    .from(invoiceCorrectionRefunds)
    .innerJoin(tenderRefunds, eq(tenderRefunds.id, invoiceCorrectionRefunds.tenderRefundId))
    .where(eq(invoiceCorrectionRefunds.invoiceCorrectionId, correctionId))
    .orderBy(asc(invoiceCorrectionRefunds.createdAt), asc(invoiceCorrectionRefunds.id));
  let completed = 0,
    pending = 0;
  let pendingRefundId: string | null = null,
    firstCompletedAt: string | null = null;
  for (const leg of legs) {
    if (leg.state === "completed") {
      completed += leg.cents;
      if (
        leg.completedAt !== null &&
        (firstCompletedAt === null || leg.completedAt < firstCompletedAt)
      )
        firstCompletedAt = leg.completedAt;
    } else if (leg.state === "pending") {
      pending += leg.cents;
      pendingRefundId ??= leg.id;
    }
  }
  return { completed, pending, pendingRefundId, firstCompletedAt };
}

/**
 * Refuses unless the correction is this sale's and open (`invoice_correction.not_open`
 * { correctionId, state }), the tip is zero (`invalid("tipAmount")`), no cancellation ids are named
 * (`invalid("cancellationIds")`), and the leg fits what is left (`invoice_correction.leg_too_large`
 * { correctionId, left }). Answers the correction.
 */
export async function checkCorrectionLeg(
  tx: Transaction,
  saleId: string,
  link: { id: string; cashRoute?: true },
  leg: {
    method: "cash" | "card";
    appliedCents: number;
    tipCents: number;
    cancellationIds: readonly string[] | undefined;
  },
): Promise<typeof invoiceCorrections.$inferSelect> {
  const [correction] = await tx
    .select()
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, link.id));
  if (correction === undefined)
    throw new AppError("invoice_correction.not_found", { correctionId: link.id });
  if (correction.originalSaleId !== saleId || correction.state !== "open")
    throw new AppError("invoice_correction.not_open", {
      correctionId: correction.id,
      state: correction.state,
    });
  if (leg.tipCents !== 0) throw invalid("tipAmount");
  if (leg.cancellationIds !== undefined) throw invalid("cancellationIds");
  const money = await readCorrectionMoney(tx, correction.id);
  const left = correction.gross - money.completed - money.pending;
  if (leg.appliedCents > left)
    throw new AppError("invoice_correction.leg_too_large", {
      correctionId: correction.id,
      left: centsToDecimal(left),
    });
  return correction;
}

/** Refuses `invoice_correction.already_open` while the sale has an open correction. */
export async function refuseWhileCorrectionOpen(tx: Transaction, saleId: string): Promise<void> {
  const [open] = await tx
    .select({ id: invoiceCorrections.id })
    .from(invoiceCorrections)
    .where(
      and(eq(invoiceCorrections.originalSaleId, saleId), eq(invoiceCorrections.state, "open")),
    );
  if (open !== undefined)
    throw new AppError("invoice_correction.already_open", { saleId, correctionId: open.id });
}

export async function linkRefundToCorrection(
  tx: Transaction,
  link: { invoiceCorrectionId: string; tenderRefundId: string; requestId: string },
): Promise<void> {
  await tx.insert(invoiceCorrectionRefunds).values(link);
}
