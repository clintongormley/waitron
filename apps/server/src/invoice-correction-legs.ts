import { and, asc, eq } from "drizzle-orm";
import {
  invoiceCorrectionRefunds,
  invoiceCorrections,
  tenderRefunds,
  tenders,
  type Transaction,
} from "@waitron/db";
import { AppError, centsToDecimal } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import "./errors.js";

export interface CorrectionMoney {
  completed: number;
  pending: number;
  pendingRefundId: string | null;
  firstCompletedAt: string | null;
}

/** A correction's refunds, oldest link first and, among links made at one time, oldest payment
 * first; and the money they have given back and still hold pending, in cents; failed refunds count
 * nothing. */
export async function readCorrectionLegs(
  tx: Transaction,
  correctionId: string,
): Promise<{ refunds: (typeof tenderRefunds.$inferSelect)[]; money: CorrectionMoney }> {
  const refunds = (
    await tx
      .select({ refund: tenderRefunds })
      .from(invoiceCorrectionRefunds)
      .innerJoin(tenderRefunds, eq(tenderRefunds.id, invoiceCorrectionRefunds.tenderRefundId))
      .innerJoin(tenders, eq(tenders.id, tenderRefunds.tenderId))
      .where(eq(invoiceCorrectionRefunds.invoiceCorrectionId, correctionId))
      .orderBy(
        asc(invoiceCorrectionRefunds.createdAt),
        asc(tenders.settledAt),
        asc(tenders.id),
        asc(invoiceCorrectionRefunds.id),
      )
  ).map(({ refund }) => refund);
  const money: CorrectionMoney = {
    completed: 0,
    pending: 0,
    pendingRefundId: null,
    firstCompletedAt: null,
  };
  for (const leg of refunds) {
    if (leg.state === "completed") {
      money.completed += leg.appliedAmount;
      if (
        leg.completedAt !== null &&
        (money.firstCompletedAt === null || leg.completedAt < money.firstCompletedAt)
      )
        money.firstCompletedAt = leg.completedAt;
    } else if (leg.state === "pending") {
      money.pending += leg.appliedAmount;
      money.pendingRefundId ??= leg.id;
    }
  }
  return { refunds, money };
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
  link: {
    invoiceCorrectionId: string;
    tenderRefundId: string;
    requestId: string;
    createdAt: string;
  },
): Promise<void> {
  await tx.insert(invoiceCorrectionRefunds).values(link);
}
