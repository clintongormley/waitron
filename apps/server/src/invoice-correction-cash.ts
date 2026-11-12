import { randomUUID } from "node:crypto";
import type { Transaction } from "@waitron/db";
import type { Authorization, AuthzInput } from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  type Decimal,
} from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import {
  correctionLeft,
  readCorrectionLegs,
  readCorrectionMoney,
  readCorrectionRow,
} from "./invoice-correction-legs.js";
import {
  appliedRemainingOf,
  fileCorrectionIn,
  moneyOf,
  readInvoiceCorrection,
  uuidOf,
  type InvoiceCorrectionDeps,
  type InvoiceCorrectionView,
} from "./invoice-corrections.js";
import { enqueueTenderRefundDrawer } from "./receipt-print.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { carryNewTenderRefund } from "./tender-refund-completion.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import { toTenderRefundView } from "./tender-refunds.js";
import type { TenderRefundView } from "./tender-refund-types.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import "./errors.js";

const ZERO = decimal("0.00");

/** The request's submission id, canonical, and its amount; refused by field when malformed or zero. */
export function parseCorrectionCash(request: { submissionId: unknown; amount: unknown }): {
  submissionId: string;
  amount: Decimal;
} {
  const submissionId = uuidOf(request.submissionId, "submissionId");
  const amount = moneyOf(request.amount, "amount");
  if (compareDecimal(amount, ZERO) === 0) throw invalid("amount");
  return { submissionId, amount };
}

/** The sale's cash payments still holding money paid for the sale, oldest first: a correction gives
 * back no tip, so a payment holding only its tip is left out. */
async function readCashLeft(tx: Transaction, saleId: string) {
  return (await readRefundableTenders(tx, saleId)).filter(
    (row) => row.method === "cash" && compareDecimal(decimal(row.appliedRemaining), ZERO) > 0,
  );
}

/**
 * Gives `request.amount` of the open correction `correctionId` back in cash, spread over the
 * invoice's cash payments oldest first with one drawer opening, and, once the money back reaches the
 * correction's gross, files its R5 in the same transaction: a refused filing undoes the cash and the
 * drawer job. A repeat of the same submission answers its first legs.
 */
export async function giveCorrectionCash(
  tx: Transaction,
  deps: InvoiceCorrectionDeps,
  cfg: DeviceRequestConfig,
  correctionId: string,
  ask: { submissionId: string; amount: Decimal },
  actor: { personId: string; authz: AuthzInput; authorization: Authorization },
): Promise<{ correction: InvoiceCorrectionView; refunds: TenderRefundView[]; replayed: boolean }> {
  const correction = await readCorrectionRow(tx, correctionId);
  const legs = await readCorrectionLegs(tx, correctionId);
  // One request's links share one time, so these stay in payment order.
  const earlier = legs.refunds.filter((_, i) => legs.requestIds[i] === ask.submissionId);
  if (earlier.length > 0) {
    const given = earlier.reduce((sum, refund) => sum + refund.appliedAmount, 0);
    if (given !== decimalToCents(ask.amount))
      throw new AppError("submission.id_reused", { submissionId: ask.submissionId });
    return {
      correction: await readInvoiceCorrection(tx, deps.backend, cfg, correctionId),
      refunds: earlier.map(toTenderRefundView),
      replayed: true,
    };
  }
  if (correction.state !== "open")
    throw new AppError("invoice_correction.not_open", { correctionId, state: correction.state });

  const amount = decimalToCents(ask.amount);
  const payments = await readCashLeft(tx, correction.originalSaleId);
  const cashLeft = decimalToCents(appliedRemainingOf(payments));
  if (cashLeft < amount)
    throw new AppError("invoice_correction.cash_short", {
      correctionId,
      cashLeft: centsToDecimal(cashLeft),
      amount: ask.amount,
    });
  let unclaimed = correctionLeft(correction, legs.money);
  if (amount > unclaimed)
    throw new AppError("invoice_correction.leg_too_large", {
      correctionId,
      left: centsToDecimal(unclaimed),
    });

  const reading = deps.clock.now();
  const createdAt = reading.instant.toISOString();
  const refunds: TenderRefundView[] = [];
  let left = amount;
  for (const payment of payments) {
    if (left === 0) break;
    const leg = Math.min(left, decimalToCents(decimal(payment.appliedRemaining)));
    left -= leg;
    const { refund: reserved } = await reserveTenderRefund(
      tx,
      cfg,
      correction.originalSaleId,
      {
        submissionId: randomUUID(),
        tenderId: payment.tenderId,
        appliedAmount: centsToDecimal(leg),
        tipAmount: "0.00",
        reason: correction.reason,
        invoiceCorrection: { id: correctionId, requestId: ask.submissionId, cashRoute: true },
      },
      {
        requestedBy: actor.personId,
        authorizedBy: actor.authorization.authorizedBy,
      },
      createdAt,
      { correction, left: unclaimed },
    );
    unclaimed -= leg;
    const refund = await carryNewTenderRefund(
      tx,
      deps,
      cfg.nodeId,
      reading,
      reserved,
      refunds.length === 0
        ? {
            openDrawer: (done) =>
              enqueueTenderRefundDrawer(tx, cfg, done.id, actor.personId, actor.authorization),
          }
        : {},
    );
    refunds.push(toTenderRefundView(refund));
  }

  if ((await readCorrectionMoney(tx, correctionId)).completed === correction.gross)
    await fileCorrectionIn(tx, deps, cfg, correctionId, actor.authz, actor.personId);
  return {
    correction: await readInvoiceCorrection(tx, deps.backend, cfg, correctionId),
    refunds,
    replayed: false,
  };
}
